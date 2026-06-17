# backend/main.py  (FULL SECURED VERSION)
"""
Every route follows this order:
1. Verify Telegram initData (who are you?)
2. Rate limit (are you flooding us?)
3. Validate inputs (are the numbers real?)
4. Check account status (are you allowed?)
5. Business logic (do the thing)
6. Record transaction (write to ledger)
"""

import os, uuid, json, hashlib, hmac, time
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
# {match_id: {board, white_tg, black_tg, stake, ws:{white, black}, moves:[]}}


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
async def get_my_profile(x_init_data: str = Header(...)):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    username  = user_data.get("username", f"user_{tg_id}")

    # Create user on first visit
    user = get_or_create_user(tg_id, username)

    return {
        "telegram_id": tg_id,
        "username":    username,
        "balance":     get_balance(tg_id),
    }


@app.get("/api/balance")
async def check_balance(x_init_data: str = Header(...)):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    get_or_create_user(tg_id, user_data.get("username", ""))
    return get_balance(tg_id)


@app.get("/api/transactions")
async def my_transactions(x_init_data: str = Header(...)):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])
    return {"transactions": get_transaction_history(tg_id)}


# ─────────────────────────────────────────────────────────────────────────────
#  OWNER DASHBOARD  (only your Telegram ID can access this)
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/api/owner/earnings")
async def owner_earnings(x_init_data: str = Header(...)):
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])

    if tg_id != OWNER_TELEGRAM_ID:
        raise HTTPException(403, "Owner access only")

    return get_owner_earnings()


@app.post("/api/owner/credit")
async def owner_credit_user(
    telegram_id: int,
    amount: float,
    x_init_data: str = Header(...)
):
    """
    OWNER ONLY — manually credit a user after confirming their deposit.
    In Phase 3 this will be automated by the TON blockchain listener.
    """
    user_data = verify_telegram(x_init_data)
    tg_id     = int(user_data["id"])

    if tg_id != OWNER_TELEGRAM_ID:
        raise HTTPException(403, "Owner access only")

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

class CreateMatchRequest(BaseModel):
    stake: float       # USDT amount each player bets

@app.post("/api/match/create")
async def create_match(body: CreateMatchRequest, x_init_data: str = Header(...)):
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

    match_id = str(uuid.uuid4())
    active_games[match_id] = {
        "board":    chess.Board(),
        "white_tg": tg_id,
        "black_tg": None,
        "stake":    stake,
        "ws":       {"white": None, "black": None},
        "moves":    [],
        "status":   "waiting",
        "created_at": time.time(),
    }

    return {
        "match_id": match_id,
        "color":    "white",
        "stake":    stake,
        "message":  f"Share match ID with opponent: {match_id}",
    }


@app.post("/api/match/{match_id}/join")
async def join_match(match_id: str, x_init_data: str = Header(...)):
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
        lock_escrow(match_id, game["white_tg"], tg_id, stake)
    except ValueError as e:
        raise HTTPException(400, str(e))

    game["black_tg"] = tg_id
    game["status"]   = "active"

    return {
        "match_id": match_id,
        "color":    "black",
        "stake":    stake,
        "pool":     stake * 2,
        "message":  "Escrow locked. Game started!",
    }


@app.get("/api/match/{match_id}")
async def get_match_info(match_id: str, x_init_data: str = Header(...)):
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
#  Illegal move = instant disconnect (server is authority)
# ─────────────────────────────────────────────────────────────────────────────

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

            # Wrong turn
            if color != expected:
                await ws.send_json({"type": "error", "msg": "Not your turn"})
                continue

            # Validate and apply move (server is the authority)
            move_uci = str(data.get("move", ""))
            try:
                move = chess.Move.from_uci(move_uci)
                if move not in board.legal_moves:
                    raise ValueError("Illegal move")
                board.push(move)
                game["moves"].append(move_uci)
            except Exception:
                # Illegal move attempt = immediate disconnect, match treated as forfeit
                await ws.close(code=4008, reason="Illegal move")
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
                return

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
                # Settle immediately on game end
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
                del active_games[match_id]
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
