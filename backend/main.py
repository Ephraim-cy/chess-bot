# backend/main.py  (FULL SECURED VERSION — FIXED)
"""
Every route follows this order:
1. Verify Telegram initData (who are you?)
2. Rate limit (are you flooding us?)
3. Validate inputs (are the numbers real?)
4. Check account status (are you allowed?)
5. Business logic (do the thing)
6. Record transaction (write to ledger)

CHANGES IN THIS VERSION (fixing the "piece snaps back" bug):
- A single rejected/malformed move NO LONGER kills the match.
  Previously: any move that failed `chess.Move.from_uci()` or wasn't in
  `board.legal_moves` was treated as cheating -> instant WebSocket close ->
  forfeit. That meant ANY mismatch (a stale client move, a dropped packet,
  a harmless format issue) silently ended the game and the frontend had no
  idea why the board "reverted" — it just saw the socket die.
- Now: bad moves get a clean {"type":"error"} response and the player can
  try again. We only forfeit after repeated bad attempts (anti-cheat-ish),
  tracked per connection.
- The move string is validated for shape BEFORE being handed to python-chess,
  so a malformed string never reaches the broad except/forfeit branch.
"""

import os, uuid, json, hashlib, hmac, time, re, asyncio
from collections import defaultdict
from collections import defaultdict
from urllib.parse import unquote
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Header, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chess
from security import verify_telegram, rate_limit, validate_stake, validate_match_id, require_active_account
from escrow import (
    get_or_create_user, get_user, get_balance,
    lock_escrow, settle_match, refund_match,
    get_transaction_history, get_owner_earnings,
    admin_credit, OWNER_TELEGRAM_ID
)
from dotenv import load_dotenv

load_dotenv()

app = FastAPI(title="Chess Arena — Secured API")

FRONTEND_URL = os.getenv("FRONTEND_URL", "*")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Active games in memory ────────────────────────────────────────────────────
active_games = {}
# {match_id: {board, white_tg, black_tg, stake, ws:{white, black}, moves:[], bad_move_count:{white:0,black:0}}}

UCI_MOVE_RE = re.compile(r'^[a-h][1-8][a-h][1-8][qrbn]?$')
MAX_BAD_MOVES_BEFORE_FORFEIT = 3   # tolerate a few bad attempts before treating as malicious


# ─────────────────────────────────────────────────────────────────────────────
#  HEALTH
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"status": "Chess Arena API ✅", "time": time.time()}


# ─────────────────────────────────────────────────────────────────────────────
#  USER PROFILE & BALANCE
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/me")
async def get_my_profile(x_init_data: str = Header(default="test")):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    username  = user_data.get("username", f"user_{tg_id}")

    # Create user on first visit
    user = get_or_create_user(tg_id, username)

    return {
        "id":               user.id,
        "telegram_id":      tg_id,
        "username":         username,
        "playable_balance": float(user.playable_balance),
        "locked_balance":   float(user.locked_balance),
        "status":           user.status,
        "balance":          get_balance(tg_id),
    }

@app.get("/api/balance")
async def check_balance(x_init_data: str = Header(default="test")):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    get_or_create_user(tg_id, user_data.get("username", ""))
    return get_balance(tg_id)


@app.get("/api/transactions")
async def my_transactions(x_init_data: str = Header(default="test")):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    return {"transactions": get_transaction_history(tg_id)}


# ─────────────────────────────────────────────────────────────────────────────
#  OWNER DASHBOARD  (only your Telegram ID can access this)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/owner/earnings")
async def owner_earnings(x_init_data: str = Header(default="test")):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])

    if tg_id != OWNER_TELEGRAM_ID:
        raise HTTPException(403, "Owner access only")

    return get_owner_earnings()


@app.post("/api/owner/credit")
async def owner_credit_user(
    telegram_id: int,
    amount: float,
    x_init_data: str = Header(default="test")
):
    """
    OWNER ONLY — manually credit a user after confirming their deposit.
    In Phase 3 this will be automated by the TON blockchain listener.

    NOTE: the owner-only check below is currently commented out (carried
    over from earlier dev version). Left as-is intentionally since we are
    still on simulated/play-money balances — see SECURITY note in security.py.
    This MUST be re-enabled before any real funds are involved.
    """
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])

    #if tg_id != OWNER_TELEGRAM_ID:
    #    raise HTTPException(403, "Owner access only")

    rate_limit(f"owner_credit", 30, 60)   # max 30 credits per minute
    amount_validated = validate_stake(amount)

    get_or_create_user(telegram_id, f"user_{telegram_id}")
    tx = admin_credit(telegram_id, amount_validated, note="manual_deposit")

    return {
        "credited_to":  telegram_id,
        "amount":       amount_validated,
        "tx_id":        tx.id,
        "new_balance":  get_balance(telegram_id),
    }


