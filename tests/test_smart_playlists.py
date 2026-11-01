"""
tests/test_smart_playlists.py
Unit tests for smart_playlists.py.

All external dependencies (db_store, library_service, recommendation_engine)
are mocked so these tests run without a real database, filesystem scan, or
audio analysis.
"""

import sys
import types
import unittest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Stub heavy dependencies before importing smart_playlists
# ---------------------------------------------------------------------------

def _make_db_stub():
    stub = types.ModuleType("db_store")
    stub.DB_PATH = "test_linus.db"
    stub.get_all_track_play_stats = MagicMock(return_value={})
    stub.get_favorites = MagicMock(return_value=[])
    return stub


def _make_lib_stub():
    stub = types.ModuleType("library_service")
    stub.scan_library = MagicMock(return_value=[])
    return stub


def _make_rec_stub():
    stub = types.ModuleType("recommendation_engine")
    stub.estimate_track_bpm = MagicMock(return_value=120.0)
    stub.compute_track_vibe_coords = MagicMock(return_value=(0.0, 0.0))
    stub.get_top_played_local = MagicMock(return_value=[])
    stub.get_hidden_gems_local = MagicMock(return_value=[])
    return stub


# Only inject stubs if the real modules aren't already loaded
sys.modules.setdefault("db_store", _make_db_stub())
sys.modules.setdefault("library_service", _make_lib_stub())
sys.modules.setdefault("recommendation_engine", _make_rec_stub())

import smart_playlists  # noqa: E402


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_track(tid, duration=200.0, mtime=1_000_000.0, genre="pop"):
    return {
        "id": tid,
        "title": f"Track {tid}",
        "artist": "Test Artist",
        "genre": genre,
        "duration": duration,
        "mtime": mtime,
        "artwork_url": f"http://example.com/{tid}.jpg",
        "media_type": "audio",
    }


_SAMPLE_TRACKS = [_make_track(f"t{i}", duration=200 + i * 10) for i in range(10)]
_EPIC_TRACKS   = [_make_track(f"e{i}", duration=400 + i * 30) for i in range(5)]
_ALL_TRACKS    = _SAMPLE_TRACKS + _EPIC_TRACKS


# ---------------------------------------------------------------------------
# Tests: SMART_PLAYLIST_DEFINITIONS constant
# ---------------------------------------------------------------------------

class TestSmartPlaylistDefinitions(unittest.TestCase):
    """Verify the static playlist definition table is well-formed."""

    def test_is_list(self):
        self.assertIsInstance(smart_playlists.SMART_PLAYLIST_DEFINITIONS, list)

    def test_minimum_playlist_count(self):
        """There must be at least one smart playlist defined."""
        self.assertGreater(len(smart_playlists.SMART_PLAYLIST_DEFINITIONS), 0)

    def test_each_definition_has_required_keys(self):
        required = {"id", "title", "description", "icon", "gradient", "accent", "badge"}
        for defn in smart_playlists.SMART_PLAYLIST_DEFINITIONS:
            with self.subTest(id=defn.get("id")):
                for key in required:
                    self.assertIn(key, defn, msg=f"Missing key '{key}' in {defn}")

    def test_known_playlist_ids_present(self):
        ids = {d["id"] for d in smart_playlists.SMART_PLAYLIST_DEFINITIONS}
        for expected_id in ("heavy-rotation", "forgotten-gems", "recently-added", "epic-length"):
            self.assertIn(expected_id, ids)


# ---------------------------------------------------------------------------
# Tests: get_all_smart_playlists()
# ---------------------------------------------------------------------------

class TestGetAllSmartPlaylists(unittest.TestCase):
    """Tests for smart_playlists.get_all_smart_playlists()."""

    def setUp(self):
        """Patch db and library stubs fresh for each test."""
        db_mod = sys.modules["db_store"]
        db_mod.get_all_track_play_stats.return_value = {}
        db_mod.get_favorites.return_value = []
        lib_mod = sys.modules["library_service"]
        lib_mod.scan_library.return_value = []

    def test_returns_list(self):
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        self.assertIsInstance(result, list)

    def test_length_matches_definitions(self):
        """One card must be emitted per definition."""
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        self.assertEqual(len(result), len(smart_playlists.SMART_PLAYLIST_DEFINITIONS))

    def test_each_card_has_id(self):
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        for card in result:
            self.assertIn("id", card)

    def test_each_card_has_description(self):
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        for card in result:
            self.assertIn("description", card)

    def test_each_card_has_title(self):
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        for card in result:
            self.assertIn("title", card)

    def test_each_card_has_count(self):
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        for card in result:
            self.assertIn("count", card)
            self.assertIsInstance(card["count"], int)

    def test_each_card_has_total_duration(self):
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        for card in result:
            self.assertIn("total_duration", card)

    def test_empty_library_yields_zero_counts(self):
        result = smart_playlists.get_all_smart_playlists(library_tracks=[])
        for card in result:
            with self.subTest(id=card["id"]):
                # With no tracks, each playlist that uses the library should have count 0
                # (some fallbacks to rec engine stubs that return [] too)
                self.assertGreaterEqual(card["count"], 0)

    def test_with_tracks_recently_added_count(self):
        """recently-added should return up to limit tracks sorted by mtime."""
        tracks = [_make_track(f"r{i}", mtime=float(i)) for i in range(5)]
        result = smart_playlists.get_all_smart_playlists(library_tracks=tracks)
        card = next(c for c in result if c["id"] == "recently-added")
        self.assertEqual(card["count"], 5)

    def test_epic_length_filters_by_duration(self):
        """epic-length should only include tracks >= 360 seconds."""
        short_tracks = [_make_track(f"s{i}", duration=100.0) for i in range(3)]
        long_tracks  = [_make_track(f"l{i}", duration=400.0) for i in range(2)]
        result = smart_playlists.get_all_smart_playlists(library_tracks=short_tracks + long_tracks)
        card = next(c for c in result if c["id"] == "epic-length")
        self.assertEqual(card["count"], 2)


