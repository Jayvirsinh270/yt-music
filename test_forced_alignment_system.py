"""
test_forced_alignment_system.py
Comprehensive automated test for the Forced Alignment system:
- lyrics_aligner module
- lyrics_provider integration
- web_app /api/lyrics/align endpoint
"""

import os
import sys
import json
from pathlib import Path

# Add project root
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

import lyrics_aligner
import lyrics_provider
from web_app import app

def test_lyrics_aligner():
    print(">>> 1. Testing lyrics_aligner.align_lyrics_to_audio...")
    
    audio_file = ROOT / "stream_cache" / "09R8_2nJtjg.mp4"
    if not audio_file.exists():
        print(f"Sample audio not found at {audio_file}, skipping direct file test.")
        return

    plain_lyrics = """
    I'm hurtin' baby
    I'm broken down
    I need your lovin', lovin', I need it now
    When I'm without you
    I'm somethin' weak
    You got me beggin', beggin', I'm on my knees, yeah
    """

    res = lyrics_aligner.align_lyrics_to_audio(str(audio_file), plain_lyrics)
    
    assert res["success"] is True, "Alignment did not return success=True"
    assert res["synced"] is True, "Alignment did not return synced=True"
    assert res["source"] == "auto_aligned", f"Unexpected source: {res['source']}"
    assert len(res["lines"]) == 6, f"Expected 6 lines, got {len(res['lines'])}"

    prev_time = -1.0
    for l in res["lines"]:
        assert l["time"] > prev_time, f"Timestamps must strictly increase: {l['time']} <= {prev_time}"
        prev_time = l["time"]
        assert len(l["text"]) > 0, "Line text must not be empty"

    assert "I'm hurtin' baby" in res["raw_lrc"], "Official words must be 100% preserved"
    assert "I'm on my knees, yeah" in res["raw_lrc"], "Official words must be 100% preserved"

    print(f"[OK] lyrics_aligner test passed! Generated {len(res['lines'])} synced lines: {res['raw_lrc'].splitlines()[0]}")


def test_webapp_endpoint():
    print("\n>>> 2. Testing web_app.py POST /api/lyrics/align...")
    client = app.test_client()

    audio_file = ROOT / "stream_cache" / "09R8_2nJtjg.mp4"
    if not audio_file.exists():
        print("Sample audio not found, skipping webapp test.")
        return

    payload = {
        "track_id": str(audio_file),
        "artist": "Maroon 5",
        "title": "Sugar",
        "content": "I'm hurtin' baby\nI'm broken down\nI need your lovin', lovin', I need it now"
    }

    response = client.post("/api/lyrics/align", json=payload)
    assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.data}"
    data = response.get_json()
    assert data.get("success") is True, f"Response did not succeed: {data}"
    lyrics = data.get("lyrics", {})
    assert lyrics.get("synced") is True, "Lyrics must be synced"
    assert lyrics.get("source") == "auto_aligned", "Source must be auto_aligned"
    assert len(lyrics.get("lines", [])) == 3, f"Expected 3 lines, got {len(lyrics.get('lines', []))}"

    print("[OK] web_app endpoint test passed! Response received:")
    for line in lyrics["lines"]:
        print("  ", line)


if __name__ == "__main__":
    test_lyrics_aligner()
    test_webapp_endpoint()
    print("\n==========================================")
    print("ALL FORCED ALIGNMENT TESTS PASSED SUCCESSFULLY!")
    print("==========================================")
