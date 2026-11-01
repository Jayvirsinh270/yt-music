// ---- 10-Band Audiophile EQ, Bass Boost & 8D Spatial Audio DSP Engine ----
const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_LABELS = ['32Hz', '64Hz', '125Hz', '250Hz', '500Hz', '1kHz', '2kHz', '4kHz', '8kHz', '16kHz'];

const EQ_PRESETS = {
  flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  bass: [6, 5.5, 4, 1.5, 0, 0, 0, 1, 2, 2.5],
  cyberpunk: [4, 3, 1, -1, -2, 1, 3.5, 4, 5.5, 6],
  vocal: [-2, -1, 0, 1, 2.5, 4, 4.5, 3, 1.5, 1],
  acoustic: [3, 2.5, 1.5, 0.5, 1, 2, 3, 3.5, 4, 4],
  nightcore: [-1, 0, 1, 2, 2.5, 3.5, 5, 6, 6.5, 5],
  immersion: [5, 4.5, 3, 1.5, 0.5, 1, 2, 3.5, 4.5, 5]
};

let eqFilters = [];
let bassBoostFilter = null;
let spatialPanner = null;
let spatialRaf = null;
let is8DActive = false;
let spatialSpeed = 0.25;
let spatialAngle = 0;
let currentEqGains = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
let currentBassBoost = 0;

var audioCtx = window.audioCtx || null;
var analyser = window.analyser || null;
let sourceA = null;
let sourceB = null;
let deckAGain = null;
let deckBGain = null;
var audioDataArray = window.audioDataArray || null;
let visualizerRaf = null;
let compressorNode = null;
let makeupGainNode = null;
let isAudioNormEnabled = localStorage.getItem('linus_audio_normalization') !== 'false';
let isKaraokeEnabled = localStorage.getItem('linus_karaoke_enabled') === 'true';
let karaokeInput = null;
let karaokeDryGain = null;
let karaokeWetGain = null;
let karaokeBassFilter = null;
let karaokeVocalHighpass = null;
let karaokeSplitter = null;
let karaokeInvertNode = null;
let karaokeDiffNode = null;
let karaokeDiffMerger = null;
let karaokeOutput = null;

function initAudioContext() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return;
  }
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    audioCtx = new AudioContextClass();
    
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64; // 32 frequency buckets
    analyser.smoothingTimeConstant = 0.8;
    audioDataArray = new Uint8Array(analyser.frequencyBinCount);

    window.audioCtx = audioCtx;
    window.analyser = analyser;
    window.audioDataArray = audioDataArray;
    window.initAudioContext = initAudioContext;

    if (!sourceA && _audioA) {
      sourceA = audioCtx.createMediaElementSource(_audioA);
      deckAGain = audioCtx.createGain();
      deckAGain.gain.value = activeDeck === 'A' ? 1.0 : 0.0;
      sourceA.connect(deckAGain);
      window.deckAGain = deckAGain;
    }
    if (!sourceB && _audioB) {
      sourceB = audioCtx.createMediaElementSource(_audioB);
      deckBGain = audioCtx.createGain();
      deckBGain.gain.value = activeDeck === 'B' ? 1.0 : 0.0;
      sourceB.connect(deckBGain);
      window.deckBGain = deckBGain;
    }

    // 1. Build 10-Band BiquadFilterNodes
    eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
      const filter = audioCtx.createBiquadFilter();
      if (idx === 0) {
        filter.type = 'lowshelf';
      } else if (idx === EQ_FREQUENCIES.length - 1) {
        filter.type = 'highshelf';
      } else {
        filter.type = 'peaking';
        filter.Q.value = 1.4;
      }
      filter.frequency.value = freq;
      filter.gain.value = currentEqGains[idx] || 0;
      return filter;
    });

    // 2. Bass Booster LowShelf filter @ 75Hz
    bassBoostFilter = audioCtx.createBiquadFilter();
    bassBoostFilter.type = 'lowshelf';
    bassBoostFilter.frequency.value = 75;
    bassBoostFilter.gain.value = currentBassBoost;

    // 3. 8D Spatial Audio Stereo Panner Node
    if (audioCtx.createStereoPanner) {
      spatialPanner = audioCtx.createStereoPanner();
    }

    // 4. Karaoke Mid-Side Vocal Remover DSP
    karaokeInput = audioCtx.createGain();
    karaokeDryGain = audioCtx.createGain();
    karaokeDryGain.gain.value = isKaraokeEnabled ? 0.0 : 1.0;

    karaokeWetGain = audioCtx.createGain();
    karaokeWetGain.gain.value = isKaraokeEnabled ? 1.25 : 0.0;

    karaokeOutput = audioCtx.createGain();

    // 4a. Dry Passthrough
    karaokeInput.connect(karaokeDryGain);
    karaokeDryGain.connect(karaokeOutput);

    // 4b. Low-End Rhythm & Bass Preservation (< 200 Hz)
    karaokeBassFilter = audioCtx.createBiquadFilter();
    karaokeBassFilter.type = 'lowpass';
    karaokeBassFilter.frequency.value = 200;
    karaokeBassFilter.Q.value = 0.707;
    karaokeInput.connect(karaokeBassFilter);
    karaokeBassFilter.connect(karaokeWetGain);

    // 4c. Vocal Cancellation via Mid-Side Inversion (> 200 Hz)
    karaokeVocalHighpass = audioCtx.createBiquadFilter();
    karaokeVocalHighpass.type = 'highpass';
    karaokeVocalHighpass.frequency.value = 200;
    karaokeVocalHighpass.Q.value = 0.707;
    karaokeInput.connect(karaokeVocalHighpass);

    karaokeSplitter = audioCtx.createChannelSplitter(2);
    karaokeVocalHighpass.connect(karaokeSplitter);

    karaokeInvertNode = audioCtx.createGain();
    karaokeInvertNode.gain.value = -1.0;
    karaokeSplitter.connect(karaokeInvertNode, 1); // Splitter output 1 (Right) -> Invert (-R)

    karaokeDiffNode = audioCtx.createGain();
    karaokeDiffNode.gain.value = 1.0;
    karaokeSplitter.connect(karaokeDiffNode, 0);   // Splitter output 0 (Left) -> Diff (+L)
    karaokeInvertNode.connect(karaokeDiffNode);     // Inverted Right -> Diff (-R), resulting in (L - R)

    karaokeDiffMerger = audioCtx.createChannelMerger(2);
    karaokeDiffNode.connect(karaokeDiffMerger, 0, 0); // (L - R) -> Left out
    karaokeDiffNode.connect(karaokeDiffMerger, 0, 1); // (L - R) -> Right out
    karaokeDiffMerger.connect(karaokeWetGain);

    karaokeWetGain.connect(karaokeOutput);

    // 5. Smart Gain Dynamics Compressor & Makeup Gain
    compressorNode = audioCtx.createDynamicsCompressor();
    compressorNode.threshold.value = isAudioNormEnabled ? -24 : 0;
    compressorNode.knee.value = 30;
    compressorNode.ratio.value = isAudioNormEnabled ? 12 : 1;
    compressorNode.attack.value = 0.003;
    compressorNode.release.value = 0.25;

    makeupGainNode = audioCtx.createGain();
    makeupGainNode.gain.value = isAudioNormEnabled ? 1.68 : 1.0;

    // Connect Dual-Deck Inputs to DSP Chain:
    // [deckAGain + deckBGain] -> eqFilters[0..9] -> bassBoostFilter -> [spatialPanner] -> karaokeInput -> karaokeOutput -> compressorNode -> makeupGainNode -> analyser -> destination
    if (deckAGain && eqFilters[0]) {
      deckAGain.connect(eqFilters[0]);
    }
    if (deckBGain && eqFilters[0]) {
      deckBGain.connect(eqFilters[0]);
    }

    let lastNode = eqFilters[0];
    for (let i = 1; i < eqFilters.length; i++) {
      lastNode.connect(eqFilters[i]);
      lastNode = eqFilters[i];
    }
    lastNode.connect(bassBoostFilter);
    lastNode = bassBoostFilter;

    if (spatialPanner) {
      lastNode.connect(spatialPanner);
      lastNode = spatialPanner;
    }

    lastNode.connect(karaokeInput);
    lastNode = karaokeOutput;

    lastNode.connect(compressorNode);
    compressorNode.connect(makeupGainNode);
    lastNode = makeupGainNode;

    lastNode.connect(analyser);
    analyser.connect(audioCtx.destination);
  } catch (e) {
    console.warn('Web Audio API setup error:', e);
  }
}

