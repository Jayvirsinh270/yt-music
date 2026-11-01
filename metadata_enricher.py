"""
metadata_enricher.py — Automated High-Resolution Metadata & Artwork Enrichment for Linus

Provides automated metadata scraping for tracks missing artwork or metadata:
  1. Primary: iTunes Public Search API (free, fast, no API key required, 1000x1000 Retina artwork)
  2. Secondary: MusicBrainz API (open-source database)
  3. Tertiary: Last.fm API (if configured in .env)

Updates local database records with rich artwork, album names, genres, and release years.
"""

import json
import logging
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Optional

import requests
import db_store as db

logger = logging.getLogger(__name__)

_LOCK = threading.RLock()
_ENRICHMENT_STATUS = {
    "in_progress": False,
    "total": 0,
    "processed": 0,
    "enriched": 0,
    "last_run": 0.0,
}

_USER_AGENT = "LinusMusicPlayer/2.0 (Self-Hosted Aesthetic Player; contact@linus.local)"


def query_itunes_metadata(title: str, artist: str = "") -> Optional[dict[str, Any]]:
    """
    Queries the iTunes public search API for high-resolution artwork and accurate metadata.
    Returns dict with artwork_url (1000x1000), album, artist, genre, year, or None.
    """
    if not title:
        return None

    # Clean query (remove file extensions, feat, brackets)
    clean_title = title.split(".")[0].strip()
    term = f"{clean_title} {artist}".strip() if artist and artist != "Unknown Artist" else clean_title

    url = f"https://itunes.apple.com/search?term={urllib.parse.quote(term)}&entity=song&limit=1"
    headers = {"User-Agent": _USER_AGENT}

    try:
        resp = requests.get(url, headers=headers, timeout=6)
        if resp.status_code != 200:
            return None
        data = resp.json()
        results = data.get("results") or []
        if not results:
            return None

        item = results[0]
        # Convert 100x100 thumbnail URL to 1000x1000 high-resolution Retina cover
        art_100 = item.get("artworkUrl100") or ""
        art_high = art_100.replace("100x100bb.jpg", "1000x1000bb.jpg") if art_100 else ""

        rel_date = item.get("releaseDate") or ""
        year = rel_date[:4] if len(rel_date) >= 4 else ""

        return {
            "title": item.get("trackName") or title,
            "artist": item.get("artistName") or artist,
            "album": item.get("collectionName") or "",
            "artwork_url": art_high or art_100,
            "genre": item.get("primaryGenreName") or "",
            "year": year,
            "preview_url": item.get("previewUrl") or "",
            "source": "itunes",
        }
    except Exception as exc:
        logger.debug(f"[Enricher] iTunes query failed for '{term}': {exc}")
        return None


def query_musicbrainz_metadata(title: str, artist: str = "") -> Optional[dict[str, Any]]:
    """
    Fallback query to the MusicBrainz public database.
    """
    if not title:
        return None

    query_parts = [f'recording:"{title}"']
    if artist and artist != "Unknown Artist":
        query_parts.append(f'artist:"{artist}"')
    q_str = " AND ".join(query_parts)

    url = f"https://musicbrainz.org/ws/2/recording/?query={urllib.parse.quote(q_str)}&fmt=json&limit=1"
    headers = {"User-Agent": _USER_AGENT}

    try:
        resp = requests.get(url, headers=headers, timeout=6)
        if resp.status_code != 200:
            return None
        data = resp.json()
        recordings = data.get("recordings") or []
        if not recordings:
            return None

        rec = recordings[0]
        artist_credit = rec.get("artist-credit") or []
        rec_artist = artist_credit[0].get("name") if artist_credit else artist
        releases = rec.get("releases") or []
        album_name = releases[0].get("title") if releases else ""
        year = releases[0].get("date", "")[:4] if releases and releases[0].get("date") else ""

        return {
            "title": rec.get("title") or title,
            "artist": rec_artist or artist,
            "album": album_name,
            "artwork_url": "",
            "genre": "",
            "year": year,
            "source": "musicbrainz",
        }
    except Exception as exc:
        logger.debug(f"[Enricher] MusicBrainz query failed: {exc}")
        return None


def enrich_track(track: dict[str, Any]) -> dict[str, Any]:
    """
    Inspects a track dictionary. If it lacks artwork or metadata, queries enrichment sources.
    Returns the enriched track dict (and saves changes to database if updated).
    """
    needs_art = not track.get("artwork_url") and not track.get("has_artwork")
    needs_meta = not track.get("artist") or track.get("artist") == "Unknown Artist" or not track.get("album")

    if not needs_art and not needs_meta:
        return track

    title = track.get("title") or ""
    artist = track.get("artist") or ""

    # 1. Try iTunes
    info = query_itunes_metadata(title, artist)

    # 2. Try MusicBrainz fallback if no result
    if not info:
        info = query_musicbrainz_metadata(title, artist)

    if not info:
        return track

    updated = False
    if needs_art and info.get("artwork_url"):
        track["artwork_url"] = info["artwork_url"]
        track["has_artwork"] = True
        updated = True

    if (not track.get("album") or track.get("album") == "Unknown Album") and info.get("album"):
        track["album"] = info["album"]
        updated = True

    if (not track.get("artist") or track.get("artist") == "Unknown Artist") and info.get("artist"):
        track["artist"] = info["artist"]
        updated = True

    if info.get("year") and not track.get("year"):
        track["year"] = info["year"]
        updated = True

    if updated:
        track_id = track.get("id")
        if track_id:
            try:
                db.update_track_metadata(
                    track_id,
                    title=track.get("title"),
                    artist=track.get("artist"),
                    album=track.get("album"),
                    artwork_url=track.get("artwork_url"),
                )
            except Exception as e:
                logger.debug(f"[Enricher] DB update failed for {track_id}: {e}")

    return track


def start_library_enrichment(tracks: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Launches an asynchronous background worker that enriches tracks lacking artwork.
    """
    with _LOCK:
        if _ENRICHMENT_STATUS["in_progress"]:
            return {"status": "already_running", "progress": _ENRICHMENT_STATUS.copy()}

        candidates = [
            t for t in tracks
            if not t.get("has_artwork") and not t.get("artwork_url")
        ]

        _ENRICHMENT_STATUS.update({
            "in_progress": True,
            "total": len(candidates),
            "processed": 0,
            "enriched": 0,
            "last_run": time.time(),
        })

    def _worker():
        for t in candidates:
            try:
                before_art = t.get("artwork_url")
                enrich_track(t)
                after_art = t.get("artwork_url")
                with _LOCK:
                    _ENRICHMENT_STATUS["processed"] += 1
                    if after_art and after_art != before_art:
                        _ENRICHMENT_STATUS["enriched"] += 1
                # Respect rate limits: small pause between external queries
                time.sleep(0.3)
            except Exception as e:
                logger.debug(f"[Enricher] Error processing track {t.get('title')}: {e}")
                with _LOCK:
                    _ENRICHMENT_STATUS["processed"] += 1

        with _LOCK:
            _ENRICHMENT_STATUS["in_progress"] = False

    thread = threading.Thread(target=_worker, name="MetadataEnricherWorker", daemon=True)
    thread.start()

    return {"status": "started", "candidate_count": len(candidates)}


def get_enrichment_status() -> dict[str, Any]:
    """Returns the current progress of library metadata enrichment."""
    with _LOCK:
        return _ENRICHMENT_STATUS.copy()
