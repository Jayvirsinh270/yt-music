"""
lyrics_provider.py — Linus Universal Multi-Tier Lyrics Engine (v5)
Fetches synchronized (.lrc) and plain lyrics from multiple global providers:
  1. Local Media Directory (.lrc adjacent to audio file)
  2. Persistent Disk Cache (lyrics_cache/*.lrc, *.txt, and *.meta.json)
  3. LRCLIB API (Duration-aware synchronized & plain lyrics)
  4. NetEase Cloud Music API (Duration- & similarity-scored synchronized LRC)
  5. YouTube Timed Captions (Official/manual video subtitles for yt: streams)
  6. lyrics.ovh API (Clean plain-text lyrics fallback)
Includes multi-provider search candidate scoring, LRC [offset:] & multi-timestamp
support, quality validation, and persistent custom caching.
"""

import difflib
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# Directories & Caching
ROOT_DIR = Path(__file__).resolve().parent
LYRICS_CACHE_DIR = ROOT_DIR / "lyrics_cache"
LYRICS_CACHE_DIR.mkdir(exist_ok=True)

_memory_cache: dict[str, dict] = {}
CACHE_TTL_SECONDS = 3600 * 24 * 30  # 30 days

LABEL_CHANNELS = {
    't-series', 'tseries', 'zee music company', 'sony music india', 'sonymusicindiavevo',
    'yrf', 'saregama music', 'saregama', 'tips official', 'tips music', 'speed records',
    'white hill music', 'aditya music', 'lahari music', 'eros now music', 'times music',
    'desi music factory', 'vyrl originals', 'universal music india', 'vibe music', '7clouds',
    'taj tracks', 'lofi fruits music', 'hollywoodrecordsvevo', 'vevo', 'warner music india',
    'geetha arts', 't-series apna punjab', 'jjust music', 'drj records', 'single track studios',
    'queen official', 't-series bhakti sagar', 'sonymusic', 'warnermusic', 'universalmusic',
    'geffen', 'def jam', 'atlantic records', 'columbia records', 'interscope',
    'goldmines', 'shemaroo', 'ishtar music', 'venus', 'vianet lofi bhajans',
}

_NOISE_WORDS = {
    'lofi', 'lo-fi', 'version', 'full', 'song', 'video', 'audio', 'official',
    'lyrical', 'lyrics', 'lyric', 'hd', '4k', 'status', 'ringtone', 'slowed',
    'reverb', 'remix', 'mashup', 'cover', 'unplugged', 'acoustic', 'hindi',
    'punjabi', 'tamil', 'telugu', 'malayalam', 'kannada', 'ost', 'teaser',
    'promo', 'trailer', 'edit', 'mix', 'remastered', 'visualizer', 'music',
    'fullscreen', 'track', 'original', '60fps', '8d', 'sped', 'up', 'nightcore',
    'feat', 'ft', 'featuring', 'with', 'and', 'the',
}

_INSTRUMENTAL_MARKERS = (
    '纯音乐，请欣赏',
    '纯音乐',
    'pure music',
    'instrumental only',
)

_CREDIT_LINE_RE = re.compile(
    r'^(?:by:|作词\s*[:：]|作曲\s*[:：]|编曲\s*[:：]|制作人\s*[:：]|混音\s*[:：]|'
    r'lyrics\s+by\s*[:：]|composed\s+by\s*[:：]|music\s+by\s*[:：])',
    re.IGNORECASE,
)

_VARIANT_PATTERNS = [
    ("slowed/reverb", re.compile(r'\b(slowed|reverb|slow\s*\+\s*reverb)\b', re.IGNORECASE)),
    ("sped-up", re.compile(r'\b(sped\s*up|speed\s*up|nightcore)\b', re.IGNORECASE)),
    ("lofi", re.compile(r'\b(lo-?fi)\b', re.IGNORECASE)),
    ("remix", re.compile(r'\b(remix|mashup|bootleg|club\s*mix|dj\s*mix)\b', re.IGNORECASE)),
    ("live", re.compile(r'\b(live\s*(?:at|in|from|performance|session|version)?|concert|unplugged)\b', re.IGNORECASE)),
    ("acoustic", re.compile(r'\b(acoustic)\b', re.IGNORECASE)),
    ("8d", re.compile(r'\b(8d\s*audio|8d)\b', re.IGNORECASE)),
]


def _clean_artist_name(artist: str) -> str:
    """Strip YouTube auto-generated '- Topic' suffixes and clean whitespace."""
    a = (artist or "").strip()
    a = re.sub(r'\s*[-–—]\s*Topic$', '', a, flags=re.IGNORECASE).strip()
    return a


def _is_label_channel(artist: str) -> bool:
    c = _clean_artist_name(artist).lower().strip()
    if not c or c in ('local collection', 'youtube', 'unknown', 'unknown artist', 'various artists', 'various', 'artist'):
        return True
    if c in LABEL_CHANNELS:
        return True
    return any(k in c for k in (
        'music company', 'records', 'vevo', 'channel', 'official', 'series',
        'films', 'studios', 'music india', 'music label', 'entertainment', 'bhajans'
    ))


def _detect_audio_variant(title: str) -> str:
    """Detect whether the title refers to a modified tempo/arrangement (slowed, remix, live, etc.)."""
    t = title or ""
    for label, pat in _VARIANT_PATTERNS:
        if pat.search(t):
            return label
    return ""


def _is_generic_noise_title(text: str) -> bool:
    """True if text consists solely of generic upload descriptors like 'Lofi Version' or 'Full Song'."""
    cleaned = re.sub(r'[^\w\s]', ' ', (text or "").lower())
    tokens = [tok for tok in cleaned.split() if tok and not tok.isdigit()]
    if not tokens:
        return True
    meaningful = [tok for tok in tokens if tok not in _NOISE_WORDS]
    return len(meaningful) == 0


def _clean_track_title(title: str) -> str:
    """Strip noisy metadata strings added by YouTube, uploaders, filenames, track numbers, and record labels."""
    if not title:
        return ""
    t = title.replace('_', ' ').strip()
    # Strip leading track numbers like '01 - ', '02. ', '03 ', '04_', '12 - '
    t = re.sub(r'^\d{1,3}\s*[-–—._\s]\s*', '', t)
    # Strip bitrate / file quality tags
    t = re.sub(
        r'\b(128kbps|192kbps|256kbps|320kbps|320\s*kbps|flac|mp3|m4a|wav|aac|cd\s*rip|web-dl|dvdrip|kbps|lossless|24bit|16bit)\b',
        '',
        t,
        flags=re.IGNORECASE
    )
    # Strip bracketed descriptors (official, video, hd, 4k, audio, etc.)
    t = re.sub(
        r'[\(\[\{].*?(?:official|video|lyrics|audio|lyric|hd|4k|remix|full|medley|ringtone|song|visualizer|feat|ft|lyrical|hindi|tamil|telugu|punjabi|version|slowed|reverb|lofi|lo-fi|teaser|promo|trailer|remastered|ost|unplugged|acoustic|sped\s*up).*?[\)\]\}]',
        '',
        t,
        flags=re.IGNORECASE
    )
    # Strip common standalone noise phrases
    t = re.sub(
        r'\b(full song|full video|lyrical video|lyric video|official audio|official music video|official video|official lyrical video|video song|audio song|with lyrics|original track|lofi version|lo-fi version|acoustic version|slowed reverb|slowed and reverb|slowed \+ reverb|sped up|status video|fullscreen status|4k 60fps|remastered \d{4})\b',
        '',
        t,
        flags=re.IGNORECASE
    )
    # Strip ft. / feat.
    t = re.sub(r'\b(ft\.?|feat\.?|featuring)\b.*', '', t, flags=re.IGNORECASE)
    # Strip multi delimiters & stray edge punctuation
    t = re.sub(r'[\s\-_\/\|]{2,}', ' ', t)
    t = t.strip(" -–—|:/")
    return t or title.strip()