function toggleAudioNormalization(forceState = null) {
  initAudioContext();
  if (typeof forceState === 'boolean') {
    isAudioNormEnabled = forceState;
  } else {
    isAudioNormEnabled = !isAudioNormEnabled;
  }
  try { localStorage.setItem('linus_audio_normalization', isAudioNormEnabled ? 'true' : 'false'); } catch(e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ audio_norm_enabled: isAudioNormEnabled });

  if (audioCtx && compressorNode && makeupGainNode) {
    const now = audioCtx.currentTime;
    if (isAudioNormEnabled) {
      compressorNode.threshold.setTargetAtTime(-24, now, 0.05);
      compressorNode.ratio.setTargetAtTime(12, now, 0.05);
      makeupGainNode.gain.setTargetAtTime(1.68, now, 0.05);
    } else {
      compressorNode.threshold.setTargetAtTime(0, now, 0.05);
      compressorNode.ratio.setTargetAtTime(1, now, 0.05);
      makeupGainNode.gain.setTargetAtTime(1.0, now, 0.05);
    }
  }

  updateAudioNormUI();

  if (isAudioNormEnabled) {
    notify('🎧 Smart Gain: ON (Automatic Loudness Leveling)');
  } else {
    notify('🎧 Smart Gain: OFF (Raw Dynamic Range)');
  }
}

function updateAudioNormUI() {
  const badge = $('#norm-status-badge');
  const sub = $('#norm-status-sub');
  const btn = $('#norm-toggle-btn');
  if (badge) {
    badge.textContent = isAudioNormEnabled ? 'ON' : 'OFF';
    badge.className = `norm-status-pill ${isAudioNormEnabled ? 'on' : 'off'}`;
  }
  if (sub) {
    sub.textContent = isAudioNormEnabled ? 'Consistent loudness across tracks' : 'Raw dynamic range (unprocessed)';
  }
  if (btn) {
    btn.classList.toggle('active', isAudioNormEnabled);
  }
}

