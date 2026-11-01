"""
db_store.py — Linus SQLite Database & High-Performance State Engine
Replaces flat JSON state with an ACID-compliant SQLite store in WAL (Write-Ahead Logging) mode.
Automatically migrates legacy linus_state.json on initial launch.
"""

import json
import os
import shutil
import sqlite3
import threading
import time
from typing import Any
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent
DB_PATH = ROOT_DIR / "linus.db"
LEGACY_STATE_FILE = ROOT_DIR / "linus_state.json"
BACKUP_STATE_FILE = ROOT_DIR / "linus_state.json.bak"
DOWNLOADS_DIR = ROOT_DIR / "downloads"

_local = threading.local()


def get_db() -> sqlite3.Connection:
    """Thread-local SQLite connection with WAL mode enabled."""
    if not hasattr(_local, "conn") or _local.conn is None:
        conn = sqlite3.connect(str(DB_PATH), timeout=20.0, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        # Enable WAL mode and busy timeout for high concurrent read/write throughput
        conn.execute("PRAGMA journal_mode = WAL;")
        conn.execute("PRAGMA synchronous = NORMAL;")
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA busy_timeout = 5000;")
        conn.execute("PRAGMA wal_autocheckpoint = 1000;")
        _local.conn = conn
    return _local.conn


def init_db():
    """Initializes the database schema and performs auto-migration if needed."""
    conn = get_db()
    with conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS app_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                created_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_tracks (
                playlist_name TEXT NOT NULL,
                track_id TEXT NOT NULL,
                position INTEGER NOT NULL,
                added_at REAL NOT NULL,
                PRIMARY KEY (playlist_name, track_id)
            );

            CREATE TABLE IF NOT EXISTS favorites (
                track_id TEXT PRIMARY KEY,
                added_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                track_id TEXT NOT NULL,
                played_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS positions (
                track_id TEXT PRIMARY KEY,
                position REAL NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS track_categories (
                track_id TEXT PRIMARY KEY,
                category TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS library_folders (
                folder_path TEXT PRIMARY KEY,
                added_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS custom_lyrics (
                track_id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS track_play_stats (
                track_id TEXT PRIMARY KEY,
                play_count INTEGER DEFAULT 0,
                skip_count INTEGER DEFAULT 0,
                total_play_time REAL DEFAULT 0,
                completion_rate REAL DEFAULT 0,
                last_played_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS track_transitions (
                from_track_id TEXT NOT NULL,
                to_track_id TEXT NOT NULL,
                count INTEGER DEFAULT 0,
                updated_at REAL NOT NULL,
                PRIMARY KEY (from_track_id, to_track_id)
            );

            CREATE TABLE IF NOT EXISTS tracks_meta (
                track_id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                artist TEXT NOT NULL,
                album TEXT DEFAULT '',
                genre TEXT DEFAULT '',
                duration REAL DEFAULT 0,
                artwork_url TEXT DEFAULT '',
                is_online INTEGER DEFAULT 0,
                source TEXT DEFAULT '',
                file_mtime REAL DEFAULT 0,
                file_size INTEGER DEFAULT 0,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT DEFAULT '',
                event_type TEXT NOT NULL,
                track_id TEXT NOT NULL,
                prev_track_id TEXT DEFAULT '',
                duration_played REAL DEFAULT 0,
                total_duration REAL DEFAULT 0,
                completion_rate REAL DEFAULT 0,
                context_source TEXT DEFAULT '',
                hour_of_day INTEGER DEFAULT 0,
                day_of_week INTEGER DEFAULT 0,
                timestamp REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dislikes (
                track_id TEXT PRIMARY KEY,
                disliked_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS dashboard_cache (
                shelf_id TEXT PRIMARY KEY,
                payload TEXT NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS search_cache (
                query TEXT PRIMARY KEY,
                results TEXT NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at REAL NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_tracks_meta_artist ON tracks_meta (artist);
            CREATE INDEX IF NOT EXISTS idx_tracks_meta_title ON tracks_meta (title);
            CREATE INDEX IF NOT EXISTS idx_tracks_meta_genre ON tracks_meta (genre);
            CREATE INDEX IF NOT EXISTS idx_user_events_track ON user_events (track_id);
            CREATE INDEX IF NOT EXISTS idx_user_events_type ON user_events (event_type);
            CREATE INDEX IF NOT EXISTS idx_user_events_time ON user_events (timestamp);
            CREATE INDEX IF NOT EXISTS idx_user_events_session ON user_events (session_id);
            CREATE INDEX IF NOT EXISTS idx_track_transitions_to ON track_transitions (to_track_id);
            CREATE INDEX IF NOT EXISTS idx_history_track ON history (track_id);
            CREATE INDEX IF NOT EXISTS idx_history_played ON history (played_at);
            CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks (track_id);
            CREATE INDEX IF NOT EXISTS idx_play_stats_plays ON track_play_stats (play_count);
        """)

    # Migration for tracks_meta cache columns
    try:
        with conn:
            conn.execute("ALTER TABLE tracks_meta ADD COLUMN file_mtime REAL DEFAULT 0;")
    except Exception:
        pass
    try:
        with conn:
            conn.execute("ALTER TABLE tracks_meta ADD COLUMN file_size INTEGER DEFAULT 0;")
    except Exception:
        pass

    # Ensure history table is synchronized with recorded user_events
    try:
        with conn:
            conn.execute("""
                INSERT INTO history (track_id, played_at)
                SELECT track_id, timestamp FROM user_events
                WHERE track_id NOT IN (SELECT track_id FROM history)
                ORDER BY id ASC
            """)
    except Exception:
        pass

    # Check if migration from linus_state.json is needed
    _auto_migrate_legacy_json()

    # Truncate WAL and optimize DB on startup
    optimize_database()


def _auto_migrate_legacy_json():
    """Migrates existing data from linus_state.json into SQLite if database is fresh."""
    conn = get_db()
    
    # Check if already migrated
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM library_folders")
    folder_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM playlists")
    playlist_count = cur.fetchone()[0]
    cur.execute("SELECT COUNT(*) FROM favorites")
    fav_count = cur.fetchone()[0]

    # If DB already has data, migration not needed
    if folder_count > 0 or playlist_count > 0 or fav_count > 0:
        return

    if not LEGACY_STATE_FILE.exists():
        add_library_folder(str(DOWNLOADS_DIR))
        return

    try:
        data = json.loads(LEGACY_STATE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        print("Warning: Could not parse legacy state file:", e)
        add_library_folder(str(DOWNLOADS_DIR))
        return

    print("Migrating legacy linus_state.json into SQLite database (linus.db)...")

    # 1. Migrate library folders
    folders = data.get("library_folders") or [str(DOWNLOADS_DIR)]
    for f in folders:
        if f:
            add_library_folder(str(f))

    # 2. Migrate playlists
    playlists = data.get("playlists") or {}
    for name, tracks in playlists.items():
        if name and isinstance(tracks, list):
            create_playlist(name)
            for idx, tid in enumerate(tracks):
                if tid:
                    add_track_to_playlist(name, tid, position=idx)

    # 3. Migrate favorites
    favorites = data.get("favorites") or []
    for tid in favorites:
        if tid:
            set_favorite(tid, True)

    # 4. Migrate history (preserve order)
    history = data.get("history") or []
    for tid in history:
        if tid:
            add_history(tid)

    # 5. Migrate positions
    positions = data.get("positions") or {}
    for tid, pos in positions.items():
        if tid and isinstance(pos, (int, float)):
            set_position(tid, float(pos))

    # 6. Migrate track categories
    cats = data.get("track_categories") or {}
    for tid, cat in cats.items():
        if tid and cat:
            set_track_category(tid, cat)

    # 7. Migrate custom lyrics
    lyrics = data.get("lyrics") or {}
    for tid, l_content in lyrics.items():
        if tid and l_content:
            set_custom_lyrics(tid, l_content)

    # 8. Migrate scalar app states
    if data.get("last_played_track_id"):
        set_app_state("last_played_track_id", str(data["last_played_track_id"]))
    if data.get("last_played_position") is not None:
        set_app_state("last_played_position", str(data["last_played_position"]))
    set_app_state("schema_version", "3.0")

    # Backup the legacy file
    try:
        shutil.copy2(LEGACY_STATE_FILE, BACKUP_STATE_FILE)
    except Exception:
        pass

    print("Migration to SQLite complete! Backup created at linus_state.json.bak")


# ---------------------------------------------------------------------------
# State Query & Update APIs (100% Backward Compatible)
# ---------------------------------------------------------------------------

def get_state() -> dict:
    """Returns the full state dictionary matching the frontend state contract."""
    conn = get_db()
    cur = conn.cursor()

    # 1. Playlists
    cur.execute("SELECT playlist_name, track_id FROM playlist_tracks ORDER BY playlist_name, position ASC")
    playlists = {}
    for row in cur.fetchall():
        playlists.setdefault(row["playlist_name"], []).append(row["track_id"])
    cur.execute("SELECT name FROM playlists")
    for row in cur.fetchall():
        playlists.setdefault(row["name"], [])

    # 2. Favorites
    cur.execute("SELECT track_id FROM favorites ORDER BY added_at DESC")
    favorites = [row["track_id"] for row in cur.fetchall()]

    # 3. History
    cur.execute("SELECT track_id FROM history ORDER BY id DESC LIMIT 100")
    history = [row["track_id"] for row in cur.fetchall()]

    # 4. Positions
    cur.execute("SELECT track_id, position FROM positions")
    positions = {row["track_id"]: row["position"] for row in cur.fetchall()}

    # 5. Track Categories
    cur.execute("SELECT track_id, category FROM track_categories")
    track_categories = {row["track_id"]: row["category"] for row in cur.fetchall()}

    # 6. Library Folders
    cur.execute("SELECT folder_path FROM library_folders ORDER BY added_at ASC")
    library_folders = [row["folder_path"] for row in cur.fetchall()]
    if not library_folders:
        library_folders = [str(DOWNLOADS_DIR)]

    # 7. Custom Lyrics
    cur.execute("SELECT track_id, content FROM custom_lyrics")
    lyrics = {row["track_id"]: row["content"] for row in cur.fetchall()}

    # 8. Scalar App State
    cur.execute("SELECT key, value FROM app_state")
    app_state = {row["key"]: row["value"] for row in cur.fetchall()}

    last_played_pos = 0.0
    try:
        last_played_pos = float(app_state.get("last_played_position", "0"))
    except ValueError:
        pass

    return {
        "playlists": playlists,
        "favorites": favorites,
        "history": history,
        "positions": positions,
        "track_categories": track_categories,
        "library_folders": library_folders,
        "lyrics": lyrics,
        "last_played_track_id": app_state.get("last_played_track_id") or None,
        "last_played_position": last_played_pos,
        "playback_queue": get_playback_queue(),
        "user_settings": get_all_user_settings(),
        "schema_version": 3.0,
    }


def save_state_dict(state_dict: dict):
    """Saves any incoming state dictionary into SQLite."""
    conn = get_db()
    with conn:
        # 1. Playlists
        if "playlists" in state_dict and isinstance(state_dict["playlists"], dict):
            for name, track_list in state_dict["playlists"].items():
                if not name:
                    continue
                conn.execute("INSERT OR IGNORE INTO playlists (name, created_at) VALUES (?, ?)", (name, time.time()))
                conn.execute("DELETE FROM playlist_tracks WHERE playlist_name = ?", (name,))
                if isinstance(track_list, list):
                    for idx, tid in enumerate(track_list):
                        if tid:
                            conn.execute(
                                "INSERT OR REPLACE INTO playlist_tracks (playlist_name, track_id, position, added_at) VALUES (?, ?, ?, ?)",
                                (name, tid, idx, time.time())
                            )

        # 2. Favorites
        if "favorites" in state_dict and isinstance(state_dict["favorites"], list):
            conn.execute("DELETE FROM favorites")
            for tid in state_dict["favorites"]:
                if tid:
                    conn.execute("INSERT OR REPLACE INTO favorites (track_id, added_at) VALUES (?, ?)", (tid, time.time()))

        # 3. History
        if "history" in state_dict and isinstance(state_dict["history"], list):
            conn.execute("DELETE FROM history")
            for tid in state_dict["history"][-100:]:
                if tid:
                    conn.execute("INSERT INTO history (track_id, played_at) VALUES (?, ?)", (tid, time.time()))

        # 4. Positions
        if "positions" in state_dict and isinstance(state_dict["positions"], dict):
            for tid, pos in state_dict["positions"].items():
                if tid and isinstance(pos, (int, float)):
                    conn.execute("INSERT OR REPLACE INTO positions (track_id, position, updated_at) VALUES (?, ?, ?)", (tid, float(pos), time.time()))

        # 5. Track Categories
        if "track_categories" in state_dict and isinstance(state_dict["track_categories"], dict):
            conn.execute("DELETE FROM track_categories")
            for tid, cat in state_dict["track_categories"].items():
                if tid and cat:
                    conn.execute("INSERT OR REPLACE INTO track_categories (track_id, category) VALUES (?, ?)", (tid, cat))

        # 6. Library Folders
        if "library_folders" in state_dict and isinstance(state_dict["library_folders"], list):
            conn.execute("DELETE FROM library_folders")
            for f in state_dict["library_folders"]:
                if f:
                    conn.execute("INSERT OR REPLACE INTO library_folders (folder_path, added_at) VALUES (?, ?)", (f, time.time()))

        # 7. Lyrics
        if "lyrics" in state_dict and isinstance(state_dict["lyrics"], dict):
            for tid, l_content in state_dict["lyrics"].items():
                if tid and l_content:
                    conn.execute("INSERT OR REPLACE INTO custom_lyrics (track_id, content, updated_at) VALUES (?, ?, ?)", (tid, l_content, time.time()))

        # 8. Scalar keys
        if "last_played_track_id" in state_dict:
            conn.execute("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", ("last_played_track_id", str(state_dict["last_played_track_id"] or "")))
        if "last_played_position" in state_dict:
            conn.execute("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", ("last_played_position", str(state_dict["last_played_position"] or 0)))

        # 9. Playback queue
        if "playback_queue" in state_dict:
            pq = state_dict["playback_queue"]
            if isinstance(pq, (dict, list)):
                save_playback_queue(pq)

        # 10. User settings
        if "user_settings" in state_dict and isinstance(state_dict["user_settings"], dict):
            save_user_settings(state_dict["user_settings"])


# ---------------------------------------------------------------------------
# User Settings & Queue State (Persistent in SQLite)
# ---------------------------------------------------------------------------

def _clean_theme_dict(d: Any) -> Any:
    if isinstance(d, dict):
        d_copy = dict(d)
        src = d_copy.get("customImageSrc")
        if isinstance(src, str) and src.startswith("blob:"):
            d_copy["customImageSrc"] = d_copy.get("sourceUrl") or ""
        vsrc = d_copy.get("customVideoSrc")
        if isinstance(vsrc, str) and vsrc.startswith("blob:"):
            d_copy["customVideoSrc"] = d_copy.get("sourceUrl") or ""
        return d_copy
    return d


def set_user_setting(key: str, value: Any) -> bool:
    """Sets a single user setting into SQLite."""
    if not key:
        return False
    if key in ("custom_theme", "fs_theme"):
        value = _clean_theme_dict(value)
    val_str = json.dumps(value) if not isinstance(value, str) else value
    conn = get_db()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)",
            (key, val_str, time.time())
        )
    return True


def get_user_setting(key: str, default: Any = None) -> Any:
    """Gets a single user setting, deserializing JSON if possible."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT value FROM user_settings WHERE key = ?", (key,))
    row = cur.fetchone()
    if not row:
        return default
    raw = row["value"]
    try:
        val = json.loads(raw)
    except Exception:
        val = raw
    if key in ("custom_theme", "fs_theme"):
        val = _clean_theme_dict(val)
    return val


def get_all_user_settings() -> dict:
    """Returns all user settings from SQLite as a dictionary."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT key, value FROM user_settings")
    res = {}
    for r in cur.fetchall():
        k = r["key"]
        v = r["value"]
        try:
            val = json.loads(v)
        except Exception:
            val = v
        if k in ("custom_theme", "fs_theme"):
            val = _clean_theme_dict(val)
        res[k] = val
    return res


def save_user_settings(settings: dict) -> bool:
    """Batch saves multiple user settings into SQLite."""
    if not isinstance(settings, dict):
        return False
    conn = get_db()
    now = time.time()
    rows = []
    for k, v in settings.items():
        if not k:
            continue
        if k in ("custom_theme", "fs_theme"):
            v = _clean_theme_dict(v)
        val_str = json.dumps(v) if not isinstance(v, str) else v
        rows.append((k, val_str, now))
    if not rows:
        return True
    with conn:
        conn.executemany(
            "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, ?)",
            rows
        )
    return True


def save_playback_queue(queue_data: dict | list, current_index: int = 0) -> bool:
    """Saves the current playback queue and active index into SQLite."""
    payload = {
        "queue": queue_data if isinstance(queue_data, list) else queue_data.get("queue", []),
        "currentIndex": current_index if isinstance(queue_data, list) else queue_data.get("currentIndex", current_index)
    }
    conn = get_db()
    with conn:
        conn.execute(
            "INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)",
            ("playback_queue", json.dumps(payload))
        )
    return True


def get_playback_queue() -> dict:
    """Retrieves the stored playback queue and index from SQLite."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT value FROM app_state WHERE key = 'playback_queue'")
    row = cur.fetchone()
    if not row or not row["value"]:
        return {"queue": [], "currentIndex": 0}
    try:
        data = json.loads(row["value"])
        if isinstance(data, dict):
            return data
        elif isinstance(data, list):
            return {"queue": data, "currentIndex": 0}
    except Exception:
        pass
    return {"queue": [], "currentIndex": 0}


def upsert_online_tracks_batch(tracks: list[dict]) -> int:
    """Efficiently upserts multiple online track metadata entries in SQLite."""
    if not tracks or not isinstance(tracks, list):
        return 0
    count = 0
    for t in tracks:
        if not isinstance(t, dict):
            continue
        tid = t.get("id") or (f"yt:{t.get('video_id')}" if t.get("video_id") else "")
        if not tid:
            continue
        title = t.get("title") or "Unknown Track"
        artist = t.get("artist") or "YouTube"
        album = t.get("album") or ""
        genre = t.get("genre") or "YouTube"
        duration = float(t.get("duration") or 0.0)
        artwork_url = t.get("artwork_url") or t.get("thumbnail") or ""
        source = t.get("source") or "youtube"
        ok = upsert_track_metadata(
            track_id=tid,
            title=title,
            artist=artist,
            album=album,
            genre=genre,
            duration=duration,
            artwork_url=artwork_url,
            is_online=True,
            source=source
        )
        if ok:
            count += 1
    return count


# ---------------------------------------------------------------------------
# Individual Helper Functions
# ---------------------------------------------------------------------------

def set_app_state(key: str, value: str):
    conn = get_db()
    with conn:
        conn.execute("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", (key, value))


def get_app_state(key: str, default: str = "") -> str:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT value FROM app_state WHERE key = ?", (key,))
    row = cur.fetchone()
    return row["value"] if row else default


def create_playlist(name: str) -> bool:
    name = (name or "").strip()
    if not name:
        return False
    conn = get_db()
    try:
        with conn:
            conn.execute("INSERT OR IGNORE INTO playlists (name, created_at) VALUES (?, ?)", (name, time.time()))
        return True
    except Exception:
        return False


def add_track_to_playlist(name: str, track_id: str, position: int | None = None) -> bool:
    name = (name or "").strip()
    track_id = (track_id or "").strip()
    if not name or not track_id:
        return False
    conn = get_db()
    try:
        with conn:
            create_playlist(name)
            if position is None:
                cur = conn.cursor()
                cur.execute("SELECT COALESCE(MAX(position), -1) + 1 FROM playlist_tracks WHERE playlist_name = ?", (name,))
                position = cur.fetchone()[0]
            conn.execute(
                "INSERT OR REPLACE INTO playlist_tracks (playlist_name, track_id, position, added_at) VALUES (?, ?, ?, ?)",
                (name, track_id, position, time.time())
            )
        return True
    except Exception:
        return False


def remove_track_from_playlist(name: str, track_id: str) -> bool:
    conn = get_db()
    try:
        with conn:
            conn.execute("DELETE FROM playlist_tracks WHERE playlist_name = ? AND track_id = ?", (name, track_id))
        return True
    except Exception:
        return False


def delete_playlist(name: str) -> bool:
    conn = get_db()
    try:
        with conn:
            conn.execute("DELETE FROM playlist_tracks WHERE playlist_name = ?", (name,))
            conn.execute("DELETE FROM playlists WHERE name = ?", (name,))
        return True
    except Exception:
        return False


def set_favorite(track_id: str, is_fav: bool) -> bool:
    conn = get_db()
    try:
        with conn:
            if is_fav:
                conn.execute("INSERT OR REPLACE INTO favorites (track_id, added_at) VALUES (?, ?)", (track_id, time.time()))
            else:
                conn.execute("DELETE FROM favorites WHERE track_id = ?", (track_id,))
        return True
    except Exception:
        return False


def get_favorites() -> list[str]:
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT track_id FROM favorites ORDER BY added_at DESC")
        return [r["track_id"] for r in cur.fetchall()]
    except Exception:
        return []


def get_all_track_play_stats() -> dict[str, dict]:
    """Returns mapping of track_id -> play stats dictionary."""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT track_id, play_count, skip_count, total_play_time, completion_rate, last_played_at FROM track_play_stats")
        rows = cur.fetchall()
        return {
            r["track_id"]: {
                "play_count": r["play_count"],
                "skip_count": r["skip_count"],
                "total_play_time": r["total_play_time"],
                "completion_rate": r["completion_rate"],
                "last_played_at": r["last_played_at"]
            }
            for r in rows
        }
    except Exception:
        return {}



def add_history(track_id: str):
    conn = get_db()
    try:
        with conn:
            conn.execute("INSERT INTO history (track_id, played_at) VALUES (?, ?)", (track_id, time.time()))
    except Exception:
        pass


def set_position(track_id: str, pos: float):
    conn = get_db()
    try:
        with conn:
            conn.execute("INSERT OR REPLACE INTO positions (track_id, position, updated_at) VALUES (?, ?, ?)", (track_id, pos, time.time()))
    except Exception:
        pass


def set_track_category(track_id: str, category: str):
    conn = get_db()
    try:
        with conn:
            if category:
                conn.execute("INSERT OR REPLACE INTO track_categories (track_id, category) VALUES (?, ?)", (track_id, category))
            else:
                conn.execute("DELETE FROM track_categories WHERE track_id = ?", (track_id,))
    except Exception:
        pass


def set_custom_lyrics(track_id: str, content: str):
    conn = get_db()
    try:
        with conn:
            if content:
                conn.execute("INSERT OR REPLACE INTO custom_lyrics (track_id, content, updated_at) VALUES (?, ?, ?)", (track_id, content, time.time()))
            else:
                conn.execute("DELETE FROM custom_lyrics WHERE track_id = ?", (track_id,))
    except Exception:
        pass


def add_library_folder(folder_path: str) -> bool:
    folder_path = (folder_path or "").strip()
    if not folder_path:
        return False
    conn = get_db()
    try:
        with conn:
            conn.execute("INSERT OR REPLACE INTO library_folders (folder_path, added_at) VALUES (?, ?)", (folder_path, time.time()))
        return True
    except Exception:
        return False


def remove_library_folder(folder_path: str) -> bool:
    conn = get_db()
    try:
        with conn:
            conn.execute("DELETE FROM library_folders WHERE folder_path = ?", (folder_path,))
        return True
    except Exception:
        return False


def get_library_folders() -> list[str]:
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT folder_path FROM library_folders ORDER BY added_at ASC")
    folders = [row["folder_path"] for row in cur.fetchall()]
    return folders if folders else [str(DOWNLOADS_DIR)]


# ---------------------------------------------------------------------------
# Metadata, Telemetry & Recommendation Persistence APIs (Linus CMI v6.0)
# ---------------------------------------------------------------------------

def upsert_track_metadata(
    track_id: str,
    title: str,
    artist: str,
    album: str = "",
    genre: str = "",
    duration: float = 0.0,
    artwork_url: str = "",
    is_online: bool = False,
    source: str = "",
    file_mtime: float = 0.0,
    file_size: int = 0
) -> bool:
    """Persists or updates metadata for any track (local or online)."""
    if not track_id or not title:
        return False
    conn = get_db()
    now = time.time()
    try:
        with conn:
            conn.execute("""
                INSERT INTO tracks_meta (track_id, title, artist, album, genre, duration, artwork_url, is_online, source, file_mtime, file_size, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(track_id) DO UPDATE SET
                    title = CASE WHEN ? != '' THEN ? ELSE title END,
                    artist = CASE WHEN ? != '' AND ? NOT IN ('Local collection', 'YouTube', 'Unknown') THEN ? ELSE artist END,
                    album = CASE WHEN ? != '' THEN ? ELSE album END,
                    genre = CASE WHEN ? != '' THEN ? ELSE genre END,
                    duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
                    artwork_url = CASE WHEN ? != '' THEN ? ELSE artwork_url END,
                    file_mtime = CASE WHEN ? > 0 THEN ? ELSE file_mtime END,
                    file_size = CASE WHEN ? > 0 THEN ? ELSE file_size END,
                    updated_at = ?
            """, (
                track_id, title.strip(), (artist or "Unknown").strip(), album.strip(), genre.strip(),
                float(duration or 0.0), artwork_url.strip(), 1 if is_online else 0, source.strip(),
                float(file_mtime or 0.0), int(file_size or 0), now,
                title.strip(), title.strip(),
                artist.strip(), artist.strip(), artist.strip(),
                album.strip(), album.strip(),
                genre.strip(), genre.strip(),
                float(duration or 0.0), float(duration or 0.0),
                artwork_url.strip(), artwork_url.strip(),
                float(file_mtime or 0.0), float(file_mtime or 0.0),
                int(file_size or 0), int(file_size or 0),
                now
            ))
        return True
    except Exception as e:
        print(f"[DB] Error upserting track metadata for {track_id}: {e}")
        return False


def update_track_metadata(
    track_id: str,
    title: Optional[str] = None,
    artist: Optional[str] = None,
    album: Optional[str] = None,
    genre: Optional[str] = None,
    artwork_url: Optional[str] = None,
) -> bool:
    """Updates specific metadata fields for an existing track in SQLite."""
    if not track_id:
        return False
    conn = get_db()
    now = time.time()
    updates = ["updated_at = ?"]
    params = [now]

    if title is not None:
        updates.append("title = ?")
        params.append(title.strip())
    if artist is not None:
        updates.append("artist = ?")
        params.append(artist.strip())
    if album is not None:
        updates.append("album = ?")
        params.append(album.strip())
    if genre is not None:
        updates.append("genre = ?")
        params.append(genre.strip())
    if artwork_url is not None:
        updates.append("artwork_url = ?")
        params.append(artwork_url.strip())

    params.append(track_id)
    try:
        with conn:
            conn.execute(f"UPDATE tracks_meta SET {', '.join(updates)} WHERE track_id = ?", params)
        return True
    except Exception as e:
        print(f"[DB] Error updating track metadata for {track_id}: {e}")
        return False



def get_all_local_tracks_metadata() -> dict[str, dict]:
    """Fetches all local track metadata indexed in SQLite for high-speed cache checks."""
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT track_id, title, artist, album, genre, duration, artwork_url, file_mtime, file_size FROM tracks_meta WHERE is_online = 0")
        return {r["track_id"]: dict(r) for r in cur.fetchall()}
    except Exception:
        return {}


def get_all_online_tracks_metadata() -> dict[str, dict]:
    """Fetches all online track metadata stored in SQLite (e.g. imported YouTube playlists)."""
    conn = get_db()
    cur = conn.cursor()
    try:
        cur.execute("SELECT track_id, title, artist, album, genre, duration, artwork_url, source FROM tracks_meta WHERE is_online = 1")
        res = {}
        for r in cur.fetchall():
            row = dict(r)
            tid = row.get("track_id", "")
            if not tid:
                continue
            vid = tid.replace("yt:", "") if tid.startswith("yt:") else tid
            res[tid] = {
                "id": tid,
                "video_id": vid,
                "title": row.get("title") or "YouTube Stream",
                "artist": row.get("artist") or "YouTube",
                "album": row.get("album") or "YouTube",
                "genre": row.get("genre") or "YouTube",
                "duration": float(row.get("duration") or 0.0),
                "artwork_url": row.get("artwork_url") or f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "has_artwork": True,
                "is_online": True,
                "source": row.get("source") or "youtube",
                "url": f"/api/youtube/stream/{vid}"
            }
        return res
    except Exception as e:
        print(f"[DB] Error fetching online tracks metadata: {e}")
        return {}


def get_track_metadata(track_id: str) -> dict | None:
    """Fetches stored metadata for a given track."""
    if not track_id:
        return None
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM tracks_meta WHERE track_id = ?", (track_id,))
    row = cur.fetchone()
    if row:
        return dict(row)
    return None


def batch_get_track_metadata(track_ids: list[str]) -> dict[str, dict]:
    """Fetches metadata for multiple tracks in a single query."""
    if not track_ids:
        return {}
    conn = get_db()
    cur = conn.cursor()
    results = {}
    chunk_size = 400
    for i in range(0, len(track_ids), chunk_size):
        chunk = track_ids[i:i + chunk_size]
        placeholders = ",".join(["?"] * len(chunk))
        cur.execute(f"SELECT * FROM tracks_meta WHERE track_id IN ({placeholders})", chunk)
        for r in cur.fetchall():
            results[r["track_id"]] = dict(r)
    return results


def record_granular_user_event(
    session_id: str,
    event_type: str,
    track_id: str,
    prev_track_id: str = "",
    duration_played: float = 0.0,
    total_duration: float = 0.0,
    completion_rate: float = 0.0,
    context_source: str = "",
    timestamp: float = None
) -> bool:
    """Logs a discrete user event (play, skip, complete, like, dislike, etc.)."""
    if not track_id or not event_type:
        return False
    ts = timestamp or time.time()
    tm = time.localtime(ts)
    hour = tm.tm_hour
    dow = tm.tm_wday  # 0=Monday, 6=Sunday
    conn = get_db()
    try:
        with conn:
            conn.execute("""
                INSERT INTO user_events (
                    session_id, event_type, track_id, prev_track_id,
                    duration_played, total_duration, completion_rate,
                    context_source, hour_of_day, day_of_week, timestamp
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                session_id or "", event_type, track_id, prev_track_id or "",
                float(duration_played or 0.0), float(total_duration or 0.0),
                float(completion_rate or 0.0), context_source or "",
                hour, dow, ts
            ))
        return True
    except Exception as e:
        print(f"[DB] Error logging user event: {e}")
        return False


def set_dislike(track_id: str, disliked: bool = True) -> bool:
    """Adds or removes a track from the negative feedback (dislike) suppression list."""
    if not track_id:
        return False
    conn = get_db()
    try:
        with conn:
            if disliked:
                conn.execute("INSERT OR REPLACE INTO dislikes (track_id, disliked_at) VALUES (?, ?)", (track_id, time.time()))
            else:
                conn.execute("DELETE FROM dislikes WHERE track_id = ?", (track_id,))
        return True
    except Exception as e:
        print(f"[DB] Dislike update error: {e}")
        return False


def is_disliked(track_id: str) -> bool:
    """Checks if a track is marked as disliked."""
    if not track_id:
        return False
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT 1 FROM dislikes WHERE track_id = ?", (track_id,))
    return cur.fetchone() is not None


def get_disliked_track_ids() -> set[str]:
    """Returns all disliked track IDs as a fast lookup set."""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT track_id FROM dislikes")
    return {r["track_id"] for r in cur.fetchall()}


def get_dashboard_shelf_cache(shelf_id: str, max_age_seconds: float = 1800.0) -> list | dict | None:
    """Retrieves a cached recommendation shelf if fresh."""
    if not shelf_id:
        return None
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT payload, updated_at FROM dashboard_cache WHERE shelf_id = ?", (shelf_id,))
    row = cur.fetchone()
    if not row:
        return None
    if (time.time() - row["updated_at"]) > max_age_seconds:
        return None
    try:
        return json.loads(row["payload"])
    except Exception:
        return None


def set_dashboard_shelf_cache(shelf_id: str, payload: list | dict) -> bool:
    """Saves a recommendation shelf into persistent SQLite cache."""
    if not shelf_id or payload is None:
        return False
    conn = get_db()
    now = time.time()
    try:
        with conn:
            conn.execute("""
                INSERT INTO dashboard_cache (shelf_id, payload, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(shelf_id) DO UPDATE SET
                    payload = ?,
                    updated_at = ?
            """, (shelf_id, json.dumps(payload), now, json.dumps(payload), now))
        return True
    except Exception as e:
        print(f"[DB] Error writing dashboard cache: {e}")
        return False


def invalidate_dashboard_cache(shelf_id: str = None):
    """Purges cached shelves so fresh recommendations generate immediately."""
    conn = get_db()
    try:
        with conn:
            if shelf_id:
                conn.execute("DELETE FROM dashboard_cache WHERE shelf_id = ?", (shelf_id,))
            else:
                conn.execute("DELETE FROM dashboard_cache")
    except Exception:
        pass


def get_search_cache(query: str, max_age_seconds: float = 86400.0) -> list | None:
    """Retrieves cached search results from SQLite if within max_age_seconds."""
    if not query:
        return None
    key = query.strip().lower()
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT results, updated_at FROM search_cache WHERE query = ?", (key,))
    row = cur.fetchone()
    if not row:
        return None
    if (time.time() - row["updated_at"]) > max_age_seconds:
        return None
    try:
        return json.loads(row["results"])
    except Exception:
        return None


def set_search_cache(query: str, results: list) -> bool:
    """Stores search results into SQLite persistent cache."""
    if not query or results is None:
        return False
    key = query.strip().lower()
    now = time.time()
    conn = get_db()
    try:
        with conn:
            conn.execute("""
                INSERT INTO search_cache (query, results, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(query) DO UPDATE SET
                    results = ?,
                    updated_at = ?
            """, (key, json.dumps(results), now, json.dumps(results), now))
        return True
    except Exception as e:
        print(f"[DB] Error writing search cache: {e}")
        return False


def optimize_database() -> bool:
    """Runs PRAGMA optimize and WAL checkpoint to truncate WAL file and keep SQLite fast."""
    try:
        conn = get_db()
        with conn:
            conn.execute("PRAGMA optimize;")
            conn.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        return True
    except Exception as e:
        print(f"[DB] Error optimizing database: {e}")
        return False


# Initialize on import
init_db()
