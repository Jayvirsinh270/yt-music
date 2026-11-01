"""
tests/test_connect_service.py — Unit tests for Linus Connect cross-device sync hub
"""

import time
import pytest
import connect_service as cs


@pytest.fixture(autouse=True)
def clean_connect_state():
    with cs._LOCK:
        cs._devices.clear()
        cs._pending_commands.clear()
        cs._playback_state.update({
            "device_id": None,
            "device_name": "No device active",
            "track": None,
            "is_playing": False,
            "position": 0.0,
            "duration": 0.0,
            "volume": 1.0,
            "queue_count": 0,
            "updated_at": 0.0,
            "seq": 0,
        })
    yield


def test_heartbeat_and_active_devices():
    dev = cs.register_heartbeat("dev_1", name="Living Room Web", device_type="web", is_active_player=True)
    assert dev["device_id"] == "dev_1"
    assert dev["name"] == "Living Room Web"
    assert dev["is_active_player"] is True

    devices = cs.get_active_devices()
    assert len(devices) == 1
    assert devices[0]["device_id"] == "dev_1"


def test_playback_state_update_and_estimation():
    cs.register_heartbeat("dev_1", name="Desktop", device_type="web", is_active_player=True)
    
    track_info = {"id": "song_1", "title": "Golden Hour", "artist": "JVKE", "duration": 210.0}
    state = cs.update_playback_state("dev_1", {
        "track": track_info,
        "is_playing": True,
        "position": 30.0,
        "duration": 210.0,
        "volume": 0.8,
    })

    assert state["device_id"] == "dev_1"
    assert state["is_playing"] is True
    assert state["position"] == 30.0
    assert state["track"]["title"] == "Golden Hour"

    cur_state = cs.get_playback_state()
    assert cur_state["estimated_position"] >= 30.0


def test_command_dispatch_and_retrieval():
    cs.register_heartbeat("phone", name="Android Phone", device_type="mobile", is_active_player=False)
    cs.register_heartbeat("desktop", name="Desktop Web", device_type="web", is_active_player=True)
    
    # Update state so desktop is recognized as active
    cs.update_playback_state("desktop", {"is_playing": True, "position": 10.0})

    # Phone sends 'pause' to active device without specifying target
    res = cs.send_command("phone", None, "pause")
    assert res["success"] is True
    assert res["target_device_id"] == "desktop"

    # Desktop polls for commands
    cmds = cs.get_pending_commands("desktop")
    assert len(cmds) == 1
    assert cmds[0]["action"] == "pause"
    assert cmds[0]["source_device_id"] == "phone"

    # Second poll should be empty since previous was popped
    assert len(cs.get_pending_commands("desktop")) == 0


def test_prune_expired_devices():
    cs.register_heartbeat("old_dev", name="Ghost", device_type="web")
    with cs._LOCK:
        # Manually backdate last_seen
        cs._devices["old_dev"]["last_seen"] = time.time() - 100

    devices = cs.get_active_devices()
    assert len(devices) == 0


def test_connect_api_endpoints():
    from web_app import app
    client = app.test_client()

    # 1. Heartbeat
    res = client.post("/api/connect/heartbeat", json={
        "device_id": "test_client",
        "name": "Test Browser",
        "type": "web",
        "is_active_player": True,
    })
    assert res.status_code == 200
    data = res.get_json()
    assert data["success"] is True

    # 2. Get Devices
    res = client.get("/api/connect/devices")
    assert res.status_code == 200
    devices = res.get_json()["devices"]
    assert any(d["device_id"] == "test_client" for d in devices)

    # 3. Update State
    res = client.post("/api/connect/state", json={
        "device_id": "test_client",
        "track": {"title": "Test Track"},
        "is_playing": True,
        "position": 42.0,
    })
    assert res.status_code == 200

    # 4. Get State
    res = client.get("/api/connect/state")
    assert res.status_code == 200
    state = res.get_json()
    assert state["device_id"] == "test_client"
    assert state["track"]["title"] == "Test Track"

    # 5. Remote Command
    res = client.post("/api/connect/command", json={
        "source_device_id": "remote_controller",
        "target_device_id": "test_client",
        "action": "toggle",
    })
    assert res.status_code == 200
    assert res.get_json()["success"] is True

    # 6. Poll Commands
    res = client.get("/api/connect/poll?device_id=test_client")
    assert res.status_code == 200
    poll_data = res.get_json()
    assert len(poll_data["commands"]) == 1
    assert poll_data["commands"][0]["action"] == "toggle"

