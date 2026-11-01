"""
test_storage_cache_db.py — Comprehensive tests for SQLite storage of online tracks,
playback queue, user settings, and cache-control headers.
"""

import json
import unittest
import db_store
import web_app


class TestStorageCacheDB(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        db_store.init_db()

    def test_user_settings_crud(self):
        # 1. Single setting
        ok = db_store.set_user_setting("theme_test", {"accent": "#ff0000", "font": "sans"})
        self.assertTrue(ok)
        val = db_store.get_user_setting("theme_test")
        self.assertIsInstance(val, dict)
        self.assertEqual(val.get("accent"), "#ff0000")

        # 2. Batch settings
        batch = {
            "vibe_test": "chill",
            "autodj_enabled": True,
            "autodj_duration": 6
        }
        ok_batch = db_store.save_user_settings(batch)
        self.assertTrue(ok_batch)

        all_settings = db_store.get_all_user_settings()
        self.assertEqual(all_settings.get("vibe_test"), "chill")
        self.assertEqual(all_settings.get("autodj_enabled"), True)
        self.assertEqual(all_settings.get("autodj_duration"), 6)

    def test_playback_queue_persistence(self):
        test_queue = [
            {"id": "t1", "title": "Track 1", "artist": "Artist 1"},
            {"id": "t2", "title": "Track 2", "artist": "Artist 2"}
        ]
        ok = db_store.save_playback_queue(test_queue, current_index=1)
        self.assertTrue(ok)

        loaded = db_store.get_playback_queue()
        self.assertIn("queue", loaded)
        self.assertIn("currentIndex", loaded)
        self.assertEqual(len(loaded["queue"]), 2)
        self.assertEqual(loaded["currentIndex"], 1)

    def test_upsert_online_tracks_batch(self):
        tracks = [
            {
                "id": "yt:batch_test_1",
                "video_id": "batch_test_1",
                "title": "Online Track 1",
                "artist": "Artist Online",
                "duration": 210.0,
                "artwork_url": "https://example.com/thumb1.jpg"
            },
            {
                "id": "yt:batch_test_2",
                "video_id": "batch_test_2",
                "title": "Online Track 2",
                "artist": "Artist Online 2",
                "duration": 180.0,
                "artwork_url": "https://example.com/thumb2.jpg"
            }
        ]
        count = db_store.upsert_online_tracks_batch(tracks)
        self.assertEqual(count, 2)

        online_meta = db_store.get_all_online_tracks_metadata()
        self.assertIn("yt:batch_test_1", online_meta)
        self.assertEqual(online_meta["yt:batch_test_1"]["title"], "Online Track 1")
        self.assertIn("yt:batch_test_2", online_meta)

    def test_api_endpoints_and_cache_control(self):
        client = web_app.app.test_client()

        # 1. Test POST /api/tracks/cache-online
        res = client.post("/api/tracks/cache-online", json={
            "tracks": [
                {
                    "id": "yt:api_test_01",
                    "title": "API Cached Song",
                    "artist": "Test YouTube Artist",
                    "duration": 195.0
                }
            ]
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data.get("status"), "success")
        self.assertEqual(data.get("cached_count"), 1)

        # 2. Test GET and POST /api/settings
        post_set = client.post("/api/settings", json={"radio_mode": "online", "volume": 85})
        self.assertEqual(post_set.status_code, 200)

        get_set = client.get("/api/settings")
        self.assertEqual(get_set.status_code, 200)
        settings_data = get_set.get_json()
        self.assertEqual(settings_data.get("radio_mode"), "online")
        self.assertEqual(settings_data.get("volume"), 85)

        # 3. Test POST /api/state/sync-session
        sync_res = client.post("/api/state/sync-session", data=json.dumps({
            "last_played_track_id": "yt:api_test_01",
            "last_played_position": 45.2,
            "user_settings": {"sidebar_pinned": True}
        }), content_type="application/json")
        self.assertEqual(sync_res.status_code, 200)

        # 4. Test GET /api/library returns settings, queue, online_tracks and cache-control
        lib_res = client.get("/api/library")
        self.assertEqual(lib_res.status_code, 200)
        # Verify Cache-Control header prevents browser disk cache hoarding
        cache_ctrl = lib_res.headers.get("Cache-Control", "")
        self.assertIn("no-cache", cache_ctrl)
        self.assertIn("no-store", cache_ctrl)

        lib_data = lib_res.get_json()
        self.assertIn("settings", lib_data)
        self.assertIn("playback_queue", lib_data)
        self.assertIn("online_tracks", lib_data)
        self.assertIn("yt:api_test_01", lib_data["online_tracks"])


if __name__ == "__main__":
    unittest.main()
