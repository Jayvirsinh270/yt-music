// ============================================================
// Linus — Acoustic Waveform Scrubber & Visual Timeline Engine
// High-fidelity dynamic audio amplitude bars, hover cue & seek
// ============================================================

(function() {
  const _peaksCache = new Map();
  let _activeTrack = null;
  let _hoverRatio = -1;
  let _fsHoverRatio = -1;

  function getAudioElement() {
    return window.audio || document.getElementById('audio');
  }

  function getActiveTrack() {
    if (_activeTrack) return _activeTrack;
    if (typeof window.getActivePlaybackTrack === 'function') {
      return window.getActivePlaybackTrack();
    }
    if (typeof queue !== 'undefined' && typeof currentIndex !== 'undefined' && queue[currentIndex]) {
      return queue[currentIndex];
    }
    return null;
  }

  function generateAcousticPeaks(track, count = 80) {
    if (!track) track = {};
    const key = `${track.id || track.video_id || track.title || 'default'}_${count}`;
    if (_peaksCache.has(key)) return _peaksCache.get(key);

    const title = track.title || 'Acoustic Track';
    const artist = track.artist || 'Linus Artist';
    const dur = track.duration || 180;

    let seed = 0;
    const str = `${title}:${artist}:${dur}`;
    for (let i = 0; i < str.length; i++) {
      seed = (seed * 31 + str.charCodeAt(i)) & 0xffffff;
    }

    function pseudoRandom() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    const peaks = [];
    for (let i = 0; i < count; i++) {
      const pos = i / (count - 1);
      let envelope = 0.35;
      if (pos < 0.12) {
        envelope = 0.22 + (pos / 0.12) * 0.38;
      } else if (pos < 0.38) {
        envelope = 0.44 + Math.sin((pos - 0.12) * 12) * 0.16;
      } else if (pos < 0.58) {
        envelope = 0.72 + Math.sin((pos - 0.38) * 15) * 0.22;
      } else if (pos < 0.68) {
        envelope = 0.36 + Math.cos((pos - 0.58) * 18) * 0.14;
      } else if (pos < 0.88) {
        envelope = 0.82 + Math.sin((pos - 0.68) * 16) * 0.18;
      } else {
        envelope = 0.65 * (1 - (pos - 0.88) / 0.12) + 0.18;
      }

      const noise = (pseudoRandom() * 0.36) - 0.18;
      const height = Math.max(0.14, Math.min(1.0, envelope + noise));
      peaks.push(height);
    }

    _peaksCache.set(key, peaks);
    return peaks;
  }

  function drawWaveform(canvas, peaks, playedRatio, hoverRatio = -1) {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;
    ctx.clearRect(0, 0, w, h);

    const count = peaks.length;
    const dpr = window.devicePixelRatio || 1;
    const barWidth = Math.max(2 * dpr, (w / count) * 0.58);
    const gap = (w - (count * barWidth)) / Math.max(1, count - 1);
    
    let accentColor = '#e5a95d';
    if (typeof getComputedStyle !== 'undefined') {
      const docStyle = getComputedStyle(document.documentElement);
      accentColor = docStyle.getPropertyValue('--accent').trim() || '#e5a95d';
    }

    for (let i = 0; i < count; i++) {
      const barRatio = i / (count - 1);
      const barH = Math.max(3.5 * dpr, peaks[i] * (h - 6 * dpr));
      const x = i * (barWidth + gap);
      const y = (h - barH) / 2;
      const radius = 1.2 * dpr;

      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, barWidth, barH, radius);
      } else {
        ctx.rect(x, y, barWidth, barH);
      }

      if (barRatio <= playedRatio) {
        ctx.fillStyle = accentColor;
        if (barRatio > playedRatio - 0.035 && barRatio <= playedRatio) {
          ctx.shadowColor = accentColor;
          ctx.shadowBlur = 8 * dpr;
          ctx.fill();
          ctx.shadowBlur = 0;
        } else {
          ctx.fill();
        }
      } else if (hoverRatio >= 0 && barRatio <= hoverRatio) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
        ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.fill();
      }
    }
  }

  function resizeCanvas(canvas) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const dpr = window.devicePixelRatio || 1;
      const targetW = Math.round(rect.width * dpr);
      const targetH = Math.round(rect.height * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
    }
  }

  function updateWaveformProgress(currentTime, duration) {
    const audio = getAudioElement();
    const cur = (typeof currentTime === 'number' && Number.isFinite(currentTime)) 
      ? currentTime 
      : (audio ? (audio.currentTime || 0) : 0);
    const dur = (typeof duration === 'number' && Number.isFinite(duration) && duration > 0)
      ? duration
      : (audio ? (audio.duration || 0) : 0);

    const ratio = dur > 0 ? Math.max(0, Math.min(1.0, cur / dur)) : 0;
    const track = getActiveTrack();

    // 1. Main player bar waveform
    const mainCanvas = document.getElementById('waveform-canvas');
    if (mainCanvas) {
      resizeCanvas(mainCanvas);
      const peaks = generateAcousticPeaks(track, 80);
      drawWaveform(mainCanvas, peaks, ratio, _hoverRatio);
    }

    // 2. Fullscreen player waveform
    const fsCanvas = document.getElementById('fs-waveform-canvas');
    if (fsCanvas) {
      resizeCanvas(fsCanvas);
      const fsPeaks = generateAcousticPeaks(track, 110);
      drawWaveform(fsCanvas, fsPeaks, ratio, _fsHoverRatio);
    }
  }

  function refreshTrackWaveform(track) {
    if (track) _activeTrack = track;
    const mainCanvas = document.getElementById('waveform-canvas');
    const fsCanvas = document.getElementById('fs-waveform-canvas');
    resizeCanvas(mainCanvas);
    resizeCanvas(fsCanvas);
    const audio = getAudioElement();
    const cur = audio ? (audio.currentTime || 0) : 0;
    const dur = (track && track.duration) || (audio ? (audio.duration || 0) : 0);
    updateWaveformProgress(cur, dur);
  }

  function initWaveformScrubber() {
    const wrap = document.getElementById('waveform-progress-wrap');
    const canvas = document.getElementById('waveform-canvas');
    const cue = document.getElementById('waveform-hover-cue');
    const cueTime = document.getElementById('waveform-hover-time');

    if (wrap && canvas) {
      resizeCanvas(canvas);
      window.addEventListener('resize', () => {
        resizeCanvas(canvas);
        const audio = getAudioElement();
        if (audio) updateWaveformProgress(audio.currentTime, audio.duration);
      });

      wrap.addEventListener('mousemove', (e) => {
        const rect = wrap.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pct = Math.max(0, Math.min(1.0, (e.clientX - rect.left) / rect.width));
        _hoverRatio = pct;

        if (cue && cueTime) {
          const audio = getAudioElement();
          const dur = audio ? (audio.duration || 0) : 0;
          const hoverSecs = pct * dur;
          const mins = Math.floor(hoverSecs / 60);
          const secs = Math.floor(hoverSecs % 60);
          cueTime.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          cue.style.left = `${e.clientX - rect.left}px`;
        }

        const audio = getAudioElement();
        const cur = audio ? (audio.currentTime || 0) : 0;
        const dur = audio ? (audio.duration || 0) : 0;
        updateWaveformProgress(cur, dur);
      });

      wrap.addEventListener('mouseleave', () => {
        _hoverRatio = -1;
        const audio = getAudioElement();
        const cur = audio ? (audio.currentTime || 0) : 0;
        const dur = audio ? (audio.duration || 0) : 0;
        updateWaveformProgress(cur, dur);
      });
    }

    // Fullscreen waveform hover
    const fsWrap = document.getElementById('fs-progress-bar-wrapper');
    const fsCanvas = document.getElementById('fs-waveform-canvas');
    const fsCue = document.getElementById('fs-waveform-hover-cue');
    const fsCueTime = document.getElementById('fs-waveform-hover-time');

    if (fsWrap && fsCanvas) {
      resizeCanvas(fsCanvas);
      window.addEventListener('resize', () => resizeCanvas(fsCanvas));

      fsWrap.addEventListener('mousemove', (e) => {
        const rect = fsWrap.getBoundingClientRect();
        if (rect.width <= 0) return;
        const pct = Math.max(0, Math.min(1.0, (e.clientX - rect.left) / rect.width));
        _fsHoverRatio = pct;

        if (fsCue && fsCueTime) {
          const audio = getAudioElement();
          const dur = audio ? (audio.duration || 0) : 0;
          const hoverSecs = pct * dur;
          const mins = Math.floor(hoverSecs / 60);
          const secs = Math.floor(hoverSecs % 60);
          fsCueTime.textContent = `${mins}:${secs < 10 ? '0' : ''}${secs}`;
          fsCue.style.left = `${e.clientX - rect.left}px`;
        }

        const audio = getAudioElement();
        const cur = audio ? (audio.currentTime || 0) : 0;
        const dur = audio ? (audio.duration || 0) : 0;
        updateWaveformProgress(cur, dur);
      });

      fsWrap.addEventListener('mouseleave', () => {
        _fsHoverRatio = -1;
        const audio = getAudioElement();
        const cur = audio ? (audio.currentTime || 0) : 0;
        const dur = audio ? (audio.duration || 0) : 0;
        updateWaveformProgress(cur, dur);
      });
    }

    // Initial render
    const audio = getAudioElement();
    if (audio) {
      updateWaveformProgress(audio.currentTime, audio.duration);
    }
  }

  // Auto-initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWaveformScrubber);
  } else {
    setTimeout(initWaveformScrubber, 50);
  }

  // Export globally
  window.initWaveformScrubber = initWaveformScrubber;
  window.updateWaveformProgress = updateWaveformProgress;
  window.refreshTrackWaveform = refreshTrackWaveform;
})();
