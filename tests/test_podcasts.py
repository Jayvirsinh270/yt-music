import pytest
from unittest.mock import patch, MagicMock
import podcast_service as pod

SAMPLE_RSS_XML = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Sample Tech Talk</title>
    <author>Jane Developer</author>
    <description>A podcast about clean architecture.</description>
    <itunes:image href="https://example.com/podcast.jpg"/>
    <item>
      <title>Episode 1: The Beginning</title>
      <description>Introduction to the show.</description>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <enclosure url="https://example.com/ep1.mp3" length="12345" type="audio/mpeg"/>
      <itunes:duration>1800</itunes:duration>
      <guid>ep-001</guid>
    </item>
  </channel>
</rss>
"""


def test_parse_feed():
    with patch("podcast_service.requests.get") as mock_get:
        mock_resp = MagicMock()
        mock_resp.content = SAMPLE_RSS_XML
        mock_resp.raise_for_status = MagicMock()
        mock_get.return_value = mock_resp

        parsed = pod.parse_feed("https://example.com/feed.rss")
        assert parsed["title"] == "Sample Tech Talk"
        assert parsed["author"] == "Jane Developer"
        assert parsed["artwork_url"] == "https://example.com/podcast.jpg"
        assert parsed["episode_count"] == 1

        ep = parsed["episodes"][0]
        assert ep["title"] == "Episode 1: The Beginning"
        assert ep["audio_url"] == "https://example.com/ep1.mp3"
        assert ep["duration"] == 1800.0


def test_save_episode_position():
    pod.init_podcast_tables()
    ok = pod.save_episode_position("non_existent_ep", 120.0, False)
    assert ok is True
