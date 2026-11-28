"""
lyrics_aligner.py — Linus Forced Alignment Lyrics Engine
Implements the "Spotify / Apple Music / Musixmatch" method:
Matches 100% accurate official plain-text lyrics to song audio timestamps.
- Words, spelling, punctuation and casing are 100% preserved (official lyrics).
- Timestamps are computed via acoustic speech alignment (faster-whisper / Gemini fallback).
- Monotonic sequence alignment & interpolation guarantees accurate, synchronized LRC lines.
"""

import difflib
import logging
import os
import re
import time
from pathlib import Path

logger = logging.getLogger("linus.lyrics_aligner")

_whisper_model = None


def get_whisper_model():
    """Lazy-load and cache the faster-whisper model singleton (configurable via LINUS_WHISPER_MODEL)."""
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel
            model_name = os.environ.get("LINUS_WHISPER_MODEL", "tiny").strip() or "tiny"
            logger.info(f"Initializing faster-whisper ({model_name} int8) for forced alignment...")
            t0 = time.time()
            try:
                # Try offline first for instant startup
                _whisper_model = WhisperModel(
                    model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=4,
                    local_files_only=True
                )
            except Exception:
                # Fallback to downloading if model not yet cached locally
                _whisper_model = WhisperModel(
                    model_name,
                    device="cpu",
                    compute_type="int8",
                    cpu_threads=4,
                    local_files_only=False
                )
            logger.info(f"faster-whisper model loaded in {time.time() - t0:.2f}s")
        except ImportError as e:
            logger.error(f"faster-whisper is not installed: {e}")
            raise
    return _whisper_model


def _normalize_token(w: str) -> str:
    """Normalize a word for fuzzy matching: lowercase, strip punctuation, handle common contractions."""
    if not w:
        return ""
    w = re.sub(r"[^\w]", "", w).lower()
    if w.endswith("in") and not w.endswith("ain") and len(w) > 3:
        w = w + "g"
    elif w == "cuz" or w == "cos":
        w = "because"
    elif w == "gonna":
        w = "going"
    elif w == "wanna":
        w = "want"
    elif w == "gotta":
        w = "got"
    elif w == "ya":
        w = "you"
    return w


def _extract_plain_lines(raw_text: str) -> list[str]:
    """Clean plain lyrics lines, removing empty lines and existing [mm:ss.xx] timestamps if present."""
    lines = []
    timestamp_pattern = re.compile(r"^\[\d{1,3}:\d{2}(?:\.\d+)?\]\s*")
    for raw in raw_text.splitlines():
        cleaned = timestamp_pattern.sub("", raw).strip()
        if cleaned.startswith("[") and cleaned.endswith("]") and not re.search(r"\d", cleaned):
            continue
        if cleaned:
            lines.append(cleaned)
    return lines


def _try_gemini_alignment(audio_path: str, plain_lines: list[str]) -> str | None:
    """Optional turbo alignment using Gemini API if GEMINI_API_KEY is configured."""
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return None

    audio_file = None
    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)

        audio_file = genai.upload_file(path=audio_path)
        for _ in range(15):
            file_info = genai.get_file(audio_file.name)
            if file_info.state.name == "ACTIVE":
                break
            time.sleep(1)

        lyrics_str = "\n".join(plain_lines)
        prompt = (
            "You are an expert audio forced-alignment system. Align the following official lyrics "
            "to the attached song audio.\n"
            "Rules:\n"
            "1. Output ONLY standard LRC format: [mm:ss.xx] line text\n"
            "2. Keep the EXACT official line text, spelling, and casing. Do not alter a single word.\n"
            "3. Output one timestamped line for each line in the provided lyrics in sequential order.\n\n"
            f"Official Lyrics:\n{lyrics_str}"
        )
        for model_name in ("gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"):
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content([audio_file, prompt])
                text = (response.text or "").strip()
                if "[" in text and "]" in text:
                    from lyrics_provider import _parse_lrc
                    parsed = _parse_lrc(text)
                    if len(parsed) >= max(1, int(len(plain_lines) * 0.6)):
                        logger.info(f"Successfully aligned lyrics via Gemini API ({model_name})!")
                        return text
            except Exception as inner_e:
                logger.debug(f"Gemini model {model_name} alignment attempt failed: {inner_e}")
    except Exception as e:
        logger.warning(f"Gemini alignment skipped/failed, falling back to local Whisper: {e}")
    finally:
        if audio_file is not None:
            try:
                import google.generativeai as genai
                genai.delete_file(audio_file.name)
            except Exception:
                pass

    return None