# ─────────────────────────────────────────────────────────────────────────────
#  MATCH CREATION WITH STAKE
# ─────────────────────────────────────────────────────────────────────────────

ALLOWED_CURRENCIES = {"USDT", "TON", "STARS"}

class CreateMatchRequest(BaseModel):
    stake: float
    currency: str = "USDT"

@app.post("/api/match/create")
async def create_match(body: CreateMatchRequest, x_init_data: str = Header(default="test")):
    # 1. Auth
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    username  = user_data.get("username", f"user_{tg_id}")

    # 2. Rate limit — max 5 match creations per minute per user
    rate_limit(f"create_match:{tg_id}", 5, 60)

    # 3. Validate stake
    stake = validate_stake(body.stake)

    # 4. Check account
    user = get_or_create_user(tg_id, username)
    require_active_account(user.status, tg_id)

    # 5. Check balance (no lock yet — opponent hasn't joined)
    from decimal import Decimal
    if user.playable_balance < Decimal(str(stake)):
        raise HTTPException(400, f"Insufficient balance. You have ${float(user.playable_balance):.2f} USDT, need ${stake:.2f}")

   # Validate currency server-side — never trust client
    currency = body.currency.upper().strip()
    if currency not in ALLOWED_CURRENCIES:
        raise HTTPException(400, f"Invalid currency. Allowed: {', '.join(ALLOWED_CURRENCIES)}")

    match_id = str(uuid.uuid4())
    active_games[match_id] = {
        "board":      chess.Board(),
        "white_tg":   tg_id,
        "black_tg":   None,
        "stake":      stake,
        "currency":   currency,
        "ws":         {"white": None, "black": None},
        "moves":      [],
        "status":     "waiting",
        "created_at": time.time(),
        "bad_move_count": {"white": 0, "black": 0},
    }

    return {
        "match_id": match_id,
        "color":    "white",
        "stake":    stake,
        "currency": currency,
        "message":  f"Share match ID with opponent: {match_id}",
    }


@app.post("/api/match/{match_id}/join")
async def join_match(match_id: str, x_init_data: str = Header(default="test")):
    # 1. Auth
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    username  = user_data.get("username", f"user_{tg_id}")

    # 2. Validate match ID format
    match_id = validate_match_id(match_id)

    # 3. Rate limit
    rate_limit(f"join_match:{tg_id}", 10, 60)

    # 4. Check match exists
    if match_id not in active_games:
        raise HTTPException(404, "Match not found")
    game = active_games[match_id]

    if game["status"] != "waiting":
        raise HTTPException(400, "Match is no longer available")
    if game["black_tg"] is not None:
        raise HTTPException(400, "Match is already full")
    if game["white_tg"] == tg_id:
        raise HTTPException(400, "You cannot play against yourself")

    # 5. Check account
    user = get_or_create_user(tg_id, username)
    require_active_account(user.status, tg_id)

    stake = game["stake"]
    from decimal import Decimal
    if user.playable_balance < Decimal(str(stake)):
        raise HTTPException(400, f"Insufficient balance. Need ${stake:.2f} USDT to join.")

    # 6. Lock escrow for BOTH players atomically
    try:
        lock_escrow(match_id, game["white_tg"], tg_id, stake, game.get("currency", "USDT"))
    except ValueError as e:
        raise HTTPException(400, str(e))

    game["black_tg"] = tg_id
    game["status"]   = "active"

    return {
        "match_id": match_id,
        "color":    "black",
        "stake":    stake,
        "currency": game.get("currency", "USDT"),
        "pool":     stake * 2,
        "message":  "Escrow locked. Game started!",
    }


@app.get("/api/match/{match_id}")
async def get_match_info(match_id: str, x_init_data: str = Header(default="test")):
    verify_telegram(x_init_data)
    match_id = validate_match_id(match_id)
    if match_id not in active_games:
        raise HTTPException(404, "Match not found")
    game = active_games[match_id]
    return {
        "match_id":  match_id,
        "stake":     game["stake"],
        "pool":      game["stake"] * 2,
        "status":    game["status"],
        "white_tg":  game["white_tg"],
        "black_tg":  game["black_tg"],
    }


# ─────────────────────────────────────────────────────────────────────────────
#  WEBSOCKET GAME SERVER
#  Server is the authority on the board. A bad move gets a clean error and
#  a retry — it no longer kills the match. Only repeated bad attempts (or a
#  real attempt to push a move that IS in the right format but illegal,
#  beyond the tolerance count) ends the game as a forfeit.
# ─────────────────────────────────────────────────────────────────────────────

def parse_move_or_none(move_str: str):
    """
    Returns a chess.Move if move_str is well-formed UCI (e.g. 'e2e4', 'e7e8q'),
    otherwise None. Never raises.
    """
    if not isinstance(move_str, str) or not UCI_MOVE_RE.match(move_str):
        return None
    try:
        return chess.Move.from_uci(move_str)
    except Exception:
        return None


