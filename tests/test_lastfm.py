import pytest
from lastfm_service import _build_signature, get_status


def test_build_signature():
    params = {"method": "track.scrobble", "track": "Song", "artist": "Artist"}
    secret = "secret123"
    sig = _build_signature(params, secret)
    assert isinstance(sig, str)
    assert len(sig) == 32  # md5 hex length


def test_lastfm_status_unconfigured(monkeypatch):
    monkeypatch.delenv("LASTFM_API_KEY", raising=False)
    monkeypatch.delenv("LASTFM_API_SECRET", raising=False)
    status = get_status()
    assert "configured" in status
    assert status["configured"] is False
