import json
from pathlib import Path
import pytest
from web_app import app


@pytest.fixture
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_scan_wallpaper_folder_missing_param(client):
    res = client.post("/api/wallpaper/scan-local-folder", json={})
    assert res.status_code == 400
    data = res.get_json()
    assert "required" in data.get("error", "").lower()


def test_scan_wallpaper_folder_nonexistent(client, tmp_path):
    missing_dir = str(tmp_path / "does_not_exist_dir")
    res = client.post("/api/wallpaper/scan-local-folder", json={"folder_path": missing_dir})
    assert res.status_code == 404
    data = res.get_json()
    assert "not found" in data.get("error", "").lower()


def test_scan_wallpaper_folder_empty(client, tmp_path):
    empty_dir = tmp_path / "empty_wallpapers"
    empty_dir.mkdir()
    res = client.post("/api/wallpaper/scan-local-folder", json={"folder_path": str(empty_dir)})
    assert res.status_code == 404
    data = res.get_json()
    assert "no image files" in data.get("error", "").lower()


def test_scan_wallpaper_folder_with_images(client, tmp_path):
    wp_dir = tmp_path / "my_wallpapers"
    wp_dir.mkdir()

    # Create dummy image files
    img1 = wp_dir / "wallpaper1.jpg"
    img1.write_bytes(b"\xff\xd8\xff\xe0" + b"\x00" * 32)
    img2 = wp_dir / "wallpaper2.png"
    img2.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 32)
    non_img = wp_dir / "notes.txt"
    non_img.write_text("not an image")

    res = client.post("/api/wallpaper/scan-local-folder", json={"folder_path": str(wp_dir)})
    assert res.status_code == 200
    data = res.get_json()
    assert data["status"] == "success"
    assert data["count"] == 2
    assert data["folder_name"] == "my_wallpapers"
    assert len(data["images"]) == 2

    names = [img["name"] for img in data["images"]]
    assert "wallpaper1.jpg" in names
    assert "wallpaper2.png" in names
    assert "notes.txt" not in names


def test_get_local_wallpaper_file(client, tmp_path):
    img = tmp_path / "sample.jpg"
    content = b"\xff\xd8\xff\xe0fake_jpeg_bytes"
    img.write_bytes(content)

    # Valid fetch
    res = client.get(f"/api/wallpaper/local-file?path={img}")
    assert res.status_code == 200
    assert res.data == content
    assert "image/jpeg" in res.content_type

    # Missing path
    res = client.get("/api/wallpaper/local-file")
    assert res.status_code == 400

    # Non-existent file
    res = client.get(f"/api/wallpaper/local-file?path={tmp_path / 'ghost.jpg'}")
    assert res.status_code == 404

    # Invalid extension
    txt_file = tmp_path / "danger.exe"
    txt_file.write_bytes(b"bad")
    res = client.get(f"/api/wallpaper/local-file?path={txt_file}")
    assert res.status_code == 400