// ============================================================================
// 🎤 Instant Vocal Remover / Karaoke DSP Engine (Mid-Side Phase Inversion)
// ============================================================================
function toggleKaraokeMode(forceState = null) {
  initAudioContext();
  if (typeof forceState === 'boolean') {
    isKaraokeEnabled = forceState;
  } else {
    isKaraokeEnabled = !isKaraokeEnabled;
  }
  try { localStorage.setItem('linus_karaoke_enabled', isKaraokeEnabled ? 'true' : 'false'); } catch(e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ karaoke_enabled: isKaraokeEnabled });

  if (audioCtx && karaokeDryGain && karaokeWetGain) {
    const now = audioCtx.currentTime;
    if (isKaraokeEnabled) {
      karaokeDryGain.gain.setTargetAtTime(0.0, now, 0.05);
      karaokeWetGain.gain.setTargetAtTime(1.25, now, 0.05);
    } else {
      karaokeDryGain.gain.setTargetAtTime(1.0, now, 0.05);
      karaokeWetGain.gain.setTargetAtTime(0.0, now, 0.05);
    }
  }

  updateKaraokeUI();

  if (isKaraokeEnabled) {
    notify('🎤 Karaoke Mode: ON (Vocal Suppressed)');
  } else {
    notify('🎤 Karaoke Mode: OFF (Full Vocal Mix)');
  }
}

function updateKaraokeUI() {
  const badge = $('#karaoke-status-badge');
  const sub = $('#karaoke-status-sub');
  const btn = $('#karaoke-toggle-btn');
  const fsBtn = $('#fs-karaoke-btn');
  if (badge) {
    badge.textContent = isKaraokeEnabled ? 'ON' : 'OFF';
    badge.className = `norm-status-pill ${isKaraokeEnabled ? 'on' : 'off'}`;
  }
  if (sub) {
    sub.textContent = isKaraokeEnabled ? 'Vocal suppressed (sing-along mode)' : 'Real-time vocal suppression for singing';
  }
  if (btn) {
    btn.classList.toggle('active', isKaraokeEnabled);
  }
  if (fsBtn) {
    fsBtn.classList.toggle('active', isKaraokeEnabled);
  }
}

// ============================================================================
// 🔊 20-Second Audio Hover Preview Engine
// ============================================================================


function updateHoverPreviewUI() {
  const badge = $('#hover-preview-status-badge');
  const sub = $('#hover-preview-status-sub');
  const btn = $('#hover-preview-toggle-btn');
  if (badge) {
    badge.textContent = _isHoverPreviewEnabled ? 'ON' : 'OFF';
    badge.className = `norm-status-pill ${_isHoverPreviewEnabled ? 'on' : 'off'}`;
  }
  if (sub) {
    sub.textContent = _isHoverPreviewEnabled ? 'Dedicated 20s preview buttons on songs' : '20s audio previews disabled';
  }
  if (btn) {
    btn.classList.toggle('active', _isHoverPreviewEnabled);
  }
}

function toggleHoverPreview() {
  _isHoverPreviewEnabled = !_isHoverPreviewEnabled;
  try { localStorage.setItem('linus_hover_preview_enabled', _isHoverPreviewEnabled ? 'true' : 'false'); } catch(e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ hover_preview_enabled: _isHoverPreviewEnabled });
  updateHoverPreviewUI();
  if (!_isHoverPreviewEnabled) {
    stopHoverPreview();
    notify('🔇 20s Audio Preview disabled');
  } else {
    notify('🔊 20s Audio Preview enabled');
  }
}

function duckMainAudio() {
  if (_isMainAudioDucked) return;
  if (!audio || audio.paused || audio.volume <= 0.05) return;
  _preDuckVolume = audio.volume;
  _isMainAudioDucked = true;

  const targetVol = Math.max(0.08, _preDuckVolume * 0.35);
  const step = (_preDuckVolume - targetVol) / 8;
  let count = 0;
  const duckTimer = setInterval(() => {
    count++;
    if (!_isMainAudioDucked || !audio) {
      clearInterval(duckTimer);
      return;
    }
    audio.volume = Math.max(targetVol, audio.volume - step);
    if (count >= 8 || audio.volume <= targetVol) {
      audio.volume = targetVol;
      clearInterval(duckTimer);
    }
  }, 20);
}

function restoreMainAudio() {
  if (!_isMainAudioDucked) return;
  _isMainAudioDucked = false;
  if (!audio) return;

  const targetVol = _preDuckVolume;
  const startVol = audio.volume;
  const step = (targetVol - startVol) / 8;
  let count = 0;
  const restoreTimer = setInterval(() => {
    count++;
    if (_isMainAudioDucked || !audio) {
      clearInterval(restoreTimer);
      return;
    }
    audio.volume = Math.min(targetVol, audio.volume + step);
    if (count >= 8 || audio.volume >= targetVol) {
      audio.volume = targetVol;
      clearInterval(restoreTimer);
    }
  }, 20);
}

