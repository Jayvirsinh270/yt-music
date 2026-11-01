"""
discord_rpc.py — Discord Rich Presence (RPC) Integration for Linus Music Player
Zero external dependencies (pure Python named pipe / Unix domain socket IPC client).
Runs asynchronously in a background thread to ensure zero blocking on audio playback.
"""

import json
import logging
import os
import platform
import queue
import socket
import struct
import sys
import threading
import time
import uuid

logger = logging.getLogger("discord_rpc")

# Default registered client ID for Linus Music Player
DEFAULT_CLIENT_ID = "1219273418579808307"

OP_HANDSHAKE = 0
OP_FRAME = 1
OP_CLOSE = 2
OP_PING = 3
OP_PONG = 4


class DiscordRPCClient:
    def __init__(self, client_id: str = DEFAULT_CLIENT_ID):
        self.client_id = client_id
        self.pipe = None
        self.is_connected = False
        self.is_enabled = True
        self._running = False
        self._worker_thread = None
        self._queue = queue.Queue(maxsize=30)
        self._lock = threading.Lock()
        self._current_activity = None
        self._last_reconnect_attempt = 0
        self._reconnect_interval = 15.0  # seconds between connect attempts if Discord not open

    def start(self):
        """Starts the background worker thread."""
        with self._lock:
            if self._running:
                return
            self._running = True
            self._worker_thread = threading.Thread(target=self._run_loop, name="DiscordRPCWorker", daemon=True)
            self._worker_thread.start()
            logger.info("Discord RPC worker thread started.")

    def stop(self):
        """Stops the RPC worker thread and disconnects."""
        self._running = False
        self._queue.put(("STOP", None))
        self._disconnect()

    def set_enabled(self, enabled: bool):
        """Enable or disable Discord RPC."""
        self.is_enabled = bool(enabled)
        if not self.is_enabled:
            self.clear_activity()

    def get_status(self) -> dict:
        """Returns the current RPC connection status."""
        return {
            "enabled": self.is_enabled,
            "connected": self.is_connected,
            "has_activity": self._current_activity is not None,
        }

    def _open_pipe(self):
        """Attempts to open Discord IPC pipe."""
        if platform.system() == "Windows":
            for i in range(10):
                pipe_path = rf"\\.\pipe\discord-ipc-{i}"
                try:
                    # Windows named pipes can be opened via standard open in binary read/write mode
                    f = open(pipe_path, "rb+", buffering=0)
                    self.pipe = f
                    return True
                except (OSError, IOError):
                    continue
            return False
        else:
            # Unix / macOS socket
            env_vars = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
            base_dirs = [os.environ.get(v) for v in env_vars if os.environ.get(v)]
            base_dirs.extend(["/tmp", "/var/tmp"])
            for base_dir in base_dirs:
                if not base_dir or not os.path.isdir(base_dir):
                    continue
                for i in range(10):
                    sock_path = os.path.join(base_dir, f"discord-ipc-{i}")
                    if os.path.exists(sock_path):
                        try:
                            s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                            s.connect(sock_path)
                            self.pipe = s
                            return True
                        except (OSError, socket.error):
                            continue
            return False

    def _send(self, opcode: int, payload: dict) -> bool:
        """Sends an opcode and JSON payload to the Discord pipe."""
        if not self.pipe:
            return False
        try:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            header = struct.pack("<II", opcode, len(body))
            packet = header + body
            if hasattr(self.pipe, "write"):
                self.pipe.write(packet)
                self.pipe.flush()
            elif hasattr(self.pipe, "sendall"):
                self.pipe.sendall(packet)
            return True
        except Exception as err:
            logger.debug(f"Failed to send to Discord pipe: {err}")
            self._disconnect()
            return False

    def _receive(self) -> tuple[int, dict] | None:
        """Reads one response frame from Discord."""
        if not self.pipe:
            return None
        try:
            if hasattr(self.pipe, "read"):
                header = self.pipe.read(8)
            elif hasattr(self.pipe, "recv"):
                header = self.pipe.recv(8)
            else:
                return None

            if not header or len(header) < 8:
                return None

            opcode, length = struct.unpack("<II", header)
            data = b""
            while len(data) < length:
                chunk = (
                    self.pipe.read(length - len(data))
                    if hasattr(self.pipe, "read")
                    else self.pipe.recv(length - len(data))
                )
                if not chunk:
                    break
                data += chunk

            parsed = json.loads(data.decode("utf-8", errors="ignore"))
            return opcode, parsed
        except Exception:
            return None

    def _connect(self) -> bool:
        """Handshakes with Discord."""
        self._disconnect()
        if not self._open_pipe():
            return False

        # Send Opcode 0: Handshake
        handshake_data = {"v": 1, "client_id": self.client_id}
        if not self._send(OP_HANDSHAKE, handshake_data):
            self._disconnect()
            return False

        # Wait for READY evt
        resp = self._receive()
        if resp and resp[0] == OP_FRAME:
            body = resp[1]
            if body.get("evt") == "READY":
                self.is_connected = True
                logger.info("Connected to Discord Rich Presence via IPC.")
                return True
            elif body.get("evt") == "ERROR":
                logger.warning(f"Discord IPC Error: {body.get('data')}")

        self.is_connected = True
        return True

    def _disconnect(self):
        """Safely disconnects from IPC."""
        self.is_connected = False
        if self.pipe:
            try:
                if hasattr(self.pipe, "close"):
                    self.pipe.close()
            except Exception:
                pass
            self.pipe = None

    def ensure_connected(self) -> bool:
        """Immediately checks if connected, or attempts connection once if enabled."""
        if not self.is_enabled:
            return False
        if self.is_connected and self.pipe:
            return True
        try:
            return self._connect()
        except Exception:
            self.is_connected = False
            return False

    def update_activity(
        self,
        title: str,
        artist: str = "",
        album: str = "",
        duration: float = 0.0,
        current_time: float = 0.0,
        is_playing: bool = True,
        artwork_url: str = "",
        source_url: str = "",
    ):
        """Enqueues an activity update (non-blocking)."""
        if not self.is_enabled:
            return

        payload = {
            "title": str(title or "Unknown Track")[:128],
            "artist": str(artist or "Linus Music Player")[:128],
            "album": str(album or "Linus Audio")[:128],
            "duration": float(duration or 0.0),
            "current_time": float(current_time or 0.0),
            "is_playing": bool(is_playing),
            "artwork_url": str(artwork_url or ""),
            "source_url": str(source_url or ""),
        }
        try:
            # Drop older pending activity updates if queue is busy
            while not self._queue.empty():
                try:
                    self._queue.get_nowait()
                except queue.Empty:
                    break
            self._queue.put_nowait(("UPDATE", payload))
        except queue.Full:
            pass

    def clear_activity(self):
        """Enqueues clearing active presence."""
        try:
            self._queue.put_nowait(("CLEAR", None))
        except (queue.Full, Exception):
            pass

    def _build_activity_frame(self, data: dict) -> dict:
        """Constructs Discord SetActivity payload with timestamps and rich assets."""
        now = time.time()
        is_playing = data.get("is_playing", True)
        duration = data.get("duration", 0.0)
        curr = data.get("current_time", 0.0)

        activity = {
            "details": data.get("title", "Listening to Music"),
            "state": f"by {data.get('artist', 'Unknown')}",
            "assets": {
                "large_image": data.get("artwork_url") or "linus_logo",
                "large_text": data.get("album") or "Linus Music Player",
                "small_image": "play" if is_playing else "pause",
                "small_text": "Playing" if is_playing else "Paused",
            },
        }

        # Calculate live synced timeline if track is currently playing
        if is_playing and duration > 0:
            start_ts = int(now - max(0, curr))
            end_ts = int(start_ts + duration)
            activity["timestamps"] = {"start": start_ts, "end": end_ts}
        elif is_playing:
            activity["timestamps"] = {"start": int(now - max(0, curr))}

        # Optional action buttons (e.g. Listen Along / Explore link)
        source_url = data.get("source_url")
        if source_url and source_url.startswith("http"):
            activity["buttons"] = [
                {"label": "Listen on Linus / Web", "url": source_url[:512]}
            ]

        return {
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": os.getpid(),
                "activity": activity,
            },
            "nonce": str(uuid.uuid4()),
        }

    def _build_clear_frame(self) -> dict:
        return {
            "cmd": "SET_ACTIVITY",
            "args": {
                "pid": os.getpid(),
                "activity": None,
            },
            "nonce": str(uuid.uuid4()),
        }

    def _run_loop(self):
        """Background thread handling communication with Discord pipe."""
        while self._running:
            try:
                # 1. Check for commands with short timeout
                try:
                    cmd_type, payload = self._queue.get(timeout=1.0)
                except queue.Empty:
                    cmd_type, payload = None, None

                if cmd_type == "STOP":
                    break

                if not self.is_enabled:
                    if self.is_connected:
                        self._disconnect()
                    continue

                now = time.time()

                # 2. Reconnection check
                if not self.is_connected:
                    if now - self._last_reconnect_attempt >= self._reconnect_interval:
                        self._last_reconnect_attempt = now
                        self._connect()

                # 3. If connected and we have a command, send it
                if self.is_connected:
                    if cmd_type == "UPDATE" and payload:
                        frame = self._build_activity_frame(payload)
                        if self._send(OP_FRAME, frame):
                            self._current_activity = payload
                    elif cmd_type == "CLEAR":
                        frame = self._build_clear_frame()
                        if self._send(OP_FRAME, frame):
                            self._current_activity = None

            except Exception as e:
                logger.debug(f"Discord RPC loop error: {e}")
                self._disconnect()
                time.sleep(2.0)


# Global singleton instance
rpc = DiscordRPCClient()
