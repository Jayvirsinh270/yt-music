"""
Comprehensive tests for the upgraded lyrics matching, sync offset, forced alignment,
and Flask API endpoints.
"""

import io
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

import db_store as db
import lyrics_aligner
import lyrics_provider
from web_app import app


class TestLrcParsingAndCleaning:
    def test_parse_lrc_multi_timestamp_and_inline_tags(self):
        lrc = (
            "[ti:Sample Song]\n"
            "[ar:Sample Artist]\n"
            "[00:10.00][01:05.50] Repeated chorus line\n"
            "[00:15:25] <00:15.25>Word <00:16.00>timed line\n"
        )
        lines = lyrics_provider._parse_lrc(lrc)
        assert len(lines) == 3
        assert lines[0] == {"time": 10.0, "text": "Repeated chorus line"}
        assert lines[1] == {"time": 15.25, "text": "Word timed line"}
        assert lines[2] == {"time": 65.5, "text": "Repeated chorus line"}

    def test_parse_lrc_applies_offset_tag(self):
        lrc = "[offset:+1500]\n[00:10.00] First line\n[00:01.00] Early line\n"
        lines = lyrics_provider._parse_lrc(lrc)
        assert lines[0] == {"time": 0.0, "text": "Early line"}
        assert lines[1] == {"time": 8.5, "text": "First line"}

    def test_extract_candidates_skips_generic_noise_pipe_segment(self):
        cands = lyrics_provider._extract_query_candidates(
            "Vianet LoFi Bhajans",
            "Lofi Version | Bajrang Baan | Jubin Nautiyal (Official Video)",
        )
        queries = [c["query"].lower() for c in cands]
        titles = [c["title"].lower() for c in cands]
        assert "lofi version" not in queries
        assert "lofi version" not in titles
        assert any("bajrang baan" in q for q in queries)

    def test_clean_artist_strips_youtube_topic(self):
        assert lyrics_provider._clean_artist_name("Aditya Rikhari - Topic") == "Aditya Rikhari"
        assert not lyrics_provider._is_label_channel("Aditya Rikhari - Topic")


class TestDurationScoringAndValidation:
    def test_rejects_unrelated_song_title_mismatch(self):
        lrc_lines = [{"time": i * 5.0, "text": f"Unholy lyric line {i}"} for i in range(1, 8)]
        score, meta = lyrics_provider._score_candidate(
            cand_title="Unholy",
            cand_artist="Sam Smith",
            cand_duration=156.0,
            expected_titles=["Bajrang Baan"],
            expected_artists=["Jubin Nautiyal"],
            target_duration=240.0,
            synced=True,
            lines=lrc_lines,
        )
        assert score < 0
        assert meta["reason"] == "title_mismatch"

    def test_rejects_netease_instrumental_placeholder(self):
        lines = [
            {"time": 0.0, "text": "作曲 : Roy Hareven"},
            {"time": 5.0, "text": "纯音乐，请欣赏"},
        ]
        assert lyrics_provider._is_valid_lyrics_result(lines, synced=True) is False

    def test_lrclib_search_prefers_closest_duration_match(self):
        short_lrc = "\n".join(f"[00:{10+i*5:02d}.00] Radio edit line {i}" for i in range(6))
        full_lrc = "\n".join(f"[00:{20+i*5:02d}.00] Full album version line {i}" for i in range(6))
        fake_results = [
            {
                "id": 1,
                "trackName": "Without Me",
                "artistName": "Eminem",
                "duration": 180.0,
                "syncedLyrics": short_lrc,
                "plainLyrics": "Radio edit",
            },
            {
                "id": 2,
                "trackName": "Without Me",
                "artistName": "Eminem",
                "duration": 290.0,
                "syncedLyrics": full_lrc,
                "plainLyrics": "Full album",
            },
        ]

        mock_resp = MagicMock()
        mock_resp.read.return_value = json.dumps(fake_results).encode("utf-8")
        mock_resp.__enter__.return_value = mock_resp

        with patch("urllib.request.urlopen", return_value=mock_resp):
            res = lyrics_provider._try_lrclib_search(
                "Eminem Without Me",
                expected_titles=["Without Me"],
                expected_artists=["Eminem"],
                target_duration=289.0,
            )

        assert res is not None
        assert res["duration"] == 290.0
        assert res["duration_diff"] == 1.0
        assert res["lines"][0]["text"] == "Full album version line 0"
        assert "Full album version line 0" in res["raw_lrc"]

    def test_youtube_caption_parsers(self):
        vtt = (
            "WEBVTT\n\n"
            "00:00:04.500 --> 00:00:07.000\n"
            "<i>First sung line</i>\n\n"
            "00:00:08.250 --> 00:00:11.000\n"
            "Second sung line\n"
        )
        vtt_lines = lyrics_provider._parse_vtt_captions(vtt)
        assert vtt_lines == [
            {"time": 4.5, "text": "First sung line"},
            {"time": 8.25, "text": "Second sung line"},
        ]

        json3 = json.dumps({
            "events": [
                {"tStartMs": 12300, "segs": [{"utf8": "Hello "}, {"utf8": "world"}]},
                {"tStartMs": 15000, "segs": [{"utf8": "[Music]"}]},
            ]
        })
        j_lines = lyrics_provider._parse_json3_captions(json3)
        assert j_lines == [{"time": 12.3, "text": "Hello world"}]

    def test_variant_warning_on_duration_gap_and_slowed(self):
        res = {"found": True, "synced": True, "source": "lrclib", "duration": 200.0, "duration_diff": -45.0}
        lyrics_provider._attach_variant_warning(res, "Humdum (Slowed + Reverb)", 245.0)
        assert "slowed/reverb" in res["variant_warning"].lower()

        res2 = {"found": True, "synced": True, "source": "lrclib", "duration": 200.0, "duration_diff": -30.0}
        lyrics_provider._attach_variant_warning(res2, "Without Me", 230.0)
        assert "30s" in res2["variant_warning"]


