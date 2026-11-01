/**
 * static/connect.js — Linus Connect Client Hub
 * 
 * Enables seamless cross-device playback synchronization and remote control:
 *   - Device discovery and presence heartbeat
 *   - Remote playback commands (play, pause, next, prev, seek, volume)
 *   - Synchronized Now Playing state
 */

(function() {
  'use strict';

  // 1. Device Identification
  let deviceId = localStorage.getItem('linus_connect_device_id');
  if (!deviceId) {
    deviceId = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem('linus_connect_device_id', deviceId);
  }

  function getDeviceType() {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'mobile';
    if (/iPad|iPhone|iPod/.test(ua)) return 'mobile';
    return 'web';
  }

  function getDeviceDefaultName() {
    const isMobile = getDeviceType() === 'mobile';
    if (isMobile) return 'Mobile Phone';
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isWin = navigator.platform.toUpperCase().indexOf('WIN') >= 0;
    const osName = isWin ? 'Windows' : (isMac ? 'Mac' : 'Computer');
    return `Web Player (${osName})`;
  }

  let deviceName = localStorage.getItem('linus_connect_device_name') || getDeviceDefaultName();

  // State flags
  let isLocalActivePlayer = true;
  let remoteTargetDeviceId = null;
  let lastAckCmdId = null;
  let pollIntervalId = null;
  let heartbeatIntervalId = null;

  // 2. Heartbeat Ping
  async function sendHeartbeat() {
    try {
      const audioEl = document.getElementById('audio');
      const isPlaying = audioEl && !audioEl.paused && Boolean(audioEl.src);
      
      const res = await fetch('/api/connect/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          name: deviceName,
          type: getDeviceType(),
          is_active_player: isLocalActivePlayer && isPlaying,
        })
      });
      return await res.json();
    } catch (e) {
      // Quiet fail
      return null;
    }
  }

  // 3. Broadcast State
  let _lastBroadcastTime = 0;
  async function broadcastState(force = false) {
    const now = Date.now();
    if (!force && (now - _lastBroadcastTime < 2500)) return;
    _lastBroadcastTime = now;

    if (!isLocalActivePlayer) return;

    const audioEl = document.getElementById('audio');
    if (!audioEl) return;

    let track = null;
    if (typeof getActivePlaybackTrack === 'function') {
      track = getActivePlaybackTrack();
    } else if (typeof window.queue !== 'undefined' && typeof window.currentIndex !== 'undefined') {
      track = window.queue[window.currentIndex];
    }

    try {
      await fetch('/api/connect/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          device_id: deviceId,
          is_playing: !audioEl.paused && Boolean(audioEl.src),
          position: audioEl.currentTime || 0,
          duration: audioEl.duration || 0,
          volume: audioEl.volume !== undefined ? audioEl.volume : 1.0,
          queue_count: (window.queue ? window.queue.length : 0),
          track: track ? {
            id: track.id,
            title: track.title,
            artist: track.artist,
            artwork_url: track.artwork_url,
            duration: track.duration,
            is_online: track.is_online,
            video_id: track.video_id
          } : null
        })
      });
    } catch (e) {}
  }

  // 4. Command Poller
  async function pollCommands() {
    try {
      const url = `/api/connect/poll?device_id=${encodeURIComponent(deviceId)}${lastAckCmdId ? '&ack_cmd_id=' + encodeURIComponent(lastAckCmdId) : ''}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const cmds = data.commands || [];

      for (const cmd of cmds) {
        lastAckCmdId = cmd.cmd_id;
        handleIncomingCommand(cmd);
      }
    } catch (e) {}
  }

  function handleIncomingCommand(cmd) {
    const audioEl = document.getElementById('audio');
    if (!audioEl) return;

    const action = cmd.action;
    const payload = cmd.payload || {};

    switch (action) {
      case 'play':
        if (audioEl.paused) {
          const playBtn = document.getElementById('play');
          if (playBtn) playBtn.click();
          else audioEl.play().catch(() => {});
        }
        break;
      case 'pause':
        if (!audioEl.paused) {
          const playBtn = document.getElementById('play');
          if (playBtn) playBtn.click();
          else audioEl.pause();
        }
        break;
      case 'toggle':
        const playBtn = document.getElementById('play');
        if (playBtn) playBtn.click();
        else if (audioEl.paused) audioEl.play().catch(() => {});
        else audioEl.pause();
        break;
      case 'next':
        document.getElementById('next')?.click();
        break;
      case 'prev':
        document.getElementById('previous')?.click();
        break;
      case 'seek':
        if (typeof payload.position === 'number') {
          audioEl.currentTime = payload.position;
          broadcastState(true);
        }
        break;
      case 'volume':
        if (typeof payload.volume === 'number') {
          if (typeof window.updateVolumeUI === 'function') {
            window.updateVolumeUI(payload.volume);
          }
          audioEl.volume = payload.volume;
        }
        break;
    }
  }

  // 5. Send Remote Command
  async function sendRemoteCommand(action, payload = {}) {
    try {
      const res = await fetch('/api/connect/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_device_id: deviceId,
          target_device_id: remoteTargetDeviceId,
          action: action,
          payload: payload,
        })
      });
      return await res.json();
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // 6. Connect Devices Modal UI
  async function renderDevicesModal() {
    const listEl = document.getElementById('connect-devices-list');
    const curNameEl = document.getElementById('connect-current-name');
    const curStatusEl = document.getElementById('connect-current-status');
    const curSubEl = document.getElementById('connect-current-sub');
    const curIconEl = document.getElementById('connect-current-icon');
    const remoteDock = document.getElementById('connect-remote-dock');

    if (curNameEl) curNameEl.textContent = deviceName;

    if (!listEl) return;
    listEl.innerHTML = `
      <div style="padding:16px;text-align:center;color:var(--text-muted);">
        <i class="ph ph-spinner-gap spinning" style="font-size:20px;margin-bottom:6px;display:block;"></i>
        <span>Scanning network...</span>
      </div>
    `;

    try {
      const res = await fetch('/api/connect/devices');
      const data = await res.json();
      const devices = data.devices || [];

      // Update current device card
      const myDev = devices.find(d => d.device_id === deviceId);
      if (myDev && myDev.is_active_player) {
        isLocalActivePlayer = true;
        remoteTargetDeviceId = null;
        if (curStatusEl) {
          curStatusEl.className = 'norm-status-pill on';
          curStatusEl.textContent = 'Active Player';
        }
        if (curSubEl) curSubEl.textContent = 'Audio output is playing here';
        if (curIconEl) curIconEl.className = 'ph-fill ph-speaker-high';
        if (remoteDock) remoteDock.style.display = 'none';
      } else {
        const activeDev = devices.find(d => d.is_active_player);
        if (activeDev) {
          remoteTargetDeviceId = activeDev.device_id;
          if (curStatusEl) {
            curStatusEl.className = 'norm-status-pill off';
            curStatusEl.textContent = 'Remote Controller';
          }
          if (curSubEl) curSubEl.textContent = `Controlling: ${activeDev.name}`;
          if (curIconEl) curIconEl.className = 'ph-bold ph-device-mobile';
          if (remoteDock) remoteDock.style.display = 'block';
        }
      }

      const otherDevices = devices.filter(d => d.device_id !== deviceId);

      if (!otherDevices.length) {
        listEl.innerHTML = `
          <div style="padding:16px;text-align:center;color:var(--text-muted);font-size:12.5px;background:rgba(255,255,255,0.02);border-radius:10px;">
            <i class="ph-bold ph-broadcast" style="font-size:24px;opacity:0.4;margin-bottom:6px;display:block;"></i>
            <strong>No other devices found right now</strong>
            <p style="margin:4px 0 0;font-size:11.5px;">Open Linus on another computer or your phone on the same Wi-Fi network to connect.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = otherDevices.map(d => {
        const isTarget = d.device_id === remoteTargetDeviceId;
        const icon = d.type === 'mobile' ? 'ph-device-mobile' : 'ph-desktop';
        return `
          <div class="connect-device-item" data-id="${d.device_id}" style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid ${isTarget ? 'var(--accent)' : 'var(--border)'};cursor:pointer;transition:all 0.2s ease;">
            <div style="display:flex;align-items:center;gap:10px;">
              <i class="ph-bold ${icon}" style="font-size:20px;color:${d.is_active_player ? 'var(--accent)' : 'var(--text-muted)'};"></i>
              <div style="display:flex;flex-direction:column;">
                <strong style="font-size:13px;color:var(--text);">${d.name}</strong>
                <span style="font-size:11px;color:var(--text-muted);">${d.is_active_player ? 'Currently Playing' : 'Idle'}</span>
              </div>
            </div>
            <button type="button" class="btn-secondary" style="padding:4px 10px;font-size:11px;">
              ${d.is_active_player ? '<i class="ph-bold ph-sliders"></i> Control' : '<i class="ph ph-broadcast"></i> Cast to here'}
            </button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.connect-device-item').forEach(item => {
        item.addEventListener('click', async () => {
          const targetId = item.dataset.id;
          remoteTargetDeviceId = targetId;
          const targetDev = otherDevices.find(d => d.device_id === targetId);
          if (targetDev) {
            if (typeof notify === 'function') notify(`Connected to ${targetDev.name}`);
            renderDevicesModal();
          }
        });
      });

    } catch (e) {
      listEl.innerHTML = `<p class="muted" style="font-size:12px;text-align:center;">Failed to load devices.</p>`;
    }
  }

  function openConnectModal() {
    const sheet = document.getElementById('connect-devices-sheet');
    if (!sheet) return;
    renderDevicesModal();
    sheet.showModal();
  }

  // 7. Initialization
  document.addEventListener('DOMContentLoaded', () => {
    sendHeartbeat();
    heartbeatIntervalId = setInterval(sendHeartbeat, 25000);
    pollIntervalId = setInterval(pollCommands, 2500);

    // Audio element hookups
    const audioEl = document.getElementById('audio');
    if (audioEl) {
      audioEl.addEventListener('play', () => broadcastState(true));
      audioEl.addEventListener('pause', () => broadcastState(true));
      audioEl.addEventListener('seeked', () => broadcastState(true));
      audioEl.addEventListener('timeupdate', () => broadcastState(false));
      audioEl.addEventListener('volumechange', () => broadcastState(false));
    }

    // Modal buttons
    document.getElementById('connect-devices-btn')?.addEventListener('click', openConnectModal);
    document.getElementById('connect-devices-bar-btn')?.addEventListener('click', openConnectModal);
    document.getElementById('connect-modal-close')?.addEventListener('click', () => {
      document.getElementById('connect-devices-sheet')?.close();
    });
    document.getElementById('connect-modal-done')?.addEventListener('click', () => {
      document.getElementById('connect-devices-sheet')?.close();
    });
    document.getElementById('connect-refresh-btn')?.addEventListener('click', renderDevicesModal);

    // Rename button
    document.getElementById('connect-rename-btn')?.addEventListener('click', () => {
      const newName = prompt('Enter a name for this device:', deviceName);
      if (newName && newName.trim()) {
        deviceName = newName.trim();
        localStorage.setItem('linus_connect_device_name', deviceName);
        sendHeartbeat();
        renderDevicesModal();
      }
    });

    // Remote dock actions
    document.getElementById('connect-remote-play')?.addEventListener('click', () => sendRemoteCommand('toggle'));
    document.getElementById('connect-remote-next')?.addEventListener('click', () => sendRemoteCommand('next'));
    document.getElementById('connect-remote-prev')?.addEventListener('click', () => sendRemoteCommand('prev'));
    document.getElementById('connect-takeover-btn')?.addEventListener('click', async () => {
      // Pause remote and play locally
      await sendRemoteCommand('pause');
      isLocalActivePlayer = true;
      remoteTargetDeviceId = null;
      sendHeartbeat();
      renderDevicesModal();
      document.getElementById('play')?.click();
      if (typeof notify === 'function') notify('Playback transferred to this device');
    });
  });

  // Export
  window.LinusConnect = {
    getDeviceId: () => deviceId,
    getDeviceName: () => deviceName,
    openModal: openConnectModal,
    sendCommand: sendRemoteCommand,
  };
})();