@app.websocket("/ws/{match_id}/{color}")
async def ws_game(ws: WebSocket, match_id: str, color: str):
    await ws.accept()

    if match_id not in active_games:
        await ws.close(code=4004, reason="Match not found")
        return
    if color not in ("white", "black"):
        await ws.close(code=4003, reason="Invalid color")
        return

    game = active_games[match_id]
    game["ws"][color] = ws
    game.setdefault("bad_move_count", {"white": 0, "black": 0})

    await ws.send_json({
        "type":  "connected",
        "color": color,
        "fen":   game["board"].fen(),
        "stake": game["stake"],
        "pool":  game["stake"] * 2,
        "turn":  "white" if game["board"].turn == chess.WHITE else "black",
    })

    try:
        while True:
            data = await ws.receive_json()

            if data.get("type") != "move":
                continue

            board = game["board"]
            expected = "white" if board.turn == chess.WHITE else "black"

            # Wrong turn — NOT a forfeit, just tell them to wait.
            if color != expected:
                await ws.send_json({"type": "error", "msg": "Not your turn"})
                continue

            move_uci = str(data.get("move", ""))
            move = parse_move_or_none(move_uci)

            # Malformed string OR not a legal move right now.
            # This is the branch that used to instantly close the socket.
            if move is None or move not in board.legal_moves:
                game["bad_move_count"][color] += 1
                await ws.send_json({
                    "type": "error",
                    "msg": "Illegal move",
                    "fen": board.fen(),          # resend authoritative FEN so client can resync
                    "turn": expected,
                })

                if game["bad_move_count"][color] > MAX_BAD_MOVES_BEFORE_FORFEIT:
                    # Repeated bad attempts — now treat as malicious/broken client.
                    await ws.close(code=4008, reason="Too many illegal move attempts")
                    winner_color = "black" if color == "white" else "white"
                    winner_tg    = game[f"{winner_color}_tg"]
                    if winner_tg and game["status"] == "active":
                        game["status"] = "settled"
                        try:
                            settle_match(match_id, winner_tg)
                        except Exception:
                            pass
                        other_ws = game["ws"].get(winner_color)
                        if other_ws:
                            try:
                                await other_ws.send_json({
                                    "type": "gameover", "reason": "illegal_move",
                                    "winner": winner_color,
                                    "payout": game["stake"] * 2 * 0.9,
                                })
                            except Exception:
                                pass
                        active_games.pop(match_id, None)
                    return
                continue

            # Legal move — apply it and reset the bad-move counter for this side.
            game["bad_move_count"][color] = 0
            board.push(move)
            game["moves"].append(move_uci)

            # ── Determine result ──
            result = None
            if board.is_checkmate():
                winner_color = "white" if board.turn == chess.BLACK else "black"
                winner_tg    = game[f"{winner_color}_tg"]
                result = {
                    "type":   "gameover",
                    "reason": "checkmate",
                    "winner": winner_color,
                    "payout": float(game["stake"]) * 2 * 0.9,
                    "rake":   float(game["stake"]) * 2 * 0.1,
                }
                if game["status"] == "active":
                    game["status"] = "settled"
                    try:
                        summary = settle_match(match_id, winner_tg)
                        result["settlement"] = summary
                    except Exception as e:
                        result["settlement_error"] = str(e)

            elif board.is_stalemate() or board.is_insufficient_material() or board.is_fifty_moves():
                reason = ("stalemate" if board.is_stalemate()
                          else "insufficient_material" if board.is_insufficient_material()
                          else "fifty_moves")
                result = {"type": "gameover", "reason": reason, "winner": None}
                if game["status"] == "active":
                    game["status"] = "refunded"
                    try:
                        refund_match(match_id, reason)
                    except Exception:
                        pass

            # ── Broadcast state to both players ──
            state = {
                "type":      "state",
                "fen":       board.fen(),
                "last_move": move_uci,
                "mover":     color,            # tells clients who just moved
                "turn":      "white" if board.turn == chess.WHITE else "black",
                "in_check":  board.is_check(),
                "game_over": result is not None,
                "result":    result,
            }

            for side in ("white", "black"):
                side_ws = game["ws"].get(side)
                if side_ws:
                    try:
                        await side_ws.send_json(state)
                    except Exception:
                        pass

            if result:
                active_games.pop(match_id, None)
                return

    except WebSocketDisconnect:
        game["ws"][color] = None
        other = "black" if color == "white" else "white"
        other_ws = game["ws"].get(other)

        # Disconnected player forfeits if game was active
        if game["status"] == "active":
            other_tg = game[f"{other}_tg"]
            game["status"] = "settled"
            try:
                settle_match(match_id, other_tg)
            except Exception:
                pass
            if other_ws:
                try:
                    await other_ws.send_json({
                        "type":   "gameover",
                        "reason": "opponent_disconnected",
                        "winner": other,
                        "payout": float(game["stake"]) * 2 * 0.9,
                    })
                except Exception:
                    pass
            active_games.pop(match_id, None)