function resolveHoverTrackInfo(el) {
  if (!el) return null;

  // 1. Recommendation card (.rec-card)
  if (el.classList.contains('rec-card')) {
    const id = el.dataset.id || '';
    const isYt = el.dataset.isYt === '1' || id.startsWith('yt:');
    const vid = el.dataset.vid || (isYt ? id.replace('yt:', '') : '');
    const dur = parseFloat(el.dataset.dur || '0');
    const title = el.dataset.title || 'Track';

    let url = '';
    if (isYt && vid) {
      url = `/api/youtube/stream/${encodeURIComponent(vid)}`;
    } else if (id) {
      const t = trackById(id);
      url = t?.url || '';
    }
    return { id, isYt, vid, dur, title, url };
  }

  // 2. Explore card (.explore-card)
  if (el.classList.contains('explore-card')) {
    const vid = el.dataset.vid || '';
    const title = el.dataset.title || 'Track';
    const streamBtn = el.querySelector('.explore-stream-btn');
    const dur = streamBtn ? parseFloat(streamBtn.dataset.dur || '0') : 0;
    const url = vid ? `/api/youtube/stream/${encodeURIComponent(vid)}` : '';
    return { id: `yt:${vid}`, isYt: true, vid, dur, title, url };
  }

  // 3. Track row (.track-row)
  if (el.classList.contains('track-row')) {
    const id = el.dataset.id || '';
    if (!id) return null;
    const t = trackById(id);
    if (!t) return null;
    const isYt = !!(t.is_online || id.startsWith('yt:'));
    const vid = t.video_id || (isYt ? id.replace('yt:', '') : '');
    let url = '';
    if (isYt && vid) {
      url = `/api/youtube/stream/${encodeURIComponent(vid)}`;
    } else {
      url = t.url || '';
    }
    return { id, isYt, vid, dur: t.duration || 0, title: t.title || 'Track', url };
  }

  return null;
}

function toggleTrackAudioPreview(el, triggerBtn = null) {
  if (!_isHoverPreviewEnabled) {
    notify('🔊 Enable 20s Audio Preview in the FX menu first');
    return;
  }
  if (_hoverPreviewTarget === el) {
    stopHoverPreview();
    return;
  }
  startHoverPreview(el, triggerBtn);
}

function startHoverPreview(el, triggerBtn = null) {
  if (!_isHoverPreviewEnabled) return;
  const info = resolveHoverTrackInfo(el);
  if (!info || !info.url) return;

  // Don't preview if track is currently playing in main player
  if (audio && !audio.paused) {
    if (info.id && queue[currentIndex]?.id === info.id) return;
    if (info.vid && typeof _ytCurrentStreamId !== 'undefined' && _ytCurrentStreamId === info.vid) return;
  }

  // Stop previous preview cleanly
  stopHoverPreview();
  _hoverPreviewTarget = el;

  // Set active previewing state on trigger button
  const btn = triggerBtn || el.querySelector('.rec-card-preview-btn, .explore-preview-btn, .preview-track-btn');
  if (btn) {
    btn.classList.add('previewing');
    btn.setAttribute('title', 'Stop 20s Preview');
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'ph-bold ph-stop';
  }

  // Mount visual indicators on target immediately
  el.classList.add('hover-preview-active');
  el.querySelectorAll('.preview-badge-pill, .preview-progress-bar-wrap').forEach(n => n.remove());

  const badge = document.createElement('span');
  badge.className = 'preview-badge-pill';
  badge.innerHTML = `<span class="preview-wave-anim"><span class="preview-wave-bar"></span><span class="preview-wave-bar"></span><span class="preview-wave-bar"></span><span class="preview-wave-bar"></span></span> 20s Preview`;

  const barWrap = document.createElement('div');
  barWrap.className = 'preview-progress-bar-wrap';
  barWrap.innerHTML = `<div class="preview-progress-bar-fill"></div>`;

  const thumbEl = el.querySelector('.rec-card-thumb, .explore-card-thumb');
  if (thumbEl) {
    thumbEl.appendChild(badge);
    thumbEl.appendChild(barWrap);
  } else {
    el.appendChild(badge);
    el.appendChild(barWrap);
  }

  // Configure audio playback - start at 0 so container/demuxer headers are read cleanly
  _previewAudio.pause();
  _previewAudio.currentTime = 0;
  _previewAudio.src = info.url;
  _previewAudio.volume = Math.min(1.0, (audio && audio.volume > 0.1 ? audio.volume : 0.85));

  // Error listener
  _previewAudio.onerror = () => {
    console.warn('Preview audio load error for:', info.url);
    notify('Could not load audio preview.');
    stopHoverPreview();
  };

  const playPromise = _previewAudio.play();
  if (playPromise) {
    playPromise.then(() => {
      if (_hoverPreviewTarget !== el) {
        _previewAudio.pause();
        return;
      }

      // Duck main player audio smoothly so preview stands out
      duckMainAudio();

      // Strict 20-second stop timeout
      clearTimeout(_hoverPreview20sTimer);
      _hoverPreview20sTimer = setTimeout(() => {
        stopHoverPreview(true);
      }, 20000);
    }).catch(err => {
      console.warn('Hover preview play prevented:', err);
      stopHoverPreview();
    });
  }
}

function stopHoverPreview(timedOut = false) {
  clearTimeout(_hoverPreviewDebounceTimer);
  _hoverPreviewDebounceTimer = null;
  clearTimeout(_hoverPreview20sTimer);
  _hoverPreview20sTimer = null;
  clearInterval(_previewFadeInterval);

  // Restore all preview buttons back to normal
  document.querySelectorAll('.rec-card-preview-btn.previewing, .explore-preview-btn.previewing, .preview-track-btn.previewing').forEach(btn => {
    btn.classList.remove('previewing');
    btn.setAttribute('title', 'Quick 20s Preview');
    const icon = btn.querySelector('i');
    if (icon) icon.className = 'ph-bold ph-speaker-simple-high';
  });

  if (_hoverPreviewTarget) {
    _hoverPreviewTarget.classList.remove('hover-preview-active');
    _hoverPreviewTarget.querySelectorAll('.preview-badge-pill, .preview-progress-bar-wrap').forEach(n => n.remove());
    _hoverPreviewTarget = null;
  }

  if (_previewAudio) {
    _previewAudio.onerror = null;
    _previewAudio.pause();
    _previewAudio.removeAttribute('src');
    _previewAudio.load();
  }

  restoreMainAudio();
}