def _normalize_for_match(text: str) -> str:
    """Normalize text for title/artist fuzzy similarity scoring."""
    s = _clean_track_title(text or "")
    s = re.sub(r'[\(\[\{].*?[\)\]\}]', ' ', s)
    s = re.sub(r'[^\w\s]', ' ', s.lower(), flags=re.UNICODE)
    return re.sub(r'\s+', ' ', s).strip()


def _text_similarity(a: str, b: str) -> float:
    """Combined sequence & token-overlap similarity between two track/artist strings in [0, 1]."""
    na = _normalize_for_match(a)
    nb = _normalize_for_match(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    if na in nb or nb in na:
        shorter = min(len(na), len(nb))
        longer = max(len(na), len(nb))
        if shorter >= 3 and (shorter / longer) >= 0.4:
            return max(0.85, difflib.SequenceMatcher(None, na, nb).ratio())

    seq_ratio = difflib.SequenceMatcher(None, na, nb).ratio()
    ta = set(na.split())
    tb = set(nb.split())
    if ta and tb:
        overlap = len(ta & tb) / max(len(ta), len(tb))
        return max(seq_ratio, overlap * 0.95)
    return seq_ratio


def _get_cache_filename(artist: str, title: str, file_path: str = "") -> Path:
    """Generate deterministic file path in disk cache."""
    key = f"{(artist or '').lower().strip()}_{(title or '').lower().strip()}_{(file_path or '').strip()}"
    digest = hashlib.sha256(key.encode("utf-8")).hexdigest()[:24]
    safe_name = re.sub(r'[^a-zA-Z0-9_\-]', '_', f"{artist}_{title}")[:40].strip('_') or "track"
    return LYRICS_CACHE_DIR / f"{safe_name}_{digest}"


def _parse_lrc(lrc_text: str) -> list[dict]:
    """
    Parses standard and multi-timestamp LRC format:
      '[mm:ss.xx] Lyric line'
      '[mm:ss.xx][mm:ss.yy] Repeated chorus line'
      '[offset:+/-ms]' global shift metadata
    Strips inline enhanced-LRC <mm:ss.xx> word timing tags from text.
    Returns sorted list of dicts: [{'time': float_seconds, 'text': str}, ...]
    """
    if not lrc_text:
        return []

    offset_seconds = 0.0
    offset_match = re.search(r'\[offset:\s*([+-]?\d+)\s*\]', lrc_text, flags=re.IGNORECASE)
    if offset_match:
        try:
            # Standard LRC [offset:+ms] shifts lyric timestamps earlier by ms/1000
            offset_seconds = int(offset_match.group(1)) / 1000.0
        except ValueError:
            offset_seconds = 0.0

    time_tag_re = re.compile(r'\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]')
    inline_word_tag_re = re.compile(r'<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>')
    meta_tag_re = re.compile(r'^\[(?:ti|ar|al|au|by|offset|length|re|ve):.*\]$', re.IGNORECASE)

    lines = []
    for raw_line in lrc_text.splitlines():
        stripped = raw_line.strip()
        if not stripped or meta_tag_re.match(stripped):
            continue
        tags = time_tag_re.findall(stripped)
        if not tags:
            continue

        # Remove all [mm:ss.xx] tags and enhanced <mm:ss.xx> word tags
        text = time_tag_re.sub("", stripped)
        text = inline_word_tag_re.sub("", text).strip()

        for m_str, s_str, frac_str in tags:
            minutes = int(m_str)
            secs = int(s_str)
            frac = float(f"0.{frac_str}") if frac_str else 0.0
            total_seconds = round(max(0.0, minutes * 60 + secs + frac - offset_seconds), 2)
            lines.append({"time": total_seconds, "text": text})

    return sorted(lines, key=lambda x: x["time"])


def _meaningful_lyric_lines(lines: list[dict] | None = None, plain: str = "") -> list[str]:
    """Extract non-empty sung lines, excluding credit/instrumental placeholder lines."""
    raw_texts = [l.get("text", "").strip() for l in lines] if lines else [p.strip() for p in (plain or "").splitlines()]
    out = []
    for t in raw_texts:
        if not t:
            continue
        if _CREDIT_LINE_RE.match(t):
            continue
        if any(marker in t.lower() for marker in _INSTRUMENTAL_MARKERS):
            continue
        out.append(t)
    return out


def _is_valid_lyrics_result(lines: list[dict], plain: str = "", synced: bool = True) -> bool:
    """Reject empty, instrumental placeholder, or stub lyric responses."""
    raw_combined = (plain or "\n".join(l.get("text", "") for l in (lines or []))).lower()
    meaningful = _meaningful_lyric_lines(lines if synced else None, plain)

    if any(m in raw_combined for m in _INSTRUMENTAL_MARKERS) and len(meaningful) < 4:
        return False
    if synced:
        return len(meaningful) >= 4
    return len(meaningful) >= 4 and len("\n".join(meaningful)) >= 30


def _extract_query_candidates(artist: str, title: str) -> list[dict]:
    """
    Generates an ordered list of search candidate dicts:
    [{'artist': '...', 'title': '...', 'query': '...'}, ...]
    Filters out pure noise segments like 'Lofi Version' or 'Official Video'.
    """
    candidates = []
    raw_title = title or ""
    raw_artist = _clean_artist_name(artist or "")
    is_label = _is_label_channel(raw_artist)

    def _add_candidate(cand_artist: str, cand_title: str, query: str):
        ct = (cand_title or "").strip()
        ca = _clean_artist_name(cand_artist or "")
        q = (query or "").strip()
        if not q or _is_generic_noise_title(q):
            return
        if ct and _is_generic_noise_title(ct):
            return
        candidates.append({'artist': ca, 'title': ct, 'query': q})

    # 1. Pipe split (Bollywood & Asian format: Song | Movie | Singer)
    pipe_parts = [p.strip() for p in re.split(r'\s*\|\s*', raw_title) if p.strip()]
    if len(pipe_parts) >= 2:
        # Pick non-noise pipe segments first (fixes 'Lofi Version | Bajrang Baan | ...')
        for idx, seg in enumerate(pipe_parts[:3]):
            cleaned_seg = _clean_track_title(seg)
            if _is_generic_noise_title(cleaned_seg):
                continue
            if ':' in seg:
                c_artist, c_title = seg.split(':', 1)
                ca = _clean_track_title(c_artist)
                ct = _clean_track_title(c_title)
                if ct and not _is_generic_noise_title(ct):
                    _add_candidate(ca, ct, f"{ca} {ct}".strip())
                    _add_candidate('', ct, ct)
            elif re.search(r'\s+[-–—]\s+', seg):
                sub_parts = re.split(r'\s+[-–—]\s+', seg, maxsplit=1)
                st0 = _clean_track_title(sub_parts[0])
                st1 = _clean_track_title(sub_parts[1])
                _add_candidate(st0, st1, f"{st0} {st1}".strip())
                _add_candidate('', st1, st1)
                _add_candidate('', st0, st0)
            else:
                if not is_label and raw_artist:
                    _add_candidate(raw_artist, cleaned_seg, f"{raw_artist} {cleaned_seg}")
                # Check next non-noise segment as potential artist/movie context
                next_seg = _clean_track_title(pipe_parts[idx + 1]) if idx + 1 < len(pipe_parts) else ""
                if next_seg and not _is_generic_noise_title(next_seg):
                    _add_candidate('', cleaned_seg, f"{cleaned_seg} {next_seg}")
                _add_candidate('', cleaned_seg, cleaned_seg)
                break

    # 2. Dash / Hyphen split (Artist - Title or Title - Artist)
    dash_parts = [p.strip() for p in re.split(r'\s+[-–—]\s+', raw_title) if p.strip()]
    if len(dash_parts) >= 2:
        d0 = _clean_track_title(dash_parts[0])
        d1 = _clean_track_title(dash_parts[1])
        if d0 and d1:
            _add_candidate(d0, d1, f"{d0} {d1}")
            _add_candidate(d1, d0, f"{d1} {d0}")
            _add_candidate('', d1, d1)
            _add_candidate('', d0, d0)

    # 3. Cleaned title with given artist
    cleaned_all = _clean_track_title(raw_title)
    if not is_label and raw_artist and cleaned_all:
        _add_candidate(raw_artist, cleaned_all, f"{raw_artist} {cleaned_all}".strip())

    # 4. Cleaned title alone
    if cleaned_all:
        _add_candidate('', cleaned_all, cleaned_all)

    # 5. Raw title alone as last resort (if not generic noise)
    if raw_title and raw_title != cleaned_all and not _is_generic_noise_title(raw_title):
        _add_candidate('', raw_title, raw_title)

    seen = set()
    unique = []
    for c in candidates:
        q_key = f"{c['artist'].lower()}___{c['title'].lower()}___{c['query'].lower()}"
        if c['query'] and q_key not in seen:
            seen.add(q_key)
            unique.append(c)

    return unique


def _score_candidate(
    cand_title: str,
    cand_artist: str,
    cand_duration: float,
    expected_titles: list[str],
    expected_artists: list[str],
    target_duration: float,
    synced: bool,
    lines: list[dict],
    plain: str = "",
) -> tuple[float, dict]:
    """
    Score a lyrics candidate against expected title/artist/duration.
    Returns (score, metadata_dict). Scores < 0 indicate invalid or mismatched lyrics.
    """
    if not _is_valid_lyrics_result(lines, plain, synced=synced):
        return -1000.0, {"reason": "invalid_or_placeholder"}

    best_title_sim = max(
        (_text_similarity(cand_title, et) for et in expected_titles if et),
        default=0.0,
    )
    best_artist_sim = max(
        (_text_similarity(cand_artist, ea) for ea in expected_artists if ea and not _is_label_channel(ea)),
        default=0.0,
    )

    # Reject completely unrelated tracks (prevents 'Lofi Version' -> 'Unholy')
    has_expected_artist = any(ea and not _is_label_channel(ea) for ea in expected_artists)
    if best_title_sim < 0.36 and not (has_expected_artist and best_artist_sim >= 0.78 and best_title_sim >= 0.2):
        return -1000.0, {"reason": "title_mismatch", "title_sim": best_title_sim}

    score = best_title_sim * 60.0

    if has_expected_artist:
        if best_artist_sim >= 0.65:
            score += 28.0
        elif best_artist_sim >= 0.35:
            score += 12.0
        elif cand_artist:
            score -= 18.0

    duration_diff = None
    if target_duration > 0 and cand_duration > 0:
        duration_diff = round(cand_duration - target_duration, 1)
        abs_diff = abs(duration_diff)
        if abs_diff <= 2.5:
            score += 45.0
        elif abs_diff <= 5.0:
            score += 30.0
        elif abs_diff <= 10.0:
            score += 12.0
        elif abs_diff <= 20.0:
            score -= 12.0
        elif abs_diff <= 35.0:
            score -= 35.0
        else:
            score -= 65.0

    if synced:
        score += 20.0

    return round(score, 2), {
        "title_sim": round(best_title_sim, 3),
        "artist_sim": round(best_artist_sim, 3),
        "duration_diff": duration_diff,
    }


# ---------------------------------------------------------------------------
# Provider 1: LRCLIB (Direct & Search)
# ---------------------------------------------------------------------------

def _build_lrclib_result(item: dict, target_duration: float = 0.0) -> dict | None:
    synced = item.get("syncedLyrics") or ""
    plain = item.get("plainLyrics") or ""
    cand_dur = float(item.get("duration") or 0.0)
    matched_title = item.get("trackName") or item.get("name") or ""
    matched_artist = item.get("artistName") or ""

    if synced:
        lines = _parse_lrc(synced)
        if not _is_valid_lyrics_result(lines, plain, synced=True):
            return None
        diff = round(cand_dur - target_duration, 1) if (target_duration > 0 and cand_dur > 0) else None
        return {
            "found": True,
            "synced": True,
            "lines": lines,
            "plain": plain or "\n".join(l["text"] for l in lines if l["text"]),
            "source": "lrclib",
            "raw_lrc": synced,
            "duration": cand_dur,
            "duration_diff": diff,
            "matched_title": matched_title,
            "matched_artist": matched_artist,
        }
    if plain and _is_valid_lyrics_result([], plain, synced=False):
        diff = round(cand_dur - target_duration, 1) if (target_duration > 0 and cand_dur > 0) else None
        return {
            "found": True,
            "synced": False,
            "lines": [],
            "plain": plain.strip(),
            "source": "lrclib",
            "raw_lrc": "",
            "duration": cand_dur,
            "duration_diff": diff,
            "matched_title": matched_title,
            "matched_artist": matched_artist,
        }
    return None


def _try_lrclib_direct(artist: str, title: str, timeout: int = 4, target_duration: float = 0.0) -> dict | None:
    if not title or _is_generic_noise_title(title):
        return None
    clean_artist = _clean_artist_name(artist)
    try:
        params = {"track_name": title}
        if clean_artist and not _is_label_channel(clean_artist):
            params["artist_name"] = clean_artist
        if target_duration > 0:
            params["duration"] = int(round(target_duration))
        url = f"https://lrclib.net/api/get?{urllib.parse.urlencode(params)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Linus/2.0 (Personal Music Player)"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
            res = _build_lrclib_result(data, target_duration=target_duration)
            if res:
                return res
    except Exception:
        pass
    return None


def _try_lrclib_search(
    query: str,
    expected_titles: list[str] | None = None,
    expected_artists: list[str] | None = None,
    target_duration: float = 0.0,
    timeout: int = 4,
) -> dict | None:
    if not query or _is_generic_noise_title(query):
        return None
    exp_titles = expected_titles or [query]
    exp_artists = expected_artists or []
    try:
        url = f"https://lrclib.net/api/search?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(url, headers={"User-Agent": "Linus/2.0 (Personal Music Player)"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            results = json.loads(response.read().decode("utf-8"))
            if not isinstance(results, list) or not results:
                return None

            best_score = -1.0
            best_res = None
            for item in results[:10]:
                built = _build_lrclib_result(item, target_duration=target_duration)
                if not built:
                    continue
                score, _ = _score_candidate(
                    cand_title=built.get("matched_title", ""),
                    cand_artist=built.get("matched_artist", ""),
                    cand_duration=built.get("duration", 0.0),
                    expected_titles=exp_titles,
                    expected_artists=exp_artists,
                    target_duration=target_duration,
                    synced=built["synced"],
                    lines=built["lines"],
                    plain=built["plain"],
                )
                if score > best_score and score >= 15.0:
                    best_score = score
                    best_res = built

            return best_res
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Provider 2: NetEase Cloud Music (Synchronized LRC)
# ---------------------------------------------------------------------------

def _try_netease_search(
    query: str,
    expected_titles: list[str] | None = None,
    expected_artists: list[str] | None = None,
    target_duration: float = 0.0,
    timeout: int = 4,
) -> dict | None:
    """Searches NetEase Cloud Music and picks the highest-scoring duration & title match."""
    if not query or len(query) < 2 or _is_generic_noise_title(query):
        return None
    exp_titles = expected_titles or [query]
    exp_artists = expected_artists or []
    try:
        search_url = f"https://music.163.com/api/cloudsearch/pc?s={urllib.parse.quote(query)}&type=1&offset=0&limit=6"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Referer": "https://music.163.com"
        }
        req = urllib.request.Request(search_url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8", errors="ignore"))
            songs = data.get("result", {}).get("songs", [])
            if not songs:
                return None

            # Pre-rank search results by title + duration before fetching LRC payloads
            ranked_songs = []
            for song in songs:
                s_id = song.get("id")
                if not s_id:
                    continue
                s_title = song.get("name") or ""
                s_artist = ", ".join(a.get("name", "") for a in song.get("ar", []))
                s_dur = round(float(song.get("dt") or 0) / 1000.0, 1)
                t_sim = max((_text_similarity(s_title, et) for et in exp_titles if et), default=0.0)
                dur_penalty = (abs(s_dur - target_duration) * 0.02) if (target_duration > 0 and s_dur > 0) else 0.0
                ranked_songs.append((t_sim - dur_penalty, song, s_title, s_artist, s_dur))

            ranked_songs.sort(key=lambda x: x[0], reverse=True)

            best_score = -1.0
            best_res = None

            for _, song, s_title, s_artist, s_dur in ranked_songs[:3]:
                song_id = song.get("id")
                lyric_url = f"https://music.163.com/api/song/lyric?os=pc&id={song_id}&lv=-1&kv=-1&tv=-1"
                req_l = urllib.request.Request(lyric_url, headers=headers)
                try:
                    with urllib.request.urlopen(req_l, timeout=timeout) as l_resp:
                        ldata = json.loads(l_resp.read().decode("utf-8", errors="ignore"))
                        raw_lrc = ldata.get("lrc", {}).get("lyric", "")
                        if not raw_lrc:
                            continue

                        if "[" in raw_lrc and "]" in raw_lrc:
                            lines = _parse_lrc(raw_lrc)
                            valid_lines = [l for l in lines if l["text"] and not _CREDIT_LINE_RE.match(l["text"])]
                            if not _is_valid_lyrics_result(valid_lines, synced=True):
                                continue
                            plain = "\n".join(l["text"] for l in valid_lines)
                            score, _ = _score_candidate(
                                cand_title=s_title,
                                cand_artist=s_artist,
                                cand_duration=s_dur,
                                expected_titles=exp_titles,
                                expected_artists=exp_artists,
                                target_duration=target_duration,
                                synced=True,
                                lines=valid_lines,
                                plain=plain,
                            )
                            if score > best_score and score >= 15.0:
                                best_score = score
                                diff = round(s_dur - target_duration, 1) if (target_duration > 0 and s_dur > 0) else None
                                best_res = {
                                    "found": True,
                                    "synced": True,
                                    "lines": valid_lines,
                                    "plain": plain,
                                    "source": "netease",
                                    "raw_lrc": raw_lrc,
                                    "duration": s_dur,
                                    "duration_diff": diff,
                                    "matched_title": s_title,
                                    "matched_artist": s_artist,
                                }
                        elif len(raw_lrc.strip()) > 30 and _is_valid_lyrics_result([], raw_lrc, synced=False):
                            score, _ = _score_candidate(
                                cand_title=s_title,
                                cand_artist=s_artist,
                                cand_duration=s_dur,
                                expected_titles=exp_titles,
                                expected_artists=exp_artists,
                                target_duration=target_duration,
                                synced=False,
                                lines=[],
                                plain=raw_lrc.strip(),
                            )
                            if score > best_score and score >= 15.0:
                                best_score = score
                                diff = round(s_dur - target_duration, 1) if (target_duration > 0 and s_dur > 0) else None
                                best_res = {
                                    "found": True,
                                    "synced": False,
                                    "lines": [],
                                    "plain": raw_lrc.strip(),
                                    "source": "netease",
                                    "raw_lrc": "",
                                    "duration": s_dur,
                                    "duration_diff": diff,
                                    "matched_title": s_title,
                                    "matched_artist": s_artist,
                                }
                except Exception:
                    continue

            return best_res
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Provider 3: YouTube Manual Subtitles / Timed Captions (yt: tracks)
# ---------------------------------------------------------------------------

def _parse_json3_captions(payload: str) -> list[dict]:
    """Parse YouTube json3 timedtext payload into synced LRC line dicts."""
    data = json.loads(payload)
    lines = []
    for ev in data.get("events", []):
        segs = ev.get("segs")
        if not segs:
            continue
        text = "".join(s.get("utf8", "") for s in segs).replace("\n", " ").strip()
        text = re.sub(r'\s+', ' ', text)
        if not text or (text.startswith("[") and text.endswith("]")):
            continue
        t_ms = ev.get("tStartMs", 0)
        lines.append({"time": round(max(0.0, t_ms / 1000.0), 2), "text": text})
    return lines


def _parse_vtt_captions(vtt_text: str) -> list[dict]:
    """Parse WebVTT subtitle text into synced LRC line dicts."""
    lines = []
    ts_re = re.compile(r'(?:(\d{1,2}):)?(\d{2}):(\d{2}\.\d{3})\s*-->\s*')
    current_time = None
    buf = []

    def _flush():
        nonlocal buf
        if current_time is not None and buf:
            clean = re.sub(r'<[^>]+>', '', " ".join(buf)).strip()
            clean = re.sub(r'\s+', ' ', clean)
            if clean and (not lines or lines[-1]["text"] != clean):
                lines.append({"time": current_time, "text": clean})
        buf = []

    for raw in (vtt_text or "").splitlines():
        s = raw.strip()
        if not s or s.startswith("WEBVTT") or s.startswith("Kind:") or s.startswith("Language:"):
            if not s:
                _flush()
            continue
        m = ts_re.match(s)
        if m:
            _flush()
            hrs = int(m.group(1) or 0)
            mins = int(m.group(2))
            secs = float(m.group(3))
            current_time = round(hrs * 3600 + mins * 60 + secs, 2)
        elif current_time is not None and not s.isdigit():
            buf.append(s)
    _flush()
    return lines


def _lines_to_raw_lrc(lines: list[dict]) -> str:
    out = []
    for l in lines:
        t = max(0.0, float(l.get("time", 0.0)))
        mins = int(t // 60)
        secs = t % 60
        out.append(f"[{mins:02d}:{secs:05.2f}] {l.get('text', '').strip()}")
    return "\n".join(out)


def _try_youtube_captions(video_id: str, timeout: int = 5) -> dict | None:
    """Fetch manual (creator-uploaded) timed captions for a YouTube video ID via yt-dlp."""
    clean_id = (video_id or "").replace("yt:", "").strip()
    if not clean_id or len(clean_id) < 6:
        return None
    try:
        import yt_dlp
    except ImportError:
        return None

    try:
        ydl_opts = {
            "skip_download": True,
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": timeout,
            "extract_flat": False,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"https://www.youtube.com/watch?v={clean_id}", download=False)
        if not info:
            return None

        subs = info.get("subtitles") or {}
        if not subs:
            return None

        # Prefer English / Hindi / Punjabi / first available manual subtitle track
        preferred_langs = ["en", "en-US", "en-GB", "en-IN", "hi", "pa", "ta", "te"]
        chosen_lang = next((lg for lg in preferred_langs if lg in subs), next(iter(subs.keys()), None))
        if not chosen_lang:
            return None

        tracks = subs.get(chosen_lang) or []
        sub_entry = next((x for x in tracks if x.get("ext") == "json3"), None) or next((x for x in tracks if x.get("ext") == "vtt"), None)
        if not sub_entry or not sub_entry.get("url"):
            return None

        req = urllib.request.Request(sub_entry["url"], headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = resp.read().decode("utf-8", errors="ignore")

        if sub_entry.get("ext") == "json3":
            lines = _parse_json3_captions(payload)
        else:
            lines = _parse_vtt_captions(payload)

        if not _is_valid_lyrics_result(lines, synced=True):
            return None

        raw_lrc = _lines_to_raw_lrc(lines)
        dur = float(info.get("duration") or 0.0)
        return {
            "found": True,
            "synced": True,
            "lines": lines,
            "plain": "\n".join(l["text"] for l in lines),
            "source": "youtube_cc",
            "raw_lrc": raw_lrc,
            "duration": dur,
            "duration_diff": 0.0 if dur > 0 else None,
            "matched_title": info.get("title") or "",
            "matched_artist": info.get("uploader") or "",
        }
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Provider 4: lyrics.ovh (Plain text fallback)
# ---------------------------------------------------------------------------

def _try_lyrics_ovh(artist: str, title: str, timeout: int = 4) -> str:
    clean_artist = _clean_artist_name(artist)
    if not clean_artist or not title or _is_label_channel(clean_artist) or _is_generic_noise_title(title):
        return ""
    try:
        encoded_artist = urllib.parse.quote(clean_artist, safe="")
        encoded_title = urllib.parse.quote(title, safe="")
        url = f"https://api.lyrics.ovh/v1/{encoded_artist}/{encoded_title}"
        req = urllib.request.Request(url, headers={"User-Agent": "Linus/2.0"})
        with urllib.request.urlopen(req, timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
            text = data.get("lyrics", "").strip()
            if _is_valid_lyrics_result([], text, synced=False):
                return text
            return ""
    except Exception:
        return ""


# ---------------------------------------------------------------------------
# Disk Caching & Custom Lyrics Helpers
# ---------------------------------------------------------------------------

def _save_to_disk_cache(cache_prefix: Path, result: dict):
    """Persists fetched lyrics and metadata into lyrics_cache directory."""
    try:
        if result.get("synced") and result.get("raw_lrc"):
            lrc_file = cache_prefix.with_suffix(".lrc")
            lrc_file.write_text(result["raw_lrc"], encoding="utf-8")
        elif result.get("plain"):
            txt_file = cache_prefix.with_suffix(".txt")
            txt_file.write_text(result["plain"], encoding="utf-8")

        meta = {
            "source": result.get("source", ""),
            "duration": result.get("duration", 0.0),
            "matched_title": result.get("matched_title", ""),
            "matched_artist": result.get("matched_artist", ""),
            "cached_at": time.time(),
        }
        cache_prefix.with_suffix(".meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    except Exception:
        pass


def _read_from_disk_cache(cache_prefix: Path, target_duration: float = 0.0) -> dict | None:
    """Reads previously cached .lrc or .txt file from disk, ignoring corrupt/placeholder caches."""
    meta = {}
    meta_file = cache_prefix.with_suffix(".meta.json")
    if meta_file.exists():
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8", errors="ignore"))
        except Exception:
            meta = {}

    try:
        lrc_file = cache_prefix.with_suffix(".lrc")
        if lrc_file.exists():
            content = lrc_file.read_text(encoding="utf-8", errors="ignore")
            lines = _parse_lrc(content)
            if lines and _is_valid_lyrics_result(lines, synced=True):
                cand_dur = float(meta.get("duration") or 0.0)
                diff = round(cand_dur - target_duration, 1) if (target_duration > 0 and cand_dur > 0) else None
                return {
                    "found": True,
                    "synced": True,
                    "lines": lines,
                    "plain": "\n".join(l["text"] for l in lines if l["text"]),
                    "source": meta.get("source") or "local_cache",
                    "raw_lrc": content,
                    "duration": cand_dur,
                    "duration_diff": diff,
                    "matched_title": meta.get("matched_title", ""),
                    "matched_artist": meta.get("matched_artist", ""),
                    "fetched_at": time.time(),
                }
        txt_file = cache_prefix.with_suffix(".txt")
        if txt_file.exists():
            content = txt_file.read_text(encoding="utf-8", errors="ignore")
            if content.strip() and _is_valid_lyrics_result([], content, synced=False):
                cand_dur = float(meta.get("duration") or 0.0)
                diff = round(cand_dur - target_duration, 1) if (target_duration > 0 and cand_dur > 0) else None
                return {
                    "found": True,
                    "synced": False,
                    "lines": [],
                    "plain": content.strip(),
                    "source": meta.get("source") or "local_cache",
                    "raw_lrc": "",
                    "duration": cand_dur,
                    "duration_diff": diff,
                    "matched_title": meta.get("matched_title", ""),
                    "matched_artist": meta.get("matched_artist", ""),
                    "fetched_at": time.time(),
                }
    except Exception:
        pass
    return None


def clear_cached_lyrics(track_id: str, artist: str = "", title: str = "") -> bool:
    """Clear disk and memory caches for a track so the next fetch pulls fresh lyrics."""
    removed = False
    prefixes = set()
    if track_id:
        prefixes.add(_get_cache_filename(artist, title, track_id))
    prefixes.add(_get_cache_filename(artist, title, ""))

    for prefix in prefixes:
        for ext in (".lrc", ".txt", ".meta.json"):
            f = prefix.with_suffix(ext)
            if f.exists():
                try:
                    f.unlink()
                    removed = True
                except Exception:
                    pass

    artist_low = (artist or "").strip().lower()
    title_low = (title or "").strip().lower()
    cleaned_low = _clean_track_title(title or "").lower()
    to_delete = [
        k for k in list(_memory_cache.keys())
        if (track_id and track_id in k) or (artist_low in k and (title_low in k or cleaned_low in k))
    ]
    for k in to_delete:
        _memory_cache.pop(k, None)
        removed = True

    return removed


def save_custom_lyrics(track_id: str, artist: str, title: str, content: str) -> dict:
    """Explicitly save user-edited or custom lyrics to disk cache and memory."""
    content = (content or "").strip()
    cache_prefix = _get_cache_filename(artist, title, track_id)

    lines = _parse_lrc(content) if ("[" in content and "]" in content) else []
    is_synced = len(lines) > 0
    if is_synced:
        res = {
            "found": True,
            "synced": True,
            "lines": lines,
            "plain": "\n".join(l["text"] for l in lines if l["text"]),
            "source": "custom",
            "raw_lrc": content,
            "fetched_at": time.time(),
        }
        lrc_file = cache_prefix.with_suffix(".lrc")
        lrc_file.write_text(content, encoding="utf-8")
        txt_file = cache_prefix.with_suffix(".txt")
        if txt_file.exists():
            try:
                txt_file.unlink()
            except Exception:
                pass
    else:
        res = {
            "found": True,
            "synced": False,
            "lines": [],
            "plain": content,
            "source": "custom",
            "raw_lrc": "",
            "fetched_at": time.time(),
        }
        txt_file = cache_prefix.with_suffix(".txt")
        txt_file.write_text(content, encoding="utf-8")
        lrc_file = cache_prefix.with_suffix(".lrc")
        if lrc_file.exists():
            try:
                lrc_file.unlink()
            except Exception:
                pass

    try:
        cache_prefix.with_suffix(".meta.json").write_text(
            json.dumps({"source": "custom", "cached_at": time.time()}),
            encoding="utf-8",
        )
    except Exception:
        pass

    # Clear matching RAM cache entries and store fresh one
    to_delete = [k for k in list(_memory_cache.keys()) if track_id and track_id in k]
    for k in to_delete:
        _memory_cache.pop(k, None)
    cache_key = f"{(artist or '').lower()}___{_clean_track_title(title).lower()}___{track_id}___0"
    _memory_cache[cache_key] = res
    return res


def align_and_cache_lyrics(artist: str, title: str, track_id: str, audio_path: str, plain_lyrics: str) -> dict:
    """
    Runs Forced Alignment on plain lyrics against the audio file,
    saves the resulting .lrc to disk cache and memory cache, and returns the result.
    """
    from lyrics_aligner import align_lyrics_to_audio
    result = align_lyrics_to_audio(audio_path, plain_lyrics)

    cache_prefix = _get_cache_filename(artist, title, track_id)
    lrc_file = cache_prefix.with_suffix(".lrc")
    lrc_file.write_text(result["raw_lrc"], encoding="utf-8")

    # Remove any plain .txt cache
    txt_file = cache_prefix.with_suffix(".txt")
    if txt_file.exists():
        try:
            txt_file.unlink()
        except Exception:
            pass

    try:
        cache_prefix.with_suffix(".meta.json").write_text(
            json.dumps({"source": "auto_aligned", "cached_at": time.time()}),
            encoding="utf-8",
        )
    except Exception:
        pass

    cleaned_title = _clean_track_title(title)
    to_delete = [k for k in list(_memory_cache.keys()) if track_id and track_id in k]
    for k in to_delete:
        _memory_cache.pop(k, None)
    cache_key = f"{(artist or '').lower()}___{cleaned_title.lower()}___{track_id}___0"
    res = {
        "found": True,
        "synced": True,
        "lines": result["lines"],
        "plain": result["plain"],
        "source": "auto_aligned",
        "raw_lrc": result["raw_lrc"],
        "matched_ratio": result.get("matched_ratio", 1.0),
        "fetched_at": time.time()
    }
    _memory_cache[cache_key] = res
    return res


def _attach_variant_warning(res: dict, raw_title: str, target_duration: float) -> dict:
    """Annotate response when audio variant or duration gap may cause timing drift."""
    if not res or not res.get("found") or not res.get("synced"):
        return res
    if res.get("source") in ("custom", "auto_aligned", "local", "youtube_cc"):
        return res

    variant = _detect_audio_variant(raw_title)
    diff = res.get("duration_diff")
    if diff is None and target_duration > 0 and res.get("duration", 0) > 0:
        diff = round(float(res["duration"]) - float(target_duration), 1)
        res["duration_diff"] = diff

    if variant:
        res["variant_warning"] = (
            f"Track looks like a {variant} edit — synced lyrics may match the original version. "
            "Use Sync Offset or Auto-Sync if timing drifts."
        )
    elif diff is not None and abs(diff) >= 8.0:
        direction = "shorter" if diff < 0 else "longer"
        res["variant_warning"] = (
            f"Matched lyrics duration differs by {abs(diff):.0f}s ({direction} than track). "
            "Use Sync Offset (+/-) if lines start early/late."
        )
    return res


# ---------------------------------------------------------------------------
# Public Fetch API
# ---------------------------------------------------------------------------

def fetch_lyrics(
    artist: str,
    title: str,
    file_path: str = "",
    timeout: int = 4,
    duration: float = 0.0,
    force_refresh: bool = False,
) -> dict:
    """
    Universal API to retrieve synchronized or plain lyrics using multi-tier fallback.
    Returns:
      {
        "found": bool,
        "synced": bool,
        "lines": [{"time": 12.34, "text": "..."}],
        "plain": "...",
        "source": "lrclib" | "netease" | "youtube_cc" | "lyrics.ovh" | "local" | "custom" | "auto_aligned" | "local_cache" | "none",
        "duration": float,
        "duration_diff": float | None,
        "variant_warning": str (optional)
      }
    """
    artist = (artist or "").strip()
    title = (title or "").strip()
    target_duration = float(duration or 0.0)
    cleaned_title = _clean_track_title(title)

    cache_key = f"{artist.lower()}___{cleaned_title.lower()}___{file_path}___{int(round(target_duration))}"
    if not force_refresh and cache_key in _memory_cache:
        cached = _memory_cache[cache_key]
        if (time.time() - cached.get("fetched_at", 0)) < CACHE_TTL_SECONDS:
            return cached

    # 1. Try local .lrc file in same directory as media file
    if file_path and not file_path.startswith("yt:"):
        local_lrc = Path(file_path).with_suffix(".lrc")
        if local_lrc.exists():
            try:
                content = local_lrc.read_text(encoding="utf-8", errors="ignore")
                parsed = _parse_lrc(content)
                if parsed:
                    res = {
                        "found": True,
                        "synced": True,
                        "lines": parsed,
                        "plain": "\n".join(l["text"] for l in parsed if l["text"]),
                        "source": "local",
                        "raw_lrc": content,
                        "fetched_at": time.time(),
                    }
                    _memory_cache[cache_key] = res
                    return res
            except Exception:
                pass

    cache_prefix = _get_cache_filename(artist, title, file_path)

    # 2. Try disk cache (lyrics_cache/) unless bypassed
    if not force_refresh:
        disk_cached = _read_from_disk_cache(cache_prefix, target_duration=target_duration)
        if disk_cached:
            _attach_variant_warning(disk_cached, title, target_duration)
            _memory_cache[cache_key] = disk_cached
            return disk_cached
    else:
        # Respect user-saved custom / auto-aligned lyrics only if not explicitly cleared;
        # force_refresh clears remote-fetched cache so fresh search runs.
        for ext in (".lrc", ".txt", ".meta.json"):
            f = cache_prefix.with_suffix(ext)
            if f.exists():
                try:
                    f.unlink()
                except Exception:
                    pass

    # 3. Extract multi-stage candidates & expected target lists for scoring
    candidates = _extract_query_candidates(artist, title)
    expected_titles = [c["title"] for c in candidates if c.get("title")] or ([cleaned_title] if cleaned_title else [title])
    expected_artists = [c["artist"] for c in candidates if c.get("artist")]
    cleaned_artist = _clean_artist_name(artist)
    if cleaned_artist and not _is_label_channel(cleaned_artist) and cleaned_artist not in expected_artists:
        expected_artists.insert(0, cleaned_artist)

    best_plain_fallback = None

    # 4. Try LRCLIB Direct Match (duration-aware)
    for cand in candidates:
        if cand.get('artist') and cand.get('title'):
            res = _try_lrclib_direct(cand['artist'], cand['title'], timeout=timeout, target_duration=target_duration)
            if res and res.get("found"):
                if res.get("synced"):
                    res["fetched_at"] = time.time()
                    _attach_variant_warning(res, title, target_duration)
                    _save_to_disk_cache(cache_prefix, res)
                    _memory_cache[cache_key] = res
                    return res
                elif not best_plain_fallback:
                    best_plain_fallback = res

    # 5. Try LRCLIB Search (scored across top 10 results by title, artist, and duration)
    for cand in candidates[:4]:
        q = cand.get('query', '').strip()
        if q and len(q) >= 3:
            res = _try_lrclib_search(
                q,
                expected_titles=expected_titles,
                expected_artists=expected_artists,
                target_duration=target_duration,
                timeout=timeout,
            )
            if res and res.get("found"):
                if res.get("synced"):
                    res["fetched_at"] = time.time()
                    _attach_variant_warning(res, title, target_duration)
                    _save_to_disk_cache(cache_prefix, res)
                    _memory_cache[cache_key] = res
                    return res
                elif not best_plain_fallback:
                    best_plain_fallback = res

    # 6. Try NetEase Cloud Music (scored by title, artist, and duration)
    for cand in candidates[:3]:
        q = cand.get('query', '').strip()
        if q and len(q) >= 2:
            res = _try_netease_search(
                q,
                expected_titles=expected_titles,
                expected_artists=expected_artists,
                target_duration=target_duration,
                timeout=timeout,
            )
            if res and res.get("found"):
                if res.get("synced"):
                    res["fetched_at"] = time.time()
                    _attach_variant_warning(res, title, target_duration)
                    _save_to_disk_cache(cache_prefix, res)
                    _memory_cache[cache_key] = res
                    return res
                elif not best_plain_fallback:
                    best_plain_fallback = res

    # 7. Try YouTube Manual Captions for yt: streams if no synced lyrics found yet
    if file_path and file_path.startswith("yt:"):
        yt_res = _try_youtube_captions(file_path, timeout=timeout)
        if yt_res and yt_res.get("found"):
            yt_res["fetched_at"] = time.time()
            _save_to_disk_cache(cache_prefix, yt_res)
            _memory_cache[cache_key] = yt_res
            return yt_res

    # 8. Return best validated plain-text match from LRCLIB/NetEase if found
    if best_plain_fallback:
        best_plain_fallback["fetched_at"] = time.time()
        _save_to_disk_cache(cache_prefix, best_plain_fallback)
        _memory_cache[cache_key] = best_plain_fallback
        return best_plain_fallback

    # 9. Fallback to lyrics.ovh (Plain text)
    for cand in candidates:
        if cand.get('artist') and cand.get('title'):
            plain = _try_lyrics_ovh(cand['artist'], cand['title'], timeout)
            if plain:
                res = {
                    "found": True,
                    "synced": False,
                    "lines": [],
                    "plain": plain,
                    "source": "lyrics.ovh",
                    "raw_lrc": "",
                    "fetched_at": time.time(),
                }
                _save_to_disk_cache(cache_prefix, res)
                _memory_cache[cache_key] = res
                return res

    # Not found
    empty_res = {
        "found": False,
        "synced": False,
        "lines": [],
        "plain": "",
        "source": "none",
        "raw_lrc": "",
        "fetched_at": time.time(),
    }
    _memory_cache[cache_key] = empty_res
    return empty_res


# ---------------------------------------------------------------------------
# Multi-Provider Search for Manual UI Selection
# ---------------------------------------------------------------------------

def search_lyrics_candidates(
    query: str,
    limit: int = 12,
    target_duration: float = 0.0,
    track_id: str = "",
) -> list[dict]:
    """
    Searches LRCLIB, NetEase, and (for yt: tracks) YouTube manual captions simultaneously.
    Returns candidates sorted by sync availability and duration closeness.
    """
    query = (query or "").strip()
    if not query and not (track_id and track_id.startswith("yt:")):
        return []

    target_dur = float(target_duration or 0.0)
    results = []

    def _search_lrclib():
        lrclib_res = []
        if not query:
            return lrclib_res
        try:
            url = f"https://lrclib.net/api/search?q={urllib.parse.quote(query)}"
            req = urllib.request.Request(url, headers={"User-Agent": "Linus/2.0"})
            with urllib.request.urlopen(req, timeout=4) as response:
                data = json.loads(response.read().decode("utf-8"))
                if isinstance(data, list):
                    for item in data[:limit]:
                        synced = item.get("syncedLyrics")
                        plain = item.get("plainLyrics") or ""
                        cand_dur = float(item.get("duration") or 0.0)
                        parsed = _parse_lrc(synced) if synced else []
                        if synced and not _is_valid_lyrics_result(parsed, plain, synced=True):
                            continue
                        if not synced and not _is_valid_lyrics_result([], plain, synced=False):
                            continue

                        preview = ""
                        if parsed:
                            preview = " / ".join(l["text"] for l in parsed[:3] if l["text"])
                        elif plain:
                            preview = " / ".join(p.strip() for p in plain.splitlines()[:3] if p.strip())

                        diff = round(cand_dur - target_dur, 1) if (target_dur > 0 and cand_dur > 0) else None
                        lrclib_res.append({
                            "id": f"lrclib_{item.get('id', '')}",
                            "title": item.get("trackName") or item.get("name") or "Unknown Title",
                            "artist": item.get("artistName") or "Unknown Artist",
                            "album": item.get("albumName") or "",
                            "source": "LRCLIB",
                            "synced": bool(parsed),
                            "duration": cand_dur,
                            "duration_diff": diff,
                            "line_count": len(parsed) if parsed else len([p for p in plain.splitlines() if p.strip()]),
                            "preview": preview or "Lyrics available",
                            "raw_lrc": synced or "",
                            "plain": plain or "\n".join(l["text"] for l in parsed)
                        })
        except Exception:
            pass
        return lrclib_res

    def _search_netease():
        netease_res = []
        if not query:
            return netease_res
        try:
            url = f"https://music.163.com/api/cloudsearch/pc?s={urllib.parse.quote(query)}&type=1&offset=0&limit={min(limit, 8)}"
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                "Referer": "https://music.163.com"
            }
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=4) as response:
                data = json.loads(response.read().decode("utf-8", errors="ignore"))
                songs = data.get("result", {}).get("songs", [])
                for s in songs:
                    s_id = s.get("id")
                    title = s.get("name") or "Unknown"
                    artist = ", ".join(a.get("name", "") for a in s.get("ar", [])) or "Unknown"
                    album = s.get("al", {}).get("name") or ""
                    cand_dur = round(float(s.get("dt") or 0) / 1000.0, 1)

                    lyric_url = f"https://music.163.com/api/song/lyric?os=pc&id={s_id}&lv=-1&kv=-1&tv=-1"
                    req_l = urllib.request.Request(lyric_url, headers=headers)
                    try:
                        with urllib.request.urlopen(req_l, timeout=3) as l_resp:
                            ldata = json.loads(l_resp.read().decode("utf-8", errors="ignore"))
                            raw_lrc = ldata.get("lrc", {}).get("lyric", "")
                            if not raw_lrc:
                                continue
                            parsed = _parse_lrc(raw_lrc) if ("[" in raw_lrc and "]" in raw_lrc) else []
                            valid_lines = [l for l in parsed if l["text"] and not _CREDIT_LINE_RE.match(l["text"])]
                            if parsed and not _is_valid_lyrics_result(valid_lines, synced=True):
                                continue
                            if not parsed and not _is_valid_lyrics_result([], raw_lrc, synced=False):
                                continue

                            preview = " / ".join(l["text"] for l in valid_lines[:3] if l["text"]) if valid_lines else " / ".join(p.strip() for p in raw_lrc.splitlines()[:3] if p.strip())
                            diff = round(cand_dur - target_dur, 1) if (target_dur > 0 and cand_dur > 0) else None
                            netease_res.append({
                                "id": f"netease_{s_id}",
                                "title": title,
                                "artist": artist,
                                "album": album,
                                "source": "NetEase",
                                "synced": bool(valid_lines),
                                "duration": cand_dur,
                                "duration_diff": diff,
                                "line_count": len(valid_lines) if valid_lines else len([p for p in raw_lrc.splitlines() if p.strip()]),
                                "preview": preview or "Synchronized LRC available",
                                "raw_lrc": raw_lrc if valid_lines else "",
                                "plain": "\n".join(l["text"] for l in valid_lines) if valid_lines else raw_lrc
                            })
                    except Exception:
                        continue
        except Exception:
            pass
        return netease_res

    def _search_yt_cc():
        if not (track_id and track_id.startswith("yt:")):
            return []
        yt_res = _try_youtube_captions(track_id, timeout=4)
        if not yt_res or not yt_res.get("found"):
            return []
        parsed = yt_res.get("lines", [])
        cand_dur = float(yt_res.get("duration") or 0.0)
        diff = round(cand_dur - target_dur, 1) if (target_dur > 0 and cand_dur > 0) else None
        return [{
            "id": f"ytcc_{track_id}",
            "title": yt_res.get("matched_title") or "YouTube Video Captions",
            "artist": yt_res.get("matched_artist") or "YouTube CC",
            "album": "Video Subtitles",
            "source": "YouTube CC",
            "synced": True,
            "duration": cand_dur,
            "duration_diff": diff,
            "line_count": len(parsed),
            "preview": " / ".join(l["text"] for l in parsed[:3] if l["text"]),
            "raw_lrc": yt_res.get("raw_lrc", ""),
            "plain": yt_res.get("plain", ""),
        }]

    with ThreadPoolExecutor(max_workers=3) as executor:
        futures = [
            executor.submit(_search_lrclib),
            executor.submit(_search_netease),
            executor.submit(_search_yt_cc),
        ]
        for f in as_completed(futures):
            try:
                results.extend(f.result())
            except Exception:
                pass

    def _sort_key(item):
        synced_rank = 0 if item.get("synced") else 1
        dur_diff = abs(item["duration_diff"]) if item.get("duration_diff") is not None else 999.0
        title_sim = _text_similarity(item.get("title", ""), query) if query else 0.5
        return (synced_rank, round(dur_diff / 4.0), -title_sim)

    results.sort(key=_sort_key)
    return results[:limit]
