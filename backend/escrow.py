# backend/escrow.py
"""
THE FINANCIAL ENGINE
====================
This is the most critical file in the entire project.
Every dollar flows through here.

RULES that must NEVER be broken:
1. Never update a balance without a matching transaction row
2. Every state change is recorded with a timestamp
3. Rake always goes to OWNER_TELEGRAM_ID — never anywhere else
4. A match can only be settled ONCE (idempotency check)
5. If ANYTHING fails mid-operation, the whole thing rolls back
"""

import os, uuid, time
from decimal import Decimal, ROUND_HALF_UP
from datetime import datetime, timezone

# ─── Your owner account ID (your Telegram user ID) ───────────────────────────
# Go to @userinfobot in Telegram to get your ID
OWNER_TELEGRAM_ID = int(os.getenv("OWNER_TELEGRAM_ID", "0"))
RAKE_PERCENT      = Decimal("0.10")   # 10% to owner

# ─── In-memory store (replace with Supabase in production) ───────────────────
# Structure mirrors your PostgreSQL tables exactly
_users        = {}   # {telegram_id: UserRecord}
_matches      = {}   # {match_id: MatchRecord}
_transactions = []   # append-only list of TransactionRecord


class UserRecord:
    def __init__(self, telegram_id: int, username: str, first_name: str = None):
        self.id               = str(uuid.uuid4())
        self.telegram_id      = telegram_id
        self.username         = username
        self.first_name       = first_name or username
        self.playable_balance = Decimal("0")
        self.locked_balance   = Decimal("0")
        self.status           = "active"   # active | flagged | banned
        self.created_at       = datetime.now(timezone.utc)
        self.phone_number     = None

    def total_balance(self):
        return self.playable_balance + self.locked_balance

    def to_dict(self):
        return {
            "telegram_id":      self.telegram_id,
            "username":         self.username,
            "playable_balance": float(self.playable_balance),
            "locked_balance":   float(self.locked_balance),
            "status":           self.status,
            "phone_number":     self.phone_number,
        }


class MatchRecord:
    def __init__(self, match_id, white_id, black_id, stake):
        self.id           = match_id
        self.player_white = white_id     # telegram_id
        self.player_black = black_id     # telegram_id
        self.stake_amount = Decimal(str(stake))
        self.pool_amount  = Decimal(str(stake)) * 2
        self.winner_id    = None
        self.status       = "locked"     # locked | settled | refunded | disputed
        self.settled_at   = None


class TransactionRecord:
    def __init__(self, user_id, match_id, tx_type, amount, direction, note=""):
        self.id         = str(uuid.uuid4())
        self.user_id    = user_id       # telegram_id
        self.match_id   = match_id
        self.type       = tx_type       # escrow_lock | escrow_release | rake | deposit | withdrawal
        self.amount     = Decimal(str(amount))
        self.direction  = direction     # "in" or "out"
        self.note       = note
        self.created_at = datetime.now(timezone.utc)

    def to_dict(self):
        return {
            "id":         self.id,
            "type":       self.type,
            "amount":     float(self.amount),
            "direction":  self.direction,
            "note":       self.note,
            "created_at": self.created_at.isoformat(),
        }


# ─────────────────────────────────────────────────────────────────────────────
#  USER MANAGEMENT
# ─────────────────────────────────────────────────────────────────────────────

def get_or_create_user(telegram_id: int, username: str, first_name: str = None) -> UserRecord:
    """Get existing user or create a new one with zero balance."""
    if telegram_id not in _users:
        _users[telegram_id] = UserRecord(telegram_id, username, first_name)
    else:
        if username and _users[telegram_id].username != username:
            _users[telegram_id].username = username
        if first_name and getattr(_users[telegram_id], "first_name", None) != first_name:
            _users[telegram_id].first_name = first_name
    return _users[telegram_id]


def get_user(telegram_id: int) -> UserRecord:
    user = _users.get(telegram_id)
    if not user:
        raise ValueError(f"User {telegram_id} not found")
    return user