function initHoverPreview() {
  updateHoverPreviewUI();

  // 1-Click Dedicated 20s Preview Button Handler via Event Delegation
  document.addEventListener('click', (e) => {
    const previewBtn = e.target.closest('.rec-card-preview-btn, .explore-preview-btn, .preview-track-btn');
    if (previewBtn) {
      e.stopPropagation();
      e.preventDefault();
      const card = previewBtn.closest('.rec-card, .explore-card, .track-row');
      if (card) {
        toggleTrackAudioPreview(card, previewBtn);
      }
      return;
    }

    // Clicking to play a full track stops any running preview immediately
    const playTrigger = e.target.closest('.rec-card-play-btn, .explore-stream-btn, .ctrl-play, #play, .track-title-cell, .track-thumb');
    if (playTrigger) {
      stopHoverPreview();
    }
  });

  window.addEventListener('blur', () => {
    stopHoverPreview();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopHoverPreview();
    }
  });
}

// ============================================================================
// 🌈 Dynamic Artwork Color Extraction (Chameleon Glow) Engine
// ============================================================================
var _isChameleonGlowEnabled = localStorage.getItem('linus_chameleon_glow_enabled') !== 'false';
var _currentChameleonPalette = null;
var _currentChameleonTrackId = null;
const _chameleonPaletteCache = new Map();

window._isChameleonGlowEnabled = _isChameleonGlowEnabled;
window._currentChameleonPalette = _currentChameleonPalette;

function updateChameleonUI() {
  const badge = $('#chameleon-status-badge');
  const sub = $('#chameleon-status-sub');
  const btn = $('#chameleon-toggle-btn');
  if (badge) {
    badge.textContent = _isChameleonGlowEnabled ? 'ON' : 'OFF';
    badge.className = `norm-status-pill ${_isChameleonGlowEnabled ? 'on' : 'off'}`;
  }
  if (sub) {
    sub.textContent = _isChameleonGlowEnabled ? 'Dynamic UI glow from album art' : 'Static theme colors (classic)';
  }
  if (btn) {
    btn.classList.toggle('active', _isChameleonGlowEnabled);
  }
}

function toggleChameleonGlow(forceState = null) {
  if (typeof forceState === 'boolean') {
    _isChameleonGlowEnabled = forceState;
  } else {
    _isChameleonGlowEnabled = !_isChameleonGlowEnabled;
  }
  try { localStorage.setItem('linus_chameleon_glow_enabled', _isChameleonGlowEnabled ? 'true' : 'false'); } catch(e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ chameleon_glow_enabled: _isChameleonGlowEnabled });
  window._isChameleonGlowEnabled = _isChameleonGlowEnabled;
  updateChameleonUI();

  if (!_isChameleonGlowEnabled) {
    document.body.classList.remove('chameleon-active');
    document.documentElement.style.removeProperty('--chameleon-primary');
    document.documentElement.style.removeProperty('--chameleon-primary-rgb');
    document.documentElement.style.removeProperty('--chameleon-secondary');
    document.documentElement.style.removeProperty('--chameleon-secondary-rgb');
    document.documentElement.style.removeProperty('--chameleon-accent');
    document.documentElement.style.removeProperty('--chameleon-accent-rgb');
    document.documentElement.style.removeProperty('--chameleon-glow');
    document.documentElement.style.removeProperty('--chameleon-glow-subtle');
    document.documentElement.style.removeProperty('--chameleon-gradient');
    document.documentElement.style.removeProperty('--chameleon-surface');
    document.documentElement.style.removeProperty('--chameleon-beat-glow');
    document.documentElement.style.removeProperty('--chameleon-beat-scale');
    if (typeof updateLivingAuraColors === 'function') updateLivingAuraColors();
    notify('🎨 Chameleon Glow: OFF (Classic Theme)');
  } else {
    notify('🌈 Chameleon Glow: ON (Artwork Adaptive)');
    const curTrack = (currentIndex >= 0 && queue[currentIndex]) ? queue[currentIndex] : (state.last_played_track_id ? trackById(state.last_played_track_id) : null);
    if (curTrack) {
      applyChameleonPalette(curTrack);
    }
  }
}

/** Utility: Convert RGB [0-255, 0-255, 0-255] to HSL [0-360, 0-1, 0-1] */
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) * 60; break;
      case g: h = ((b - r) / d + 2) * 60; break;
      case b: h = ((r - g) / d + 4) * 60; break;
    }
  }
  return [h, s, l];
}

