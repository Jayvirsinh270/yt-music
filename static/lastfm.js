/**
 * lastfm.js — Last.fm Scrobbling Client Integration
 */

window.LinusLastFM = (() => {
  let _status = { connected: false, username: '', configured: false };
  let _currentTrack = null;
  let _scrobbled = false;

  async function fetchStatus() {
    try {
      const resp = await fetch('/api/lastfm/status');
      _status = await resp.json();
      return _status;
    } catch (e) {
      return _status;
    }
  }

  async function onTrackStart(track) {
    _currentTrack = track;
    _scrobbled = false;
    if (!_status.connected) return;

    try {
      await fetch('/api/lastfm/now-playing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: track.title || '',
          artist: track.artist || '',
          album: track.album || '',
          duration: Math.round(track.duration || 0),
        }),
      });
    } catch (e) {}
  }

  async function onTimeUpdate(currentTime, duration) {
    if (_scrobbled || !_currentTrack || !_status.connected) return;
    if (!duration || duration < 30) return;

    const threshold = Math.min(duration * 0.5, 240);
    if (currentTime >= threshold) {
      _scrobbled = true;
      try {
        await fetch('/api/lastfm/scrobble', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: _currentTrack.title || '',
            artist: _currentTrack.artist || '',
            album: _currentTrack.album || '',
            duration: Math.round(duration),
            timestamp: Math.floor(Date.now() / 1000),
          }),
        });
      } catch (e) {
        _scrobbled = false;
      }
    }
  }

  async function startAuth() {
    const resp = await fetch('/api/lastfm/auth-url');
    const data = await resp.json();
    if (data.error) {
      alert('Last.fm: ' + data.error);
      return;
    }
    window.open(data.auth_url, '_blank');
    const token = prompt('Authorize Linus on Last.fm, then paste the token parameter here:');
    if (!token) return;

    const connectResp = await fetch('/api/lastfm/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token.trim() }),
    });
    const result = await connectResp.json();
    if (result.error) {
      alert('Last.fm Error: ' + result.error);
      return;
    }
    alert('Connected to Last.fm as ' + result.username);
    await fetchStatus();
  }

  document.addEventListener('DOMContentLoaded', () => {
    fetchStatus();
  });

  return { fetchStatus, onTrackStart, onTimeUpdate, startAuth, getStatus: () => _status };
})();
