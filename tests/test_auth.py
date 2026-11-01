import pytest
from unittest.mock import patch
import auth_service as auth


def test_auth_not_required_by_default(monkeypatch):
    monkeypatch.delenv("LINUS_PASSCODE", raising=False)
    with patch("auth_service.db.get_app_state", return_value=""):
        assert auth.is_auth_required() is False
        assert auth.verify_passcode("anything") is True
        assert auth.validate_session_token("any_token") is True


def test_auth_required_with_env(monkeypatch):
    monkeypatch.setenv("LINUS_PASSCODE", "4321")
    assert auth.is_auth_required() is True
    assert auth.verify_passcode("4321") is True
    assert auth.verify_passcode("wrong") is False


def test_token_generation_and_validation(monkeypatch):
    monkeypatch.setenv("LINUS_PASSCODE", "9999")
    token = auth.generate_session_token()
    assert token is not None
    assert ":" in token
    assert auth.validate_session_token(token) is True
    assert auth.validate_session_token("invalid:token") is False
