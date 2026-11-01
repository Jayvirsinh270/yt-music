"""
tests/test_db_store.py
Unit tests for db_store.py using an in-memory / temp SQLite database.

The conftest.py session fixture patches DB_PATH to a temp file and calls
init_db() once before any test runs. Each test class additionally resets
the thread-local connection so it always works against the correct temp DB.
"""

import sqlite3
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _reset_connection():
    """Force db_store to open a fresh connection against the current DB_PATH."""
    import db_store
    db_store._local = threading.local()


# ---------------------------------------------------------------------------
# Test: Database initialisation
# ---------------------------------------------------------------------------

class TestInitDb(unittest.TestCase):
    """Tests that init_db() creates the expected schema."""

    def setUp(self):
        _reset_connection()

    def test_init_db_creates_tables(self):
        """After init_db(), all core tables should exist in the database."""
        import db_store
        conn = db_store.get_db()
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {row["name"] for row in cur.fetchall()}

        expected_tables = {
            "app_state", "playlists", "playlist_tracks", "favorites",
            "history", "positions", "track_categories", "library_folders",
            "custom_lyrics", "track_play_stats", "track_transitions",
            "tracks_meta", "user_events", "dislikes",
            "dashboard_cache", "search_cache",
        }
        for table in expected_tables:
            self.assertIn(table, tables, msg=f"Missing table: {table}")

    def test_init_db_is_idempotent(self):
        """Calling init_db() a second time must not raise any exception."""
        import db_store
        try:
            db_store.init_db()
        except Exception as exc:
            self.fail(f"init_db() raised on second call: {exc}")


# ---------------------------------------------------------------------------
# Test: get_db()
# ---------------------------------------------------------------------------

class TestGetDb(unittest.TestCase):
    """Tests for the get_db() connection factory."""

    def setUp(self):
        _reset_connection()

    def test_returns_sqlite_connection(self):
        import db_store
        conn = db_store.get_db()
        self.assertIsInstance(conn, sqlite3.Connection)

    def test_thread_local_same_connection(self):
        """Two calls from the same thread must return the identical connection object."""
        import db_store
        conn1 = db_store.get_db()
        conn2 = db_store.get_db()
        self.assertIs(conn1, conn2)

    def test_row_factory_is_set(self):
        """Rows should be addressable by column name (sqlite3.Row)."""
        import db_store
        conn = db_store.get_db()
        cur = conn.cursor()
        cur.execute("SELECT 1 AS val")
        row = cur.fetchone()
        self.assertEqual(row["val"], 1)


# ---------------------------------------------------------------------------
# Test: Favorites CRUD
# ---------------------------------------------------------------------------

class TestFavoritesCrud(unittest.TestCase):
    """Basic CRUD: add favorite → check exists → remove → check gone."""

    TRACK_ID = "test_fav_track_001"

    def setUp(self):
        _reset_connection()
        import db_store
        # Ensure clean slate for this specific track
        db_store.set_favorite(self.TRACK_ID, False)

    def tearDown(self):
        import db_store
        db_store.set_favorite(self.TRACK_ID, False)

    def test_add_favorite(self):
        import db_store
        result = db_store.set_favorite(self.TRACK_ID, True)
        self.assertTrue(result)

    def test_favorite_appears_in_get_favorites(self):
        import db_store
        db_store.set_favorite(self.TRACK_ID, True)
        favs = db_store.get_favorites()
        self.assertIn(self.TRACK_ID, favs)

    def test_remove_favorite(self):
        import db_store
        db_store.set_favorite(self.TRACK_ID, True)
        db_store.set_favorite(self.TRACK_ID, False)
        favs = db_store.get_favorites()
        self.assertNotIn(self.TRACK_ID, favs)

    def test_get_favorites_returns_list(self):
        import db_store
        result = db_store.get_favorites()
        self.assertIsInstance(result, list)

    def test_set_favorite_idempotent(self):
        """Adding the same track twice should not raise or duplicate."""
        import db_store
        db_store.set_favorite(self.TRACK_ID, True)
        db_store.set_favorite(self.TRACK_ID, True)
        favs = db_store.get_favorites()
        self.assertEqual(favs.count(self.TRACK_ID), 1)


# ---------------------------------------------------------------------------
# Test: Library Folders
# ---------------------------------------------------------------------------

