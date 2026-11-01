// ============================================================
// Linus — Fullscreen Player Subsystem (static/fullscreen.js)
// 3D CD Jewel Case, Vinyl Turntable, 90s Winamp/Walkman CRT LCD,
// True Fullscreen API, Auto-Hide HUD, View Modes, Ring Seek
// ============================================================

(function() {
  'use strict';

  const $ = window.$ || (sel => document.querySelector(sel));
  const $$ = window.$$ || (sel => document.querySelectorAll(sel));
  const formatTime = window.formatTime || (sec => {
    if (!sec || isNaN(sec)) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  });

// ---- Full-Screen Player -------------------------------------
const fsPlayer = $('#fs-player');
let activeFsBg = 1;
window.activeFsBg = 1;

// ---- Fullscreen Visualizer Modes Catalog (12 Curated Cinema Modes) ----
const FS_MODES = [
  { id: 'stage', name: 'Modern Split Stage', icon: 'ph-bold ph-columns' },
  { id: 'galaxy', name: 'Cosmic Galaxy 3D', icon: 'ph-fill ph-planet' },
  { id: 'cyber', name: 'Cyberpunk Neon Wave', icon: 'ph-bold ph-activity' },
  { id: 'halo', name: 'Celestial Halo', icon: 'ph-bold ph-circle-dashed' },
  { id: 'vinyl', name: 'Vinyl Turntable', icon: 'ph-fill ph-vinyl-record' },
  { id: 'retro90s', name: '90s Retro', icon: 'ph-bold ph-cassette-tape' },
  { id: 'modern', name: 'Modern Glass Card', icon: 'ph-bold ph-square' },
  { id: 'lyrics', name: 'Karaoke Lyrics', icon: 'ph-bold ph-quotes' },
  { id: 'wave', name: 'Ambient Waveform', icon: 'ph-bold ph-waveform' },
  { id: 'aura', name: 'Living Aura', icon: 'ph-bold ph-aperture' },
  { id: 'radio', name: 'Retro Cassette', icon: 'ph-bold ph-radio' },
  { id: 'clean', name: 'Clean Canvas', icon: 'ph-bold ph-image' }
];

let currentFsMode = localStorage.getItem('linus_fullscreen_mode') || 'stage';

// Cinema Auto-Hide HUD & Immersive Screen Lock Engine
let fsIdleTimer = null;
let isFsHudLocked = false;

function toggleFsHudLock(forceState) {
  if (!fsPlayer || !fsPlayer.classList.contains('open')) return;
  const nextState = forceState !== undefined ? !!forceState : !isFsHudLocked;
  isFsHudLocked = nextState;
  
  const lockBtn = $('#fs-lock-hud-btn');
  if (isFsHudLocked) {
    if (fsIdleTimer) clearTimeout(fsIdleTimer);
    fsPlayer.classList.add('fs-locked', 'fs-idle');
    if (lockBtn) {
      lockBtn.innerHTML = '<i class="ph-fill ph-lock-key"></i>';
      lockBtn.title = 'Unlock HUD (Double-Click Screen or Ctrl+Shift+Y)';
      lockBtn.classList.add('active');
    }
    notify('🔒 Cinema HUD Locked — Double-click screen or press Ctrl+Shift+Y to unlock');
  } else {
    fsPlayer.classList.remove('fs-locked', 'fs-idle');
    if (lockBtn) {
      lockBtn.innerHTML = '<i class="ph-bold ph-lock-key-open"></i>';
      lockBtn.title = 'Lock Immersive HUD (Double-Click Screen or Ctrl+Shift+Y to Lock/Unlock)';
      lockBtn.classList.remove('active');
    }
    notify('🔓 Cinema HUD Unlocked');
    resetFsIdleTimer();
  }
}

function resetFsIdleTimer() {
  if (!fsPlayer || !fsPlayer.classList.contains('open')) return;
  if (isFsHudLocked) {
    // Keep HUD strictly locked & hidden regardless of mouse movement, clicking or keyboard navigation
    fsPlayer.classList.add('fs-locked', 'fs-idle');
    return;
  }
  fsPlayer.classList.remove('fs-idle');
  if (fsIdleTimer) clearTimeout(fsIdleTimer);

  const vizPanel = $('#fs-visualizer-panel');
  const themeStudio = $('#fs-theme-studio');
  if ((vizPanel && !vizPanel.classList.contains('hidden')) || 
      (themeStudio && !themeStudio.classList.contains('hidden'))) {
    return;
  }

  fsIdleTimer = setTimeout(() => {
    if (fsPlayer && fsPlayer.classList.contains('open') && !isFsHudLocked) {
      fsPlayer.classList.add('fs-idle');
    }
  }, 3500);
}

function setupFsIdleTimer() {
  ['mousemove', 'mousedown', 'keydown', 'touchstart', 'pointermove'].forEach(evt => {
    window.addEventListener(evt, resetFsIdleTimer, { passive: true });
  });

  // Double-click on screen locks/unlocks the HUD
  fsPlayer?.addEventListener('dblclick', (e) => {
    if (!fsPlayer.classList.contains('open')) return;
    // When unlocked, ignore double-clicks on buttons or editable controls so standard clicks aren't hijacked
    if (!isFsHudLocked && e.target.closest('input, textarea, select, button, .fs-viz-card, .karaoke-line')) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    toggleFsHudLock();
  });

  // Dedicated Lock HUD button in header action cluster
  $('#fs-lock-hud-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFsHudLock();
  });
}
setupFsIdleTimer();

function setFullscreenMode(modeId) {
  if (!FS_MODES.some(m => m.id === modeId)) {
    modeId = 'stage';
  }
  currentFsMode = modeId;
  try {
    localStorage.setItem('linus_fullscreen_mode', modeId);
    if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ fullscreen_mode: modeId });
  } catch {}
  if (fsPlayer) fsPlayer.setAttribute('data-mode', modeId);

  // Update quick mode bar pills
  document.querySelectorAll('.mode-bar-pill').forEach(pill => {
    const isActive = pill.getAttribute('data-mode') === modeId;
    pill.classList.toggle('active', isActive);
    pill.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  // Update capsule UI if present
  const modeObj = FS_MODES.find(m => m.id === modeId);
  const capsuleIcon = $('#mode-capsule-icon');
  const capsuleName = $('#mode-capsule-name');
  if (capsuleIcon && modeObj) capsuleIcon.innerHTML = `<i class="${modeObj.icon}"></i>`;
  if (capsuleName && modeObj) capsuleName.textContent = modeObj.name;

  // Update active states in studio panel cards
  document.querySelectorAll('.fs-viz-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-mode') === modeId);
  });

  // Re-trigger visual updates based on current progress if audio has duration
  if (typeof audio !== 'undefined' && audio && audio.duration && typeof updateFullscreenRing === 'function') {
    updateFullscreenRing(audio.currentTime, audio.duration);
  }

  // Ensure canvases are properly resized only when the player is open
  if (typeof resizeVisualizerCanvases === 'function' && fsPlayer && fsPlayer.classList.contains('open')) {
    resizeVisualizerCanvases();
  }
  if (modeId === 'retro90s' && typeof initWinampEngine === 'function') {
    initWinampEngine();
  }
  if (modeId === 'galaxy' && typeof initGalaxyEngine === 'function') {
    initGalaxyEngine();
  }
  if (modeId === 'cyber' && typeof initCyberEngine === 'function') {
    initCyberEngine();
  }
  if (typeof startAudioVisualizer === 'function') {
    startAudioVisualizer();
  }
}