class TestOffsetsAndEndpoints:
    def test_db_lyrics_offset_clamping_and_reset(self):
        tid = "yt:test_offset_track"
        assert db.set_lyrics_offset(tid, 1.5) == 1.5
        assert db.get_lyrics_offset(tid) == 1.5
        assert db.set_lyrics_offset(tid, 500.0) == 120.0
        assert db.set_lyrics_offset(tid, -500.0) == -120.0
        assert db.set_lyrics_offset(tid, 0.0) == 0.0
        assert db.get_lyrics_offset(tid) == 0.0

    def test_api_lyrics_offset_clear_and_apply_reset(self, tmp_path):
        client = app.test_client()
        tid = "yt:endpoint_test_1"

        # Save offset
        r1 = client.post("/api/lyrics/offset", json={"track_id": tid, "offset": -2.5})
        assert r1.status_code == 200
        assert r1.get_json()["offset"] == -2.5

        # GET /api/lyrics returns offset and forwards duration & force
        fake_lyrics = {
            "found": True,
            "synced": True,
            "lines": [{"time": 10.0, "text": "Line 1"}],
            "plain": "Line 1",
            "source": "lrclib",
            "raw_lrc": "[00:10.00] Line 1",
        }
        with patch("web_app.fetch_lyrics", return_value=fake_lyrics) as mock_fetch:
            r2 = client.get(f"/api/lyrics?artist=Test&title=Song&track_id={tid}&duration=215.4&force=1")
        assert r2.status_code == 200
        payload = r2.get_json()
        assert payload["offset"] == -2.5
        mock_fetch.assert_called_once_with(
            "Test", "Song", file_path=tid, duration=215.4, force_refresh=True
        )

        # Applying new candidate lyrics resets offset back to 0.0
        lrc_body = "\n".join(f"[00:{10+i*4:02d}.00] Applied line {i}" for i in range(5))
        with patch("lyrics_provider.LYRICS_CACHE_DIR", tmp_path):
            r3 = client.post(
                "/api/lyrics/apply",
                json={"track_id": tid, "artist": "Test", "title": "Song", "content": lrc_body},
            )
        assert r3.status_code == 200
        assert r3.get_json()["lyrics"]["offset"] == 0.0
        assert db.get_lyrics_offset(tid) == 0.0

        # Clear removes custom lyrics and cache
        with patch("lyrics_provider.LYRICS_CACHE_DIR", tmp_path):
            r4 = client.post("/api/lyrics/clear", json={"track_id": tid, "artist": "Test", "title": "Song"})
        assert r4.status_code == 200
        assert r4.get_json()["success"] is True

    def test_align_rejects_remote_url_cleanly(self):
        with pytest.raises(ValueError, match="locally cached audio"):
            lyrics_aligner.align_lyrics_to_audio("https://example.com/stream.mp4", "Line one\nLine two")

    def test_align_lead_compensation_when_first_word_missed(self, tmp_path):
        audio_file = tmp_path / "dummy.mp3"
        audio_file.write_bytes(b"ID3")

        class _Word:
            def __init__(self, word, start, end, prob=0.9):
                self.word = word
                self.start = start
                self.end = end
                self.probability = prob

        class _Seg:
            def __init__(self, words):
                self.words = words

        class _Info:
            duration = 30.0

        # First line misses words 0,1 ('hello', 'darkness') and matches word 2 ('friend') at 5.00s
        fake_segments = [
            _Seg([_Word("friend", 5.0, 5.4), _Word("come", 8.0, 8.3), _Word("talk", 8.4, 8.8)])
        ]
        mock_model = MagicMock()
        mock_model.transcribe.return_value = (fake_segments, _Info())

        with patch.object(lyrics_aligner, "_try_gemini_alignment", return_value=None), \
             patch.object(lyrics_aligner, "get_whisper_model", return_value=mock_model):
            res = lyrics_aligner.align_lyrics_to_audio(
                str(audio_file),
                "Hello darkness friend\nCome talk with me again",
            )

        assert res["synced"] is True
        assert len(res["lines"]) == 2
        # Lead compensation shifts 5.00s earlier by 2 * 0.28 = 0.56s -> 4.44s
        assert res["lines"][0]["time"] < 5.0
        assert res["lines"][1]["time"] > res["lines"][0]["time"]