/** Utility: Convert HSL values to RGB [0-255, 0-255, 0-255] */
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  let c = (1 - Math.abs(2 * l - 1)) * s;
  let x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  let m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (0 <= h && h < 60) { r = c; g = x; b = 0; }
  else if (60 <= h && h < 120) { r = x; g = c; b = 0; }
  else if (120 <= h && h < 180) { r = 0; g = c; b = x; }
  else if (180 <= h && h < 240) { r = 0; g = x; b = c; }
  else if (240 <= h && h < 300) { r = x; g = 0; b = c; }
  else if (300 <= h && h < 360) { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Generates a rich, harmonic 3-color palette deterministically from track metadata (0ms fallback) */
function getHarmonicTrackPalette(track) {
  const seed = (track.artist || '') + (track.title || '') + (track.id || 'linus');
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i);
    hash |= 0;
  }
  const h1 = Math.abs(hash) % 360;
  const h2 = (h1 + 45 + (Math.abs(hash >> 3) % 90)) % 360;
  const h3 = (h1 + 180 + (Math.abs(hash >> 6) % 60)) % 360;
  return {
    primary: hslToRgb(h1, 0.88, 0.58),
    secondary: hslToRgb(h2, 0.82, 0.48),
    accent: hslToRgb(h3, 0.94, 0.64),
    isFallback: true
  };
}

/**
 * Optimizes chroma, saturation and luminous radiance for maximum visual pop against dark backgrounds.
 * Guarantees vivid, gemstone-pure colors without muddy greys or blinding whitewash.
 */
function adjustGlowRgb(rgb) {
  const [r, g, b] = rgb;
  let [h, s, l] = rgbToHsl(r, g, b);

  // Boost saturation to ensure intense, living color presence
  s = Math.max(0.72, Math.min(0.98, s * 1.35));

  // Anchor lightness in the luminous sweet spot for OLED dark themes
  if (l < 0.42) {
    l = Math.min(0.56, l * 1.45 + 0.14);
  } else if (l > 0.72) {
    l = 0.64;
  } else {
    l = Math.max(0.48, Math.min(0.62, l * 1.08));
  }

  return hslToRgb(h, s, l);
}

/**
 * Extracts dominant, secondary, and vibrant accent colors from an artwork URL via 48x48 HTML5 canvas.
 * Executes in under 3ms with automatic caching and graceful harmonic fallback.
 */
function extractArtworkPalette(imgUrl, track = null) {
  return new Promise((resolve) => {
    const fallback = track ? getHarmonicTrackPalette(track) : {
      primary: [235, 175, 95],
      secondary: [210, 138, 55],
      accent: [255, 165, 20],
      isFallback: true
    };
    if (!imgUrl) return resolve(fallback);
    if (_chameleonPaletteCache.has(imgUrl)) {
      return resolve(_chameleonPaletteCache.get(imgUrl));
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 48;
        canvas.height = 48;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return resolve(fallback);

        ctx.drawImage(img, 0, 0, 48, 48);
        const data = ctx.getImageData(0, 0, 48, 48).data;

        const colorBuckets = {};

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const a = data[i + 3];
          if (a < 128) continue; // Ignore transparent pixels

          const sum = r + g + b;
          // Filter out mud (< 40) and washed-out glare (> 725)
          if (sum < 40 || sum > 725) continue;

          // Filter low saturation (washed grays)
          const maxVal = Math.max(r, g, b);
          const minVal = Math.min(r, g, b);
          const delta = maxVal - minVal;
          if (delta < 14 && sum > 85) continue;

          // Quantize to 18-step buckets for high-resolution palette distinction
          const qr = Math.floor(r / 18) * 18;
          const qg = Math.floor(g / 18) * 18;
          const qb = Math.floor(b / 18) * 18;
          const key = `${qr},${qg},${qb}`;

          // Weight heavily by chroma & saturation
          const saturation = maxVal > 0 ? delta / maxVal : 0;
          const weight = 1.0 + Math.pow(saturation, 1.4) * 3.2;

          if (!colorBuckets[key]) {
            colorBuckets[key] = { r: qr, g: qg, b: qb, count: 0, weight: 0 };
          }
          colorBuckets[key].count++;
          colorBuckets[key].weight += weight;
        }

        const sorted = Object.values(colorBuckets).sort((a, b) => b.weight - a.weight);

        if (sorted.length === 0) {
          _chameleonPaletteCache.set(imgUrl, fallback);
          return resolve(fallback);
        }

        const p1 = sorted[0];
        let p2 = null;
        let p3 = null;

        for (let i = 1; i < sorted.length; i++) {
          const cand = sorted[i];
          const dist1 = Math.hypot(cand.r - p1.r, cand.g - p1.g, cand.b - p1.b);
          if (dist1 > 60) {
            p2 = cand;
            break;
          }
        }

        if (p2) {
          for (let i = 1; i < sorted.length; i++) {
            const cand = sorted[i];
            const dist1 = Math.hypot(cand.r - p1.r, cand.g - p1.g, cand.b - p1.b);
            const dist2 = Math.hypot(cand.r - p2.r, cand.g - p2.g, cand.b - p2.b);
            if (dist1 > 45 && dist2 > 45) {
              p3 = cand;
              break;
            }
          }
        }

        // Harmonious synthetic generation if album art is monochrome
        const [h1, s1, l1] = rgbToHsl(p1.r, p1.g, p1.b);
        if (!p2) {
          const [r2, g2, b2] = hslToRgb((h1 + 45) % 360, Math.max(0.75, s1), Math.max(0.42, l1 * 0.9));
          p2 = { r: r2, g: g2, b: b2 };
        }
        if (!p3) {
          const [r3, g3, b3] = hslToRgb((h1 + 180) % 360, Math.min(0.95, s1 * 1.2), Math.min(0.68, l1 * 1.15));
          p3 = { r: r3, g: g3, b: b3 };
        }

        const palette = {
          primary: adjustGlowRgb([p1.r, p1.g, p1.b]),
          secondary: adjustGlowRgb([p2.r, p2.g, p2.b]),
          accent: adjustGlowRgb([p3.r, p3.g, p3.b]),
          isFallback: false
        };

        _chameleonPaletteCache.set(imgUrl, palette);
        resolve(palette);
      } catch (err) {
        console.warn('Artwork canvas extraction fallback:', err);
        resolve(fallback);
      }
    };
    img.onerror = () => resolve(fallback);
    img.src = imgUrl;
  });
}