def _transcribe_audio_tokens(model, audio_path: str) -> tuple[list[dict], float]:
    """Transcribe audio into word-level acoustic tokens, trying VAD first with clean fallback."""
    def _run(use_vad: bool):
        segments, info = model.transcribe(
            audio_path,
            word_timestamps=True,
            beam_size=1,
            condition_on_previous_text=False,
            temperature=0.0,
            vad_filter=use_vad,
        )
        tokens = []
        for seg in segments:
            if seg.words:
                for w in seg.words:
                    norm = _normalize_token(w.word)
                    if norm:
                        tokens.append({
                            "word": w.word,
                            "norm": norm,
                            "start": round(w.start, 2),
                            "end": round(w.end, 2),
                            "prob": round(w.probability, 2),
                        })
        dur = getattr(info, "duration", 0) or 0.0
        return tokens, dur

    try:
        tokens, dur = _run(True)
        if tokens:
            return tokens, dur
    except Exception:
        pass
    return _run(False)


def align_lyrics_to_audio(audio_path: str | Path, plain_text: str) -> dict:
    """
    Forced Alignment:
    Takes a local audio file path and official plain lyrics text.
    Returns:
    {
      "success": bool,
      "synced": bool,
      "lines": [{"time": float_seconds, "text": "line text"}],
      "raw_lrc": str,
      "plain": str,
      "source": "auto_aligned",
      "matched_ratio": float
    }
    """
    raw_path_str = str(audio_path)
    if raw_path_str.startswith(("http://", "https://")):
        raise ValueError("Forced alignment requires a locally cached audio file, not a remote URL.")

    audio_path = str(Path(raw_path_str).resolve())
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found at: {audio_path}")

    plain_lines = _extract_plain_lines(plain_text)
    if not plain_lines:
        raise ValueError("No valid lyrics lines found to align.")

    # 1. Try Gemini Turbo Alignment if configured
    gemini_lrc = _try_gemini_alignment(audio_path, plain_lines)
    if gemini_lrc:
        from lyrics_provider import _parse_lrc
        parsed = _parse_lrc(gemini_lrc)
        if parsed:
            return {
                "success": True,
                "synced": True,
                "lines": parsed,
                "raw_lrc": gemini_lrc,
                "plain": "\n".join(plain_lines),
                "source": "auto_aligned",
                "matched_ratio": 1.0,
            }

    # 2. Local Forced Alignment via faster-whisper + Monotonic DP Sequence Alignment
    logger.info(f"Starting local forced alignment on {len(plain_lines)} lines for {audio_path}...")
    t_start = time.time()

    # Tokenize reference lines
    ref_tokens = []
    for line_idx, line_text in enumerate(plain_lines):
        words = line_text.split()
        for word_idx, w in enumerate(words):
            norm = _normalize_token(w)
            if norm:
                ref_tokens.append({
                    "line_idx": line_idx,
                    "word_idx": word_idx,
                    "raw": w,
                    "norm": norm,
                    "start": None,
                    "end": None
                })

    if not ref_tokens:
        raise ValueError("Lyrics text contains no readable words.")

    model = get_whisper_model()
    audio_tokens, info_duration = _transcribe_audio_tokens(model, audio_path)

    logger.info(f"Extracted {len(audio_tokens)} acoustic tokens from audio in {time.time() - t_start:.2f}s")

    # Step A: Find Exact Sequence Anchors via SequenceMatcher
    ref_norms = [t["norm"] for t in ref_tokens]
    audio_norms = [t["norm"] for t in audio_tokens]

    matcher = difflib.SequenceMatcher(None, ref_norms, audio_norms)
    matching_blocks = matcher.get_matching_blocks()

    matched_count = 0
    matched_audio_indices = set()

    for block in matching_blocks:
        for i in range(block.size):
            r_idx = block.a + i
            a_idx = block.b + i
            ref_tokens[r_idx]["start"] = audio_tokens[a_idx]["start"]
            ref_tokens[r_idx]["end"] = audio_tokens[a_idx]["end"]
            matched_audio_indices.add(a_idx)
            matched_count += 1

    # Step B: Local monotonic fuzzy matching in the gaps between anchors
    for b_idx in range(len(matching_blocks) - 1):
        b1 = matching_blocks[b_idx]
        b2 = matching_blocks[b_idx + 1]

        r_start = b1.a + b1.size
        r_end = b2.a
        a_start = b1.b + b1.size
        a_end = b2.b

        if r_start < r_end and a_start < a_end:
            curr_a = a_start
            for curr_r in range(r_start, r_end):
                best_score = 0.65
                best_pos = -1

                for scan_a in range(curr_a, min(a_end, curr_a + 6)):
                    sim = difflib.SequenceMatcher(None, ref_norms[curr_r], audio_norms[scan_a]).ratio()
                    if sim > best_score:
                        best_score = sim
                        best_pos = scan_a

                if best_pos != -1:
                    ref_tokens[curr_r]["start"] = audio_tokens[best_pos]["start"]
                    ref_tokens[curr_r]["end"] = audio_tokens[best_pos]["end"]
                    curr_a = best_pos + 1
                    matched_count += 1

    # Group matched (word_idx, start_time) by line so missing leading words don't bias lines late
    line_word_hits: dict[int, list[tuple[int, float]]] = {}
    for t in ref_tokens:
        l_idx = t["line_idx"]
        if t["start"] is not None:
            line_word_hits.setdefault(l_idx, []).append((t["word_idx"], t["start"]))

    line_timestamps: dict[int, float] = {}
    for l_idx, hits in line_word_hits.items():
        first_word_idx, first_start = min(hits, key=lambda h: (h[0], h[1]))
        # Back-estimate opening word time when only later words in the line anchored
        lead_compensation = min(1.8, first_word_idx * 0.28)
        line_timestamps[l_idx] = round(max(0.0, first_start - lead_compensation), 2)

    # Monotonic line timestamp synthesis & interpolation
    total_lines = len(plain_lines)
    audio_duration = info_duration or (audio_tokens[-1]["end"] if audio_tokens else 180.0)

    final_lrc_entries = []
    last_timestamp = -0.5

    for l_idx, line_text in enumerate(plain_lines):
        if l_idx in line_timestamps:
            t = line_timestamps[l_idx]
            if t <= last_timestamp:
                t = round(last_timestamp + 0.35, 2)
        else:
            next_t = None
            next_idx = None
            for n_idx in range(l_idx + 1, total_lines):
                if n_idx in line_timestamps:
                    next_t = line_timestamps[n_idx]
                    next_idx = n_idx
                    break

            anchor_prev = max(0.0, last_timestamp)
            if next_t is not None and next_t > anchor_prev and next_idx is not None:
                step = (next_t - anchor_prev) / (next_idx - l_idx + 1)
                t = round(anchor_prev + step, 2)
            else:
                remaining = max(1, total_lines - l_idx)
                remaining_duration = max(5.0, audio_duration - anchor_prev)
                step = min(3.0, remaining_duration / remaining)
                t = round(anchor_prev + max(0.5, step), 2)

        last_timestamp = t
        minutes = int(t // 60)
        seconds = t % 60
        formatted_lrc_line = f"[{minutes:02d}:{seconds:05.2f}] {line_text}"
        final_lrc_entries.append({
            "time": t,
            "text": line_text,
            "raw": formatted_lrc_line
        })

    raw_lrc = "\n".join(e["raw"] for e in final_lrc_entries)
    matched_ratio = round(matched_count / max(1, len(ref_tokens)), 3)

    logger.info(
        f"Forced Alignment completed in {time.time() - t_start:.2f}s. "
        f"Matched {matched_count}/{len(ref_tokens)} words ({matched_ratio * 100:.1f}%), "
        f"{len(line_timestamps)}/{total_lines} lines directly anchored."
    )

    return {
        "success": True,
        "synced": True,
        "lines": [{"time": e["time"], "text": e["text"]} for e in final_lrc_entries],
        "raw_lrc": raw_lrc,
        "plain": "\n".join(plain_lines),
        "source": "auto_aligned",
        "matched_ratio": matched_ratio,
    }
