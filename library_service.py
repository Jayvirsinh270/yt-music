"""
Linus Music Player — Library Service
Domain service managing local media library, Mutagen tag parsing,
artwork extraction, SQLite metadata caching, and async rescan.
"""

from __future__ import annotations

import base64
import logging
import mimetypes
import os
import re
import sys
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

import mutagen
from mutagen.flac import FLAC
from mutagen.id3 import ID3, APIC, TALB, TCON, TIT2, TPE1
from mutagen.mp4 import MP4, MP4Cover

import db_store as db

logger = logging.getLogger('linus.library')

ROOT = Path(__file__).resolve().parent
DOWNLOADS = ROOT / 'downloads'
AUDIO_EXTENSIONS = {'.mp3', '.wav', '.ogg', '.flac', '.m4a'}
VIDEO_EXTENSIONS = {'.mp4', '.webm', '.mkv', '.mov', '.avi'}
ALL_MEDIA_EXTENSIONS = AUDIO_EXTENSIONS | VIDEO_EXTENSIONS

# ---------------------------------------------------------------------------
# State helpers (SQLite Engine)
# ---------------------------------------------------------------------------

def load_state():
    return db.get_state()


def save_state(state):
    db.save_state_dict(state)


# ---------------------------------------------------------------------------
# Metadata & Artwork Extraction (Mutagen)
# ---------------------------------------------------------------------------

def extract_artwork_bytes(filepath: str) -> tuple[bytes, str] | None:
    """Extract embedded album art image bytes & mime type from audio file."""
    try:
        f = mutagen.File(filepath)
        if f is None or not getattr(f, "tags", None):
            return None
        tags = f.tags

        # ID3 (MP3)
        for k in tags.keys():
            if k.startswith("APIC"):
                apic = tags[k]
                mime = getattr(apic, "mime", "image/jpeg")
                return apic.data, mime

        # MP4 / M4A (covr)
        if "covr" in tags and tags["covr"]:
            covr = tags["covr"][0]
            mime = "image/png" if getattr(covr, "imageformat", None) == 14 else "image/jpeg"
            return bytes(covr), mime

        # FLAC
        if hasattr(f, "pictures") and f.pictures:
            pic = f.pictures[0]
            return pic.data, getattr(pic, "mime", "image/jpeg")
    except Exception:
        pass
    return None


ID3_GENRES = {
    "0": "Blues", "1": "Classic Rock", "2": "Country", "3": "Dance", "4": "Disco", "5": "Funk",
    "6": "Grunge", "7": "Hip-Hop", "8": "Jazz", "9": "Metal", "10": "New Age", "11": "Oldies",
    "12": "Other", "13": "Pop", "14": "R&B", "15": "Rap", "16": "Reggae", "17": "Rock",
    "18": "Techno", "19": "Industrial", "20": "Alternative", "21": "Ska", "22": "Death Metal",
    "24": "Soundtrack", "25": "Euro-Techno", "26": "Ambient", "31": "Trance", "32": "Classical",
    "33": "Instrumental", "34": "Acid", "35": "House", "36": "Game", "38": "Gospel",
    "40": "Alternative Rock", "41": "Bass", "42": "Soul", "43": "Punk", "44": "Space",
    "45": "Meditative", "47": "Instrumental Rock", "48": "Ethnic", "49": "Gothic",
    "50": "Darkwave", "51": "Techno-Industrial", "52": "Electronic", "53": "Pop-Folk",
    "54": "Eurodance", "55": "Dream", "56": "Southern Rock", "57": "Comedy", "58": "Cult",
    "59": "Gangsta", "60": "Top 40", "61": "Christian Rap", "62": "Pop/Funk", "63": "Jungle",
    "64": "Native American", "65": "Cabaret", "66": "New Wave", "67": "Psychadelic",
    "68": "Rave", "69": "Showtunes", "70": "Trailer", "71": "Lo-Fi", "72": "Tribal",
    "73": "Acid Punk", "74": "Acid Jazz", "75": "Polka", "76": "Retro", "77": "Musical",
    "78": "Rock & Roll", "79": "Hard Rock", "80": "Folk", "81": "Folk-Rock", "82": "National Folk",
    "83": "Swing", "84": "Fast Fusion", "85": "Bebob", "86": "Latin", "87": "Revival",
    "88": "Celtic", "89": "Bluegrass", "90": "Avantgarde", "91": "Gothic Rock", "92": "Progressive Rock",
    "93": "Psychedelic Rock", "94": "Symphonic Rock", "95": "Slow Rock", "96": "Big Band",
    "97": "Chorus", "98": "Easy Listening", "99": "Acoustic", "101": "Speech",
    "103": "Opera", "104": "Chamber Music", "105": "Sonata", "106": "Symphony",
    "111": "Slow Jam", "112": "Club", "113": "Tango", "114": "Samba", "115": "Folklore",
    "116": "Ballad", "117": "Power Ballad", "118": "Rhythmic Soul", "119": "Freestyle",
    "121": "Punk Rock", "123": "Acapella", "124": "Euro-House", "125": "Dance Hall"
}