/** Applies Chameleon Palette CSS variables and Fullscreen sync across Linus */
function setChameleonCssVariables(palette) {
  if (!palette || !palette.primary) return;
  const [r1, g1, b1] = palette.primary;
  const [r2, g2, b2] = palette.secondary;
  const [r3, g3, b3] = palette.accent || [Math.round((r1 + r2) / 2), Math.round((g1 + g2) / 2), Math.round((b1 + b2) / 2)];

  const root = document.documentElement;
  root.style.setProperty('--chameleon-primary', `rgb(${r1}, ${g1}, ${b1})`);
  root.style.setProperty('--chameleon-primary-rgb', `${r1}, ${g1}, ${b1}`);
  root.style.setProperty('--chameleon-secondary', `rgb(${r2}, ${g2}, ${b2})`);
  root.style.setProperty('--chameleon-secondary-rgb', `${r2}, ${g2}, ${b2}`);
  root.style.setProperty('--chameleon-accent', `rgb(${r3}, ${g3}, ${b3})`);
  root.style.setProperty('--chameleon-accent-rgb', `${r3}, ${g3}, ${b3}`);
  root.style.setProperty('--chameleon-glow', `rgba(${r1}, ${g1}, ${b1}, 0.65)`);
  root.style.setProperty('--chameleon-glow-subtle', `rgba(${r1}, ${g1}, ${b1}, 0.28)`);
  root.style.setProperty('--chameleon-glow-deep', `rgba(${r1}, ${g1}, ${b1}, 0.85)`);
  root.style.setProperty('--chameleon-secondary-glow', `rgba(${r2}, ${g2}, ${b2}, 0.48)`);
  root.style.setProperty('--chameleon-accent-glow', `rgba(${r3}, ${g3}, ${b3}, 0.55)`);
  root.style.setProperty('--chameleon-gradient', `linear-gradient(135deg, rgb(${r1}, ${g1}, ${b1}) 0%, rgb(${r3}, ${g3}, ${b3}) 50%, rgb(${r2}, ${g2}, ${b2}) 100%)`);
  root.style.setProperty('--chameleon-surface', `rgba(${Math.floor(r1 * 0.14)}, ${Math.floor(g1 * 0.14)}, ${Math.floor(b1 * 0.14)}, 0.78)`);

  document.body.classList.add('chameleon-active');

  // Smoothly sync Fullscreen Player background
  const chameleonBg = `linear-gradient(135deg, rgba(${r1}, ${g1}, ${b1}, 0.88) 0%, rgba(${r3}, ${g3}, ${b3}, 0.70) 50%, rgba(${r2}, ${g2}, ${b2}, 0.88) 100%)`;
  const curFsBgIndex = window.activeFsBg || (typeof activeFsBg !== 'undefined' ? activeFsBg : 1);
  const currBg = $('#fs-bg-' + curFsBgIndex);
  if (currBg) {
    currBg.style.background = chameleonBg;
  }
}

/**
 * Applies extracted Chameleon Palette across Linus UI:
 * Ambient Mesh, Living Aura Canvas, Player bar, Hero Vinyl card, Fullscreen background, CSS tokens.
 */
async function applyChameleonPalette(track) {
  if (!track) return;
  _currentChameleonTrackId = track.id;

  if (!_isChameleonGlowEnabled) {
    document.body.classList.remove('chameleon-active');
    return;
  }

  // 1. Instant 0ms harmonic aesthetic response from track metadata
  const immediatePalette = getHarmonicTrackPalette(track);
  _currentChameleonPalette = immediatePalette;
  window._currentChameleonPalette = immediatePalette;
  setChameleonCssVariables(immediatePalette);
  if (typeof updateLivingAuraColors === 'function') updateLivingAuraColors(immediatePalette);

  const artUrl = track.artwork_url || (track.is_online && track.video_id ? `https://i.ytimg.com/vi/${track.video_id}/hqdefault.jpg` : null);

  // 2. High-precision true artwork canvas extraction
  if (artUrl) {
    const palette = await extractArtworkPalette(artUrl, track);
    if (!palette || _currentChameleonTrackId !== track.id) return;
    if (!_isChameleonGlowEnabled) return;

    _currentChameleonPalette = palette;
    window._currentChameleonPalette = palette;
    setChameleonCssVariables(palette);
    if (typeof updateLivingAuraColors === 'function') updateLivingAuraColors(palette);
  }
}

function run8DSpatialLoop() {
  if (document.hidden || !is8DActive || !spatialPanner || audio.paused) {
    if (spatialPanner && !is8DActive) spatialPanner.pan.value = 0;
    if (spatialRaf) cancelAnimationFrame(spatialRaf);
    spatialRaf = null;
    return;
  }
  spatialAngle += spatialSpeed * 0.04;
  const panVal = Math.sin(spatialAngle) * 0.96;
  spatialPanner.pan.value = panVal;

  const sat = $('#orbit-satellite');
  if (sat) {
    sat.style.transform = `rotate(${spatialAngle * 57.2958}deg)`;
  }

  spatialRaf = requestAnimationFrame(run8DSpatialLoop);
}

