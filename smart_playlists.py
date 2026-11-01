"""
smart_playlists.py — Linus Smart Rule-Based Dynamic Playlists Engine
Computes real-time, auto-updating intelligent playlists based on user listening
habits, BPM/tempo estimation, audio metadata, recency, and mood analysis.
"""

from __future__ import annotations
import time
from typing import Any
import db_store as db
import library_service as lib
import recommendation_engine as rec


SMART_PLAYLIST_DEFINITIONS = [
    {
        "id": "heavy-rotation",
        "title": "Heavy Rotation",
        "description": "Your most played anthems and high-completion repeat favorites",
        "icon": "ph-fill ph-fire",
        "gradient": "linear-gradient(135deg, rgba(239, 68, 68, 0.35), rgba(249, 115, 22, 0.15))",
        "accent": "#ef4444",
        "badge": "Top Played",
    },
    {
        "id": "forgotten-gems",
        "title": "Forgotten Gems",
        "description": "Hidden gems and previous favorites waiting for your rediscovery",
        "icon": "ph-fill ph-sketch-logo",
        "gradient": "linear-gradient(135deg, rgba(168, 85, 247, 0.35), rgba(236, 72, 153, 0.15))",
        "accent": "#a855f7",
        "badge": "Rediscover",
    },
    {
        "id": "high-energy",
        "title": "High Energy (130+ BPM)",
        "description": "Pumping uptempo beats and workout power tracks",
        "icon": "ph-fill ph-lightning",
        "gradient": "linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(234, 179, 8, 0.15))",
        "accent": "#f59e0b",
        "badge": "Workout & Rave",
    },
    {
        "id": "deep-focus",
        "title": "Deep Focus & Chill (<105 BPM)",
        "description": "Low-tempo ambient, acoustic, and peaceful melodies for flow state",
        "icon": "ph-fill ph-brain",
        "gradient": "linear-gradient(135deg, rgba(56, 189, 248, 0.35), rgba(14, 165, 233, 0.15))",
        "accent": "#38bdf8",
        "badge": "Focus & Code",
    },
    {
        "id": "recently-added",
        "title": "Recently Added",
        "description": "The freshest additions imported into your local library",
        "icon": "ph-bold ph-clock-clockwise",
        "gradient": "linear-gradient(135deg, rgba(52, 211, 153, 0.35), rgba(16, 185, 129, 0.15))",
        "accent": "#34d399",
        "badge": "New Arrivals",
    },
    {
        "id": "epic-length",
        "title": "Epic Length (> 6 Mins)",
        "description": "Extended mixes, prog rock odysseys, and symphonic movements",
        "icon": "ph-bold ph-hourglass-high",
        "gradient": "linear-gradient(135deg, rgba(129, 140, 248, 0.35), rgba(99, 102, 241, 0.15))",
        "accent": "#818cf8",
        "badge": "Extended Cuts",
    },
]


def _get_active_library(library_tracks: list[dict] | None = None) -> list[dict]:
    """Ensures audio tracks are loaded."""
    if library_tracks is not None:
        return [t for t in library_tracks if t.get("media_type") != "video"]
    all_tracks = lib.scan_library()
    return [t for t in all_tracks if t.get("media_type") != "video"]