function toggleVisualizerPanel(forceState) {
  const panel = $('#fs-visualizer-panel');
  const capsule = $('#fs-mode-capsule');
  if (!panel) return;
  const isHidden = forceState !== undefined ? !forceState : !panel.classList.contains('hidden');
  panel.classList.toggle('hidden', isHidden);
  if (capsule) capsule.classList.toggle('panel-open', !isHidden);
}

function closeVisualizerPanel() {
  toggleVisualizerPanel(false);
}

function cycleFullscreenMode(direction = 1) {
  const currentIndex = FS_MODES.findIndex(m => m.id === currentFsMode);
  const safeIdx = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (safeIdx + direction + FS_MODES.length) % FS_MODES.length;
  setFullscreenMode(FS_MODES[nextIndex].id);
}

// Mode Capsule Trigger (Opens/Closes the Visualizer Studio Hub)
$('#mode-capsule-trigger')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleVisualizerPanel();
});

// Arrow buttons on capsule
$('#mode-capsule-prev')?.addEventListener('click', (e) => {
  e.stopPropagation();
  cycleFullscreenMode(-1);
});
$('#mode-capsule-next')?.addEventListener('click', (e) => {
  e.stopPropagation();
  cycleFullscreenMode(1);
});

// Close button on Visualizer Studio Panel
$('#fs-viz-panel-close')?.addEventListener('click', (e) => {
  e.stopPropagation();
  closeVisualizerPanel();
});