def admin_credit(telegram_id: int, amount: float, note: str = "manual_credit"):
    """
    OWNER ONLY — add funds to a user's playable balance.
    Used to credit confirmed deposits.
    """
    user = get_user(telegram_id)
    amount_d = Decimal(str(amount)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    user.playable_balance += amount_d
    tx = TransactionRecord(telegram_id, None, "deposit", amount_d, "in", note)
    _transactions.append(tx)
    return tx


# ─────────────────────────────────────────────────────────────────────────────
#  ESCROW LOCK
#  Called when BOTH players accept a match.
#  Deducts stake from each player's playable balance
#  and moves it to locked_balance.
# ─────────────────────────────────────────────────────────────────────────────

def lock_escrow(match_id: str, white_tg: int, black_tg: int, stake: float) -> MatchRecord:
    """
    ATOMIC: either BOTH players are charged, or NEITHER is.
    If one player doesn't have enough balance, the whole operation fails
    and no money moves.
    """
    if float(stake) == 0:
        return  # Free game — no escrow needed
    stake_d = Decimal(str(stake)).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    white   = get_user(white_tg)
    black   = get_user(black_tg)

    # ── Pre-flight checks (before touching any money) ──
    if white.status != "active":
        raise ValueError(f"White player account is {white.status}")
    if black.status != "active":
        raise ValueError(f"Black player account is {black.status}")
    if white.playable_balance < stake_d:
        raise ValueError(f"White player has insufficient balance (has {white.playable_balance}, needs {stake_d})")
    if black.playable_balance < stake_d:
        raise ValueError(f"Black player has insufficient balance (has {black.playable_balance}, needs {stake_d})")
    if match_id in _matches:
        raise ValueError("Match already has an escrow")

    # ── All checks passed — move money ──
    # White
    white.playable_balance -= stake_d
    white.locked_balance   += stake_d
    _transactions.append(TransactionRecord(
        white_tg, match_id, "escrow_lock", stake_d, "out",
        f"Locked for match {match_id[:8]}"
    ))

    # Black
    black.playable_balance -= stake_d
    black.locked_balance   += stake_d
    _transactions.append(TransactionRecord(
        black_tg, match_id, "escrow_lock", stake_d, "out",
        f"Locked for match {match_id[:8]}"
    ))

    # Create match record
    match = MatchRecord(match_id, white_tg, black_tg, stake_d)
    _matches[match_id] = match

    print(f"[ESCROW] Locked ${stake_d*2} for match {match_id[:8]} "
          f"(white:{white_tg}, black:{black_tg})")

    return match


# ─────────────────────────────────────────────────────────────────────────────
#  ESCROW SETTLEMENT — THE RAKE HAPPENS HERE
#
#  Pool = stake × 2
#  Winner gets = pool × 90%
#  Owner gets  = pool × 10%
#
#  Example: $5 stake each → $10 pool
#    → Winner receives $9.00
#    → Owner receives  $1.00
# ─────────────────────────────────────────────────────────────────────────────

def settle_match(match_id: str, winner_telegram_id: int) -> dict:
    """
    Pay the winner and send the rake to the owner.
    Can only be called ONCE per match (idempotency guard).
    """
    if match_id not in _matches:
        raise ValueError("Match not found")

    match = _matches[match_id]

    # ── Idempotency guard — prevent double-settlement ──
    if match.status in ("settled", "refunded"):
        raise ValueError(f"Match already {match.status} — cannot settle again")

    # ── Validate winner is actually a player in this match ──
    if winner_telegram_id not in (match.player_white, match.player_black):
        raise ValueError("Winner is not a participant in this match")

    loser_telegram_id = (
        match.player_black if winner_telegram_id == match.player_white
        else match.player_white
    )

    winner = get_user(winner_telegram_id)
    loser  = get_user(loser_telegram_id)
    owner  = get_or_create_user(OWNER_TELEGRAM_ID, "owner")

    pool        = match.pool_amount
    rake        = (pool * RAKE_PERCENT).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
    winner_gets = (pool - rake).quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)

    # ── Release locked funds ──
    winner.locked_balance -= match.stake_amount
    loser.locked_balance  -= match.stake_amount

    # ── Pay winner ──
    winner.playable_balance += winner_gets
    _transactions.append(TransactionRecord(
        winner_telegram_id, match_id, "escrow_release", winner_gets, "in",
        f"Won match {match_id[:8]} (after {int(RAKE_PERCENT*100)}% rake)"
    ))

    # ── Send rake to owner ──
    owner.playable_balance += rake
    _transactions.append(TransactionRecord(
        OWNER_TELEGRAM_ID, match_id, "rake", rake, "in",
        f"Rake from match {match_id[:8]}"
    ))

    # ── Mark match as settled ──
    match.status      = "settled"
    match.winner_id   = winner_telegram_id
    match.settled_at  = datetime.now(timezone.utc)

    summary = {
        "match_id":          match_id,
        "pool":              float(pool),
        "winner_telegram_id": winner_telegram_id,
        "winner_payout":     float(winner_gets),
        "rake_to_owner":     float(rake),
        "settled_at":        match.settled_at.isoformat(),
    }

    print(f"[SETTLE] Match {match_id[:8]}: "
          f"winner {winner_telegram_id} gets ${winner_gets}, "
          f"owner gets ${rake} rake")

    return summary