GENRE_KEYWORDS = [
    (r'\b(lo-?fi|chillhop|study|relaxing|chill|peaceful)\b', "Lo-Fi"),
    (r'\b(acoustic|unplugged|piano|fingerstyle|folk)\b', "Acoustic"),
    (r'\b(edm|house|techno|trance|dubstep|synthwave|electro|electronic)\b', "Electronic"),
    (r'\b(hip[\s-]?hop|rap|trap|freestyle|drill)\b', "Hip-Hop"),
    (r'\b(r&b|rnb|soul|motown|funk)\b', "R&B"),
    (r'\b(rock|metal|punk|grunge|hard rock|guitar)\b', "Rock"),
    (r'\b(pop|dance|disco|synth|party)\b', "Pop"),
    (r'\b(classical|orchestra|symphony|concerto|sonata|chopin|mozart|beethoven|bach|vivaldi|pachelbel|tchaikovsky|canon)\b', "Classical"),
    (r'\b(jazz|blues|swing|saxophone|bossa)\b', "Jazz"),
    (r'\b(soundtrack|ost|theme|score|cinematic)\b', "Soundtrack"),
    (r'\b(ambient|meditation|sleep|drone|calm)\b', "Ambient"),
]


def extract_track_meta(path: Path) -> dict:
    """Extract clean title, artist, album, genre, duration, and artwork existence."""
    raw_title = path.stem.replace("_", " ").strip()
    title = raw_title
    artist = "Local collection"
    album = "Local files"
    genre = ""
    duration = 0.0
    has_art = False

    # 1. Read embedded tags via Mutagen
    try:
        if mutagen is not None:
            f = mutagen.File(str(path))
            if f is not None:
                duration = round(getattr(getattr(f, "info", None), "length", 0.0), 1)
                tags = getattr(f, "tags", None)
                if tags:
                    for k in ["TIT2", "title", "\xa9nam"]:
                        if k in tags and tags[k]:
                            val = tags[k][0] if isinstance(tags[k], list) else str(tags[k])
                            if val.strip():
                                title = val.strip()
                                break
                    for k in ["TPE1", "artist", "\xa9ART"]:
                        if k in tags and tags[k]:
                            val = tags[k][0] if isinstance(tags[k], list) else str(tags[k])
                            if val.strip():
                                artist = val.strip()
                                break
                    for k in ["TALB", "album", "\xa9alb"]:
                        if k in tags and tags[k]:
                            val = tags[k][0] if isinstance(tags[k], list) else str(tags[k])
                            if val.strip():
                                album = val.strip()
                                break
                    for k in ["TCON", "genre", "\xa9gen", "GENRE"]:
                        if k in tags and tags[k]:
                            val = tags[k][0] if isinstance(tags[k], list) else str(tags[k])
                            val_str = str(val).strip()
                            if val_str:
                                match_num = re.match(r'^\(?(\d+)\)?$', val_str)
                                if match_num and match_num.group(1) in ID3_GENRES:
                                    genre = ID3_GENRES[match_num.group(1)]
                                else:
                                    genre = re.sub(r'^\(\d+\)', '', val_str).strip()
                                if genre:
                                    break
                    for k in tags.keys():
                        if k.startswith("APIC") or k in ("covr", "metadata_block_picture"):
                            has_art = True
                            break
    except Exception:
        pass

    # 2. Filename-based artist separation if artist was missing
    if " - " in title and (artist == "Local collection" or not artist):
        artist, title = title.split(" - ", 1)
    elif " - " in raw_title and (artist == "Local collection" or not artist):
        artist, _ = raw_title.split(" - ", 1)

    # 3. Clean noisy YouTube tags from title
    clean_t = re.sub(
        r'[\(\[\{].*?(?:official|video|lyrics|audio|lyric|hd|4k|remix|full|medley|ringtone|song|visualizer|feat|ft).*?[\)\]\}]',
        '',
        title,
        flags=re.IGNORECASE
    )
    clean_t = re.sub(r'\b(ft\.?|feat\.?|featuring)\b.*', '', clean_t, flags=re.IGNORECASE)
    clean_t = re.sub(r'[\s\-_\/\|]{2,}', ' ', clean_t).strip()
    if clean_t:
        title = clean_t

    # 4. Keyword genre fallback if tag was missing
    if not genre:
        text_to_check = f"{title} {raw_title} {artist} {path.parent.name}".lower()
        for pattern, g_name in GENRE_KEYWORDS:
            if re.search(pattern, text_to_check, re.IGNORECASE):
                genre = g_name
                break

    return {
        "title": title.strip() or raw_title,
        "artist": artist.strip() or "Local collection",
        "album": album.strip() or "Local files",
        "genre": genre.strip() or "Music",
        "duration": duration,
        "has_artwork": has_art,
    }