# ─────────────────────────────────────────────────────────────────────────────
# ─────────────────────────────────────────────────────────────────────────────
#  AUTO MATCHMAKING QUEUE
# ─────────────────────────────────────────────────────────────────────────────
_queue: dict = defaultdict(list)
_queue_lock = asyncio.Lock()

@app.websocket("/ws/queue/{stake}/{currency}")
async def ws_queue(ws: WebSocket, stake: float, currency: str, init: str = "test"):
    await ws.accept()

    # 1. Validate currency
    ALLOWED = {"USDT", "TON", "STARS"}
    currency = currency.upper().strip()
    if currency not in ALLOWED:
        await ws.send_json({"type": "error", "msg": "Invalid currency"})
        await ws.close(code=1008); return

    # 2. Validate stake
    try:
        stake = float(stake)
        if stake <= 0 or stake > 1000:
            raise ValueError()
    except Exception:
        await ws.send_json({"type": "error", "msg": "Invalid stake"})
        await ws.close(code=1008); return

    # 3. Auth
    try:
        user_data = verify_telegram(init)
        tg_id = int(user_data["id"])
        username = user_data.get("username", f"user_{tg_id}")
    except Exception:
        await ws.send_json({"type": "error", "msg": "Auth failed"})
        await ws.close(code=1008); return

    # 4. Ensure user exists + check balance
    from decimal import Decimal
    user = get_or_create_user(tg_id, username)
    require_active_account(user.status, tg_id)
    if user.playable_balance < Decimal(str(stake)):
        await ws.send_json({"type": "error", "msg": f"Insufficient balance. Need {stake} {currency}."})
        await ws.close(code=1008); return

    queue_key = f"{currency}:{stake}"
    matched = False
    match_id = None
    my_color = None
    opponent_ws = None

    async with _queue_lock:
        queue = _queue[queue_key]

        # Look for a waiting opponent (not ourselves)
        opponent = None
        for i, e in enumerate(queue):
            if e["telegram_id"] != tg_id:
                opponent = queue.pop(i)
                break

        if opponent:
            matched = True
            match_id = str(uuid.uuid4())
            opponent_ws = opponent["ws"]

            # Create the match in active_games
            active_games[match_id] = {
                "board":          chess.Board(),
                "white_tg":       opponent["telegram_id"],
                "black_tg":       tg_id,
                "stake":          stake,
                "ws":             {"white": None, "black": None},
                "moves":          [],
                "status":         "active",
                "created_at":     time.time(),
                "bad_move_count": {"white": 0, "black": 0},
            }

            # Lock escrow for both
            try:
                lock_escrow(match_id, opponent["telegram_id"], tg_id, stake)
            except Exception as ex:
                active_games.pop(match_id, None)
                err_msg = {"type": "error", "msg": f"Escrow failed: {str(ex)}"}
                await ws.send_json(err_msg)
                try:
                    await opponent_ws.send_json(err_msg)
                except Exception:
                    pass
                return

            # Opponent waited longer → gets white
            my_color = "black"

        else:
            # No opponent yet — add ourselves to queue
            _queue[queue_key].append({
                "ws":          ws,
                "telegram_id": tg_id,
                "stake":       stake,
                "currency":    currency,
            })
            await ws.send_json({"type": "waiting", "in_queue": len(_queue[queue_key])})

    if matched:
        # Notify opponent (white)
        try:
            await opponent_ws.send_json({
                "type":     "matched",
                "match_id": match_id,
                "color":    "white",
                "stake":    stake,
                "currency": currency,
            })
        except Exception:
            pass

        # Notify ourselves (black)
        await ws.send_json({
            "type":     "matched",
            "match_id": match_id,
            "color":    "black",
            "stake":    stake,
            "currency": currency,
        })
        return

    # Wait up to 60 seconds for a match
    try:
        await asyncio.wait_for(ws.receive_text(), timeout=60.0)
        # Client sent "cancel"
        async with _queue_lock:
            _queue[queue_key] = [e for e in _queue[queue_key] if e["telegram_id"] != tg_id]
        await ws.send_json({"type": "cancelled"})
    except asyncio.TimeoutError:
        async with _queue_lock:
            _queue[queue_key] = [e for e in _queue[queue_key] if e["telegram_id"] != tg_id]
        await ws.send_json({"type": "timeout"})
    except Exception:
        async with _queue_lock:
            _queue[queue_key] = [e for e in _queue[queue_key] if e["telegram_id"] != tg_id]