# ─────────────────────────────────────────────────────────────────────────────
#  DRAW / REFUND
#  If the game ends in a draw, stalemate, or disconnect
#  both players get their stake back with no rake.
# ─────────────────────────────────────────────────────────────────────────────

def refund_match(match_id: str, reason: str = "draw") -> dict:
    """Return stakes to both players. No rake on draws."""
    if match_id not in _matches:
        raise ValueError("Match not found")

    match = _matches[match_id]
    if match.status in ("settled", "refunded"):
        raise ValueError(f"Match already {match.status}")

    for player_id in (match.player_white, match.player_black):
        player = get_user(player_id)
        player.locked_balance   -= match.stake_amount
        player.playable_balance += match.stake_amount
        _transactions.append(TransactionRecord(
            player_id, match_id, "escrow_release", match.stake_amount, "in",
            f"Refund — {reason}"
        ))

    match.status     = "refunded"
    match.settled_at = datetime.now(timezone.utc)

    print(f"[REFUND] Match {match_id[:8]} refunded to both players ({reason})")

    return {
        "match_id": match_id,
        "reason": reason,
        "each_refunded": float(match.stake_amount),
    }


# ─────────────────────────────────────────────────────────────────────────────
#  BALANCE INQUIRY
# ─────────────────────────────────────────────────────────────────────────────

def get_balance(telegram_id: int) -> dict:
    user = get_user(telegram_id)
    return {
        "playable": float(user.playable_balance),
        "locked":   float(user.locked_balance),
        "total":    float(user.total_balance()),
        "status":   user.status,
    }


def get_transaction_history(telegram_id: int, limit: int = 20) -> list:
    user_txs = [t for t in _transactions if t.user_id == telegram_id]
    return [t.to_dict() for t in reversed(user_txs[-limit:])]


def record_bot_game(telegram_id: int, outcome: str, difficulty: str):
    """Log a bot match outcome to the transaction history."""
    tx_type = f"bot_{outcome}"  # bot_win | bot_loss | bot_draw
    direction = "in" if outcome == "win" else "out" if outcome == "loss" else "in"
    note = f"VS AI ({difficulty.capitalize()})"
    tx = TransactionRecord(
        user_id=telegram_id,
        match_id=str(uuid.uuid4()),
        tx_type=tx_type,
        amount=Decimal("0"),
        direction=direction,
        note=note
    )
    _transactions.append(tx)
    return tx


def get_owner_earnings() -> dict:
    """Owner-only view of total rake collected."""
    rake_txs = [t for t in _transactions
                if t.user_id == OWNER_TELEGRAM_ID and t.type == "rake"]
    total = sum(t.amount for t in rake_txs)
    return {
        "total_rake_collected": float(total),
        "total_matches_raked":  len(rake_txs),
        "transactions":         [t.to_dict() for t in reversed(rake_txs[-50:])],
    }