// Quick Mode Bar Pills Selection
document.querySelectorAll('.mode-bar-pill').forEach(pill => {
  pill.addEventListener('click', (e) => {
    e.stopPropagation();
    const mode = pill.getAttribute('data-mode');
    if (mode) {
      setFullscreenMode(mode);
    }
  });
});

// Studio Panel Cards Selection
document.querySelectorAll('.fs-viz-card').forEach(card => {
  card.addEventListener('click', (e) => {
    e.stopPropagation();
    const mode = card.getAttribute('data-mode');
    if (mode) {
      setFullscreenMode(mode);
      closeVisualizerPanel();
    }
  });
});

// Close visualizer panel when clicking outside
document.addEventListener('click', (e) => {
  const panel = $('#fs-visualizer-panel');
  const capsule = $('#fs-mode-capsule');
  if (panel && !panel.classList.contains('hidden')) {
    if (!panel.contains(e.target) && !capsule?.contains(e.target)) {
      closeVisualizerPanel();
    }
  }
});

// Initialize mode capsule on startup
setFullscreenMode(currentFsMode);

// Walkman Tactile Hardware Buttons
$('#btn-walkman-megabass')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = $('#btn-walkman-megabass');
  const badge = $('#lcd-badge-bass');
  const isActive = btn.classList.toggle('active');
  badge?.classList.toggle('active', isActive);
  notify(isActive ? 'MEGA BASS: ON (+6dB Low Shelf)' : 'MEGA BASS: OFF');
});

$('#btn-walkman-esp')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = $('#btn-walkman-esp');
  const badge = $('#lcd-badge-esp');
  const isActive = btn.classList.toggle('active');
  badge?.classList.toggle('active', isActive);
  notify(isActive ? 'ESP: 45 SECONDS ELECTRONIC SHOCK PROTECTION ACTIVE' : 'ESP: BYPASS');
});

$('#btn-walkman-avls')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const btn = $('#btn-walkman-avls');
  const badge = $('#lcd-badge-avls');
  const isActive = btn.classList.toggle('active');
  badge?.classList.toggle('active', isActive);
  notify(isActive ? 'AVLS: AUTOMATIC VOLUME LIMITER SYSTEM ACTIVE' : 'AVLS: LIMITER OFF');
});