# ---------------------------------------------------------------------------
# High-Speed In-Memory Library Caching
# ---------------------------------------------------------------------------

_library_cache: list[dict] = []
_cache_lock = threading.Lock()
_last_scan_time = 0.0


def scan_library(force: bool = False) -> list[dict]:
    """Scan library folders with SQLite mtime/size caching and instant sub-millisecond retrieval."""
    global _library_cache, _last_scan_time
    with _cache_lock:
        if _library_cache and not force and (time.time() - _last_scan_time < 300):
            return list(_library_cache)

        state = load_state()
        roots = state.get("library_folders", [str(DOWNLOADS)])
        category_map: dict[str, str] = state.get("track_categories", {})
        existing_meta = db.get_all_local_tracks_metadata()

        tracks = []
        seen_keys = set()
        to_parse = []

        for root in roots:
            folder = Path(root).expanduser()
            if not folder.exists():
                continue
            folder_name = folder.name or str(folder)
            for path in folder.rglob("*"):
                if not path.is_file():
                    continue
                ext = path.suffix.lower()
                if ext not in ALL_MEDIA_EXTENSIONS:
                    continue

                key = str(path.resolve())
                if key in seen_keys:
                    continue
                seen_keys.add(key)

                try:
                    stat = path.stat()
                    mtime = stat.st_mtime
                    size = stat.st_size
                except OSError:
                    continue

                cached = existing_meta.get(key)
                # Fast path: unchanged file in SQLite cache
                if (
                    cached
                    and cached.get("file_mtime") == mtime
                    and cached.get("file_size") == size
                    and cached.get("title")
                ):
                    track_genre = cached.get("genre") or category_map.get(key, "") or "Music"
                    has_art = bool(cached.get("artwork_url"))
                    encoded_hex = key.encode("utf-8").hex()
                    media_type = "video" if ext in VIDEO_EXTENSIONS else "audio"

                    tracks.append({
                        "id": key,
                        "title": cached["title"],
                        "artist": cached["artist"],
                        "album": cached.get("album") or "Local files",
                        "genre": track_genre,
                        "duration": float(cached.get("duration") or 0.0),
                        "has_artwork": has_art,
                        "artwork_url": f"/api/artwork/{encoded_hex}" if has_art else "",
                        "extension": ext.lstrip("."),
                        "quality": "Lossless" if ext in {".flac", ".wav"} else ("High" if ext == ".m4a" else "Standard"),
                        "media_type": media_type,
                        "category": category_map.get(key, "") or (track_genre if track_genre != "Music" else ""),
                        "folder_name": folder_name,
                        "folder_path": str(folder),
                        "url": f"/media/{encoded_hex}",
                    })
                else:
                    to_parse.append((path, key, ext, str(folder), folder_name, mtime, size))

        # Parse new or modified files (in parallel if multiple)
        if to_parse:
            def _parse_item(item):
                p, k, x, fpath, fname, mt, sz = item
                m = extract_track_meta(p)
                return item, m

            if len(to_parse) > 4:
                from concurrent.futures import ThreadPoolExecutor
                with ThreadPoolExecutor(max_workers=min(8, len(to_parse))) as executor:
                    results = list(executor.map(_parse_item, to_parse))
            else:
                results = [_parse_item(item) for item in to_parse]

            for (p, k, x, fpath, fname, mt, sz), meta in results:
                encoded_hex = k.encode("utf-8").hex()
                media_type = "video" if x in VIDEO_EXTENSIONS else "audio"
                track_genre = meta.get("genre") or category_map.get(k, "") or "Music"
                has_art = meta["has_artwork"]
                art_url = f"/api/artwork/{encoded_hex}" if has_art else ""

                tracks.append({
                    "id": k,
                    "title": meta["title"],
                    "artist": meta["artist"],
                    "album": meta["album"],
                    "genre": track_genre,
                    "duration": meta["duration"],
                    "has_artwork": has_art,
                    "artwork_url": art_url,
                    "extension": x.lstrip("."),
                    "quality": "Lossless" if x in {".flac", ".wav"} else ("High" if x == ".m4a" else "Standard"),
                    "media_type": media_type,
                    "category": category_map.get(k, "") or (track_genre if track_genre != "Music" else ""),
                    "folder_name": fname,
                    "folder_path": fpath,
                    "url": f"/media/{encoded_hex}",
                })

                # Persist to SQLite cache with file_mtime and file_size
                if media_type == "audio":
                    try:
                        db.upsert_track_metadata(
                            track_id=k,
                            title=meta["title"],
                            artist=meta["artist"],
                            album=meta["album"],
                            genre=track_genre,
                            duration=meta["duration"],
                            artwork_url=art_url,
                            is_online=False,
                            source="local",
                            file_mtime=mt,
                            file_size=sz,
                        )
                    except Exception:
                        pass

        # Retain playlist & favorite tracks that were moved/deleted outside the app
        known_track_ids = set()
        for pl_tracks in state.get("playlists", {}).values():
            if isinstance(pl_tracks, list):
                for tid in pl_tracks:
                    known_track_ids.add(tid)
        for tid in state.get("favorites", []):
            known_track_ids.add(tid)

        for tid in known_track_ids:
            if tid not in seen_keys and not tid.startswith("yt:"):
                p = Path(tid)
                if not p.exists():
                    encoded_hex = tid.encode("utf-8").hex()
                    tracks.append({
                        "id": tid,
                        "title": p.stem.replace("_", " "),
                        "artist": "Missing File",
                        "album": "Not found on disk",
                        "genre": "Missing",
                        "duration": 0.0,
                        "has_artwork": False,
                        "artwork_url": "",
                        "extension": p.suffix.lstrip("."),
                        "media_type": "video" if p.suffix.lower() in VIDEO_EXTENSIONS else "audio",
                        "category": category_map.get(tid, ""),
                        "url": f"/media/{encoded_hex}",
                        "missing": True,
                    })

        tracks = sorted(tracks, key=lambda t: (t["artist"].lower(), t["title"].lower()))
        _library_cache = list(tracks)
        _last_scan_time = time.time()

        # Persist scan summary to SQLite for fast cold-boot recovery
        try:
            db.set_dashboard_shelf_cache("__library_scan__", {"count": len(tracks), "ts": _last_scan_time})
        except Exception:
            pass

        return list(_library_cache)


