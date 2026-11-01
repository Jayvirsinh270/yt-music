import pytest
from unittest.mock import patch
import artist_album_service as svc


@pytest.fixture
def mock_tracks():
    return [
        {
            "id": "track_1",
            "title": "Song One",
            "artist": "Artist Alpha",
            "album": "Album One",
            "duration": 180.0,
            "artwork_url": "https://example.com/art1.jpg",
            "has_artwork": True,
        },
        {
            "id": "track_2",
            "title": "Song Two",
            "artist": "Artist Alpha",
            "album": "Album One",
            "duration": 200.0,
            "artwork_url": "https://example.com/art1.jpg",
            "has_artwork": True,
        },
        {
            "id": "track_3",
            "title": "Song Three",
            "artist": "Artist Beta",
            "album": "Album Two",
            "duration": 240.0,
            "artwork_url": "",
            "has_artwork": False,
        },
    ]


def test_get_all_artists(mock_tracks):
    with patch("artist_album_service.scan_library", return_value=mock_tracks):
        artists = svc.get_all_artists()
        assert len(artists) == 2
        # Artist Alpha has 2 tracks, should be first
        assert artists[0]["name"] == "Artist Alpha"
        assert artists[0]["track_count"] == 2
        assert artists[0]["album_count"] == 1
        assert artists[0]["artwork_url"] == "https://example.com/art1.jpg"

        assert artists[1]["name"] == "Artist Beta"
        assert artists[1]["track_count"] == 1


def test_get_artist_profile(mock_tracks):
    with patch("artist_album_service.scan_library", return_value=mock_tracks):
        profile = svc.get_artist_profile("Artist Alpha")
        assert profile is not None
        assert profile["name"] == "Artist Alpha"
        assert profile["track_count"] == 2
        assert profile["album_count"] == 1
        assert len(profile["albums"]) == 1
        assert profile["albums"][0]["name"] == "Album One"
        assert len(profile["albums"][0]["tracks"]) == 2


def test_get_all_albums(mock_tracks):
    with patch("artist_album_service.scan_library", return_value=mock_tracks):
        albums = svc.get_all_albums()
        assert len(albums) == 2
        assert albums[0]["name"] == "Album One"
        assert albums[0]["track_count"] == 2


def test_get_album_details(mock_tracks):
    with patch("artist_album_service.scan_library", return_value=mock_tracks):
        alb = svc.get_album_details("Album One")
        assert alb is not None
        assert alb["name"] == "Album One"
        assert alb["artist"] == "Artist Alpha"
        assert len(alb["tracks"]) == 2