class TestLibraryFolders(unittest.TestCase):
    """Tests for add_library_folder, remove_library_folder, get_library_folders."""

    TEST_FOLDER = "/tmp/test_music_library_xyz"

    def setUp(self):
        _reset_connection()
        import db_store
        db_store.remove_library_folder(self.TEST_FOLDER)

    def tearDown(self):
        import db_store
        db_store.remove_library_folder(self.TEST_FOLDER)

    def test_get_library_folders_returns_list(self):
        import db_store
        result = db_store.get_library_folders()
        self.assertIsInstance(result, list)

    def test_add_library_folder(self):
        import db_store
        result = db_store.add_library_folder(self.TEST_FOLDER)
        self.assertTrue(result)
        folders = db_store.get_library_folders()
        self.assertIn(self.TEST_FOLDER, folders)

    def test_remove_library_folder(self):
        import db_store
        db_store.add_library_folder(self.TEST_FOLDER)
        db_store.remove_library_folder(self.TEST_FOLDER)
        folders = db_store.get_library_folders()
        self.assertNotIn(self.TEST_FOLDER, folders)

    def test_add_empty_folder_returns_false(self):
        import db_store
        result = db_store.add_library_folder("")
        self.assertFalse(result)

    def test_add_whitespace_folder_returns_false(self):
        import db_store
        result = db_store.add_library_folder("   ")
        self.assertFalse(result)

    def test_add_folder_idempotent(self):
        """Adding the same folder twice must not raise or duplicate."""
        import db_store
        db_store.add_library_folder(self.TEST_FOLDER)
        db_store.add_library_folder(self.TEST_FOLDER)
        folders = db_store.get_library_folders()
        self.assertEqual(folders.count(self.TEST_FOLDER), 1)


# ---------------------------------------------------------------------------
# Test: Playlists
# ---------------------------------------------------------------------------

class TestPlaylists(unittest.TestCase):
    """Tests for playlist creation, track management and deletion."""

    PLAYLIST = "UnitTest_Playlist_XYZ"
    TRACK1   = "pl_track_001"
    TRACK2   = "pl_track_002"

    def setUp(self):
        _reset_connection()
        import db_store
        db_store.delete_playlist(self.PLAYLIST)

    def tearDown(self):
        import db_store
        db_store.delete_playlist(self.PLAYLIST)

    def test_create_playlist(self):
        import db_store
        result = db_store.create_playlist(self.PLAYLIST)
        self.assertTrue(result)

    def test_create_empty_name_returns_false(self):
        import db_store
        self.assertFalse(db_store.create_playlist(""))
        self.assertFalse(db_store.create_playlist("  "))

    def test_add_track_to_playlist(self):
        import db_store
        db_store.create_playlist(self.PLAYLIST)
        result = db_store.add_track_to_playlist(self.PLAYLIST, self.TRACK1)
        self.assertTrue(result)

    def test_added_track_in_state(self):
        import db_store
        db_store.create_playlist(self.PLAYLIST)
        db_store.add_track_to_playlist(self.PLAYLIST, self.TRACK1)
        state = db_store.get_state()
        self.assertIn(self.PLAYLIST, state["playlists"])
        self.assertIn(self.TRACK1, state["playlists"][self.PLAYLIST])

    def test_remove_track_from_playlist(self):
        import db_store
        db_store.create_playlist(self.PLAYLIST)
        db_store.add_track_to_playlist(self.PLAYLIST, self.TRACK1)
        db_store.remove_track_from_playlist(self.PLAYLIST, self.TRACK1)
        state = db_store.get_state()
        self.assertNotIn(self.TRACK1, state["playlists"].get(self.PLAYLIST, []))

    def test_delete_playlist(self):
        import db_store
        db_store.create_playlist(self.PLAYLIST)
        db_store.delete_playlist(self.PLAYLIST)
        state = db_store.get_state()
        self.assertNotIn(self.PLAYLIST, state["playlists"])


# ---------------------------------------------------------------------------
# Test: app_state / history / positions
# ---------------------------------------------------------------------------

class TestMiscStore(unittest.TestCase):
    """Tests for app_state, history and position helpers."""

    def setUp(self):
        _reset_connection()

    def test_set_and_read_app_state(self):
        import db_store
        db_store.set_app_state("unit_test_key", "hello_value")
        state = db_store.get_state()
        # The state dict doesn't expose raw app_state keys directly, but
        # last_played_track_id goes through app_state
        db_store.set_app_state("last_played_track_id", "track_xyz")
        state = db_store.get_state()
        self.assertEqual(state["last_played_track_id"], "track_xyz")

    def test_add_history(self):
        import db_store
        db_store.add_history("history_track_001")
        state = db_store.get_state()
        self.assertIn("history_track_001", state["history"])

    def test_set_position(self):
        import db_store
        db_store.set_position("pos_track_001", 42.5)
        state = db_store.get_state()
        self.assertAlmostEqual(state["positions"].get("pos_track_001"), 42.5)

    def test_get_state_returns_expected_keys(self):
        import db_store
        state = db_store.get_state()
        for key in ("playlists", "favorites", "history", "positions",
                    "track_categories", "library_folders", "lyrics",
                    "last_played_track_id", "last_played_position"):
            self.assertIn(key, state, msg=f"Missing key '{key}' in get_state()")