def find_track(track_id: str) -> dict | None:
    for track in scan_library():
        if track["id"] == track_id:
            return track
    return None



_scan_state = {
    "scanning": False,
    "count": 0,
    "started_at": 0.0,
    "finished_at": 0.0,
    "duration": 0.0,
    "error": None
}
_rescan_thread_lock = threading.Lock()


def start_async_rescan() -> bool:
    """Spawns an asynchronous background worker to re-scan the library and optimize the DB."""
    global _scan_state
    with _rescan_thread_lock:
        if _scan_state["scanning"]:
            return False
        _scan_state["scanning"] = True
        _scan_state["started_at"] = time.time()
        _scan_state["finished_at"] = 0.0
        _scan_state["duration"] = 0.0
        _scan_state["error"] = None

    def _worker():
        global _scan_state
        try:
            start_t = time.time()
            tracks = scan_library(force=True)
            elapsed = round(time.time() - start_t, 2)
            db.optimize_database()
            with _rescan_thread_lock:
                _scan_state["count"] = len(tracks)
                _scan_state["finished_at"] = time.time()
                _scan_state["duration"] = elapsed
                _scan_state["scanning"] = False
        except Exception as e:
            with _rescan_thread_lock:
                _scan_state["error"] = str(e)
                _scan_state["finished_at"] = time.time()
                _scan_state["scanning"] = False

    threading.Thread(target=_worker, daemon=True).start()
    return True



