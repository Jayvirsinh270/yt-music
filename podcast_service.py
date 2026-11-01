"""
podcast_service.py — Podcast & RSS Audio Feed Ingestion Engine for Linus

Parses RSS 2.0 / iTunes XML podcast feeds, stores subscriptions in SQLite,
and tracks playback progress so users can listen and resume anytime.
"""

import hashlib
import time
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any, Optional

import requests
import db_store as db

# XML Namespaces
NAMESPACES = {
    "itunes": "http://www.itunes.com/dtds/podcast-1.0.dtd",
    "content": "http://purl.org/rss/1.0/modules/content/",
}


def _clean_text(elem: Optional[ET.Element]) -> str:
    if elem is None or elem.text is None:
        return ""
    return elem.text.strip()


def parse_feed(feed_url: str) -> dict[str, Any]:
    """
    Fetches and parses a podcast RSS XML feed.
    Returns show metadata and a list of audio episodes.
    """
    headers = {
        "User-Agent": "LinusMusicPlayer/2.0 (Podcast Engine; +https://github.com/Jayvirsinh270/yt-music)"
    }
    resp = requests.get(feed_url, headers=headers, timeout=15)
    resp.raise_for_status()

    root = ET.fromstring(resp.content)
    channel = root.find("channel")
    if channel is None:
        raise ValueError("Invalid podcast feed: missing <channel> element")

    # Show metadata
    title = _clean_text(channel.find("title")) or "Unknown Podcast"
    description = _clean_text(channel.find("description")) or ""
    author = _clean_text(channel.find("itunes:author", NAMESPACES)) or _clean_text(channel.find("author")) or "Podcast Host"

    # Artwork
    artwork_url = ""
    itunes_img = channel.find("itunes:image", NAMESPACES)
    if itunes_img is not None and "href" in itunes_img.attrib:
        artwork_url = itunes_img.attrib["href"]
    if not artwork_url:
        img_elem = channel.find("image")
        if img_elem is not None:
            artwork_url = _clean_text(img_elem.find("url"))

    # Episode items
    episodes = []
    for item in channel.findall("item"):
        enclosure = item.find("enclosure")
        if enclosure is None or not enclosure.attrib.get("url"):
            continue

        audio_url = enclosure.attrib.get("url", "")
        # Only accept audio streams
        enc_type = enclosure.attrib.get("type", "audio/mpeg")

        ep_title = _clean_text(item.find("title")) or "Untitled Episode"
        ep_desc = _clean_text(item.find("description")) or ""
        pub_date = _clean_text(item.find("pubDate")) or ""
        guid = _clean_text(item.find("guid")) or audio_url

        # Duration
        dur_elem = item.find("itunes:duration", NAMESPACES)
        dur_str = _clean_text(dur_elem)
        duration_sec = 0.0
        if dur_str:
            parts = dur_str.split(":")
            try:
                if len(parts) == 3:
                    duration_sec = float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
                elif len(parts) == 2:
                    duration_sec = float(parts[0]) * 60 + float(parts[1])
                elif len(parts) == 1:
                    duration_sec = float(parts[0])
            except ValueError:
                duration_sec = 0.0

        # Episode artwork fallback
        ep_img = item.find("itunes:image", NAMESPACES)
        ep_artwork = ep_img.attrib.get("href", "") if ep_img is not None else artwork_url

        ep_id = hashlib.md5(f"{feed_url}:{guid}".encode("utf-8")).hexdigest()[:16]

        episodes.append({
            "id": f"pod:{ep_id}",
            "title": ep_title,
            "description": ep_desc[:400],
            "audio_url": audio_url,
            "duration": duration_sec,
            "pub_date": pub_date,
            "artwork_url": ep_artwork or artwork_url,
            "mime_type": enc_type
        })

    feed_id = hashlib.md5(feed_url.encode("utf-8")).hexdigest()[:12]

    return {
        "id": feed_id,
        "feed_url": feed_url,
        "title": title,
        "author": author,
        "description": description[:600],
        "artwork_url": artwork_url,
        "episode_count": len(episodes),
        "episodes": episodes
    }