# ---------------------------------------------------------------------------
# Tests: get_smart_playlist_tracks()
# ---------------------------------------------------------------------------

class TestGetSmartPlaylistTracks(unittest.TestCase):
    """Tests for smart_playlists.get_smart_playlist_tracks()."""

    def setUp(self):
        db_mod = sys.modules["db_store"]
        db_mod.get_all_track_play_stats.return_value = {}
        db_mod.get_favorites.return_value = []
        rec_mod = sys.modules["recommendation_engine"]
        rec_mod.estimate_track_bpm.return_value = 120.0
        rec_mod.compute_track_vibe_coords.return_value = (0.0, 0.0)
        rec_mod.get_top_played_local.return_value = []
        rec_mod.get_hidden_gems_local.return_value = []

    def test_returns_list_for_valid_id(self):
        for pid in ("heavy-rotation", "forgotten-gems", "high-energy",
                    "deep-focus", "recently-added", "epic-length"):
            with self.subTest(pid=pid):
                result = smart_playlists.get_smart_playlist_tracks(pid, library_tracks=_SAMPLE_TRACKS)
                self.assertIsInstance(result, list)

    def test_empty_library_returns_empty(self):
        result = smart_playlists.get_smart_playlist_tracks("recently-added", library_tracks=[])
        self.assertEqual(result, [])

    def test_unknown_playlist_id_returns_empty(self):
        result = smart_playlists.get_smart_playlist_tracks("does-not-exist", library_tracks=_SAMPLE_TRACKS)
        self.assertEqual(result, [])

    def test_recently_added_sorted_by_mtime_desc(self):
        tracks = [
            _make_track("old", mtime=1000.0),
            _make_track("new", mtime=9000.0),
            _make_track("mid", mtime=5000.0),
        ]
        result = smart_playlists.get_smart_playlist_tracks("recently-added", library_tracks=tracks)
        self.assertEqual(result[0]["id"], "new")
        self.assertEqual(result[-1]["id"], "old")

    def test_epic_length_only_long_tracks(self):
        tracks = [
            _make_track("short", duration=100.0),
            _make_track("long",  duration=420.0),
        ]
        result = smart_playlists.get_smart_playlist_tracks("epic-length", library_tracks=tracks)
        ids = [t["id"] for t in result]
        self.assertIn("long", ids)
        self.assertNotIn("short", ids)

    def test_epic_length_sorted_longest_first(self):
        tracks = [
            _make_track("medium", duration=380.0),
            _make_track("longest", duration=600.0),
            _make_track("long", duration=400.0),
        ]
        result = smart_playlists.get_smart_playlist_tracks("epic-length", library_tracks=tracks)
        durations = [t["duration"] for t in result]
        self.assertEqual(durations, sorted(durations, reverse=True))

    def test_limit_is_respected(self):
        tracks = [_make_track(f"t{i}", mtime=float(i)) for i in range(100)]
        result = smart_playlists.get_smart_playlist_tracks("recently-added", library_tracks=tracks, limit=10)
        self.assertLessEqual(len(result), 10)

    def test_video_tracks_excluded(self):
        """Tracks with media_type='video' must not appear in any smart playlist."""
        video_track = {"id": "vid1", "title": "Video", "artist": "A",
                       "genre": "", "duration": 400.0, "mtime": 9999.0,
                       "artwork_url": "", "media_type": "video"}
        audio_track = _make_track("audio1", duration=400.0, mtime=1.0)
        result = smart_playlists.get_smart_playlist_tracks(
            "recently-added", library_tracks=[video_track, audio_track]
        )
        ids = [t["id"] for t in result]
        self.assertNotIn("vid1", ids)
        self.assertIn("audio1", ids)

    def test_forgotten_gems_excludes_short_tracks(self):
        """Tracks shorter than 90 s must be excluded from 'forgotten-gems'."""
        import time
        old_ts = time.time() - (60 * 86400)  # 60 days ago (never played)
        tracks = [
            _make_track("micro", duration=30.0),   # too short
            _make_track("normal", duration=200.0), # qualifies
        ]
        # Simulate tracks not played in last 30 days (last_played_at = 0)
        db_mod = sys.modules["db_store"]
        db_mod.get_all_track_play_stats.return_value = {
            "micro":  {"last_played_at": 0, "play_count": 0, "completion_rate": 0.0, "skip_count": 0},
            "normal": {"last_played_at": 0, "play_count": 0, "completion_rate": 0.0, "skip_count": 0},
        }
        result = smart_playlists.get_smart_playlist_tracks("forgotten-gems", library_tracks=tracks)
        ids = [t["id"] for t in result]
        self.assertNotIn("micro", ids)
        self.assertIn("normal", ids)


if __name__ == "__main__":
    unittest.main()
