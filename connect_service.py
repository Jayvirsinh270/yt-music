"""
connect_service.py — Linus Connect Protocol & Cross-Device State Hub

Provides real-time synchronization and remote-control between Linus clients
(desktop browser, mobile phone, smart speaker / kiosk mode):
  - Device discovery and presence tracking (with heartbeat TTL)
  - Authoritative playback state synchronization (now playing, progress, volume)
  - Remote command dispatch (play, pause, next, prev, seek, volume, set_track)
  - Zero external broker required (runs seamlessly inside standard Python/Flask)
"""

import time
import uuid
import threading
from typing import Any, Optional


_LOCK = threading.RLock()
_DEVICE_TTL_SECONDS = 60.0

# Registry of connected devices: device_id -> dict
_devices: dict[str, dict[str, Any]] = {}

# Current authoritative playback state
_playback_state: dict[str, Any] = {
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
}

# Pending commands: device_id -> list of command dicts
_pending_commands: dict[str, list[dict[str, Any]]] = {}


def register_heartbeat(
    device_id: str,
    name: str = "",
    device_type: str = "web",
    is_active_player: bool = False,
    ip_addr: str = "",
) -> dict[str, Any]:
    """Registers or updates a device's heartbeat and presence."""
    if not device_id:
        device_id = str(uuid.uuid4())

    now = time.time()
    clean_name = name.strip() or ("Mobile Device" if device_type == "mobile" else "Web Player")

    with _LOCK:
        _prune_expired_devices()

        device = _devices.get(device_id, {})
        device.update({
            "device_id": device_id,
            "name": clean_name,
            "type": device_type,
            "is_active_player": bool(is_active_player),
            "ip_addr": ip_addr,
            "last_seen": now,
        })
        _devices[device_id] = device

        if device_id not in _pending_commands:
            _pending_commands[device_id] = []

        return device.copy()


def get_active_devices() -> list[dict[str, Any]]:
    """Returns a list of all currently active connected devices."""
    with _LOCK:
        _prune_expired_devices()
        return [d.copy() for d in _devices.values()]


def update_playback_state(device_id: str, state_data: dict[str, Any]) -> dict[str, Any]:
    """Updates the global authoritative playback state from an active player device."""
    now = time.time()
    with _LOCK:
        device = _devices.get(device_id)
        device_name = device["name"] if device else "Remote Device"

        # Mark this device as the active player
        for dev in _devices.values():
            dev["is_active_player"] = (dev["device_id"] == device_id)

        _playback_state["device_id"] = device_id
        _playback_state["device_name"] = device_name
        _playback_state["seq"] += 1
        _playback_state["updated_at"] = now

        if "track" in state_data:
            _playback_state["track"] = state_data["track"]
        if "is_playing" in state_data:
            _playback_state["is_playing"] = bool(state_data["is_playing"])
        if "position" in state_data:
            _playback_state["position"] = float(state_data["position"] or 0.0)
        if "duration" in state_data:
            _playback_state["duration"] = float(state_data["duration"] or 0.0)
        if "volume" in state_data:
            _playback_state["volume"] = float(state_data["volume"] if state_data["volume"] is not None else 1.0)
        if "queue_count" in state_data:
            _playback_state["queue_count"] = int(state_data["queue_count"] or 0)

        return _playback_state.copy()


def get_playback_state() -> dict[str, Any]:
    """Returns the current playback state and estimated current play position."""
    with _LOCK:
        st = _playback_state.copy()
        # Calculate optimistic extrapolated position if playing
        if st.get("is_playing") and st.get("updated_at") and st.get("duration", 0) > 0:
            elapsed = time.time() - st["updated_at"]
            est_pos = min(st["duration"], st["position"] + elapsed)
            st["estimated_position"] = est_pos
        else:
            st["estimated_position"] = st.get("position", 0.0)
        return st


def send_command(
    source_device_id: str,
    target_device_id: Optional[str],
    action: str,
    payload: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    """
    Sends a playback control command to a target device (or to the active player device if target is None).
    Actions: 'play', 'pause', 'toggle', 'next', 'prev', 'seek', 'volume', 'set_track'
    """
    with _LOCK:
        # If target device is not specified, direct command to active player device
        if not target_device_id:
            target_device_id = _playback_state.get("device_id")
            if not target_device_id:
                # Fallback to any active device that isn't the sender
                active_devs = [d for d in _devices.values() if d["device_id"] != source_device_id]
                if active_devs:
                    target_device_id = active_devs[0]["device_id"]

        if not target_device_id:
            return {"success": False, "error": "No active playback device found."}

        cmd_id = str(uuid.uuid4())
        cmd = {
            "cmd_id": cmd_id,
            "source_device_id": source_device_id,
            "target_device_id": target_device_id,
            "action": action,
            "payload": payload or {},
            "timestamp": time.time(),
        }

        if target_device_id not in _pending_commands:
            _pending_commands[target_device_id] = []

        # Keep queue capped to last 20 commands per device
        _pending_commands[target_device_id].append(cmd)
        if len(_pending_commands[target_device_id]) > 20:
            _pending_commands[target_device_id] = _pending_commands[target_device_id][-20:]

        return {"success": True, "cmd_id": cmd_id, "target_device_id": target_device_id}


def get_pending_commands(device_id: str, ack_cmd_id: Optional[str] = None) -> list[dict[str, Any]]:
    """
    Retrieves and clears pending commands for a specific device.
    If ack_cmd_id is provided, removes commands up to and including that command.
    """
    with _LOCK:
        cmds = _pending_commands.get(device_id, [])
        if not cmds:
            return []

        if ack_cmd_id:
            idx = -1
            for i, c in enumerate(cmds):
                if c["cmd_id"] == ack_cmd_id:
                    idx = i
                    break
            if idx >= 0:
                _pending_commands[device_id] = cmds[idx + 1:]
                cmds = _pending_commands[device_id]
        else:
            # Pop and return all pending
            _pending_commands[device_id] = []

        return cmds


def _prune_expired_devices():
    """Removes devices that haven't sent a heartbeat within _DEVICE_TTL_SECONDS."""
    now = time.time()
    expired = [d_id for d_id, d in _devices.items() if now - d.get("last_seen", 0) > _DEVICE_TTL_SECONDS]
    for d_id in expired:
        _devices.pop(d_id, None)
        _pending_commands.pop(d_id, None)

    # If active player was pruned, reset active player ID
    if _playback_state.get("device_id") in expired:
        _playback_state["device_id"] = None
        _playback_state["device_name"] = "No device active"