def init_podcast_tables():
    """Initializes SQLite tables for podcast subscriptions and episodes."""
    conn = db.get_db()
    with conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS podcasts (
                id TEXT PRIMARY KEY,
                feed_url TEXT UNIQUE NOT NULL,
                title TEXT NOT NULL,
                author TEXT,
                description TEXT,
                artwork_url TEXT,
                episode_count INTEGER DEFAULT 0,
                subscribed_at REAL NOT NULL
            );

            CREATE TABLE IF NOT EXISTS podcast_episodes (
                id TEXT PRIMARY KEY,
                podcast_id TEXT NOT NULL,
                title TEXT NOT NULL,
                audio_url TEXT NOT NULL,
                duration REAL DEFAULT 0,
                pub_date TEXT,
                description TEXT,
                artwork_url TEXT,
                playback_position REAL DEFAULT 0,
                is_played INTEGER DEFAULT 0,
                updated_at REAL NOT NULL,
                FOREIGN KEY (podcast_id) REFERENCES podcasts (id) ON DELETE CASCADE
            );
        """)


def subscribe_podcast(feed_url: str) -> dict[str, Any]:
    """Subscribes to an RSS feed, persists it in the database, and stores its episodes."""
    init_podcast_tables()
    parsed = parse_feed(feed_url.strip())
    conn = db.get_db()

    with conn:
        conn.execute("""
            INSERT OR REPLACE INTO podcasts 
            (id, feed_url, title, author, description, artwork_url, episode_count, subscribed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            parsed["id"],
            parsed["feed_url"],
            parsed["title"],
            parsed["author"],
            parsed["description"],
            parsed["artwork_url"],
            parsed["episode_count"],
            time.time()
        ))

        # Store latest 60 episodes
        for ep in parsed["episodes"][:60]:
            conn.execute("""
                INSERT OR IGNORE INTO podcast_episodes
                (id, podcast_id, title, audio_url, duration, pub_date, description, artwork_url, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                ep["id"],
                parsed["id"],
                ep["title"],
                ep["audio_url"],
                ep["duration"],
                ep["pub_date"],
                ep["description"],
                ep["artwork_url"],
                time.time()
            ))

    return parsed


def get_subscribed_podcasts() -> list[dict[str, Any]]:
    """Returns all subscribed podcasts."""
    init_podcast_tables()
    conn = db.get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM podcasts ORDER BY subscribed_at DESC")
    return [dict(row) for row in cur.fetchall()]


def get_podcast_details(podcast_id: str) -> dict[str, Any] | None:
    """Returns podcast info and its stored episodes with playback positions."""
    init_podcast_tables()
    conn = db.get_db()
    cur = conn.cursor()
    cur.execute("SELECT * FROM podcasts WHERE id = ?", (podcast_id,))
    pod_row = cur.fetchone()
    if not pod_row:
        return None

    cur.execute("""
        SELECT * FROM podcast_episodes 
        WHERE podcast_id = ? 
        ORDER BY updated_at DESC LIMIT 100
    """, (podcast_id,))
    episodes = [dict(row) for row in cur.fetchall()]

    result = dict(pod_row)
    result["episodes"] = episodes
    return result


def unsubscribe_podcast(podcast_id: str) -> bool:
    """Removes a podcast and its episodes."""
    init_podcast_tables()
    conn = db.get_db()
    try:
        with conn:
            conn.execute("DELETE FROM podcast_episodes WHERE podcast_id = ?", (podcast_id,))
            conn.execute("DELETE FROM podcasts WHERE id = ?", (podcast_id,))
        return True
    except Exception:
        return False


def save_episode_position(episode_id: str, position: float, is_played: bool = False) -> bool:
    """Saves playback timestamp for an episode."""
    init_podcast_tables()
    conn = db.get_db()
    try:
        with conn:
            conn.execute("""
                UPDATE podcast_episodes 
                SET playback_position = ?, is_played = ?, updated_at = ?
                WHERE id = ?
            """, (position, 1 if is_played else 0, time.time(), episode_id))
        return True
    except Exception:
        return False
