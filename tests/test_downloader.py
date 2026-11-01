"""
tests/test_downloader.py
Unit tests for downloader.py — validate_options and get_stream_cache_info.

All tests are self-contained (no network, no yt_dlp import).
"""

import sys
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# Stub out heavy third-party dependencies so we can import downloader safely
# without yt_dlp, requests, or db_store hitting disk/network.
# ---------------------------------------------------------------------------

def _stub_modules():
    """Insert lightweight stubs into sys.modules before importing downloader."""
    # yt_dlp stub
    yt_dlp_stub = types.ModuleType("yt_dlp")
    yt_dlp_stub.YoutubeDL = MagicMock()
    sys.modules.setdefault("yt_dlp", yt_dlp_stub)

    # requests stub
    requests_stub = types.ModuleType("requests")
    requests_stub.post = MagicMock(return_value=MagicMock(status_code=200, json=lambda: {}))
    requests_stub.get = MagicMock(return_value=MagicMock(status_code=200, json=lambda: {}))
    sys.modules.setdefault("requests", requests_stub)

    # urllib3 stub (used by downloader's IPv4 monkey-patch)
    urllib3_stub = types.ModuleType("urllib3")
    urllib3_util = types.ModuleType("urllib3.util")
    urllib3_conn = types.ModuleType("urllib3.util.connection")
    urllib3_conn.allowed_gai_family = MagicMock()
    urllib3_stub.util = urllib3_util
    urllib3_util.connection = urllib3_conn
    sys.modules.setdefault("urllib3", urllib3_stub)
    sys.modules.setdefault("urllib3.util", urllib3_util)
    sys.modules.setdefault("urllib3.util.connection", urllib3_conn)

    # db_store stub
    db_stub = types.ModuleType("db_store")
    db_stub.DB_PATH = Path("test_linus.db")
    db_stub.get_search_cache = MagicMock(return_value=None)
    db_stub.set_search_cache = MagicMock()
    sys.modules.setdefault("db_store", db_stub)


_stub_modules()

# Now safe to import downloader
import importlib
import downloader  # noqa: E402  (must be after stubs)


# ---------------------------------------------------------------------------
# Test: validate_options
# ---------------------------------------------------------------------------

class TestValidateOptions(unittest.TestCase):
    """Tests for downloader.validate_options(media_type, fmt, quality)."""

    # --- Audio tests --------------------------------------------------------

    def test_valid_audio_mp3_192(self):
        """Valid audio options should return None (no error)."""
        result = downloader.validate_options("audio", "mp3", "192")
        self.assertIsNone(result)

    def test_valid_audio_flac_320(self):
        """flac at 320 kbps is a valid combination."""
        result = downloader.validate_options("audio", "flac", "320")
        self.assertIsNone(result)

    def test_valid_audio_opus_64(self):
        """opus at 64 kbps is valid."""
        result = downloader.validate_options("audio", "opus", "64")
        self.assertIsNone(result)

    def test_invalid_media_type(self):
        """Unknown media_type must return a descriptive error string."""
        result = downloader.validate_options("stream", "mp3", "192")
        self.assertIsNotNone(result)
        self.assertIn("media_type", result)

    def test_invalid_audio_format(self):
        """An unsupported audio format (e.g. 'avi') must return an error."""
        result = downloader.validate_options("audio", "avi", "192")
        self.assertIsNotNone(result)
        self.assertIn("avi", result)

    def test_invalid_audio_quality(self):
        """An unsupported audio quality (e.g. '999') must return an error."""
        result = downloader.validate_options("audio", "mp3", "999")
        self.assertIsNotNone(result)
        self.assertIn("999", result)

    def test_audio_quality_must_be_string(self):
        """Quality must match as a string key; integer '128' != int 128."""
        result = downloader.validate_options("audio", "mp3", "128")
        self.assertIsNone(result)

    def test_all_valid_audio_formats(self):
        """Every format in AUDIO_FORMATS paired with a valid quality must pass."""
        for fmt in downloader.AUDIO_FORMATS:
            with self.subTest(fmt=fmt):
                self.assertIsNone(downloader.validate_options("audio", fmt, "128"))

    # --- Video tests --------------------------------------------------------

    def test_valid_video_mp4_720(self):
        """Valid video options (mp4, 720p) should return None."""
        result = downloader.validate_options("video", "mp4", "720")
        self.assertIsNone(result)

    def test_valid_video_webm_best(self):
        """'best' quality is valid for video."""
        result = downloader.validate_options("video", "webm", "best")
        self.assertIsNone(result)

    def test_invalid_video_format(self):
        """An unsupported video format (e.g. 'avi') must return an error."""
        result = downloader.validate_options("video", "avi", "720")
        self.assertIsNotNone(result)
        self.assertIn("avi", result)

    def test_invalid_video_quality(self):
        """An unsupported video quality (e.g. '999p') must return an error."""
        result = downloader.validate_options("video", "mp4", "999")
        self.assertIsNotNone(result)
        self.assertIn("999", result)

    def test_all_valid_video_formats(self):
        """Every format in VIDEO_FORMATS must pass with quality '720'."""
        for fmt in downloader.VIDEO_FORMATS:
            with self.subTest(fmt=fmt):
                self.assertIsNone(downloader.validate_options("video", fmt, "720"))

    def test_all_valid_video_heights(self):
        """Every height in VIDEO_HEIGHTS must pass with format 'mp4'."""
        for h in downloader.VIDEO_HEIGHTS:
            with self.subTest(height=h):
                self.assertIsNone(downloader.validate_options("video", "mp4", h))


# ---------------------------------------------------------------------------
# Test: get_stream_cache_info
# ---------------------------------------------------------------------------

class TestGetStreamCacheInfo(unittest.TestCase):
    """Tests for downloader.get_stream_cache_info()."""

    def test_returns_dict_always(self):
        """get_stream_cache_info must always return a dict."""
        with patch.object(downloader, "STREAM_CACHE_DIR", Path("/nonexistent/path/xyz")):
            result = downloader.get_stream_cache_info()
        self.assertIsInstance(result, dict)

    def test_cache_dir_not_exist_returns_zeros(self):
        """When the cache directory does not exist, count and sizes should be 0."""
        with patch.object(downloader, "STREAM_CACHE_DIR", Path("/nonexistent/path/xyz")):
            result = downloader.get_stream_cache_info()
        self.assertEqual(result["count"], 0)
        self.assertEqual(result["size_bytes"], 0)
        self.assertEqual(result["size_mb"], 0.0)

    def test_cache_dir_not_exist_preserves_max_size(self):
        """max_size_mb parameter should be reflected in the returned dict."""
        with patch.object(downloader, "STREAM_CACHE_DIR", Path("/nonexistent/path/xyz")):
            result = downloader.get_stream_cache_info(max_size_mb=250)
        self.assertEqual(result["max_size_mb"], 250)

    def test_default_max_size_mb(self):
        """Default max_size_mb is 500."""
        with patch.object(downloader, "STREAM_CACHE_DIR", Path("/nonexistent/path/xyz")):
            result = downloader.get_stream_cache_info()
        self.assertEqual(result["max_size_mb"], 500)

    def test_required_keys_present(self):
        """Result dict must always contain 'count', 'size_bytes', 'size_mb', 'max_size_mb'."""
        with patch.object(downloader, "STREAM_CACHE_DIR", Path("/nonexistent/path/xyz")):
            result = downloader.get_stream_cache_info()
        for key in ("count", "size_bytes", "size_mb", "max_size_mb"):
            self.assertIn(key, result, msg=f"Missing key: {key}")


if __name__ == "__main__":
    unittest.main()
