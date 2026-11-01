// ============================================================
// Linus — Discord Rich Presence (RPC) Frontend Subsystem
// Optimized Song-Start Connection Check & Minimal API Overhead
// ============================================================

(function () {
  'use strict';

  const STORAGE_KEY = 'linus_discord_rpc_enabled';
  let isEnabled = localStorage.getItem(STORAGE_KEY) !== 'false';
  let currentTrackId = null;
  let discordAvailableForCurrentTrack = null; // null: untried, true: connected, false: unavailable
  let isSending = false;

  async function checkAndUpdateRPC(track, isPlaying, currentTime) {
    if (!isEnabled || !track || isSending) return;

    const trackId = track.id || track.title;

    // Detect if this is a new track or skipped track
    if (trackId !== currentTrackId) {
      currentTrackId = trackId;
      discordAvailableForCurrentTrack = null; // reset for the new track
    }

    // If we already attempted Discord for this track and it was not available,
    // do NOT make any further API calls until this track finishes or user skips!
    if (discordAvailableForCurrentTrack === false) {
      return;
    }

    const payload = {
      title: track.title || 'Unknown Track',
      artist: track.artist || 'Unknown Artist',
      album: track.album || 'Linus Collection',
      duration: Number(track.duration || 0),
      current_time: Number(currentTime || 0),
      is_playing: Boolean(isPlaying),
      artwork_url: track.artwork_url || '',
      source_url: track.url && track.url.startsWith('http') ? track.url : ''
    };

    isSending = true;
    try {
      const resp = await fetch('/api/discord-rpc/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await resp.json();
      discordAvailableForCurrentTrack = Boolean(data && data.connected);
    } catch (e) {
      // Failed to reach server or Discord offline: mark unavailable for this track
      discordAvailableForCurrentTrack = false;
    } finally {
      isSending = false;
    }
  }

  async function clearRPC() {
    currentTrackId = null;
    discordAvailableForCurrentTrack = null;
    try {
      await fetch('/api/discord-rpc/clear', { method: 'POST' });
    } catch (e) {}
  }

  async function toggleRPC(forceState) {
    const target = forceState !== undefined ? Boolean(forceState) : !isEnabled;
    isEnabled = target;
    localStorage.setItem(STORAGE_KEY, isEnabled ? 'true' : 'false');

    try {
      const res = await fetch('/api/discord-rpc/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: isEnabled })
      }).then(r => r.json());

      const statusText = isEnabled ? 'Enabled' : 'Disabled';
      window.showToast?.(`🎮 Discord Rich Presence: ${statusText}`);

      if (!isEnabled) {
        clearRPC();
      } else {
        // Reset current track check so it attempts immediately on toggle
        discordAvailableForCurrentTrack = null;
        syncCurrentPlayback();
      }
      return res;
    } catch (e) {
      window.showToast?.(`Discord RPC: ${isEnabled ? 'Enabled' : 'Disabled'}`);
    }
  }

  function getCurrentTrack() {
    if (typeof queue !== 'undefined' && typeof currentIndex !== 'undefined' && queue[currentIndex]) {
      return queue[currentIndex];
    }
    const titleEl = document.querySelector('#now-title');
    const artistEl = document.querySelector('#now-artist');
    if (titleEl && titleEl.textContent && titleEl.textContent !== 'No track playing') {
      return {
        title: titleEl.textContent.trim(),
        artist: artistEl ? artistEl.textContent.trim() : 'Unknown Artist',
        album: 'Linus Audio',
        duration: window.audio?.duration || 0
      };
    }
    return null;
  }

  function syncCurrentPlayback() {
    if (!isEnabled) return;
    const track = getCurrentTrack();
    if (!track) {
      clearRPC();
      return;
    }

    const audioEl = window.audio || document.querySelector('#audio');
    const isPlaying = audioEl ? !audioEl.paused : false;
    const currentTime = audioEl ? audioEl.currentTime : 0;

    checkAndUpdateRPC(track, isPlaying, currentTime);
  }

  // Setup audio lifecycle hooks — ONLY triggers on track start, play/pause, or track end
  function initListeners() {
    const audioEl = document.querySelector('#audio');
    if (audioEl) {
      audioEl.addEventListener('play', () => syncCurrentPlayback());
      audioEl.addEventListener('ended', () => {
        // Song completed: reset track marker and clear presence
        currentTrackId = null;
        discordAvailableForCurrentTrack = null;
        clearRPC();
      });
      // Pause: only update if Discord is actually connected
      audioEl.addEventListener('pause', () => {
        if (discordAvailableForCurrentTrack === true) {
          syncCurrentPlayback();
        }
      });
    }

    // Deck B listener if auto-DJ is active
    const audioDeckB = document.querySelector('#audio-deck-b');
    if (audioDeckB) {
      audioDeckB.addEventListener('play', () => syncCurrentPlayback());
      audioDeckB.addEventListener('ended', () => {
        currentTrackId = null;
        discordAvailableForCurrentTrack = null;
        clearRPC();
      });
      audioDeckB.addEventListener('pause', () => {
        if (discordAvailableForCurrentTrack === true) {
          syncCurrentPlayback();
        }
      });
    }

    // Clear RPC on page close / unload
    window.addEventListener('beforeunload', () => {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/discord-rpc/clear');
      } else {
        clearRPC();
      }
    });
  }

  // Initialize once DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initListeners);
  } else {
    initListeners();
  }

  // Global API
  window.DiscordRPC = {
    isEnabled: () => isEnabled,
    toggleRPC,
    clearRPC,
    syncCurrentPlayback,
    onTrackChange: () => {
      // Called on explicit next/prev track skip
      currentTrackId = null;
      discordAvailableForCurrentTrack = null;
      syncCurrentPlayback();
    }
  };

})();
