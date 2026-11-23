"""
tests/test_metadata_enricher.py — Unit tests for metadata enrichment
"""

from unittest.mock import patch, MagicMock
import pytest
import metadata_enricher as me


def test_enrich_track_skips_complete_tracks():
    complete_track = {
        "id": "1",
        "title": "Song",
        "artist": "Artist",
        "album": "Album",
        "has_artwork": True,
        "artwork_url": "https://example.com/art.jpg",
    }
    enriched = me.enrich_track(complete_track)
    assert enriched["artwork_url"] == "https://example.com/art.jpg"


@patch("requests.get")
def test_query_itunes_metadata(mock_get):
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {
        "results": [{
            "trackName": "Levitating",
            "artistName": "Dua Lipa",
            "collectionName": "Future Nostalgia",
            "artworkUrl100": "https://is1-ssl.mzstatic.com/image/thumb/Music/100x100bb.jpg",
            "primaryGenreName": "Pop",
            "releaseDate": "2020-03-27T07:00:00Z",
        }]
    }
    mock_get.return_value = mock_resp

    res = me.query_itunes_metadata("Levitating", "Dua Lipa")
    assert res is not None
    assert res["artist"] == "Dua Lipa"
    assert res["album"] == "Future Nostalgia"
    assert "1000x1000bb.jpg" in res["artwork_url"]
    assert res["year"] == "2020"


@patch("metadata_enricher.query_itunes_metadata")
def test_enrich_track_populates_missing_art(mock_itunes):
    mock_itunes.return_value = {
        "title": "As It Was",
        "artist": "Harry Styles",
        "album": "Harry's House",
        "artwork_url": "https://example.com/1000x1000.jpg",
        "year": "2022",
    }

    raw_track = {
        "id": "raw_1",
        "title": "As It Was",
        "artist": "Unknown Artist",
        "has_artwork": False,
        "artwork_url": "",
    }

    with patch("db_store.update_track_metadata"):
        enriched = me.enrich_track(raw_track)
        assert enriched["has_artwork"] is True
        assert enriched["artwork_url"] == "https://example.com/1000x1000.jpg"
        assert enriched["artist"] == "Harry Styles"
        assert enriched["album"] == "Harry's House"


def test_enrich_api_endpoints():
    from web_app import app
    client = app.test_client()

    # Test status endpoint
    res = client.get("/api/library/enrich/status")
    assert res.status_code == 200
    data = res.get_json()
    assert "in_progress" in data
    assert "processed" in data


def test_sidecar_artwork_extraction(tmp_path):
    import library_service as ls
    # Create a mock video file and sidecar .webp file
    video_file = tmp_path / "MySong.mp4"
    video_file.write_bytes(b"mock video data")
    sidecar_img = tmp_path / "MySong.webp"
    sidecar_img.write_bytes(b"mock webp image data")

    # Verify track meta detects has_artwork=True
    meta = ls.extract_track_meta(video_file)
    assert meta["has_artwork"] is True

    # Verify extract_artwork_bytes returns the image data and mime type
    result = ls.extract_artwork_bytes(str(video_file))
    assert result is not None
    data, mime = result
    assert data == b"mock webp image data"
    assert mime == "image/webp"


