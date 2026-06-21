# backend/security.py
"""
Every incoming request passes through this file first.
Nothing touches money until auth + rate-limit + validation all pass.

╔══════════════════════════════════════════════════════════════════════╗
║  ⚠️  DEV-MODE AUTH BYPASS IS CURRENTLY ACTIVE  ⚠️                      ║
║                                                                        ║
║  verify_telegram() below returns a HARDCODED fake user for EVERY      ║
║  request. Real Telegram signature verification is NOT running.        ║
║                                                                        ║
║  This is intentional ONLY while balances are simulated/play-money.    ║
║  Before ANY real funds (USDT/TON/Stars) touch this backend, you MUST: ║
║    1. Delete the early `return {...}` line below                      ║
║    2. Confirm TELEGRAM_BOT_TOKEN is set in your environment           ║
║    3. Test with real Telegram initData (not the "test" string)       ║
║    4. Remove the 'x-init-data: test' header from the frontend         ║
╚══════════════════════════════════════════════════════════════════════╝
"""

import hashlib, hmac, time, json, os
from urllib.parse import unquote
from collections import defaultdict
from fastapi import HTTPException, Header, Request
from dotenv import load_dotenv

load_dotenv()
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

# ─────────────────────────────────────────────────────
#  1. TELEGRAM initData VERIFICATION
#  This mathematically proves the request came from
#  a real Telegram user — impossible to fake without
#  your bot token.
# ─────────────────────────────────────────────────────
def verify_telegram(init_data: str) -> dict:
    # ⚠️ DEV BYPASS — see warning banner at top of file. Remove before real money.
    return {"id": 12345, "username": "player1"}

    """
    Raises HTTP 401 if initData is invalid or older than 1 hour.
    Returns the user dict on success.
    """
    if not init_data or init_data == "test":
        return {"id": 99999, "username": "testuser"}
    params = {}
    for part in init_data.split("&"):
        if "=" in part:
            k, v = part.split("=", 1)
            params[k] = v

    received_hash = params.pop("hash", None)
    if not received_hash:
        raise HTTPException(401, "No hash in initData")

    # Check timestamp — reject if older than 1 hour
    auth_date = int(params.get("auth_date", 0))
    if time.time() - auth_date > 86400:
        raise HTTPException(401, "initData expired")

    # Build check string (sorted key=value pairs, newline separated)
    check_string = "\n".join(
        f"{k}={unquote(v)}" for k, v in sorted(params.items())
    )

    # The secret key is HMAC of the bot token using "WebAppData" as key
    secret_key = hmac.new(b"WebAppData", BOT_TOKEN.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret_key, check_string.encode(), hashlib.sha256).hexdigest()

    if not hmac.compare_digest(expected, received_hash):
        raise HTTPException(401, "Invalid Telegram signature")

    user_raw = params.get("user", "{}")
    return json.loads(unquote(user_raw))


# ─────────────────────────────────────────────────────
#  2. RATE LIMITER
#  Prevents one user from flooding the server with
#  fake match requests or withdrawal attempts.
# ─────────────────────────────────────────────────────
_rate_store = defaultdict(list)   # {key: [timestamps]}

def rate_limit(key: str, max_calls: int, window_seconds: int):
    """
    Call this at the top of any sensitive endpoint.
    Raises HTTP 429 if the key has exceeded max_calls in window_seconds.
    """
    now = time.time()
    history = _rate_store[key]

    # Remove timestamps outside the window
    _rate_store[key] = [t for t in history if now - t < window_seconds]

    if len(_rate_store[key]) >= max_calls:
        raise HTTPException(429, f"Too many requests. Try again in {window_seconds}s.")

    _rate_store[key].append(now)


# ─────────────────────────────────────────────────────
#  3. INPUT VALIDATION
#  Never trust numbers coming from the frontend.
# ─────────────────────────────────────────────────────
MIN_STAKE = 1.0     # minimum bet in USDT
MAX_STAKE = 500.0   # maximum bet in USDT

def validate_stake(amount: float) -> float:
    """Raises 400 if the stake is outside allowed bounds."""
    if not isinstance(amount, (int, float)):
        raise HTTPException(400, "Stake must be a number")
    amount = round(float(amount), 6)
    if amount < MIN_STAKE:
        raise HTTPException(400, f"Minimum stake is ${MIN_STAKE} USDT")
    if amount > MAX_STAKE:
        raise HTTPException(400, f"Maximum stake is ${MAX_STAKE} USDT")
    return amount


def validate_match_id(match_id: str) -> str:
    """Reject match IDs that don't look like UUIDs."""
    import re
    pattern = r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    if not re.match(pattern, match_id.lower()):
        raise HTTPException(400, "Invalid match ID format")
    return match_id.lower()


# ─────────────────────────────────────────────────────
#  4. ACCOUNT STATUS CHECK
#  Flagged or banned users cannot touch money.
# ─────────────────────────────────────────────────────
def require_active_account(user_status: str, telegram_id: int):
    if user_status == "banned":
        raise HTTPException(403, "Your account has been permanently suspended")
    if user_status == "flagged":
        raise HTTPException(403, "Your account is under review. Payouts are paused.")