// Stage Mode 3D Jewel Case Mouse Parallax Tilt
const stageCaseWrap = $('#stage-case-wrap');
const stageJewelCase = $('#stage-jewel-case');
if (stageCaseWrap && stageJewelCase) {
  stageCaseWrap.addEventListener('mousemove', (e) => {
    const rect = stageCaseWrap.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const rotY = (x / (rect.width / 2)) * 12;
    const rotX = -(y / (rect.height / 2)) * 12;
    stageJewelCase.style.transform = `perspective(900px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;
  });
  stageCaseWrap.addEventListener('mouseleave', () => {
    stageJewelCase.style.transform = '';
  });
}

// ---- True Browser Fullscreen API Engine ----
function isTrueFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

function requestTrueFullscreen() {
  const el = document.documentElement;
  try {
    if (el.requestFullscreen) {
      return el.requestFullscreen().catch(() => {});
    } else if (el.webkitRequestFullscreen) {
      return el.webkitRequestFullscreen();
    } else if (el.mozRequestFullScreen) {
      return el.mozRequestFullScreen();
    } else if (el.msRequestFullscreen) {
      return el.msRequestFullscreen();
    }
  } catch (err) {
    console.warn('Native fullscreen request error:', err);
  }
  return Promise.resolve();
}

function exitTrueFullscreen() {
  if (isTrueFullscreen()) {
    try {
      if (document.exitFullscreen) {
        return document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        return document.webkitExitFullscreen();
      } else if (document.mozCancelFullScreen) {
        return document.mozCancelFullScreen();
      } else if (document.msExitFullscreen) {
        return document.msExitFullscreen();
      }
    } catch (err) {
      console.warn('Native fullscreen exit error:', err);
    }
  }
  return Promise.resolve();
}

function toggleTrueFullscreen() {
  if (isTrueFullscreen()) {
    exitTrueFullscreen();
    notify('Exited True Fullscreen');
  } else {
    requestTrueFullscreen();
    notify('Entered True Fullscreen — Browser tabs & address bar hidden!');
  }
  setTimeout(updateTrueFullscreenUI, 100);
}

function updateTrueFullscreenUI() {
  const isFs = isTrueFullscreen();
  const btn = $('#fs-native-fullscreen-btn');
  if (btn) {
    btn.innerHTML = isFs ? '<i class="ph-bold ph-corners-in"></i>' : '<i class="ph-bold ph-corners-out"></i>';
    btn.title = isFs ? 'Exit True Fullscreen (Show Browser Tabs & Window)' : 'True Fullscreen (Hide Browser Tabs & Address Bar for Full Artwork)';
    btn.classList.toggle('active', isFs);
  }
  const toggleBtn = $('#fs-native-toggle-btn');
  if (toggleBtn) {
    toggleBtn.innerHTML = isFs ? '<i class="ph-bold ph-corners-in"></i> Exit Fullscreen' : '<i class="ph-bold ph-corners-out"></i> Toggle Now';
  }
}

document.addEventListener('fullscreenchange', updateTrueFullscreenUI);
document.addEventListener('webkitfullscreenchange', updateTrueFullscreenUI);
document.addEventListener('mozfullscreenchange', updateTrueFullscreenUI);
document.addEventListener('MSFullscreenChange', updateTrueFullscreenUI);

// Open/Close Fullscreen Player
function openFullscreenPlayer(triggerNative = true) {
  if (!audio.src) {
    const first = (typeof state !== 'undefined' && state.tracks) ? state.tracks.find(t => t.media_type !== 'video') : ((typeof queue !== 'undefined' && queue) ? queue[0] : null);
    if (first && typeof playById === 'function') {
      playById(first.id);
    } else {
      notify('Play a song to enter full screen.');
      return;
    }
  }
  isFsHudLocked = false;
  fsPlayer.classList.remove('fs-locked');
  const lockBtn = $('#fs-lock-hud-btn');
  if (lockBtn) {
    lockBtn.innerHTML = '<i class="ph-bold ph-lock-key-open"></i>';
    lockBtn.classList.remove('active');
  }
  fsPlayer.classList.add('open');
  try { sessionStorage.setItem('linus_fs_open', 'true'); } catch (e) {}
  resetFsIdleTimer();

  // Refresh active track UI in fullscreen
  const activeTrack = (typeof getActivePlaybackTrack === 'function' ? getActivePlaybackTrack() : (window.getActivePlaybackTrack ? window.getActivePlaybackTrack() : null)) || (typeof queue !== 'undefined' && queue && queue[currentIndex]);
  if (activeTrack && typeof updateFullscreenUI === 'function') {
    updateFullscreenUI(activeTrack);
  }

  // Refresh wallpaper in fullscreen
  const currentFsTheme = (typeof fsTheme !== 'undefined' && fsTheme) ? fsTheme : (window.fsTheme || null);
  if (typeof applyFullscreenTheme === 'function') {
    applyFullscreenTheme(currentFsTheme, false);
  } else if (typeof window.applyFullscreenTheme === 'function') {
    window.applyFullscreenTheme(currentFsTheme, false);
  }

  if (typeof updateFullscreenRing === 'function') {
    updateFullscreenRing(audio.currentTime || 0, audio.duration || (activeTrack && activeTrack.duration) || 0);
  }
  if (triggerNative && (!currentFsTheme || currentFsTheme.autoNativeFullscreen !== false)) {
    requestTrueFullscreen();
  }
  updateTrueFullscreenUI();
  if (typeof resizeVisualizerCanvases === 'function') {
    setTimeout(resizeVisualizerCanvases, 60);
  }
}

function closeFullscreenPlayer() {
  if (isFsHudLocked) {
    toggleFsHudLock(false);
  }
  fsPlayer.classList.remove('open');
  fsPlayer.classList.remove('fs-idle', 'fs-locked');
  try { sessionStorage.removeItem('linus_fs_open'); } catch (e) {}
  if (fsIdleTimer) clearTimeout(fsIdleTimer);
  if (isTrueFullscreen()) {
    exitTrueFullscreen();
  }
  updateTrueFullscreenUI();
}

$('.now-playing').addEventListener('click', (e) => {
  if (e.target.closest('button') || e.target.closest('input')) return;
  openFullscreenPlayer();
});

$('#fs-close').addEventListener('click', () => closeFullscreenPlayer());

// Expand Button
$('#fs-expand-btn').addEventListener('click', () => {
  openFullscreenPlayer();
});

// Dedicated True Fullscreen Toggle button in fs-header
$('#fs-native-fullscreen-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleTrueFullscreen();
});

// Helper for deterministic colors
function getTrackColors(str) {
  const palettes = [
    ['#1a1a2e', '#0f3460'], ['#2d4059', '#ea5455'], 
    ['#111113', '#2a2a35'], ['#2c3e50', '#3498db'],
    ['#0b0b0c', '#d4b07a'], ['#1C1C21', '#8FA998'],
    ['#4b134f', '#c94b4b'], ['#1e130c', '#9a8478']
  ];
  let hash = 0;
  for(let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return palettes[Math.abs(hash) % palettes.length];
}

// Background crossfade & UI update
function updateFullscreenUI(track) {
  if (!track) {
    track = (typeof getActivePlaybackTrack === 'function' ? getActivePlaybackTrack() : (window.getActivePlaybackTrack ? window.getActivePlaybackTrack() : null)) || (typeof queue !== 'undefined' && queue && queue[currentIndex]);
  }
  if (!track) return;

  const c = getTrackColors((track.id || '') + (track.title || ''));
  let bgStyle = `linear-gradient(135deg, ${c[0]}, ${c[1]})`;
  const isChameleon = window._isChameleonGlowEnabled || (typeof _isChameleonGlowEnabled !== 'undefined' ? _isChameleonGlowEnabled : false);
  const chameleonPal = window._currentChameleonPalette || (typeof _currentChameleonPalette !== 'undefined' ? _currentChameleonPalette : null);
  if (isChameleon && chameleonPal && chameleonPal.primary && chameleonPal.secondary) {
    const [r1, g1, b1] = chameleonPal.primary;
    const [r2, g2, b2] = chameleonPal.secondary;
    bgStyle = `linear-gradient(135deg, rgb(${r1}, ${g1}, ${b1}), rgb(${r2}, ${g2}, ${b2}))`;
  }
  
  const oldBg = $('#fs-bg-' + activeFsBg);
  activeFsBg = activeFsBg === 1 ? 2 : 1;
  window.activeFsBg = activeFsBg;
  const newBg = $('#fs-bg-' + activeFsBg);
  
  if (newBg) newBg.style.background = bgStyle;

  // Determine whether to display the fs-bg aurora layer or keep it hidden behind wallpaper
  const curFsTheme = (typeof fsTheme !== 'undefined' && fsTheme) ? fsTheme : (window.fsTheme || {});
  const effectiveWp = curFsTheme.wallpaperType === 'match-main'
    ? ((window.userTheme && window.userTheme.wallpaperType) || 'aura')
    : (curFsTheme.wallpaperType || 'match-main');
  const isAuroraMode = effectiveWp === 'aura' || effectiveWp === 'match-main';

  if (isAuroraMode) {
    if (newBg) { newBg.style.display = 'block'; newBg.style.opacity = '1'; }
    if (oldBg) oldBg.style.opacity = '0';
  } else {
    if (newBg) newBg.style.opacity = '0';
    if (oldBg) oldBg.style.opacity = '0';
  }

  $('#fs-title').textContent = track.title;
  $('#fs-artist').textContent = track.artist;
  
  // Vinyl Mode
  if (track.has_artwork && track.artwork_url) {
    $('#fs-disk-art').innerHTML = `<img src="${track.artwork_url}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    $('#fs-disk-art').style.background = 'none';
  } else {
    $('#fs-disk-art').innerHTML = `<span id="fs-disk-letter" style="font-size: 72px; font-weight: bold; color: rgba(255,255,255,0.2);">${track.title.slice(0,1).toUpperCase()}</span>`;
    $('#fs-disk-art').style.background = bgStyle;
  }
  
  // Modern Mode
  if (track.has_artwork && track.artwork_url) {
    $('#fs-modern-art').innerHTML = `<img src="${track.artwork_url}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:24px;">`;
    $('#fs-modern-art').style.background = 'none';
  } else {
    $('#fs-modern-art').innerHTML = `<span id="fs-modern-letter" style="font-size: 96px; font-weight: bold; color: rgba(255,255,255,0.3);">${track.title.slice(0,1).toUpperCase()}</span>`;
    $('#fs-modern-art').style.background = bgStyle;
  }

  // Stage Mode (3D CD Jewel Case & Metadata)
  const stageArt = $('#stage-album-art');
  const stageLetter = $('#stage-art-letter');
  if (stageArt) {
    if (track.has_artwork && track.artwork_url) {
      stageArt.src = track.artwork_url;
      stageArt.classList.remove('hidden');
      if (stageLetter) stageLetter.classList.add('hidden');
    } else {
      stageArt.classList.add('hidden');
      if (stageLetter) {
        stageLetter.textContent = track.title.slice(0, 1).toUpperCase();
        stageLetter.classList.remove('hidden');
      }
    }
  }

  // Peeking CD Disc Label Sync
  const stageDiscArt = $('#stage-disc-art');
  const stageDiscLetter = $('#stage-disc-letter');
  if (stageDiscArt) {
    if (track.has_artwork && track.artwork_url) {
      stageDiscArt.src = track.artwork_url;
      stageDiscArt.classList.remove('hidden');
      if (stageDiscLetter) stageDiscLetter.classList.add('hidden');
    } else {
      stageDiscArt.classList.add('hidden');
      if (stageDiscLetter) {
        stageDiscLetter.textContent = track.title.slice(0, 1).toUpperCase();
        stageDiscLetter.classList.remove('hidden');
      }
    }
  }

  const stageTitle = $('#stage-track-title');
  if (stageTitle) stageTitle.textContent = track.title;
  const stageArtist = $('#stage-track-artist');
  if (stageArtist) stageArtist.textContent = track.artist;

  // 90s Walkman LCD Deck Sync
  const walkmanTrack = $('#walkman-track-no');
  if (walkmanTrack) {
    const trackNum = (typeof currentIndex === 'number' && currentIndex >= 0) ? currentIndex + 1 : 1;
    walkmanTrack.textContent = String(trackNum).padStart(2, '0');
  }
  const walkmanTicker = $('#walkman-ticker-txt');
  if (walkmanTicker) {
    const tName = (track.title || 'UNKNOWN TRACK').toUpperCase();
    const aName = (track.artist || 'UNKNOWN ARTIST').toUpperCase();
    walkmanTicker.textContent = `${tName} • ${aName} • SONY DISCMAN D-E305 • 1-BIT DAC DIGITAL AUDIO • 45-SEC ESP`;
  }
  $('#lcd-badge-shuffle')?.classList.toggle('active', !!shuffleOn);
  $('#lcd-badge-repeat')?.classList.toggle('active', repeatMode !== 'none');

  // Mini Rolling Disk Artwork (Bottom-Left Dock)
  const miniArt = $('#fs-mini-art');
  if (miniArt) {
    if (track.has_artwork && track.artwork_url) {
      miniArt.innerHTML = `<img src="${track.artwork_url}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    } else {
      miniArt.innerHTML = `<span style="font-size:16px;font-weight:bold;color:#fff;">${track.title.slice(0,1).toUpperCase()}</span>`;
    }
  }

  // Sync dock states
  const isFav = state?.favorites?.includes(track.id);
  const fsLikeBtn = $('#fs-like');
  if (fsLikeBtn) {
    fsLikeBtn.innerHTML = `<i class="ph${isFav ? '-fill' : ''} ph-star" style="${isFav ? 'color:var(--accent);' : ''}"></i>`;
    fsLikeBtn.classList.toggle('active-fav', !!isFav);
  }
  $('#fs-shuffle')?.classList.toggle('active', !!shuffleOn);
  $('#fs-repeat')?.classList.toggle('active', repeatMode !== 'none');
  $('#fs-autodj-btn')?.classList.toggle('active', !!isAutoDJEnabled);

  // Aura Mode Orbs & Core
  const auraCore = $('#fs-aura-core');
  if (auraCore) auraCore.style.background = bgStyle;
  document.querySelectorAll('.orb').forEach(orb => orb.style.background = bgStyle);
  
  if (audio.paused) fsPlayer.classList.remove('playing');
  else fsPlayer.classList.add('playing');
}

// Sync Audio Controls
$('#fs-play')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (typeof window.togglePlayGlobal === 'function') {
    window.togglePlayGlobal();
  }
});
$('#fs-next').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#next').click();
});
$('#fs-prev').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#previous').click();
});
$('#fs-shuffle').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#shuffle-btn').click();
  $('#fs-shuffle').classList.toggle('active', shuffleOn);
});
$('#fs-repeat').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#repeat-btn').click();
  $('#fs-repeat').classList.toggle('active', repeatMode !== 'none');
});
$('#fs-like').addEventListener('click', (e) => {
  e.stopPropagation();
  const cur = queue[currentIndex];
  if (cur) toggleFavorite(cur.id);
});
$('#fs-radio-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  startTrackRadio();
});
$('#fs-autodj-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  if (typeof toggleAutoDJ === 'function') {
    toggleAutoDJ();
    $('#fs-autodj-btn')?.classList.toggle('active', !!isAutoDJEnabled);
  }
});

// Interactive Progress Ring (Vinyl) & Linear Bar
const diskContainer = $('#fs-disk-container');
const linearProgress = $('#fs-progress-bar-wrapper');
let isDraggingSeek = false;
window.isDraggingSeek = false;

// Vinyl Ring Seeking
diskContainer?.addEventListener('pointerdown', (e) => {
  if (!audio.src) return;
  isDraggingSeek = true;
  window.isDraggingSeek = true;
  diskContainer.classList.add('seeking');
  updateRingSeek(e);
  diskContainer.setPointerCapture(e.pointerId);
});
diskContainer?.addEventListener('pointermove', (e) => {
  if (!isDraggingSeek) return;
  updateRingSeek(e);
});
diskContainer?.addEventListener('pointerup', (e) => {
  if (!isDraggingSeek) return;
  isDraggingSeek = false;
  window.isDraggingSeek = false;
  diskContainer.classList.remove('seeking');
  diskContainer.releasePointerCapture(e.pointerId);
});
function updateRingSeek(e) {
  const rect = diskContainer.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = e.clientX - cx;
  const dy = e.clientY - cy;
  let angle = Math.atan2(dy, dx) + Math.PI / 2;
  if (angle < 0) angle += 2 * Math.PI;
  const pct = Math.max(0, Math.min(1, angle / (2 * Math.PI)));
  if (audio.duration) audio.currentTime = pct * audio.duration;
  updateFullscreenRing(audio.currentTime, audio.duration);
}

// Linear Bar Seeking
linearProgress?.addEventListener('pointerdown', (e) => {
  if (!audio.src) return;
  isDraggingSeek = true;
  window.isDraggingSeek = true;
  updateLinearSeek(e);
  linearProgress.setPointerCapture(e.pointerId);
});
linearProgress?.addEventListener('pointermove', (e) => {
  if (!isDraggingSeek) return;
  updateLinearSeek(e);
});
linearProgress?.addEventListener('pointerup', (e) => {
  if (!isDraggingSeek) return;
  isDraggingSeek = false;
  window.isDraggingSeek = false;
  linearProgress.releasePointerCapture(e.pointerId);
});
function updateLinearSeek(e) {
  const rect = linearProgress.getBoundingClientRect();
  const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  if (audio.duration) audio.currentTime = pct * audio.duration;
  updateFullscreenRing(audio.currentTime, audio.duration);
}

function updateFullscreenRing(currentTime, duration) {
  if (!duration || duration <= 0) {
    if (typeof audio !== 'undefined' && audio && audio.duration) {
      duration = audio.duration;
    }
  }
  if (!duration || duration <= 0) return;
  const pct = Math.max(0, Math.min(1, (currentTime || 0) / duration));
  
  // Update Vinyl Ring
  const circ = 942.477;
  const ringFill = $('#fs-ring-fill');
  if (ringFill) ringFill.style.strokeDashoffset = circ - (pct * circ);
  
  // Update Linear Bar
  const progFill = $('#fs-progress-bar-fill');
  if (progFill) progFill.style.width = (pct * 100) + '%';
  const curTime = $('#fs-time-current');
  if (curTime) curTime.textContent = formatTime(currentTime || 0);
  const totTime = $('#fs-time-total');
  if (totTime) totTime.textContent = formatTime(duration);

  // Update Walkman LCD Timecode & ESP Ring Fill
  const walkmanTime = $('#walkman-time-code');
  if (walkmanTime) {
    const m = Math.floor(currentTime / 60);
    const s = Math.floor(currentTime % 60);
    walkmanTime.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  const espFill = $('#walkman-esp-fill');
  if (espFill) {
    const espCirc = 113.1;
    espFill.style.strokeDashoffset = espCirc - (pct * espCirc);
  }
}

// Automatically sync progress on timeupdate directly within fullscreen engine
if (typeof audio !== 'undefined' && audio) {
  audio.addEventListener('timeupdate', () => {
    const isSeeking = window.isDraggingSeek || isDraggingSeek;
    const cur = audio.currentTime || 0;
    const dur = audio.duration || (typeof queue !== 'undefined' && queue && queue[currentIndex]?.duration) || 0;
    if (!isSeeking && dur > 0) {
      updateFullscreenRing(cur, dur);
    }
  });
}



  // Expose Fullscreen Player API to global window
  window.fsPlayer = fsPlayer;
  window.FS_MODES = FS_MODES;
  window.currentFsMode = currentFsMode;
  window.setFullscreenMode = setFullscreenMode;
  window.cycleFullscreenMode = cycleFullscreenMode;
  window.toggleVisualizerPanel = toggleVisualizerPanel;
  window.closeVisualizerPanel = closeVisualizerPanel;
  window.isTrueFullscreen = isTrueFullscreen;
  window.requestTrueFullscreen = requestTrueFullscreen;
  window.exitTrueFullscreen = exitTrueFullscreen;
  window.toggleTrueFullscreen = toggleTrueFullscreen;
  window.updateTrueFullscreenUI = updateTrueFullscreenUI;
  window.openFullscreenPlayer = openFullscreenPlayer;
  window.closeFullscreenPlayer = closeFullscreenPlayer;
  window.updateFullscreenRing = updateFullscreenRing;
  window.toggleFsHudLock = toggleFsHudLock;
  window.updateFullscreenUI = updateFullscreenUI;
  window.getTrackColors = getTrackColors;

  // Seamless auto-restore if user refreshed while in fullscreen mode
  try {
    if (sessionStorage.getItem('linus_fs_open') === 'true') {
      setTimeout(() => {
        if (sessionStorage.getItem('linus_fs_open') === 'true' && fsPlayer && !fsPlayer.classList.contains('open')) {
          openFullscreenPlayer(false);
        }
      }, 150);
    }
  } catch (e) {}

})();