// Build Equalizer UI
function renderEqualizerUI() {
  const stage = $('#eq-sliders-stage');
  if (!stage) return;

  stage.innerHTML = EQ_FREQUENCIES.map((freq, idx) => `
    <div class="eq-col">
      <span class="eq-col-gain" id="eq-gain-${idx}">${currentEqGains[idx] > 0 ? '+' : ''}${currentEqGains[idx]}dB</span>
      <div class="eq-slider-wrap">
        <input type="range" class="eq-v-slider" id="eq-slider-${idx}" min="-12" max="12" step="0.5" value="${currentEqGains[idx]}" data-idx="${idx}">
      </div>
      <span class="eq-col-label">${EQ_LABELS[idx]}</span>
    </div>
  `).join('');

  stage.querySelectorAll('.eq-v-slider').forEach(slider => {
    slider.addEventListener('input', (e) => {
      initAudioContext();
      const idx = parseInt(e.target.dataset.idx);
      const val = parseFloat(e.target.value);
      currentEqGains[idx] = val;
      if (eqFilters[idx]) eqFilters[idx].gain.value = val;
      const gainLabel = $(`#eq-gain-${idx}`);
      if (gainLabel) gainLabel.textContent = `${val > 0 ? '+' : ''}${val}dB`;
      // Remove active from presets since manual tweak made
      document.querySelectorAll('.eq-preset-btn').forEach(b => b.classList.remove('active'));
    });
  });
}

function applyPreset(presetKey) {
  const gains = EQ_PRESETS[presetKey];
  if (!gains) return;
  initAudioContext();
  currentEqGains = [...gains];

  currentEqGains.forEach((val, idx) => {
    if (eqFilters[idx]) eqFilters[idx].gain.value = val;
    const slider = $(`#eq-slider-${idx}`);
    if (slider) slider.value = val;
    const gainLabel = $(`#eq-gain-${idx}`);
    if (gainLabel) gainLabel.textContent = `${val > 0 ? '+' : ''}${val}dB`;
  });

  document.querySelectorAll('.eq-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.preset === presetKey);
  });

  state.eq_preset = presetKey;
  state.eq_gains = currentEqGains;
  saveState();
}

// Preset Buttons
document.querySelectorAll('.eq-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});

// Bass Booster Knob/Slider
$('#bass-boost-slider').addEventListener('input', (e) => {
  initAudioContext();
  const val = parseFloat(e.target.value);
  currentBassBoost = val;
  if (bassBoostFilter) bassBoostFilter.gain.value = val;
  $('#bass-boost-val').textContent = `+${val} dB`;
});

// 8D Spatial Audio Toggle
$('#spatial-toggle').addEventListener('change', (e) => {
  initAudioContext();
  is8DActive = e.target.checked;
  const sat = $('#orbit-satellite');
  if (is8DActive) {
    if (sat) sat.parentElement.classList.add('orbit-anim');
    run8DSpatialLoop();
    notify('🎧 8D Spatial Audio ON — Best with headphones!');
  } else {
    if (sat) sat.parentElement.classList.remove('orbit-anim');
    if (spatialPanner) spatialPanner.pan.value = 0;
    notify('8D Spatial Audio OFF');
  }
});

$('#spatial-speed-slider').addEventListener('input', (e) => {
  spatialSpeed = parseFloat(e.target.value);
});

// Reset EQ
$('#eq-reset-btn').addEventListener('click', () => {
  applyPreset('flat');
  $('#bass-boost-slider').value = 0;
  currentBassBoost = 0;
  if (bassBoostFilter) bassBoostFilter.gain.value = 0;
  $('#bass-boost-val').textContent = '+0 dB';
  notify('Equalizer reset to Flat.');
});

// Equalizer Dialog Open / Close
$('#eq-toggle-btn').addEventListener('click', () => {
  initAudioContext();
  renderEqualizerUI();
  $('#eq-sheet').showModal();
});
$('#fs-eq-btn').addEventListener('click', () => {
  initAudioContext();
  renderEqualizerUI();
  $('#eq-sheet').showModal();
});
$('#fs-karaoke-btn')?.addEventListener('click', () => {
  toggleKaraokeMode();
});
$('#eq-close').addEventListener('click', () => $('#eq-sheet').close());

renderEqualizerUI();

// Expose Audio DSP APIs to window
window.audioCtx = audioCtx;
window.analyser = analyser;
window.initAudioContext = initAudioContext;
window.renderEqualizerUI = renderEqualizerUI;
window.applyPreset = applyPreset;
window.toggleAudioNormalization = toggleAudioNormalization;
window.toggleKaraokeMode = toggleKaraokeMode;
window.updateKaraokeUI = updateKaraokeUI;
window.toggleHoverPreview = toggleHoverPreview;
window.toggleChameleonGlow = toggleChameleonGlow;
window.applyChameleonPalette = applyChameleonPalette;
window.run8DSpatialLoop = run8DSpatialLoop;
window.extractArtworkPalette = extractArtworkPalette;
window.toggleTrackAudioPreview = toggleTrackAudioPreview;
window.stopHoverPreview = typeof stopHoverPreview !== 'undefined' ? stopHoverPreview : function() {};

