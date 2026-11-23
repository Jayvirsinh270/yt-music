"""
tests/test_recommendation_algorithm_and_queue.py
Unit tests verifying the accuracy, performance, and reliability of the
Linus CMI Recommendation Engine and playback queue algorithms.
"""

import sys
import unittest
import math
from unittest.mock import patch, MagicMock

import recommendation_engine as rec
import db_store as db


class TestRecommendationAlgorithm(unittest.TestCase):
    def setUp(self):
        # Reset caches before each test
        rec._clean_cache()
        rec._artist_sim_cache.clear()
        rec._title_sim_cache.clear()
        rec.invalidate_taste_profile_cache()

    def test_title_similarity_symmetric_caching(self):
        """Verify token Jaccard similarity is accurate, symmetric, and cached."""
        t1 = "Starboy (Official Audio)"
        t2 = "Starboy"
        sim1 = rec._title_similarity(t1, t2)
        sim2 = rec._title_similarity(t2, t1)
        self.assertAlmostEqual(sim1, sim2)
        self.assertGreater(sim1, 0.7)

        # Check cache hit
        cache_key = (t1.strip().lower(), t2.strip().lower())
        sorted_key = cache_key if cache_key[0] < cache_key[1] else (cache_key[1], cache_key[0])
        self.assertIn(sorted_key, rec._title_sim_cache)

        # Stop words filter test
        t3 = "The Song of the Stars"
        t4 = "Stars"
        sim_stop = rec._title_similarity(t3, t4)
        self.assertGreater(sim_stop, 0.0)

    def test_artist_similarity_multi_artist_and_collaborations(self):
        """Verify multi-artist collaboration matching and variant scoring."""
        # Exact match
        self.assertEqual(rec._artist_similarity("The Weeknd", "the weeknd"), 1.0)

        # Collaboration / Feature matching
        sim_collab = rec._artist_similarity("The Weeknd feat. Daft Punk", "Daft Punk")
        self.assertGreaterEqual(sim_collab, 0.75)

        sim_collab2 = rec._artist_similarity("Drake & Future", "Drake")
        self.assertGreaterEqual(sim_collab2, 0.75)

        # Unrelated artists
        self.assertEqual(rec._artist_similarity("Eminem", "Taylor Swift"), 0.0)

        # Ignored placeholders
        self.assertEqual(rec._artist_similarity("Unknown", "Taylor Swift"), 0.0)
        self.assertEqual(rec._artist_similarity("Local Collection", "Coldplay"), 0.0)

    def test_taste_profile_cold_start_with_favorites_and_playlists(self):
        """Verify that favorites & playlists enrich taste profile even with zero play stats."""
        # Mock empty play stats but non-empty favorites and playlists
        with patch.object(db, "get_disliked_track_ids", return_value=set()), \
             patch.object(db, "get_db") as mock_get_db, \
             patch.object(db, "batch_get_track_metadata") as mock_batch_meta:

            mock_conn = MagicMock()
            mock_cur = MagicMock()
            mock_get_db.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cur

            # Return favorites, playlists, and 0 stats rows
            mock_cur.fetchall.side_effect = [
                [{"track_id": "fav-1"}],       # favorites
                [{"track_id": "pl-1"}],        # playlist_tracks
                [],                            # stats_rows (empty!)
                [],                            # user_events (time of day)
                [],                            # date_rows
                [],                            # weekly_plays
                [],                            # session_rows
            ]
            mock_cur.fetchone.side_effect = [
                {"cnt": 0},                    # weekly_plays cnt
                None,                          # peak_hour
                {"cnt": 10},                   # total_artists
                {"total_plays": 0, "total_skips": 0}  # skip_row
            ]

            mock_batch_meta.return_value = {
                "fav-1": {"title": "Blinding Lights", "artist": "The Weeknd", "genre": "Pop"},
                "pl-1": {"title": "Starboy", "artist": "The Weeknd", "genre": "Pop"}
            }

            profile = rec.compute_user_taste_profile(days=30, force_refresh=True)

            # Profile should NOT be empty; it must be enriched from favorites and playlists!
            top_artists = dict(profile.get("top_artists", []))
            self.assertIn("The Weeknd", top_artists)
            self.assertGreater(top_artists["The Weeknd"], 0.0)
            self.assertEqual(profile.get("top_artist_name"), "The Weeknd")

    def test_smart_shuffle_artist_dispersion(self):
        """Verify smart shuffle spaces out tracks from the same artist."""
        tracks = [
            {"id": "t1", "title": "Song 1", "artist": "Artist A"},
            {"id": "t2", "title": "Song 2", "artist": "Artist A"},
            {"id": "t3", "title": "Song 3", "artist": "Artist A"},
            {"id": "t4", "title": "Song 4", "artist": "Artist B"},
            {"id": "t5", "title": "Song 5", "artist": "Artist B"},
            {"id": "t6", "title": "Song 6", "artist": "Artist C"},
            {"id": "t7", "title": "Song 7", "artist": "Artist D"},
        ]

        with patch.object(db, "get_db") as mock_get_db, \
             patch.object(db, "get_disliked_track_ids", return_value=set()):
            mock_conn = MagicMock()
            mock_cur = MagicMock()
            mock_get_db.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cur
            mock_cur.fetchall.return_value = []

            shuffled = rec.smart_shuffle_tracks(tracks, current_track_id=None)
            self.assertEqual(len(shuffled), len(tracks))

            # Verify that adjacent tracks rarely share the same artist
            consecutive_same_artist = 0
            for i in range(len(shuffled) - 1):
                if shuffled[i]["artist"].lower() == shuffled[i + 1]["artist"].lower():
                    consecutive_same_artist += 1

            # With A (3), B (2), C (1), D (1), perfect or near-perfect dispersion is achieved
            self.assertLessEqual(consecutive_same_artist, 1)

    def test_local_recommendation_batch_vibe_and_content_scoring(self):
        """Verify local recommendation batch ranks acoustic vibe and artist peers highest."""
        current = {
            "id": "curr-1",
            "title": "Midnight City",
            "artist": "M83",
            "category": "Electronic",
            "duration": 240.0
        }
        library = [
            {"id": "t1", "title": "Wait", "artist": "M83", "category": "Electronic", "duration": 235.0},
            {"id": "t2", "title": "Shooting Stars", "artist": "Bag Raiders", "category": "Electronic", "duration": 230.0},
            {"id": "t3", "title": "Acoustic Folk Song", "artist": "Bob", "category": "Acoustic", "duration": 180.0},
        ]

        with patch.object(db, "get_db") as mock_get_db, \
             patch.object(db, "get_disliked_track_ids", return_value=set()), \
             patch.object(rec, "compute_user_taste_profile", return_value={}):
            mock_conn = MagicMock()
            mock_cur = MagicMock()
            mock_get_db.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cur
            mock_cur.fetchall.return_value = []

            results = rec.get_local_recommendation_batch(current, library, count=3)
            self.assertTrue(len(results) > 0)
            # Same artist (M83) and same genre/vibe (Electronic) should rank higher than Acoustic Folk
            self.assertEqual(results[0]["id"], "t1")

    def test_api_state_playlist_saving_contract(self):
        """Verify web_app /api/state endpoint returns status: success and persists playlists."""
        import web_app
        client = web_app.app.test_client()
        with patch("web_app.load_state", return_value={"playlists": {}}), \
             patch("web_app.save_state") as mock_save:
            res = client.post("/api/state", json={"playlists": {"Test Queue Mix": ["t1", "t2"]}})
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertEqual(data.get("status"), "success")
            self.assertIn("Test Queue Mix", data.get("playlists", {}))
            mock_save.assert_called_once()

    def test_api_playlists_save_mix_endpoint(self):
        """Verify /api/playlists/save-mix converts an auto-generated mix to a permanent playlist."""
        import web_app
        client = web_app.app.test_client()
        mock_state = {"playlists": {"Morning Awakening": ["track-old"]}}
        sample_tracks = [
            {"id": "yt:vid123", "title": "Online Track", "artist": "Singer", "is_youtube": True},
            {"id": "local_track_01", "title": "Local Song", "artist": "Band"}
        ]
        with patch("web_app.load_state", return_value=mock_state), \
             patch("web_app.save_state") as mock_save, \
             patch("db_store.create_playlist") as mock_create_pl, \
             patch("db_store.add_track_to_playlist") as mock_add_pl, \
             patch("db_store.upsert_online_tracks_batch") as mock_upsert:
            # Saving with existing name should disambiguate to Morning Awakening (2)
            res = client.post("/api/playlists/save-mix", json={
                "name": "Morning Awakening",
                "tracks": sample_tracks
            })
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertEqual(data.get("status"), "success")
            self.assertEqual(data.get("playlist_name"), "Morning Awakening (2)")
            self.assertEqual(data.get("track_count"), 2)
            self.assertEqual(data.get("track_ids"), ["yt:vid123", "local_track_01"])
            mock_save.assert_called_once()
            mock_create_pl.assert_called_with("Morning Awakening (2)")
            self.assertEqual(mock_add_pl.call_count, 2)
            mock_upsert.assert_called_once()

        # Validation error test
        err_res = client.post("/api/playlists/save-mix", json={"name": ""})
        self.assertEqual(err_res.status_code, 400)

    def test_lyrics_fetch_endpoint_contract(self):
        """Verify /api/lyrics endpoint provides lyrics structure required for Floating Mini-Lyrics HUD."""
        import web_app
        client = web_app.app.test_client()
        with patch("web_app.fetch_lyrics", return_value={
            "found": True,
            "synced": True,
            "source": "lrclib",
            "lines": [{"time": 1.5, "text": "Hello world"}],
            "plain": "Hello world"
        }):
            res = client.get("/api/lyrics?artist=Adele&title=Hello")
            self.assertEqual(res.status_code, 200)
            data = res.get_json()
            self.assertTrue(data.get("found"))
            self.assertTrue(data.get("synced"))
            self.assertEqual(data.get("source"), "lrclib")
            self.assertIsInstance(data.get("lines"), list)
            self.assertEqual(len(data["lines"]), 1)
            self.assertEqual(data["lines"][0]["text"], "Hello world")


    def test_entity_resolution_and_channel_filter(self):
        """Verify that record labels (T-Series, YRF, Coke Studio) are not treated as artists and real singers are extracted."""
        # Case 1: T-Series label in title and artist
        t1, a1, g1 = rec.parse_artist_and_title("Sahiba (Official Music Video) : Aditya Rikhari | T-Series", "T-Series")
        self.assertEqual(a1, "Aditya Rikhari")
        self.assertEqual(t1, "Sahiba")

        # Case 2: Coke Studio channel
        t2, a2, g2 = rec.parse_artist_and_title("Jhol | Coke Studio Pakistan | Season 15 | Maanu x Annural Khalid", "Coke Studio Pakistan")
        self.assertEqual(a2, "Maanu")

        # Case 3: YRF channel
        t3, a3, g3 = rec.parse_artist_and_title("Lyrical | Tum Ho Toh Song | Saiyaara | Vishal Mishra", "YRF")
        self.assertEqual(a3, "Vishal Mishra")

        # Case 4: Channel denylist detection
        self.assertTrue(rec.is_channel_or_label("T-Series"))
        self.assertTrue(rec.is_channel_or_label("Sony Music India"))
        self.assertTrue(rec.is_channel_or_label("Zee Music Company"))
        self.assertFalse(rec.is_channel_or_label("Ed Sheeran"))
        self.assertFalse(rec.is_channel_or_label("Aditya Rikhari"))

    def test_soundscape_genre_inference(self):
        """Verify accurate categorization into soundscapes without relying on raw YouTube tags."""
        self.assertEqual(rec.infer_genre("Sahiba", artist="Aditya Rikhari"), "Indie Pop")
        self.assertEqual(rec.infer_genre("Shape of You", artist="Ed Sheeran"), "Pop")
        self.assertEqual(rec.infer_genre("Closer", artist="The Chainsmokers"), "Electronic")
        self.assertEqual(rec.infer_genre("Tum Ho Toh", artist="Vishal Mishra"), "Bollywood")

    def test_discovery_mode_dial_filtering(self):
        """Verify Discovery Dial adapts recommendation scoring between comfort and discovery."""
        sample_library = [
            {"id": "song-1", "title": "Blinding Lights", "artist": "The Weeknd", "category": "Pop", "duration": 200},
            {"id": "song-2", "title": "Save Your Tears", "artist": "The Weeknd", "category": "Pop", "duration": 210},
            {"id": "song-3", "title": "Indie Gem", "artist": "Unknown Indie Artist", "category": "Indie", "duration": 190},
            {"id": "song-4", "title": "Acoustic Drift", "artist": "Folk Wanderer", "category": "Acoustic", "duration": 180},
        ]
        curr = {"id": "song-0", "title": "Starboy", "artist": "The Weeknd", "category": "Pop", "duration": 210}

        # In comfort mode, artist match and favorites should be boosted
        comfort_results = rec.get_local_recommendation_batch(
            current_track=curr,
            library_tracks=sample_library,
            count=2,
            discovery_mode="comfort"
        )
        self.assertTrue(len(comfort_results) > 0)
        self.assertEqual(comfort_results[0]["artist"], "The Weeknd")

        # In discovery mode, artist cap is 1, and unplayed indie gems should surface
        discovery_results = rec.get_local_recommendation_batch(
            current_track=curr,
            library_tracks=sample_library,
            count=3,
            discovery_mode="discovery"
        )
        self.assertTrue(len(discovery_results) > 0)
        # Ensure diverse artists returned
        returned_artists = [t["artist"] for t in discovery_results]
        self.assertEqual(len(returned_artists), len(set(returned_artists)))

    def test_circadian_time_capsule_generation(self):
        """Verify circadian time capsule correctly identifies period and curates tracks."""
        sample_library = [
            {"id": "song-1", "title": "Morning Sun", "artist": "Lo-Fi Dreamer", "category": "Lo-Fi", "duration": 180},
            {"id": "song-2", "title": "Midday Energy", "artist": "Rock Hero", "category": "Rock", "duration": 220},
            {"id": "song-3", "title": "Sunset Groove", "artist": "Soul Master", "category": "R&B", "duration": 200},
            {"id": "song-4", "title": "Midnight Stars", "artist": "Ambient Pulse", "category": "Ambient", "duration": 240},
        ]
        # Test morning hour (8 AM)
        morning_capsule = rec.get_circadian_time_capsule(sample_library, count=2, custom_hour=8)
        self.assertEqual(morning_capsule["period"], "morning")
        self.assertEqual(morning_capsule["title"], "Morning Awakening")
        self.assertTrue(len(morning_capsule["tracks"]) > 0)

        # Test afternoon hour (2 PM / 14:00)
        afternoon_capsule = rec.get_circadian_time_capsule(sample_library, count=2, custom_hour=14)
        self.assertEqual(afternoon_capsule["period"], "afternoon")
        self.assertEqual(afternoon_capsule["title"], "Midday Focus Flow")

        # Test evening hour (7 PM / 19:00)
        evening_capsule = rec.get_circadian_time_capsule(sample_library, count=2, custom_hour=19)
        self.assertEqual(evening_capsule["period"], "evening")
        self.assertEqual(evening_capsule["title"], "Golden Hour Sunset")

        # Test night hour (11 PM / 23:00)
        night_capsule = rec.get_circadian_time_capsule(sample_library, count=2, custom_hour=23)
        self.assertEqual(night_capsule["period"], "night")
        self.assertEqual(night_capsule["title"], "Midnight Sanctuary")

    def test_sonic_dna_taste_summary_payload(self):
        """Verify compute_user_taste_profile provides all metrics required for the Sonic DNA Listening Card."""
        profile = rec.compute_user_taste_profile()
        self.assertIsInstance(profile, dict)
        # Required attributes for Sonic DNA Card export
        expected_keys = [
            "listening_streak_days",
            "total_listen_hours",
            "sonic_vibe_badge",
            "top_genres_breakdown",
            "top_artists_detail",
            "discovery_score"
        ]
        for key in expected_keys:
            self.assertIn(key, profile)
        self.assertIsInstance(profile["top_genres_breakdown"], list)
        self.assertIsInstance(profile["top_artists_detail"], list)


if __name__ == "__main__":
    unittest.main()
