"""
auth_service.py — Lightweight PIN & Passcode Protection for Linus LAN Deployments

Allows securing the Linus instance when exposed on LAN or public networks.
Can be configured via:
  1. Environment variable LINUS_PASSCODE in .env
  2. Stored passcode in db_store app_state
"""

import hashlib
import hmac
import os
import time
from typing import Optional
import db_store as db

# Secret key for signing session tokens
_SECRET_KEY = os.environ.get("LINUS_SECRET_KEY", "linus-default-secret-salt-2026")


def _get_configured_passcode() -> str:
    """Returns the active passcode from environment or db store."""
    env_pin = os.environ.get("LINUS_PASSCODE", "").strip()
    if env_pin:
        return env_pin
    try:
        return db.get_app_state("linus_passcode", "").strip()
    except Exception:
        return ""


def is_auth_required() -> bool:
    """True if a passcode is set and protection is active."""
    return bool(_get_configured_passcode())


def verify_passcode(passcode: str) -> bool:
    """Checks if the entered passcode matches the configured one."""
    expected = _get_configured_passcode()
    if not expected:
        return True
    return hmac.compare_digest(str(passcode).strip(), expected)


def generate_session_token() -> str:
    """Generates a signed session token valid for 30 days."""
    passcode = _get_configured_passcode()
    ts = str(int(time.time()))
    signature = hmac.new(
        _SECRET_KEY.encode("utf-8"),
        f"{passcode}:{ts}".encode("utf-8"),
        hashlib.sha256
    ).hexdigest()
    return f"{ts}:{signature}"


def validate_session_token(token: str) -> bool:
    """Validates if the session token is authentic and unexpired."""
    if not is_auth_required():
        return True
    if not token or ":" not in token:
        return False
    try:
        ts_str, signature = token.split(":", 1)
        ts = int(ts_str)
        # Expire after 30 days
        if time.time() - ts > 30 * 86400:
            return False
        passcode = _get_configured_passcode()
        expected = hmac.new(
            _SECRET_KEY.encode("utf-8"),
            f"{passcode}:{ts_str}".encode("utf-8"),
            hashlib.sha256
        ).hexdigest()
        return hmac.compare_digest(signature, expected)
    except Exception:
        return False


def set_passcode(new_passcode: str, old_passcode: str = "") -> tuple[bool, str]:
    """Sets or updates the passcode stored in the database."""
    current = _get_configured_passcode()
    if current and not verify_passcode(old_passcode):
        return False, "Incorrect current passcode."
    
    cleaned = new_passcode.strip()
    try:
        db.set_app_state("linus_passcode", cleaned)
        return True, "Passcode updated successfully."
    except Exception as e:
        return False, str(e)
