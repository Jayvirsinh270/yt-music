"""
lastfm_service.py — Last.fm Scrobbling & Now Playing Integration for Linus

Supports:
  - Scrobbling tracks (POST /api/lastfm/scrobble)
  - Now Playing updates (POST /api/lastfm/now-playing)
  - Auth via stored API key + session key in db_store
  - Configurable via .env (LASTFM_API_KEY, LASTFM_API_SECRET)
"""

import hashlib
import json
import logging
import os
import time
from typing import Optional

import requests

logger = logging.getLogger(__name__)

LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/"


def _get_credentials():
    return os.environ.get("LASTFM_API_KEY", "").strip(), os.environ.get("LASTFM_API_SECRET", "").strip()


def _build_signature(params: dict, secret: str) -> str:
    """Build Last.fm API method signature (MD5 of sorted params + secret)."""
    filtered = {k: v for k, v in params.items() if k not in ("format", "callback")}
    sig_str = "".join(f"{k}{v}" for k, v in sorted(filtered.items()))
    sig_str += secret
    return hashlib.md5(sig_str.encode("utf-8")).hexdigest()


def _call_api(params: dict, method: str = "GET", session_key: str = "") -> dict:
    api_key, api_secret = _get_credentials()
    if not api_key:
        return {"error": "Last.fm API key not configured. Set LASTFM_API_KEY and LASTFM_API_SECRET in .env"}

    params["api_key"] = api_key
    params["format"] = "json"
    if session_key:
        params["sk"] = session_key
        if api_secret:
            params["api_sig"] = _build_signature(params, api_secret)

    try:
        if method == "POST":
            resp = requests.post(LASTFM_API_URL, data=params, timeout=10)
        else:
            resp = requests.get(LASTFM_API_URL, params=params, timeout=10)
        return resp.json()
    except requests.RequestException as e:
        logger.warning(f"[Last.fm] API call failed: {e}")
        return {"error": str(e)}
    except Exception as e:
        logger.warning(f"[Last.fm] Unexpected error: {e}")
        return {"error": str(e)}


def get_auth_url() -> dict:
    api_key, _ = _get_credentials()
    if not api_key:
        return {"error": "LASTFM_API_KEY not configured in environment"}
    result = _call_api({"method": "auth.getToken"})
    if "token" not in result:
        return {"error": result.get("message", "Failed to get token from Last.fm")}
    token = result["token"]
    auth_url = f"https://www.last.fm/api/auth/?api_key={api_key}&token={token}"
    return {"token": token, "auth_url": auth_url}


def get_session(token: str) -> dict:
    api_key, api_secret = _get_credentials()
    if not api_key or not api_secret:
        return {"error": "Last.fm credentials incomplete in .env"}
    params = {"method": "auth.getSession", "token": token}
    result = _call_api(params)
    if "session" not in result:
        return {"error": result.get("message", "Authentication exchange failed")}
    session = result["session"]
    return {
        "session_key": session.get("key", ""),
        "username": session.get("name", ""),
    }


def scrobble(title: str, artist: str, album: str, timestamp: int, session_key: str, duration: int = 0) -> dict:
    if not title or not artist:
        return {"error": "Track title and artist are required"}
    if not session_key:
        return {"error": "Not authenticated with Last.fm"}
    params = {
        "method": "track.scrobble",
        "track": title,
        "artist": artist,
        "timestamp": str(timestamp or int(time.time())),
    }
    if album:
        params["album"] = album
    if duration:
        params["duration"] = str(duration)
    result = _call_api(params, method="POST", session_key=session_key)
    if result.get("scrobbles"):
        return {"success": True, "data": result["scrobbles"]}
    return {"error": result.get("message", "Scrobble rejected by Last.fm"), "raw": result}


def update_now_playing(title: str, artist: str, album: str, session_key: str, duration: int = 0) -> dict:
    if not title or not artist:
        return {"error": "Track title and artist are required"}
    if not session_key:
        return {"error": "Not authenticated with Last.fm"}
    params = {
        "method": "track.updateNowPlaying",
        "track": title,
        "artist": artist,
    }
    if album:
        params["album"] = album
    if duration:
        params["duration"] = str(duration)
    result = _call_api(params, method="POST", session_key=session_key)
    if result.get("nowplaying"):
        return {"success": True, "now_playing": result["nowplaying"]}
    return {"error": result.get("message", "Now Playing update failed"), "raw": result}


def get_status() -> dict:
    api_key, api_secret = _get_credentials()
    return {
        "configured": bool(api_key and api_secret),
        "api_key_set": bool(api_key),
        "api_secret_set": bool(api_secret),
    }