def update_track_tags(track_path: Path, title: str, artist: str, album: str, artwork_bytes: bytes | None = None, mime: str = "image/jpeg") -> bool:
    """Write updated ID3/Vorbis/MP4 metadata tags and artwork directly into media file."""
    try:
        ext = track_path.suffix.lower()
        if ext == ".mp3":
            from mutagen.id3 import ID3, TIT2, TPE1, TALB, APIC, ID3NoHeaderError
            try:
                tags = ID3(str(track_path))
            except ID3NoHeaderError:
                tags = ID3()
            
            if title: tags["TIT2"] = TIT2(encoding=3, text=title)
            if artist: tags["TPE1"] = TPE1(encoding=3, text=artist)
            if album: tags["TALB"] = TALB(encoding=3, text=album)
            if artwork_bytes:
                tags["APIC"] = APIC(
                    encoding=3,
                    mime=mime,
                    type=3,
                    desc="Cover",
                    data=artwork_bytes
                )
            tags.save(str(track_path))
            return True

        elif ext in {".m4a", ".mp4"}:
            from mutagen.mp4 import MP4, MP4Cover
            mp4 = MP4(str(track_path))
            if title: mp4["\xa9nam"] = [title]
            if artist: mp4["\xa9ART"] = [artist]
            if album: mp4["\xa9alb"] = [album]
            if artwork_bytes:
                fmt = MP4Cover.FORMAT_PNG if "png" in mime.lower() else MP4Cover.FORMAT_JPEG
                mp4["covr"] = [MP4Cover(artwork_bytes, imageformat=fmt)]
            mp4.save()
            return True

        elif ext == ".flac":
            from mutagen.flac import FLAC, Picture
            flac = FLAC(str(track_path))
            if title: flac["title"] = [title]
            if artist: flac["artist"] = [artist]
            if album: flac["album"] = [album]
            if artwork_bytes:
                pic = Picture()
                pic.type = 3
                pic.mime = mime
                pic.desc = "Cover"
                pic.data = artwork_bytes
                flac.clear_pictures()
                flac.add_picture(pic)
            flac.save()
            return True
    except Exception as e:
        print("Error saving tags:", e)
        return False
    return False


def is_safe_media_path(path: Path) -> bool:
    """
    Security guard against path traversal and unauthorized filesystem disclosure.
    Validates that:
    1. The path exists and has an allowed media extension (.mp3, .flac, .m4a, etc.)
    2. The path is situated within the downloads directory, an active library folder,
       or matches an indexed track in the database.
    """
    try:
        resolved = path.resolve()
        if not resolved.is_file():
            return False
        if resolved.suffix.lower() not in ALL_MEDIA_EXTENSIONS:
            return False

        # Check configured library roots
        state = load_state()
        roots = [Path(r).expanduser().resolve() for r in state.get("library_folders", [str(DOWNLOADS)])]
        roots.append(DOWNLOADS.resolve())

        for root in roots:
            try:
                resolved.relative_to(root)
                return True
            except ValueError:
                continue

        # Check if indexed in current library
        if find_track(str(resolved)):
            return True

        return False
    except Exception:
        return False


