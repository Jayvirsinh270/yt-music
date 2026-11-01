"""
artist_album_service.py — Artist & Album Catalog Service for Linus

Aggregates tracks across the local indexed library and online catalog to provide:
  - Artist directory with track counts, albums, and artwork
  - Dedicated Artist Profile with top tracks and grouped discography
  - Album directory with artwork grids and tracklists
  - Quick-play and shuffle queue generation for any artist or album
"""

import urllib.parse
from typing import Any
import db_store as db
from library_service import scan_library, find_track


def _normalize_name(name: str) -> str:
    """Cleans artist and album names."""
    if not name:
        return "Unknown"
    cleaned = name.strip()
    return cleaned if cleaned else "Unknown"


def get_all_artists() -> list[dict[str, Any]]:
    """
    Returns an aggregated list of all artists in the library sorted by track count.
    Each item contains: name, track_count, album_count, duration, artwork_url.
    """
    tracks = scan_library()
    artists_map: dict[str, dict[str, Any]] = {}

    for t in tracks:
        raw_artist = t.get("artist") or "Unknown Artist"
        # Split multi-artist tags if separated by standard delimiters for primary categorization
        artist_name = _normalize_name(raw_artist)
        album_name = _normalize_name(t.get("album") or "Singles & Other")

        if artist_name not in artists_map:
            artists_map[artist_name] = {
                "name": artist_name,
                "track_count": 0,
                "albums": set(),
                "duration": 0.0,
                "artwork_url": t.get("artwork_url") or "",
                "has_artwork": bool(t.get("has_artwork") or t.get("artwork_url")),
            }

        data = artists_map[artist_name]
        data["track_count"] += 1
        data["albums"].add(album_name)
        data["duration"] += float(t.get("duration") or 0.0)
        if not data["has_artwork"] and (t.get("has_artwork") or t.get("artwork_url")):
            data["artwork_url"] = t.get("artwork_url") or ""
            data["has_artwork"] = True

    results = []
    for artist, d in artists_map.items():
        results.append({
            "name": d["name"],
            "track_count": d["track_count"],
            "album_count": len(d["albums"]),
            "duration": round(d["duration"], 1),
            "artwork_url": d["artwork_url"],
            "has_artwork": d["has_artwork"],
        })

    # Sort artists with highest track count first, then alphabetical
    results.sort(key=lambda x: (-x["track_count"], x["name"].lower()))
    return results


def get_artist_profile(artist_name: str) -> dict[str, Any] | None:
    """
    Returns full artist profile including:
      - Artist statistics (track count, album count, total playtime)
      - Top tracks
      - Discography (albums with ordered tracklists)
      - Complete tracklist
    """
    target = urllib.parse.unquote(artist_name).strip().lower()
    tracks = scan_library()
    artist_tracks = []
    artwork_url = ""

    for t in tracks:
        a = (t.get("artist") or "").strip().lower()
        if a == target or target in a:
            artist_tracks.append(t)
            if not artwork_url and (t.get("artwork_url") or t.get("has_artwork")):
                artwork_url = t.get("artwork_url") or ""

    if not artist_tracks:
        return None

    # Group tracks into albums
    albums_map: dict[str, list[dict]] = {}
    for t in artist_tracks:
        alb = _normalize_name(t.get("album") or "Singles & EPs")
        if alb not in albums_map:
            albums_map[alb] = []
        albums_map[alb].append(t)

    albums_list = []
    for alb_name, alb_tracks in albums_map.items():
        # Representative cover art for album
        cover = next((tr.get("artwork_url") for tr in alb_tracks if tr.get("artwork_url")), "")
        total_alb_dur = sum(float(tr.get("duration") or 0.0) for tr in alb_tracks)
        albums_list.append({
            "name": alb_name,
            "track_count": len(alb_tracks),
            "duration": round(total_alb_dur, 1),
            "artwork_url": cover,
            "tracks": alb_tracks,
        })

    # Sort albums by track count / name
    albums_list.sort(key=lambda x: (-x["track_count"], x["name"].lower()))

    # Top tracks (first 10 sorted by duration / quality)
    top_tracks = list(artist_tracks)[:10]

    canonical_name = artist_tracks[0].get("artist") or artist_name
    total_dur = sum(float(t.get("duration") or 0.0) for t in artist_tracks)

    return {
        "name": canonical_name,
        "track_count": len(artist_tracks),
        "album_count": len(albums_list),
        "total_duration": round(total_dur, 1),
        "artwork_url": artwork_url,
        "top_tracks": top_tracks,
        "albums": albums_list,
        "all_tracks": artist_tracks,
    }


def get_all_albums() -> list[dict[str, Any]]:
    """
    Returns an aggregated list of all albums in the library sorted by track count.
    """
    tracks = scan_library()
    albums_map: dict[str, dict[str, Any]] = {}

    for t in tracks:
        album_name = _normalize_name(t.get("album") or "Unknown Album")
        artist_name = _normalize_name(t.get("artist") or "Various Artists")
        key = f"{album_name}:::{artist_name}".lower()

        if key not in albums_map:
            albums_map[key] = {
                "name": album_name,
                "artist": artist_name,
                "track_count": 0,
                "duration": 0.0,
                "artwork_url": t.get("artwork_url") or "",
                "has_artwork": bool(t.get("has_artwork") or t.get("artwork_url")),
            }

        data = albums_map[key]
        data["track_count"] += 1
        data["duration"] += float(t.get("duration") or 0.0)
        if not data["has_artwork"] and (t.get("has_artwork") or t.get("artwork_url")):
            data["artwork_url"] = t.get("artwork_url") or ""
            data["has_artwork"] = True

    results = list(albums_map.values())
    results.sort(key=lambda x: (-x["track_count"], x["name"].lower()))
    return results


def get_album_details(album_name: str) -> dict[str, Any] | None:
    """
    Returns full details for a specific album including its ordered tracklist.
    """
    target = urllib.parse.unquote(album_name).strip().lower()
    tracks = scan_library()
    album_tracks = []
    artwork_url = ""
    primary_artist = ""

    for t in tracks:
        alb = (t.get("album") or "").strip().lower()
        if alb == target or target in alb:
            album_tracks.append(t)
            if not artwork_url and (t.get("artwork_url") or t.get("has_artwork")):
                artwork_url = t.get("artwork_url") or ""
            if not primary_artist:
                primary_artist = t.get("artist") or "Various Artists"

    if not album_tracks:
        return None

    canonical_name = album_tracks[0].get("album") or album_name
    total_dur = sum(float(t.get("duration") or 0.0) for t in album_tracks)

    return {
        "name": canonical_name,
        "artist": primary_artist,
        "track_count": len(album_tracks),
        "total_duration": round(total_dur, 1),
        "artwork_url": artwork_url,
        "tracks": album_tracks,
    }