def get_smart_playlist_tracks(playlist_id: str, library_tracks: list[dict] | None = None, limit: int = 60) -> list[dict]:
    """
    Evaluates rule filters on the library and returns ordered track list.
    """
    tracks = _get_active_library(library_tracks)
    if not tracks:
        return []

    # Map play stats from SQLite
    play_stats = db.get_all_track_play_stats()  # track_id -> dict
    fav_ids = set(db.get_favorites())

    if playlist_id == "heavy-rotation":
        # Tracks sorted by play_count desc and completion_rate desc
        scored = []
        for t in tracks:
            tid = t.get("id")
            st = play_stats.get(tid, {})
            play_count = st.get("play_count", 0)
            comp_rate = st.get("completion_rate", 0.0)
            score = (play_count * 10) + (comp_rate * 5)
            if tid in fav_ids:
                score += 8
            if score > 0:
                scored.append((score, t))
        scored.sort(key=lambda x: x[0], reverse=True)
        # If user has few plays, fallback to top recommendations
        if len(scored) < 5:
            return rec.get_top_played_local(tracks, count=limit)
        return [t for _, t in scored[:limit]]

    elif playlist_id == "forgotten-gems":
        now = time.time()
        thirty_days = 30 * 86400
        gems = []
        for t in tracks:
            tid = t.get("id")
            st = play_stats.get(tid, {})
            last_played = st.get("last_played_at", 0)
            dur = t.get("duration", 0)
            # Either favorited or duration > 90s, but not played in last 30 days
            if (dur >= 90) and (now - last_played > thirty_days or last_played == 0):
                priority = 2 if tid in fav_ids else 1
                gems.append((priority, t))
        gems.sort(key=lambda x: x[0], reverse=True)
        if not gems:
            return rec.get_hidden_gems_local(tracks, count=limit)
        return [t for _, t in gems[:limit]]

    elif playlist_id == "high-energy":
        energy_tracks = []
        for t in tracks:
            bpm = rec.estimate_track_bpm(
                title=t.get("title", ""),
                artist=t.get("artist", ""),
                genre=t.get("genre", ""),
            )
            t_copy = dict(t)
            t_copy["bpm"] = bpm
            vx, vy = rec.compute_track_vibe_coords(t.get("title", ""), t.get("artist", ""), t.get("genre", ""))
            if bpm >= 118.0 or vy >= 0.2:
                energy_tracks.append((bpm + (vy * 10), t_copy))
        energy_tracks.sort(key=lambda x: x[0], reverse=True)
        return [t for _, t in energy_tracks[:limit]]

    elif playlist_id == "deep-focus":
        chill_tracks = []
        for t in tracks:
            bpm = rec.estimate_track_bpm(
                title=t.get("title", ""),
                artist=t.get("artist", ""),
                genre=t.get("genre", ""),
            )
            t_copy = dict(t)
            t_copy["bpm"] = bpm
            # Tempo between 60 and 105 BPM
            if 50.0 <= bpm <= 105.0:
                chill_tracks.append((bpm, t_copy))
        chill_tracks.sort(key=lambda x: x[0])
        return [t for _, t in chill_tracks[:limit]]

    elif playlist_id == "recently-added":
        # Sort by mtime descending
        sorted_recent = sorted(tracks, key=lambda t: t.get("mtime", 0.0), reverse=True)
        return sorted_recent[:limit]

    elif playlist_id == "epic-length":
        # Duration >= 360 seconds (6 minutes)
        epic_tracks = [t for t in tracks if t.get("duration", 0) >= 360.0]
        epic_tracks.sort(key=lambda t: t.get("duration", 0), reverse=True)
        return epic_tracks[:limit]

    return []


def get_all_smart_playlists(library_tracks: list[dict] | None = None) -> list[dict]:
    """
    Returns high-level cards with track count and preview thumbnails.
    """
    tracks = _get_active_library(library_tracks)
    playlists = []

    for defn in SMART_PLAYLIST_DEFINITIONS:
        p_id = defn["id"]
        matched_tracks = get_smart_playlist_tracks(p_id, library_tracks=tracks, limit=60)
        count = len(matched_tracks)

        # Collect sample thumbnails for cover mosaic
        sample_thumbs = []
        for t in matched_tracks:
            thumb = t.get("artwork_url")
            if thumb and thumb not in sample_thumbs:
                sample_thumbs.append(thumb)
            if len(sample_thumbs) >= 4:
                break

        total_duration = sum(t.get("duration", 0) for t in matched_tracks)

        playlists.append({
            "id": p_id,
            "title": defn["title"],
            "description": defn["description"],
            "icon": defn["icon"],
            "gradient": defn["gradient"],
            "accent": defn["accent"],
            "badge": defn["badge"],
            "count": count,
            "total_duration": total_duration,
            "sample_thumbnails": sample_thumbs,
            "first_track_id": matched_tracks[0].get("id") if matched_tracks else None,
        })

    return playlists