# ---------------------------------------------------------------------------
# Test: Track metadata upsert
# ---------------------------------------------------------------------------

class TestTrackMetadata(unittest.TestCase):
    """Tests for upsert_track_metadata and get_track_metadata."""

    TRACK_ID = "meta_track_001"

    def setUp(self):
        _reset_connection()
        import db_store
        conn = db_store.get_db()
        conn.execute("DELETE FROM tracks_meta WHERE track_id = ?", (self.TRACK_ID,))
        conn.commit()

    def tearDown(self):
        import db_store
        conn = db_store.get_db()
        conn.execute("DELETE FROM tracks_meta WHERE track_id = ?", (self.TRACK_ID,))
        conn.commit()

    def test_upsert_returns_true(self):
        import db_store
        result = db_store.upsert_track_metadata(
            self.TRACK_ID, title="Test Song", artist="Test Artist"
        )
        self.assertTrue(result)

    def test_get_track_metadata_after_upsert(self):
        import db_store
        db_store.upsert_track_metadata(
            self.TRACK_ID, title="Test Song", artist="Test Artist",
            album="Test Album", duration=240.0
        )
        meta = db_store.get_track_metadata(self.TRACK_ID)
        self.assertIsNotNone(meta)
        self.assertEqual(meta["title"], "Test Song")
        self.assertEqual(meta["artist"], "Test Artist")

    def test_get_track_metadata_nonexistent_returns_none(self):
        import db_store
        result = db_store.get_track_metadata("nonexistent_track_xyz")
        self.assertIsNone(result)

    def test_upsert_with_empty_track_id_returns_false(self):
        import db_store
        result = db_store.upsert_track_metadata("", title="Test", artist="A")
        self.assertFalse(result)


# ---------------------------------------------------------------------------
# Test: Dislikes
# ---------------------------------------------------------------------------

class TestDislikes(unittest.TestCase):
    """Tests for set_dislike, is_disliked, get_disliked_track_ids."""

    TRACK_ID = "dislike_track_001"

    def setUp(self):
        _reset_connection()
        import db_store
        db_store.set_dislike(self.TRACK_ID, False)

    def tearDown(self):
        import db_store
        db_store.set_dislike(self.TRACK_ID, False)

    def test_dislike_track(self):
        import db_store
        result = db_store.set_dislike(self.TRACK_ID, True)
        self.assertTrue(result)
        self.assertTrue(db_store.is_disliked(self.TRACK_ID))

    def test_undislike_track(self):
        import db_store
        db_store.set_dislike(self.TRACK_ID, True)
        db_store.set_dislike(self.TRACK_ID, False)
        self.assertFalse(db_store.is_disliked(self.TRACK_ID))

    def test_get_disliked_track_ids_returns_set(self):
        import db_store
        result = db_store.get_disliked_track_ids()
        self.assertIsInstance(result, set)

    def test_is_disliked_empty_string(self):
        import db_store
        self.assertFalse(db_store.is_disliked(""))


class TestOnlineTracksMetadata(unittest.TestCase):
    """Tests for get_all_online_tracks_metadata and online track metadata retrieval."""

    def setUp(self):
        _reset_connection()

    def test_online_tracks_metadata_retrieval(self):
        import db_store
        db_store.upsert_track_metadata(
            track_id="yt:test_online_vid_123",
            title="Online Song",
            artist="Online Artist",
            album="Test Album",
            genre="Pop",
            duration=210.5,
            artwork_url="https://example.com/art.jpg",
            is_online=True,
            source="youtube"
        )
        online_meta = db_store.get_all_online_tracks_metadata()
        self.assertIn("yt:test_online_vid_123", online_meta)
        track = online_meta["yt:test_online_vid_123"]
        self.assertEqual(track["title"], "Online Song")
        self.assertEqual(track["artist"], "Online Artist")
        self.assertEqual(track["video_id"], "test_online_vid_123")
        self.assertTrue(track["is_online"])


if __name__ == "__main__":
    unittest.main()
