// ============================================================
// Linus — app.js (v2 Aesthetic)
// ============================================================

// ---- Dual-Deck Audio Architecture (Deck A + Deck B for Seamless Auto-DJ) ----
const _audioA = document.querySelector('#audio');
const _audioB = document.querySelector('#audio-deck-b');
let activeDeck = 'A'; // 'A' | 'B'

function getActiveAudio() {
  return (activeDeck === 'B' && _audioB) ? _audioB : _audioA;
}

function getStandbyAudio() {
  return (activeDeck === 'B') ? _audioA : (_audioB || _audioA);
}

// Proxied audio interface so all existing code references to `audio` dynamically
// operate on whichever deck is currently active!
const _audioRegisteredListeners = new Map();

const audio = new Proxy(_audioA, {
  get(target, prop, receiver) {
    const active = getActiveAudio();
    if (prop === 'addEventListener') {
      return function(type, listener, options) {
        if (!_audioRegisteredListeners.has(type)) {
          _audioRegisteredListeners.set(type, new Set());
        }
        _audioRegisteredListeners.get(type).add(listener);

        _audioA.addEventListener(type, function(e) {
          if (activeDeck === 'A' || e.__forceCrossfade) {
            listener.call(_audioA, e);
          }
        }, options);

        if (_audioB) {
          _audioB.addEventListener(type, function(e) {
            if (activeDeck === 'B' || e.__forceCrossfade) {
              listener.call(_audioB, e);
            }
          }, options);
        }
      };
    }
    if (prop === 'removeEventListener') {
      return function(type, listener, options) {
        _audioA.removeEventListener(type, listener, options);
        if (_audioB) _audioB.removeEventListener(type, listener, options);
        if (_audioRegisteredListeners.has(type)) {
          _audioRegisteredListeners.get(type).delete(listener);
        }
      };
    }
    const val = Reflect.get(active, prop, active);
    if (typeof val === 'function') {
      return val.bind(active);
    }
    return val;
  },
  set(target, prop, value, receiver) {
    const active = getActiveAudio();
    return Reflect.set(active, prop, value, active);
  }
});

const state = {
  tracks: [],
  playlists: {},
  favorites: [],
  history: [],
  positions: {},
  lyrics: {},
  track_categories: {},
  categories: [],
  library_folders: [],
};
window.state = state;

let queue = [];
let currentIndex = -1;
let shuffleOn = false;
let repeatMode = 'none'; // 'none' | 'one' | 'all'
let toastTimer;
let currentVideoTrack = null;
let activeJobId = null;
let progressSSE = null;
let activeCategory = '';

// Shared YouTube stream state across modules
var _ytCurrentStreamId = '';
var _ytCurrentStreamType = '';
var _ytCurrentStreamTrack = null;
var _ytSearchQuery = '';

// Shared Audio DSP and Seeking State
var isDraggingSeek = false;
window.isDraggingSeek = false;
var audioCtx = null;
var analyser = null;
var audioDataArray = null;

// Hover preview state (hoisted to top to prevent temporal dead zone)
let _isHoverPreviewEnabled = localStorage.getItem('linus_hover_preview_enabled') !== 'false';
let _previewAudio = new Audio();
_previewAudio.preload = 'auto';
let _hoverPreviewDebounceTimer = null;
let _hoverPreview20sTimer = null;
let _hoverPreviewTarget = null;
let _isMainAudioDucked = false;
let _preDuckVolume = 1.0;
let _previewFadeInterval = null;

const $ = sel => document.querySelector(sel);
const escapeHtml = v => String(v).replace(/[&<>'"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function getActivePlaybackTrack() {
  if (typeof _ytCurrentStreamId !== 'undefined' && _ytCurrentStreamId && _ytCurrentStreamTrack) {
    return _ytCurrentStreamTrack;
  }
  return (typeof queue !== 'undefined' && queue && queue[currentIndex]) || null;
}

window.audio = audio;
window._audioA = _audioA;
window._audioB = _audioB;
window.$ = $;
window.escapeHtml = escapeHtml;
window.getActivePlaybackTrack = getActivePlaybackTrack;

async function api(url, options = {}) {
  const res = await fetch(url, { headers: {'Content-Type':'application/json'}, ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function notify(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function formatTime(s) {
  if (!Number.isFinite(s)) return '0:00';
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
}

window.api = api;
window.notify = notify;
window.formatTime = formatTime;

// ---- Hydrate & Persistent State -----------------------------
let _pendingOnlineTracks = [];
let _onlineTrackSyncTimer = null;
function syncOnlineTrackToDB(track) {
  if (!track || !track.id) return;
  _pendingOnlineTracks.push(track);
  clearTimeout(_onlineTrackSyncTimer);
  _onlineTrackSyncTimer = setTimeout(async () => {
    const batch = [..._pendingOnlineTracks];
    _pendingOnlineTracks = [];
    if (batch.length === 0) return;
    try {
      await api('/api/tracks/cache-online', {
        method: 'POST',
        body: JSON.stringify({ tracks: batch })
      });
    } catch (e) {
      console.warn('Failed to sync online tracks to DB:', e);
    }
  }, 400);
}
window.syncOnlineTrackToDB = syncOnlineTrackToDB;

function sanitizeThemeForStorage(theme) {
  if (!theme || typeof theme !== 'object') return theme;
  const copy = { ...theme };
  if (copy.customImageSrc && copy.customImageSrc.startsWith('blob:')) {
    copy.customImageSrc = copy.sourceUrl || '';
  }
  if (copy.customVideoSrc && copy.customVideoSrc.startsWith('blob:')) {
    copy.customVideoSrc = copy.sourceUrl || '';
  }
  return copy;
}
window.sanitizeThemeForStorage = sanitizeThemeForStorage;

let _settingsSyncTimer = null;
function syncUserSettingsToDB(settings) {
  if (!settings || typeof settings !== 'object') return;
  const sanitized = { ...settings };
  if (sanitized.custom_theme) sanitized.custom_theme = sanitizeThemeForStorage(sanitized.custom_theme);
  if (sanitized.fs_theme) sanitized.fs_theme = sanitizeThemeForStorage(sanitized.fs_theme);
  if (!state.user_settings) state.user_settings = {};
  state.user_settings = { ...state.user_settings, ...sanitized };
  clearTimeout(_settingsSyncTimer);
  _settingsSyncTimer = setTimeout(async () => {
    try {
      await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify(state.user_settings)
      });
    } catch (e) {
      console.warn('Failed to sync settings to DB:', e);
    }
  }, 400);
}
window.syncUserSettingsToDB = syncUserSettingsToDB;

async function saveState() {
  try {
    await api('/api/state', {
      method: 'POST',
      body: JSON.stringify({
        playlists: state.playlists,
        favorites: state.favorites,
        history: state.history,
        last_played_track_id: state.last_played_track_id,
        last_played_position: state.last_played_position,
        lyrics: state.lyrics,
        track_categories: state.track_categories,
        library_folders: state.library_folders,
        playback_queue: state.playback_queue,
        user_settings: state.user_settings
      })
    });
  } catch (err) {
    console.error('Failed to save state:', err);
  }
}

let _saveStateTimer = null;
function debouncedSaveState(delay = 1000) {
  clearTimeout(_saveStateTimer);
  _saveStateTimer = setTimeout(saveState, delay);
}

let _saveQueueTimer = null;
function saveQueueState() {
  try {
    if (!Array.isArray(queue) || queue.length === 0) {
      state.playback_queue = { queue: [], currentIndex: 0 };
      debouncedSaveState(500);
      return;
    }
    const serialized = queue.slice(0, 50).map(t => ({
      id: t.id,
      title: t.title || '',
      artist: t.artist || '',
      album: t.album || '',
      duration: t.duration || 0,
      artwork_url: t.artwork_url || '',
      is_online: !!t.is_online,
      video_id: t.video_id || '',
      category: t.category || '',
      genre: t.genre || '',
      url: t.url || '',
      extension: t.extension || '',
      quality: t.quality || '',
      missing: !!t.missing
    }));
    state.playback_queue = {
      queue: serialized,
      currentIndex: currentIndex
    };
    debouncedSaveState(600);
  } catch (e) {
    console.warn('Queue persistence error:', e);
  }
}

function debouncedSaveQueue(delay = 600) {
  clearTimeout(_saveQueueTimer);
  _saveQueueTimer = setTimeout(saveQueueState, delay);
}

function saveSessionBeforeClose() {
  try {
    const sessionSnapshot = {
      last_played_track_id: state.last_played_track_id || (queue && queue[currentIndex] ? queue[currentIndex].id : null),
      last_played_position: audio ? (audio.currentTime || 0) : (state.last_played_position || 0),
      playback_queue: (Array.isArray(queue) && queue.length > 0) ? {
        queue: queue.slice(0, 50).map(t => ({
          id: t.id,
          title: t.title || '',
          artist: t.artist || '',
          album: t.album || '',
          duration: t.duration || 0,
          artwork_url: t.artwork_url || '',
          is_online: !!t.is_online,
          video_id: t.video_id || '',
          url: t.url || ''
        })),
        currentIndex: currentIndex
      } : { queue: [], currentIndex: 0 },
      user_settings: {
        tour_completed: localStorage.getItem('linus_tour_completed') === 'true' || !!(state.user_settings && state.user_settings.tour_completed),
        vibe: typeof currentVibe !== 'undefined' ? currentVibe : null,
        radio_mode: typeof radioMode !== 'undefined' ? radioMode : null,
        autodj_enabled: typeof isAutoDJEnabled !== 'undefined' ? isAutoDJEnabled : null,
        autodj_duration: typeof autoDJDuration !== 'undefined' ? autoDJDuration : null,
        audio_norm_enabled: typeof isAudioNormEnabled !== 'undefined' ? isAudioNormEnabled : null,
        karaoke_enabled: typeof isKaraokeEnabled !== 'undefined' ? isKaraokeEnabled : null,
        hover_preview_enabled: typeof _isHoverPreviewEnabled !== 'undefined' ? _isHoverPreviewEnabled : null,
        chameleon_glow_enabled: typeof _isChameleonGlowEnabled !== 'undefined' ? _isChameleonGlowEnabled : null,
        sidebar_pinned: typeof isSidebarPinned !== 'undefined' ? isSidebarPinned : null,
        fullscreen_mode: typeof currentFsMode !== 'undefined' ? currentFsMode : null,
        custom_theme: (typeof userTheme !== 'undefined' && userTheme) ? sanitizeThemeForStorage(userTheme) : null,
        fs_theme: (typeof fsTheme !== 'undefined' && fsTheme) ? sanitizeThemeForStorage(fsTheme) : null
      }
    };

    const blob = new Blob([JSON.stringify(sessionSnapshot)], { type: 'application/json' });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/state/sync-session', blob);
    } else {
      fetch('/api/state/sync-session', {
        method: 'POST',
        body: blob,
        keepalive: true
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('Session sync on close error:', e);
  }
}

function clearLinusBrowserCache(showNotification = false) {
  try {
    // Preserve key user settings so personalization is not destroyed
    const preserved = {};
    const preserveKeys = [
      'linus_tour_completed',
      'linus_custom_theme',
      'linus_fs_theme',
      'linus_vibe',
      'linus_sidebar_pinned',
      'linus_radio_mode',
      'linus_autodj_enabled',
      'linus_autodj_duration',
      'linus_audio_normalization',
      'linus_karaoke_enabled',
      'linus_hover_preview_enabled',
      'linus_chameleon_glow_enabled',
      'linus_wallpaper_history'
    ];
    preserveKeys.forEach(k => {
      const val = localStorage.getItem(k);
      if (val !== null) preserved[k] = val;
    });

    // 1. Clear LocalStorage and SessionStorage, then restore user settings
    localStorage.clear();
    sessionStorage.clear();
    Object.entries(preserved).forEach(([k, v]) => {
      try { localStorage.setItem(k, v); } catch(e) {}
    });

    // 2. Clear Cache Storage API (Service Worker caches)
    if (window.caches && caches.keys) {
      caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))));
    }

    // 3. Inform Service Worker to wipe any offline caches
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_CACHES' });
    }

    if (showNotification && typeof notify === 'function') {
      notify('🧹 Browser cache and local storage cleaned! All songs, queues and settings remain safely stored in the database.');
    }
  } catch (e) {
    console.warn('Error clearing browser cache:', e);
  }
}
window.clearLinusBrowserCache = clearLinusBrowserCache;

// Persist playback queue, track position and user settings before unload
window.addEventListener('beforeunload', () => {
  saveSessionBeforeClose();
});

window.addEventListener('pagehide', () => {
  saveSessionBeforeClose();
});

function restoreLastPlaybackSession(trackId, position) {
  const track = trackById(trackId);
  if (!track || track.missing || track.media_type === 'video') return;

  currentIndex = queue.findIndex(t => t.id === trackId);
  if (currentIndex < 0) {
    currentIndex = 0;
  }

  audio.src = track.url;
  audio.currentTime = position || 0;

  $('#now-title').textContent = track.title;
  $('#now-artist').textContent = track.artist;
  if (track.has_artwork && track.artwork_url) {
    $('#now-art').innerHTML = `<img src="${track.artwork_url}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    $('#album-art-box').innerHTML = `<img src="${track.artwork_url}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;box-shadow:0 0 20px rgba(0,0,0,0.6);">`;
  } else {
    $('#now-art').innerHTML = `<i class="ph-fill ph-music-notes"></i>`;
    $('#album-art-box').innerHTML = `<i class="ph-fill ph-music-notes-simple"></i>`;
  }

  $('#hero-title').innerHTML = `${escapeHtml(track.title)}<br><em>ready to play.</em>`;
  $('#hero-artist').textContent = `${track.artist} · ${track.album}`;
  const durStr = track.duration ? ` · ${formatTime(track.duration)}` : '';
  if ($('#hero-format')) $('#hero-format').textContent = `${(track.extension || 'audio').toUpperCase()} · ${track.quality || 'Standard'}${durStr}`;
  
  if ($('#current-time')) $('#current-time').textContent = formatTime(position || 0);
  if (track.duration) {
    if ($('#total-time')) $('#total-time').textContent = formatTime(track.duration);
    if ($('#progress')) $('#progress').value = (position / track.duration) * 100;
  }

  try { if (typeof applyChameleonPalette === 'function') applyChameleonPalette(track); } catch (e) {}
  try {
    if (typeof updateFullscreenUI === 'function') updateFullscreenUI(track);
    else if (typeof window.updateFullscreenUI === 'function') window.updateFullscreenUI(track);
  } catch (e) {}
  try { if (typeof syncNowPlayingFavorite === 'function') syncNowPlayingFavorite(track.id); } catch (e) {}
  try { if (typeof loadLyricsInline === 'function') loadLyricsInline(track); } catch (e) {}
  try { if (typeof updateMediaSessionMetadata === 'function') updateMediaSessionMetadata(track); } catch (e) {}
}

function hydrate(data) {
  state.tracks = data.tracks || [];
  state.categories = data.categories || [];
  const saved = data.state || {};
  state.playlists = saved.playlists || {};
  if (!state.online_tracks_cache) state.online_tracks_cache = {};

  // Clean any old bloated linus_online_tracks_cache from browser localStorage to free quota
  try {
    const legacyCached = localStorage.getItem('linus_online_tracks_cache');
    if (legacyCached) {
      const parsed = JSON.parse(legacyCached);
      if (parsed && typeof parsed === 'object') {
        state.online_tracks_cache = { ...parsed, ...state.online_tracks_cache };
        const tracksList = Object.values(parsed);
        if (tracksList.length > 0) {
          api('/api/tracks/cache-online', {
            method: 'POST',
            body: JSON.stringify({ tracks: tracksList })
          }).catch(() => {});
        }
      }
      localStorage.removeItem('linus_online_tracks_cache');
    }
  } catch (e) {}

  // Hydrate online tracks directly from the server SQLite database into RAM
  if (data.online_tracks && typeof data.online_tracks === 'object') {
    state.online_tracks_cache = { ...state.online_tracks_cache, ...data.online_tracks };
  }

  // Restore user settings from database
  const userSettings = data.settings || saved.user_settings || {};
  state.user_settings = userSettings;
  if (userSettings && typeof userSettings === 'object') {
    if (userSettings.vibe && typeof currentVibe !== 'undefined') {
      currentVibe = userSettings.vibe;
      document.body.dataset.vibe = currentVibe;
    }
    if (userSettings.radio_mode && typeof radioMode !== 'undefined') {
      radioMode = userSettings.radio_mode;
    }
    if (typeof userSettings.autodj_duration === 'number' && typeof autoDJDuration !== 'undefined') {
      autoDJDuration = userSettings.autodj_duration;
    }
    if (typeof userSettings.autodj_enabled === 'boolean' && typeof isAutoDJEnabled !== 'undefined') {
      isAutoDJEnabled = userSettings.autodj_enabled;
    }
    if (typeof userSettings.sidebar_pinned === 'boolean' && typeof isSidebarPinned !== 'undefined') {
      isSidebarPinned = userSettings.sidebar_pinned;
      const sb = $('#sidebar');
      if (sb) {
        if (isSidebarPinned) sb.classList.add('pinned');
        else sb.classList.remove('pinned');
      }
    }
    if (userSettings.tour_completed) {
      try { localStorage.setItem('linus_tour_completed', 'true'); } catch(e) {}
      if (window.LinusTour && typeof window.LinusTour.hideWelcome === 'function') {
        window.LinusTour.hideWelcome();
      }
    }
    if (userSettings.custom_theme && typeof applyUserTheme === 'function') {
      try {
        const themeToApply = { ...userSettings.custom_theme };
        if (themeToApply.wallpaperType === 'custom-image') {
          if (window.activeWallpaperBlobUrl) {
            themeToApply.customImageSrc = window.activeWallpaperBlobUrl;
          } else if (themeToApply.customImageSrc && themeToApply.customImageSrc.startsWith('blob:')) {
            themeToApply.customImageSrc = themeToApply.sourceUrl || (window.userTheme && window.userTheme.sourceUrl) || '';
          }
        }
        applyUserTheme(themeToApply, false);
      } catch(e) {}
    }
    if (userSettings.fs_theme && typeof applyFullscreenTheme === 'function') {
      try {
        const fsThemeToApply = { ...userSettings.fs_theme };
        if (fsThemeToApply.wallpaperType === 'custom-image' || fsThemeToApply.wallpaperType === 'match-main') {
          if (window.activeWallpaperBlobUrl) {
            fsThemeToApply.customImageSrc = window.activeWallpaperBlobUrl;
          } else if (fsThemeToApply.customImageSrc && fsThemeToApply.customImageSrc.startsWith('blob:')) {
            fsThemeToApply.customImageSrc = fsThemeToApply.sourceUrl || (window.fsTheme && window.fsTheme.sourceUrl) || '';
          }
        }
        applyFullscreenTheme(fsThemeToApply, false);
      } catch(e) {}
    }
  }

  state.favorites = saved.favorites || [];
  state.history = saved.history || [];
  state.last_played_track_id = saved.last_played_track_id || null;
  state.last_played_position = saved.last_played_position || 0;
  state.lyrics = saved.lyrics || {};
  state.track_categories = saved.track_categories || {};
  state.library_folders = saved.library_folders || [];

  const audioTracks = state.tracks.filter(t => t.media_type !== 'video');
  let restoredQueue = null;

  // Restore queue from Database (primary) with legacy localStorage fallback
  const dbQueue = data.playback_queue || saved.playback_queue;
  if (dbQueue && Array.isArray(dbQueue.queue) && dbQueue.queue.length > 0) {
    const trackMap = new Map(state.tracks.map(t => [t.id, t]));
    restoredQueue = dbQueue.queue.map(t => {
      if (trackMap.has(t.id)) {
        return { ...trackMap.get(t.id), ...t };
      }
      return t;
    });
    if (typeof dbQueue.currentIndex === 'number' && dbQueue.currentIndex >= 0 && dbQueue.currentIndex < restoredQueue.length) {
      currentIndex = dbQueue.currentIndex;
    } else {
      currentIndex = 0;
    }
  } else {
    try {
      const raw = localStorage.getItem('linus_playback_queue');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
          const trackMap = new Map(state.tracks.map(t => [t.id, t]));
          restoredQueue = parsed.queue.map(t => {
            if (trackMap.has(t.id)) {
              return { ...trackMap.get(t.id), ...t };
            }
            return t;
          });
          if (typeof parsed.currentIndex === 'number' && parsed.currentIndex >= 0 && parsed.currentIndex < restoredQueue.length) {
            currentIndex = parsed.currentIndex;
          } else {
            currentIndex = 0;
          }
        }
        localStorage.removeItem('linus_playback_queue');
      }
    } catch (e) {
      console.warn('Queue restoration error:', e);
    }
  }

  if (restoredQueue && restoredQueue.length > 0) {
    queue = restoredQueue;
  } else {
    queue = [...audioTracks];
    currentIndex = state.last_played_track_id ? queue.findIndex(t => t.id === state.last_played_track_id) : 0;
    if (currentIndex < 0) currentIndex = 0;
  }

  if ($('#search')) {
    $('#search').value = '';
  }
  renderCategoryBar();
  renderTracks(audioTracks);
  renderQueue();
  renderContinueRail();
  renderVideos();
  renderFavorites();
  renderPlaylists();

  // Load full Spotify/YouTube Music-style recommendation dashboard
  if (typeof loadDashboardRecommendations === 'function') {
    loadDashboardRecommendations();
  } else if (typeof window.loadDashboardRecommendations === 'function') {
    window.loadDashboardRecommendations();
  }
  if (typeof renderDashboardUpNext === 'function') {
    renderDashboardUpNext();
  } else if (typeof window.renderDashboardUpNext === 'function') {
    window.renderDashboardUpNext();
  }
  if (typeof initHeroWaveformVisualizer === 'function') initHeroWaveformVisualizer();

  const count = audioTracks.length;
  $('#library-status').textContent = `${count} audio file${count === 1 ? '' : 's'} available`;

  const meta = data.metadata || {};
  const trackCount = meta.track_count !== undefined ? ` · ${meta.track_count} indexed` : '';
  $('#database-status').textContent = meta.connected
    ? `SQLite: Ready${trackCount}`
    : 'SQLite: Unavailable';

  // Restore last active session if available (but don't interrupt a YouTube stream)
  if (state.last_played_track_id && !_ytCurrentStreamId) {
    restoreLastPlaybackSession(state.last_played_track_id, state.last_played_position);
  } else if (queue && queue[0] && typeof applyChameleonPalette === 'function') {
    applyChameleonPalette(queue[0]);
  }
}

// ---- Animated Sidebar & Edge Trigger Architecture -----------
let isSidebarPinned = localStorage.getItem('linus_sidebar_pinned') === 'true';
let sidebarIntroTimer = null;
let hasSidebarIntroPlayed = false;

function applySidebarPinnedState() {
  if (isSidebarPinned) {
    document.body.classList.add('sidebar-is-pinned');
    $('#sidebar')?.classList.add('sidebar-open');
    $('#sidebar-pin-btn')?.classList.add('pinned');
    $('#sidebar-pin-btn')?.setAttribute('title', 'Unpin sidebar (auto-hide mode)');
  } else {
    document.body.classList.remove('sidebar-is-pinned');
    $('#sidebar-pin-btn')?.classList.remove('pinned');
    $('#sidebar-pin-btn')?.setAttribute('title', 'Pin sidebar visible');
  }
}

function openSidebar() {
  if (sidebarIntroTimer) {
    clearTimeout(sidebarIntroTimer);
    sidebarIntroTimer = null;
  }
  $('#sidebar')?.classList.remove('sidebar-intro-rollout');
  document.body.classList.remove('sidebar-intro-active');

  $('#sidebar')?.classList.add('sidebar-open', 'mobile-open');
  $('#sidebar-backdrop')?.classList.add('active');
  document.body.classList.add('sidebar-is-open');
}

function closeSidebar() {
  if (isSidebarPinned && window.innerWidth > 860) return; // Keep pinned on desktop if preferred
  if (sidebarIntroTimer) {
    clearTimeout(sidebarIntroTimer);
    sidebarIntroTimer = null;
  }
  $('#sidebar')?.classList.remove('sidebar-intro-rollout', 'sidebar-open', 'mobile-open');
  $('#sidebar-backdrop')?.classList.remove('active');
  document.body.classList.remove('sidebar-is-open', 'sidebar-intro-active');
}

function toggleSidebar() {
  const isOpen = $('#sidebar')?.classList.contains('sidebar-open') || $('#sidebar')?.classList.contains('mobile-open');
  if (isOpen) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function toggleSidebarPin() {
  isSidebarPinned = !isSidebarPinned;
  try { localStorage.setItem('linus_sidebar_pinned', isSidebarPinned ? 'true' : 'false'); } catch (e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ sidebar_pinned: isSidebarPinned });
  applySidebarPinnedState();
  if (isSidebarPinned) {
    openSidebar();
    showToast('Sidebar pinned to screen', 'info');
  } else {
    showToast('Sidebar unpinned (Touch edge to open)', 'info');
  }
}

// Backward compatibility helper
function closeMobileSidebar() { closeSidebar(); }
function openMobileSidebar() { openSidebar(); }

// Trigger handlers
$('#mobile-menu-btn')?.addEventListener('click', toggleSidebar);
$('#sidebar-close-btn')?.addEventListener('click', closeSidebar);
$('#sidebar-backdrop')?.addEventListener('click', closeSidebar);
$('#sidebar-pin-btn')?.addEventListener('click', toggleSidebarPin);

// Floating edge trigger handle (touch or click)
const edgeTrigger = $('#sidebar-edge-trigger');
if (edgeTrigger) {
  edgeTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    openSidebar();
  });
  edgeTrigger.addEventListener('touchstart', (e) => {
    e.stopPropagation();
    openSidebar();
  }, { passive: true });
}


// Initial greeting roll-out animation when website opens
function initSidebarRolloutIntro() {
  if (hasSidebarIntroPlayed) return;
  hasSidebarIntroPlayed = true;

  applySidebarPinnedState();
  if (isSidebarPinned) return; // Already docked, skip retraction

  const sidebar = $('#sidebar');
  if (!sidebar) return;

  // Add intro animation classes so user watches the sidebar roll out smoothly
  document.body.classList.add('sidebar-intro-active');
  sidebar.classList.add('sidebar-intro-rollout');

  // Cancel retraction if user hovers or interacts with sidebar during the intro rollout
  const cancelIntroAutoClose = () => {
    if (sidebarIntroTimer) {
      clearTimeout(sidebarIntroTimer);
      sidebarIntroTimer = null;
    }
    sidebar.classList.remove('sidebar-intro-rollout');
    openSidebar();
    sidebar.removeEventListener('pointerenter', cancelIntroAutoClose);
    sidebar.removeEventListener('touchstart', cancelIntroAutoClose);
  };
  sidebar.addEventListener('pointerenter', cancelIntroAutoClose, { once: true });
  sidebar.addEventListener('touchstart', cancelIntroAutoClose, { once: true, passive: true });

  // Let the sidebar display and then smoothly glide back into the edge
  sidebarIntroTimer = setTimeout(() => {
    sidebar.classList.remove('sidebar-intro-rollout');
    document.body.classList.remove('sidebar-intro-active');
    sidebarIntroTimer = null;
  }, 2800);
}

// ---- Views --------------------------------------------------
function switchView(viewName) {
  if (!viewName) return;

  // Sync active states across sidebar and mobile bottom nav
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });
  document.querySelectorAll('.mobile-nav-item').forEach(b => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });

  // Switch views
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  const targetView = $(`#${viewName}-view`);
  if (targetView) targetView.classList.remove('hidden');

  closeMobileSidebar();

  if (viewName === 'favorites') renderFavorites();
  if (viewName === 'playlists') {
    if ($('#search')) $('#search').value = '';
    renderPlaylists();
  }
  if (viewName === 'downloads') renderDownloadsView();
  if (viewName === 'library') renderTracks(state.tracks.filter(t => t.media_type !== 'video'));
  if (viewName === 'lyrics') {
    const activeT = getActivePlaybackTrack();
    if (activeT) loadLyricsInline(activeT);
  }
  if (viewName === 'explore') {
    const resultsContainer = $('#explore-results');
    if (resultsContainer && !resultsContainer.children.length && !_ytSearchQuery) {
      $('#explore-input').value = 'Trending English Pop Hits 2024';
      searchYouTube('Trending English Pop Hits 2024');
    }
  }
  if (viewName === 'dj-studio') {
    if (!audio.paused) {
      audio.pause();
      $('#play').innerHTML = '<i class="ph-fill ph-play"></i>';
      $('#vinyl-record')?.classList.remove('playing');
    }
    if (!window.djStudio) {
      window.djStudio = new DJStudioUI();
    }
    window.djStudio.init();
    notify('🎧 DJ Remix Studio Activated — Load tracks to Deck A & B');
  }
}
window.switchView = switchView;

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

document.querySelectorAll('.mobile-nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ---- Renderers ----------------------------------------------
function renderCategoryBar() {
  const bar = $('#category-bar');
  if (!state.categories.length) { bar.innerHTML = ''; return; }
  const all = `<button class="cat-pill ${activeCategory===''?'active':''}" data-cat="">All</button>`;
  const pills = state.categories.map(c =>
    `<button class="cat-pill ${activeCategory===c?'active':''}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join('');
  bar.innerHTML = all + pills;
  bar.querySelectorAll('.cat-pill').forEach(btn =>
    btn.addEventListener('click', () => {
      activeCategory = btn.dataset.cat;
      if ($('#search')) {
    $('#search').value = '';
  }
  renderCategoryBar();
      renderTracks(state.tracks.filter(t => t.media_type !== 'video'));
    })
  );
}

function _buildTrackRowHtml(t, i, currentPlayingId, isFavView = false) {
  const isPlaying = t.id === currentPlayingId;
  const isFav = state.favorites.includes(t.id);
  const waveBadge = isPlaying ? `
    <span class="track-soundwave" title="Currently Playing">
      <span class="wave-bar-mini"></span>
      <span class="wave-bar-mini"></span>
      <span class="wave-bar-mini"></span>
      <span class="wave-bar-mini"></span>
    </span>` : '';

  return `
  <div class="track-row ${isPlaying ? 'row-playing' : ''}" data-id="${escapeHtml(t.id)}">
    <span class="track-num">${isPlaying ? waveBadge : String(i+1).padStart(2,'0')}</span>
    <div class="track-thumb">
      ${t.has_artwork && t.artwork_url
        ? `<img src="${t.artwork_url}" alt="" loading="lazy" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">`
        : `<span style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(255,255,255,0.07);"><i class="ph ph-music-note" style="color:#888;font-size:16px;"></i></span>`}
    </div>
    <div class="track-title-cell">
      <span class="track-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
    </div>
    <span class="track-artist" title="${escapeHtml(t.artist)}">${escapeHtml(t.artist)}</span>
    <span class="track-album" title="${escapeHtml(t.album)}">${escapeHtml(t.album)}</span>
    <div class="track-cat">
      ${t.category ? `<span class="track-cat-tag">${escapeHtml(t.category)}</span>` : ''}
    </div>
    <div class="track-actions-cell" style="display:flex;align-items:center;gap:6px;">
      <button class="track-action start-radio-btn" data-id="${escapeHtml(t.id)}" title="Start Radio from this track">
        <i class="ph-bold ph-radio"></i>
      </button>
      <button class="track-action preview-track-btn" data-id="${escapeHtml(t.id)}" title="Quick 20s Preview">
        <i class="ph-bold ph-speaker-simple-high"></i>
      </button>
      <button class="track-action play-next-btn" data-id="${escapeHtml(t.id)}" title="Play Next">
        <i class="ph ph-queue"></i>
      </button>
      <button class="track-action queue-add-btn" data-id="${escapeHtml(t.id)}" title="Add to Queue">
        <i class="ph ph-list-plus"></i>
      </button>
      <button class="track-action playlist-add-btn" data-id="${escapeHtml(t.id)}" title="Add to Playlist">
        <i class="ph ph-plus-circle"></i>
      </button>
      <button class="track-action edit-track-btn" data-id="${escapeHtml(t.id)}" title="Edit Tags & Artwork">
        <i class="ph ph-pencil-simple"></i>
      </button>
      <button class="track-action fav-btn ${isFav ? 'active-fav' : ''}" data-id="${escapeHtml(t.id)}" title="${isFavView ? 'Remove Favorite' : 'Favorite'}">
        <i class="ph${isFav ? '-fill' : ''} ph-star"></i>
      </button>
    </div>
  </div>`;
}

function _bindTrackListDelegation(container) {
  if (!container || container._hasTrackDelegation) return;
  container._hasTrackDelegation = true;

  container.addEventListener('dblclick', e => {
    const row = e.target.closest('.track-row');
    if (row && row.dataset.id) playById(row.dataset.id);
  });

  container.addEventListener('click', e => {
    const target = e.target;
    const startRadio = target.closest('.start-radio-btn');
    if (startRadio) {
      e.stopPropagation();
      startTrackRadio(startRadio.dataset.id);
      return;
    }
    const previewBtn = target.closest('.preview-track-btn');
    if (previewBtn) {
      e.stopPropagation();
      e.preventDefault();
      const row = previewBtn.closest('.track-row');
      toggleTrackAudioPreview(row, previewBtn);
      return;
    }
    const playNextBtn = target.closest('.play-next-btn');
    if (playNextBtn) {
      e.stopPropagation();
      playNext(playNextBtn.dataset.id);
      return;
    }
    const queueAddBtn = target.closest('.queue-add-btn');
    if (queueAddBtn) {
      e.stopPropagation();
      addToQueue(queueAddBtn.dataset.id);
      return;
    }
    const playlistAddBtn = target.closest('.playlist-add-btn');
    if (playlistAddBtn) {
      e.stopPropagation();
      openAddToPlaylistModal(playlistAddBtn.dataset.id);
      return;
    }
    const editBtn = target.closest('.edit-track-btn');
    if (editBtn) {
      e.stopPropagation();
      openEditTrackModal(editBtn.dataset.id);
      return;
    }
    const favBtn = target.closest('.fav-btn');
    if (favBtn) {
      e.stopPropagation();
      const rect = favBtn.getBoundingClientRect();
      toggleFavorite(favBtn.dataset.id, rect.left + rect.width / 2, rect.top);
      return;
    }
  });
}

function renderTracks(audioTracks) {
  const searchInput = $('#search');
  if (searchInput && searchInput.value.toLowerCase().includes('groq key')) {
    searchInput.value = '';
  }
  const query = (searchInput?.value || '').trim().toLowerCase();
  let filtered = audioTracks;
  if (activeCategory) filtered = filtered.filter(t => t.category === activeCategory);
  if (query) {
    const qWords = query.split(/\s+/).filter(Boolean);
    filtered = filtered.filter(t => {
      const haystack = `${t.title || ''} ${t.artist || ''} ${t.album || ''} ${t.category || ''} ${t.genre || ''} ${t.quality || ''} ${t.extension || ''}`.toLowerCase();
      return qWords.every(w => haystack.includes(w));
    });
  }
  
  const list = $('#track-list');
  $('#empty-state').classList.toggle('hidden', filtered.length > 0 || state.tracks.length > 0);
  
  const currentPlayingId = queue[currentIndex]?.id;
  _bindTrackListDelegation(list);

  const CHUNK_SIZE = 80;
  list.innerHTML = filtered.slice(0, CHUNK_SIZE).map((t, i) => _buildTrackRowHtml(t, i, currentPlayingId)).join('');

  if (filtered.length > CHUNK_SIZE) {
    let renderedCount = CHUNK_SIZE;
    const scrollParent = list.parentElement || window;
    const onScroll = () => {
      if (renderedCount >= filtered.length) {
        scrollParent.removeEventListener('scroll', onScroll);
        return;
      }
      const rect = list.getBoundingClientRect();
      if (rect.bottom <= window.innerHeight + 800) {
        const nextBatch = filtered.slice(renderedCount, renderedCount + CHUNK_SIZE);
        const temp = document.createElement('div');
        temp.innerHTML = nextBatch.map((t, i) => _buildTrackRowHtml(t, renderedCount + i, currentPlayingId)).join('');
        while (temp.firstChild) {
          list.appendChild(temp.firstChild);
        }
        renderedCount += nextBatch.length;
      }
    };
    scrollParent.addEventListener('scroll', onScroll, { passive: true });
  }
}

function _resolveTrack(trackOrId) {
  if (!trackOrId) return null;
  if (typeof trackOrId === 'object' && trackOrId.id) {
    if (trackOrId.is_online || (trackOrId.id && trackOrId.id.startsWith('yt:'))) {
      if (!state.online_tracks_cache) state.online_tracks_cache = {};
      state.online_tracks_cache[trackOrId.id] = trackOrId;
    }
    return trackOrId;
  }
  return trackById(trackOrId);
}

function playNext(trackOrId) {
  const t = _resolveTrack(trackOrId);
  if (!t || t.missing) return notify('Track not available.');
  if (queue.length === 0) {
    if (t.is_online && t.video_id) {
      streamYouTubeAudio(t.video_id, t.title, t.artist, t.artwork_url, t.duration);
    } else {
      playById(t.id);
    }
    return;
  }

  // If already currently playing
  if (queue[currentIndex] && queue[currentIndex].id === t.id) {
    return notify(`▶ "${t.title}" is currently playing.`);
  }

  const existingIdx = queue.findIndex(x => x && x.id === t.id);
  if (existingIdx > currentIndex) {
    // Relocate existing upcoming item to top of up-next
    const [moved] = queue.splice(existingIdx, 1);
    queue.splice(currentIndex + 1, 0, moved);
  } else {
    queue.splice(currentIndex + 1, 0, t);
  }
  renderQueue();
  debouncedSaveQueue();
  notify(`⏭️ "${t.title}" will play next!`);
}

function addToQueue(trackOrId) {
  const t = _resolveTrack(trackOrId);
  if (!t || t.missing) return notify('Track not available.');

  // If already playing
  if (queue[currentIndex] && queue[currentIndex].id === t.id) {
    notify(`▶ "${t.title}" is currently playing.`);
    return;
  }

  // Prevent duplicate upcoming entries
  const isUpcoming = queue.slice(currentIndex + 1).some(x => x && x.id === t.id);
  if (isUpcoming) {
    notify(`ℹ️ "${t.title}" is already in your upcoming queue.`);
    return;
  }

  queue.push(t);
  renderQueue();
  debouncedSaveQueue();
  const pos = Math.max(1, queue.length - (currentIndex + 1));
  notify(`➕ "${t.title}" added to queue (#${pos} up next)!`);
}

function renderFavorites() {
  const query = $('#search').value.trim().toLowerCase();
  let favTracks = state.favorites.map(trackById).filter(Boolean);
  if (query) {
    const qWords = query.split(/\s+/).filter(Boolean);
    favTracks = favTracks.filter(t => {
      const haystack = `${t.title || ''} ${t.artist || ''} ${t.album || ''} ${t.category || ''} ${t.genre || ''} ${t.quality || ''}`.toLowerCase();
      return qWords.every(w => haystack.includes(w));
    });
  }
  const list = $('#favorite-list');
  if (!list) return;

  if (!favTracks.length) {
    list.innerHTML = `
      <div class="empty-state" style="padding: 60px 20px;">
        <i class="ph-fill ph-star empty-icon" style="color:var(--accent);font-size:44px;"></i>
        <h3>No favorite tracks yet.</h3>
        <p>Star any song in your library to add it to your loved collection.</p>
      </div>
    `;
    return;
  }

  const currentPlayingId = queue[currentIndex]?.id;
  _bindTrackListDelegation(list);
  list.innerHTML = favTracks.map((t, i) => _buildTrackRowHtml(t, i, currentPlayingId, true)).join('');
}

let currentOpenPlaylistName = null;

function renderPlaylists() {
  const container = $('#playlist-list');
  if (!container) return;
  const pKeys = Object.keys(state.playlists || {});

  // Extract distinct folder playlists from imported library folders
  const folderPlaylists = {};
  state.tracks.forEach(t => {
    if (t.folder_name && t.media_type !== 'video') {
      if (!folderPlaylists[t.folder_name]) folderPlaylists[t.folder_name] = [];
      folderPlaylists[t.folder_name].push(t.id);
    }
  });

  const folderNames = Object.keys(folderPlaylists);

  // Show overview and hide details
  $('#playlists-overview')?.classList.remove('hidden');
  $('#playlist-detail-view')?.classList.add('hidden');
  currentOpenPlaylistName = null;

  if (!pKeys.length && !folderNames.length) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; padding: 60px 20px;">
        <i class="ph-fill ph-list-plus empty-icon" style="color:var(--accent);font-size:44px;"></i>
        <h3>No playlists or folders yet.</h3>
        <p>Curate custom mixes or import a local music folder.</p>
        <button class="btn-primary" id="empty-create-playlist-btn" style="margin:14px auto 0;"><i class="ph ph-plus"></i> Create Playlist</button>
      </div>
    `;
    $('#empty-create-playlist-btn')?.addEventListener('click', () => {
      $('#playlist-name-input').value = '';
      $('#playlist-create-sheet').showModal();
    });
    return;
  }

  // Palette of distinct gradients for folder playlists
  const FOLDER_GRADIENTS = [
    'linear-gradient(135deg, rgba(56, 189, 248, 0.25), rgba(14, 165, 233, 0.1))',
    'linear-gradient(135deg, rgba(52, 211, 153, 0.25), rgba(16, 185, 129, 0.1))',
    'linear-gradient(135deg, rgba(217, 70, 239, 0.25), rgba(168, 85, 247, 0.1))',
    'linear-gradient(135deg, rgba(251, 146, 60, 0.25), rgba(245, 158, 11, 0.1))',
    'linear-gradient(135deg, rgba(244, 63, 94, 0.25), rgba(225, 29, 72, 0.1))'
  ];

  // 1. Render Folder-based Playlists first
  const folderCardsHtml = folderNames.map((folderName, idx) => {
    const trackIds = folderPlaylists[folderName];
    const count = trackIds.length;
    const grad = FOLDER_GRADIENTS[idx % FOLDER_GRADIENTS.length];

    return `
      <div class="playlist-card folder-playlist-card" data-folder-playlist="${escapeHtml(folderName)}" style="border-left: 3px solid #38bdf8;">
        <span class="folder-playlist-badge"><i class="ph-fill ph-folder"></i> Folder Library</span>
        <div class="playlist-cover-art" style="background: ${grad};">
          <i class="ph-fill ph-folder-notch-open" style="color:#38bdf8;font-size:48px;"></i>
        </div>
        <div class="playlist-info">
          <strong>📁 ${escapeHtml(folderName)}</strong>
          <span style="color:#38bdf8;font-weight:500;">${count} local track${count === 1 ? '' : 's'}</span>
        </div>
        <div class="playlist-actions-row">
          <button class="playlist-play-btn folder-play-btn" data-folder="${escapeHtml(folderName)}" title="Play Folder">
            <i class="ph-fill ph-play"></i> Play Folder
          </button>
        </div>
      </div>
    `;
  }).join('');

  // 2. Render Custom User-Created Playlists
  const customCardsHtml = pKeys.map(name => {
    const trackIds = state.playlists[name] || [];
    const count = trackIds.length;
    const firstTrack = trackById(trackIds[0]);
    const coverHtml = firstTrack && firstTrack.has_artwork && firstTrack.artwork_url
      ? `<img src="${firstTrack.artwork_url}" alt="Cover">`
      : `<i class="ph-fill ph-playlist"></i>`;

    return `
      <div class="playlist-card" data-name="${escapeHtml(name)}">
        <div class="playlist-cover-art">
          ${coverHtml}
        </div>
        <div class="playlist-info">
          <strong>${escapeHtml(name)}</strong>
          <span>${count} track${count === 1 ? '' : 's'}</span>
        </div>
        <div class="playlist-actions-row">
          <button class="playlist-play-btn" data-name="${escapeHtml(name)}" title="Play Playlist">
            <i class="ph-fill ph-play"></i> Play
          </button>
          <button class="playlist-del-btn" data-name="${escapeHtml(name)}" title="Delete Playlist">
            <i class="ph ph-trash"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = folderCardsHtml + customCardsHtml;

  // Folder Playlists Event Handlers
  container.querySelectorAll('.folder-playlist-card').forEach(card => {
    const folderName = card.dataset.folderPlaylist;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.folder-play-btn')) return;
      openFolderPlaylistDetail(folderName, folderPlaylists[folderName]);
    });

    card.querySelector('.folder-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playFolderPlaylist(folderName, folderPlaylists[folderName]);
    });
  });

  // Custom Playlists Event Handlers
  container.querySelectorAll('.playlist-card:not(.folder-playlist-card)').forEach(card => {
    const name = card.dataset.name;
    card.addEventListener('click', (e) => {
      if (e.target.closest('.playlist-del-btn') || e.target.closest('.playlist-play-btn')) return;
      openPlaylistDetail(name);
    });

    card.querySelector('.playlist-play-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      playPlaylist(name);
    });

    card.querySelector('.playlist-del-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      deletePlaylist(name);
    });
  });
}

function openFolderPlaylistDetail(folderName, trackIds, filterQuery = '') {
  currentOpenPlaylistName = `folder:${folderName}`;
  const allTracks = (trackIds || []).map(trackById).filter(Boolean);
  let pTracks = allTracks;
  if (filterQuery && filterQuery.trim()) {
    const q = filterQuery.trim().toLowerCase();
    pTracks = pTracks.filter(t => `${t.title || ''} ${t.artist || ''} ${t.album || ''} ${t.category || ''}`.toLowerCase().includes(q));
  }

  $('#playlists-overview')?.classList.add('hidden');
  $('#playlist-detail-view')?.classList.remove('hidden');

  $('#playlist-detail-title').textContent = `📁 Folder: ${folderName}`;
  $('#playlist-detail-stats').textContent = `${allTracks.length} tracks · Imported Local Library`;
  $('#playlist-detail-cover').innerHTML = `<i class="ph-fill ph-folder-open" style="color:#38bdf8;font-size:44px;"></i>`;
  $('#playlist-detail-delete')?.classList.add('hidden'); // Folder playlists cannot be deleted as custom playlists

  const list = $('#playlist-track-list');
  const emptyEl = $('#playlist-detail-empty');

  if (!allTracks.length) {
    list.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');

  if (!pTracks.length) {
    list.innerHTML = `<div class="muted" style="padding:40px 20px;text-align:center;"><i class="ph ph-magnifying-glass" style="font-size:24px;display:block;margin-bottom:8px;"></i>No tracks matching "${escapeHtml(filterQuery)}"</div>`;
    return;
  }

  list.innerHTML = pTracks.map((t, i) => `
    <div class="track-row" data-id="${escapeHtml(t.id)}">
      <span class="track-num">${String(i + 1).padStart(2, '0')}</span>
      <div class="track-thumb">
        ${t.has_artwork && t.artwork_url
          ? `<img src="${t.artwork_url}" alt="" loading="lazy" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">`
          : `<span style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(255,255,255,0.07);"><i class="ph ph-music-note" style="color:#888;font-size:16px;"></i></span>`}
      </div>
      <div class="track-title-cell">
        <span class="track-title">${escapeHtml(t.title || 'Unknown Track')}</span>
      </div>
      <span class="track-artist">${escapeHtml(t.artist || 'Unknown Artist')}</span>
      <span class="track-album">${escapeHtml(t.album || 'Local Folder')}</span>
      <div class="track-cat">
        ${t.category ? `<span class="track-cat-tag">${escapeHtml(t.category)}</span>` : ''}
      </div>
      <div class="track-actions-cell" style="display:flex;align-items:center;gap:6px;">
        <button class="track-action start-radio-btn" data-id="${escapeHtml(t.id)}" title="Start Radio from this track">
          <i class="ph-bold ph-radio"></i>
        </button>
        <button class="track-action preview-track-btn" data-id="${escapeHtml(t.id)}" title="Quick 20s Preview">
          <i class="ph-bold ph-speaker-simple-high"></i>
        </button>
        <button class="track-action fav-btn ${state.favorites.includes(t.id) ? 'active-fav' : ''}" data-id="${escapeHtml(t.id)}">
          <i class="ph${state.favorites.includes(t.id) ? '-fill' : ''} ph-star"></i>
        </button>
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.track-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-action')) return;
      queue = [...allTracks];
      currentIndex = allTracks.findIndex(t => t.id === row.dataset.id);
      if (currentIndex === -1) currentIndex = 0;
      playById(queue[currentIndex].id);
      renderQueue();
    });

    row.addEventListener('dblclick', () => {
      queue = [...allTracks];
      currentIndex = allTracks.findIndex(t => t.id === row.dataset.id);
      if (currentIndex === -1) currentIndex = 0;
      playById(queue[currentIndex].id);
      renderQueue();
    });

    row.querySelector('.start-radio-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      startTrackRadio(row.dataset.id);
    });

    row.querySelector('.preview-track-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      toggleTrackAudioPreview(row, e.currentTarget);
    });

    row.querySelector('.fav-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      toggleFavorite(row.dataset.id, rect.left + rect.width / 2, rect.top);
      openFolderPlaylistDetail(folderName, trackIds, filterQuery);
    });
  });

  const playBtn = $('#playlist-detail-play');
  if (playBtn) {
    playBtn.onclick = () => {
      if (allTracks.length) {
        queue = [...allTracks];
        currentIndex = 0;
        playById(queue[0].id);
        renderQueue();
      }
    };
  }

  const shuffleBtn = $('#playlist-detail-shuffle');
  if (shuffleBtn) {
    shuffleBtn.onclick = () => {
      if (allTracks.length) {
        queue = smartShuffle(allTracks);
        currentIndex = 0;
        playById(queue[0].id);
        renderQueue();
        notify(`🔀 Smart Shuffling: ${folderName}`);
      }
    };
  }
}

function playFolderPlaylist(folderName, trackIds) {
  const pTracks = (trackIds || []).map(trackById).filter(Boolean);
  if (!pTracks.length) return notify('Folder is empty.');
  queue = [...pTracks];
  currentIndex = 0;
  playById(queue[0].id);
  notify(`▶️ Playing folder: ${folderName}`);
}

function openPlaylistDetail(name, filterQuery = '') {
  currentOpenPlaylistName = name;
  const trackIds = state.playlists[name] || [];
  const allTracks = trackIds.map(trackById).filter(Boolean);
  let pTracks = allTracks;

  if (filterQuery && filterQuery.trim()) {
    const q = filterQuery.trim().toLowerCase();
    pTracks = pTracks.filter(t => `${t.title || ''} ${t.artist || ''} ${t.album || ''} ${t.category || ''}`.toLowerCase().includes(q));
  }

  $('#playlists-overview')?.classList.add('hidden');
  $('#playlist-detail-view')?.classList.remove('hidden');

  $('#playlist-detail-title').textContent = name;
  $('#playlist-detail-delete')?.classList.remove('hidden');
  
  // Calculate total duration from full tracklist
  const totalSecs = allTracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const durStr = totalSecs > 0 ? ` · ${Math.round(totalSecs / 60)} min` : '';
  $('#playlist-detail-stats').textContent = `${allTracks.length} track${allTracks.length === 1 ? '' : 's'}${durStr}`;

  // Cover Art
  const firstTrack = allTracks.find(t => t.artwork_url) || allTracks[0];
  $('#playlist-detail-cover').innerHTML = (firstTrack && firstTrack.artwork_url)
    ? `<img src="${firstTrack.artwork_url}" alt="Cover">`
    : `<i class="ph-fill ph-playlist"></i>`;

  const trackListEl = $('#playlist-track-list');
  const emptyEl = $('#playlist-detail-empty');

  // Only show empty state if playlist genuinely has no tracks
  if (!allTracks.length) {
    trackListEl.innerHTML = '';
    emptyEl?.classList.remove('hidden');
    return;
  }
  emptyEl?.classList.add('hidden');

  // If search filter resulted in 0 matches
  if (!pTracks.length) {
    trackListEl.innerHTML = `<div class="muted" style="padding:40px 20px;text-align:center;"><i class="ph ph-magnifying-glass" style="font-size:24px;display:block;margin-bottom:8px;"></i>No tracks matching "${escapeHtml(filterQuery)}"</div>`;
    return;
  }

  const currentPlayingId = queue[currentIndex]?.id;

  trackListEl.innerHTML = pTracks.map((t, i) => {
    const isPlaying = t.id === currentPlayingId;
    const waveBadge = isPlaying ? `
      <span class="track-soundwave" title="Currently Playing">
        <span class="wave-bar-mini"></span>
        <span class="wave-bar-mini"></span>
        <span class="wave-bar-mini"></span>
        <span class="wave-bar-mini"></span>
      </span>` : '';

    return `
    <div class="track-row ${isPlaying ? 'row-playing' : ''}" data-id="${escapeHtml(t.id)}">
      <span class="track-num">${isPlaying ? waveBadge : String(i+1).padStart(2,'0')}</span>
      <div class="track-thumb">
        ${t.artwork_url
          ? `<img src="${t.artwork_url}" alt="" loading="lazy" style="width:36px;height:36px;object-fit:cover;border-radius:6px;">`
          : `<span style="width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:6px;background:rgba(255,255,255,0.07);"><i class="ph ph-music-note" style="color:#888;font-size:16px;"></i></span>`}
      </div>
      <div class="track-title-cell">
        <span class="track-title" title="${escapeHtml(t.title || 'Unknown Track')}">${escapeHtml(t.title || 'Unknown Track')}</span>
      </div>
      <span class="track-artist" title="${escapeHtml(t.artist || 'Unknown Artist')}">${escapeHtml(t.artist || 'Unknown Artist')}</span>
      <span class="track-album" title="${escapeHtml(t.album || 'Playlist')}">${escapeHtml(t.album || 'Playlist')}</span>
      <div class="track-cat">
        ${t.category ? `<span class="track-cat-tag">${escapeHtml(t.category)}</span>` : ''}
      </div>
      <div class="track-actions-cell" style="display:flex;align-items:center;gap:6px;">
        <button class="track-action start-radio-btn" data-id="${escapeHtml(t.id)}" title="Start Radio from this track">
          <i class="ph-bold ph-radio"></i>
        </button>
        <button class="track-action preview-track-btn" data-id="${escapeHtml(t.id)}" title="Quick 20s Preview">
          <i class="ph-bold ph-speaker-simple-high"></i>
        </button>
        <button class="track-action playlist-remove-track-btn" data-id="${escapeHtml(t.id)}" title="Remove from this playlist">
          <i class="ph ph-trash"></i>
        </button>
        <button class="track-action edit-track-btn" data-id="${escapeHtml(t.id)}" title="Edit Tags & Artwork">
          <i class="ph ph-pencil-simple"></i>
        </button>
        <button class="track-action fav-btn ${state.favorites.includes(t.id) ? 'active-fav' : ''}" data-id="${escapeHtml(t.id)}" title="Favorite">
          <i class="ph${state.favorites.includes(t.id) ? '-fill' : ''} ph-star"></i>
        </button>
      </div>
    </div>`;
  }).join('');

  trackListEl.querySelectorAll('.track-row').forEach(row => {
    // Single click to play immediately
    row.addEventListener('click', (e) => {
      if (e.target.closest('.track-action')) return;
      queue = [...allTracks];
      currentIndex = allTracks.findIndex(t => t.id === row.dataset.id);
      if (currentIndex === -1) currentIndex = 0;
      playById(queue[currentIndex].id);
      renderQueue();
    });

    row.addEventListener('dblclick', (e) => {
      if (e.target.closest('.track-action')) return;
      queue = [...allTracks];
      currentIndex = allTracks.findIndex(t => t.id === row.dataset.id);
      if (currentIndex === -1) currentIndex = 0;
      playById(queue[currentIndex].id);
      renderQueue();
    });

    row.querySelector('.start-radio-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      startTrackRadio(row.dataset.id);
    });

    row.querySelector('.preview-track-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      toggleTrackAudioPreview(row, e.currentTarget);
    });

    row.querySelector('.playlist-remove-track-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      removeTrackFromPlaylist(name, row.dataset.id);
    });

    row.querySelector('.edit-track-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      openEditTrackModal(row.dataset.id);
    });

    row.querySelector('.fav-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      const rect = e.currentTarget.getBoundingClientRect();
      toggleFavorite(row.dataset.id, rect.left + rect.width / 2, rect.top);
      openPlaylistDetail(name, filterQuery);
    });
  });

  const playBtn = $('#playlist-detail-play');
  if (playBtn) {
    playBtn.onclick = () => {
      if (allTracks.length) {
        queue = [...allTracks];
        currentIndex = 0;
        playById(queue[0].id);
        renderQueue();
        notify(`▶️ Playing playlist: ${name}`);
      }
    };
  }

  const shuffleBtn = $('#playlist-detail-shuffle');
  if (shuffleBtn) {
    shuffleBtn.onclick = () => {
      if (allTracks.length) {
        queue = smartShuffle(allTracks);
        currentIndex = 0;
        playById(queue[0].id);
        renderQueue();
        notify(`🔀 Smart Shuffling: ${name}`);
      }
    };
  }
}

function removeTrackFromPlaylist(playlistName, trackId) {
  if (!state.playlists[playlistName]) return;
  state.playlists[playlistName] = state.playlists[playlistName].filter(id => id !== trackId);
  saveState();
  openPlaylistDetail(playlistName);
  notify(`Removed track from "${playlistName}".`);
}

$('#playlist-back-btn')?.addEventListener('click', () => {
  if ($('#search')) $('#search').value = '';
  renderPlaylists();
});

$('#playlist-detail-play')?.addEventListener('click', () => {
  if (!currentOpenPlaylistName) return;
  if (currentOpenPlaylistName.startsWith('folder:')) {
    // Folder playlist — gather tracks from state
    const folderName = currentOpenPlaylistName.slice(7);
    const folderTracks = state.tracks.filter(t => t.folder_name === folderName && t.media_type !== 'video');
    if (!folderTracks.length) return notify('Folder has no tracks.');
    queue = [...folderTracks];
    currentIndex = 0;
    playById(queue[0].id);
    renderQueue();
  } else {
    playPlaylist(currentOpenPlaylistName);
  }
});

$('#playlist-detail-shuffle')?.addEventListener('click', () => {
  if (!currentOpenPlaylistName) return;
  let pTracks;
  if (currentOpenPlaylistName.startsWith('folder:')) {
    const folderName = currentOpenPlaylistName.slice(7);
    pTracks = state.tracks.filter(t => t.folder_name === folderName && t.media_type !== 'video');
  } else {
    const trackIds = state.playlists[currentOpenPlaylistName] || [];
    pTracks = trackIds.map(trackById).filter(Boolean);
  }
  if (!pTracks.length) return notify('Playlist is empty.');

  // Smart-shuffle tracks with artist dispersion
  const shuffled = smartShuffle(pTracks);
  queue = shuffled;
  currentIndex = 0;
  playById(queue[0].id);
  renderQueue();
  notify(`🔀 Smart Shuffling: ${currentOpenPlaylistName.startsWith('folder:') ? currentOpenPlaylistName.slice(7) : currentOpenPlaylistName}`);
});

$('#playlist-detail-delete')?.addEventListener('click', () => {
  if (currentOpenPlaylistName && !currentOpenPlaylistName.startsWith('folder:')) {
    deletePlaylist(currentOpenPlaylistName);
  }
});

function playPlaylist(name) {
  const trackIds = state.playlists[name] || [];
  if (!trackIds.length) {
    return notify(`Playlist "${name}" is empty. Add songs first!`);
  }
  const pTracks = trackIds.map(trackById).filter(Boolean);
  if (!pTracks.length) return notify('No valid tracks found in playlist.');

  queue = [...pTracks];
  currentIndex = 0;
  playById(queue[0].id);
  renderQueue();
  notify(`▶ Playing playlist: ${name}`);
}

function deletePlaylist(name) {
  if (!confirm(`Are you sure you want to delete playlist "${name}"?`)) return;
  delete state.playlists[name];
  saveState();
  renderPlaylists();
  notify(`Deleted playlist "${name}".`);
}

// Create Playlist Sheet Triggers
$('#new-playlist')?.addEventListener('click', () => {
  $('#playlist-name-input').value = '';
  $('#playlist-create-sheet').showModal();
});
$('#playlist-create-close')?.addEventListener('click', () => $('#playlist-create-sheet').close());
$('#playlist-create-cancel')?.addEventListener('click', () => $('#playlist-create-sheet').close());

$('#playlist-create-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#playlist-name-input').value.trim();
  if (!name) return notify('Please enter a playlist name.');
  if (state.playlists[name]) return notify('A playlist with this name already exists.');

  state.playlists[name] = [];
  saveState();
  $('#playlist-create-sheet').close();
  renderPlaylists();
  notify(`✨ Created playlist "${name}"!`);
});

// ---- YouTube Playlist Importer Modal Handlers ----
let _currentFetchedPlaylist = null;

const importYtPlaylistBtn = $('#import-yt-playlist-btn');
const ytPlaylistModal = $('#yt-playlist-import-modal');
const ytPlaylistModalClose = $('#yt-playlist-modal-close');
const ytPlaylistFetchBtn = $('#yt-playlist-fetch-btn');
const ytPlaylistUrlInput = $('#yt-playlist-url-input');
const ytPlFetchLoading = $('#yt-pl-fetch-loading');
const ytPlStepUrl = $('#yt-pl-step-url');
const ytPlStepPreview = $('#yt-pl-step-preview');
const ytPlBackBtn = $('#yt-pl-back-btn');
const ytPlImportStreamBtn = $('#yt-pl-import-stream-btn');

function resetYtPlaylistModal() {
  _currentFetchedPlaylist = null;
  if (ytPlaylistUrlInput) ytPlaylistUrlInput.value = '';
  if (ytPlStepUrl) ytPlStepUrl.classList.remove('hidden');
  if (ytPlStepPreview) ytPlStepPreview.classList.add('hidden');
  if (ytPlFetchLoading) ytPlFetchLoading.classList.add('hidden');
  if (ytPlaylistFetchBtn) ytPlaylistFetchBtn.disabled = false;
}

if (importYtPlaylistBtn && ytPlaylistModal) {
  importYtPlaylistBtn.addEventListener('click', () => {
    resetYtPlaylistModal();
    ytPlaylistModal.showModal();
  });

  ytPlaylistModalClose?.addEventListener('click', () => {
    ytPlaylistModal.close();
  });

  ytPlBackBtn?.addEventListener('click', () => {
    ytPlStepPreview?.classList.add('hidden');
    ytPlStepUrl?.classList.remove('hidden');
  });

  ytPlaylistFetchBtn?.addEventListener('click', async () => {
    const url = (ytPlaylistUrlInput?.value || '').trim();
    if (!url) {
      notify('Please enter a YouTube playlist URL.');
      return;
    }

    ytPlFetchLoading?.classList.remove('hidden');
    ytPlaylistFetchBtn.disabled = true;

    try {
      const res = await api('/api/youtube/playlist-info', {
        method: 'POST',
        body: JSON.stringify({ url })
      });

      ytPlFetchLoading?.classList.add('hidden');
      ytPlaylistFetchBtn.disabled = false;

      if (!res || res.status !== 'success' || !res.playlist) {
        notify(res?.error || 'Could not fetch playlist. Please check the URL.');
        return;
      }

      _currentFetchedPlaylist = res.playlist;
      renderYtPlaylistPreview(res.playlist);
    } catch (err) {
      console.error('Playlist fetch error:', err);
      ytPlFetchLoading?.classList.add('hidden');
      ytPlaylistFetchBtn.disabled = false;
      notify('Failed to connect to server. Check URL.');
    }
  });

  ytPlImportStreamBtn?.addEventListener('click', async () => {
    if (!_currentFetchedPlaylist || !_currentFetchedPlaylist.tracks || !_currentFetchedPlaylist.tracks.length) {
      notify('No playlist tracks available to import.');
      return;
    }

    const customName = ($('#yt-pl-name-input')?.value || _currentFetchedPlaylist.title || 'Imported Playlist').trim();
    if (!customName) {
      notify('Please enter a playlist name.');
      return;
    }

    ytPlImportStreamBtn.disabled = true;
    ytPlImportStreamBtn.innerHTML = '<i class="ph-bold ph-spinner"></i> Importing...';

    try {
      const res = await api('/api/youtube/playlist-import', {
        method: 'POST',
        body: JSON.stringify({
          name: customName,
          tracks: _currentFetchedPlaylist.tracks,
          action: 'stream'
        })
      });

      if (res && res.status === 'success') {
        // Cache tracks locally in RAM so trackById resolves them
        if (!state.online_tracks_cache) state.online_tracks_cache = {};
        _currentFetchedPlaylist.tracks.forEach(t => {
          state.online_tracks_cache[t.id] = t;
        });

        if (!state.playlists) state.playlists = {};
        state.playlists[customName] = _currentFetchedPlaylist.tracks.map(t => t.id);

        ytPlaylistModal.close();
        notify(`✨ Successfully imported "${customName}" (${res.track_count} tracks)!`);
        document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
        document.querySelector('[data-view="playlists"]')?.classList.add('active');
        document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
        $('#playlists-view')?.classList.remove('hidden');
        if ($('#search')) $('#search').value = '';
        renderPlaylists();
        openPlaylistDetail(customName);
      } else {
        notify(res?.error || 'Import failed.');
      }
    } catch (err) {
      console.error('Playlist import error:', err);
      notify('Import failed. Please try again.');
    } finally {
      ytPlImportStreamBtn.disabled = false;
      ytPlImportStreamBtn.innerHTML = '<i class="ph-bold ph-lightning"></i> Import & Stream Now';
    }
  });
}

function renderYtPlaylistPreview(playlist) {
  if (!playlist) return;
  ytPlStepUrl?.classList.add('hidden');
  ytPlStepPreview?.classList.remove('hidden');

  const nameInput = $('#yt-pl-name-input');
  if (nameInput) nameInput.value = playlist.title || 'YouTube Playlist';

  const thumbImg = $('#yt-pl-preview-thumb');
  if (thumbImg) thumbImg.src = playlist.thumbnail || (playlist.tracks[0]?.artwork_url || '');

  const uploaderLabel = $('#yt-pl-uploader-label');
  if (uploaderLabel) uploaderLabel.textContent = playlist.uploader || 'YouTube';

  const countBadge = $('#yt-pl-count-badge');
  if (countBadge) countBadge.textContent = `${playlist.count} tracks`;

  const totalSecs = playlist.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const durLabel = $('#yt-pl-preview-duration');
  if (durLabel) durLabel.textContent = totalSecs > 0 ? `${Math.round(totalSecs / 60)} min` : `${playlist.count} songs`;

  const listContainer = $('#yt-pl-tracks-preview-list');
  if (listContainer) {
    listContainer.innerHTML = playlist.tracks.map((t, idx) => `
      <div class="yt-pl-preview-row">
        <span style="font-size:11px;width:18px;color:var(--text-muted);text-align:center;">${idx + 1}</span>
        <img src="${escapeHtml(t.artwork_url || '')}" alt="" loading="lazy">
        <div class="yt-pl-row-meta">
          <strong title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</strong>
          <span>${escapeHtml(t.artist)}</span>
        </div>
        <span class="yt-pl-row-dur">${t.duration > 0 ? formatTime(t.duration) : ''}</span>
      </div>
    `).join('');
  }
}

// Add to Playlist modal
// Add to Playlist modal (supports single tracks and complete queues)
let _playlistTargetTracks = [];
let _isAddingQueueToPlaylist = false;

function openAddToPlaylistModal(targetOrId, isQueue = false) {
  _isAddingQueueToPlaylist = isQueue;
  const sheet = $('#add-to-playlist-sheet');
  if (!sheet) return;

  const titleEl = $('#add-to-playlist-title');
  const trackNameEl = $('#add-to-playlist-track-name');
  const queueOptionsEl = $('#add-to-playlist-queue-options');
  const inlineInput = $('#add-to-playlist-inline-name');

  if (isQueue) {
    if (!queue || queue.length === 0) return notify('Queue is empty.');
    if (titleEl) titleEl.textContent = 'Save Queue as Playlist';
    if (queueOptionsEl) queueOptionsEl.style.display = 'block';

    const allCount = queue.length;
    const upcomingCount = Math.max(0, queue.length - (currentIndex + 1));
    const allLabel = $('#queue-scope-all-label');
    const upcomingLabel = $('#queue-scope-upcoming-label');
    if (allLabel) allLabel.textContent = `All in Queue (${allCount} tracks)`;
    if (upcomingLabel) upcomingLabel.textContent = `Upcoming Only (${upcomingCount} tracks)`;

    // Select upcoming if currently playing with items ahead, otherwise all
    const upcomingRadio = $('#queue-scope-upcoming');
    const allRadio = $('#queue-scope-all');
    if (upcomingCount > 0 && currentIndex >= 0) {
      if (upcomingRadio) upcomingRadio.checked = true;
    } else {
      if (allRadio) allRadio.checked = true;
    }

    if (trackNameEl) trackNameEl.textContent = `Save your queue (${allCount} tracks) into a new or existing playlist:`;
    if (inlineInput) {
      const nowStr = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      inlineInput.value = `Queue Mix · ${nowStr}`;
    }
  } else {
    const t = _resolveTrack(targetOrId);
    if (!t) return;
    _playlistTargetTracks = [t.id];
    if (titleEl) titleEl.textContent = 'Add to Playlist';
    if (queueOptionsEl) queueOptionsEl.style.display = 'none';
    if (trackNameEl) trackNameEl.textContent = `Add "${t.title || 'Track'}" to:`;
    if (inlineInput) inlineInput.value = '';
  }

  function _getCurrentTargetTrackIds() {
    if (_isAddingQueueToPlaylist) {
      const isUpcomingOnly = document.getElementById('queue-scope-upcoming')?.checked;
      const src = isUpcomingOnly ? queue.slice(currentIndex + 1) : queue;

      // Cache any online tracks so they stay available even on future loads
      src.forEach(x => {
        if (!x) return;
        const ytId = x.id || (x.video_id ? (x.video_id.startsWith('yt:') ? x.video_id : `yt:${x.video_id}`) : null);
        if (ytId && (x.is_online || ytId.startsWith('yt:'))) {
          if (!state.online_tracks_cache) state.online_tracks_cache = {};
          state.online_tracks_cache[ytId] = {
            id: ytId,
            video_id: x.video_id || ytId.replace(/^yt:/, ''),
            title: x.title || 'Online Track',
            artist: x.artist || 'YouTube',
            artwork_url: x.artwork_url || '',
            duration: parseFloat(x.duration) || 0,
            is_online: true
          };
          syncOnlineTrackToDB(state.online_tracks_cache[ytId]);
        }
      });

      return src.map(x => {
        if (!x) return null;
        if (x.id) return x.id;
        if (x.video_id) return x.video_id.startsWith('yt:') ? x.video_id : `yt:${x.video_id}`;
        return null;
      }).filter(Boolean);
    }
    return _playlistTargetTracks;
  }

  // Populate list of existing playlists
  const list = $('#playlist-select-list');
  const pKeys = Object.keys(state.playlists || {});

  if (!pKeys.length) {
    list.innerHTML = `<p class="muted" style="font-size:13px;padding:10px 0;">No playlists yet. Create one above!</p>`;
  } else {
    list.innerHTML = pKeys.map(name => {
      const trackIds = state.playlists[name] || [];
      const curTargets = _getCurrentTargetTrackIds();
      const allAlreadyIn = curTargets.length > 0 && curTargets.every(id => trackIds.includes(id));
      return `
        <button class="playlist-select-item" data-name="${escapeHtml(name)}" style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-radius:6px;background:rgba(255,255,255,0.03);border:1px solid var(--border);cursor:pointer;width:100%;text-align:left;color:var(--text);transition:background 0.15s ease;">
          <div style="display:flex;flex-direction:column;gap:2px;">
            <strong style="font-size:14px;">${escapeHtml(name)}</strong>
            <span style="font-size:11px;color:var(--text-muted);">${trackIds.length} track${trackIds.length === 1 ? '' : 's'}</span>
          </div>
          <span style="font-size:12px;color:var(--accent);font-weight:600;">
            ${allAlreadyIn ? '<i class="ph-fill ph-check"></i> Already in' : '<i class="ph ph-plus"></i> Add to this'}
          </span>
        </button>
      `;
    }).join('');

    list.querySelectorAll('.playlist-select-item').forEach(item => {
      item.addEventListener('click', async () => {
        const pName = item.dataset.name;
        if (!state.playlists[pName]) state.playlists[pName] = [];
        const tIds = _getCurrentTargetTrackIds();
        if (!tIds.length) return notify('No tracks selected to add.');

        let addedCount = 0;
        tIds.forEach(id => {
          if (!state.playlists[pName].includes(id)) {
            state.playlists[pName].push(id);
            addedCount++;
          }
        });

        await saveState();
        if (typeof renderPlaylists === 'function') renderPlaylists();
        if (addedCount > 0) {
          notify(`💾 Added ${addedCount} track${addedCount === 1 ? '' : 's'} to "${pName}"!`);
        } else {
          notify(`ℹ️ All selected tracks are already in "${pName}".`);
        }
        sheet.close();
      });
    });
  }

  // Handle radio toggle changing target track counts dynamically
  const radios = sheet.querySelectorAll('input[name="queue_scope"]');
  radios.forEach(r => {
    r.onchange = () => {
      const curTargets = _getCurrentTargetTrackIds();
      list.querySelectorAll('.playlist-select-item').forEach(item => {
        const pName = item.dataset.name;
        const trackIds = state.playlists[pName] || [];
        const allAlreadyIn = curTargets.length > 0 && curTargets.every(id => trackIds.includes(id));
        const badge = item.querySelector('span');
        if (badge) {
          badge.innerHTML = allAlreadyIn 
            ? '<i class="ph-fill ph-check"></i> Already in' 
            : '<i class="ph ph-plus"></i> Add to this';
        }
      });
    };
  });

  // Handle inline "Create" new playlist button
  const inlineCreateBtn = $('#add-to-playlist-inline-create-btn');
  if (inlineCreateBtn) {
    inlineCreateBtn.onclick = async () => {
      const rawName = (inlineInput?.value || '').trim();
      if (!rawName) return notify('Please enter a playlist name.');
      if (!state.playlists) state.playlists = {};
      if (state.playlists[rawName]) return notify(`A playlist named "${rawName}" already exists.`);

      const tIds = _getCurrentTargetTrackIds();
      if (!tIds.length) return notify('No tracks to add.');

      state.playlists[rawName] = tIds;
      await saveState();
      if (typeof renderPlaylists === 'function') renderPlaylists();
      notify(`💾 Created new playlist "${rawName}" with ${tIds.length} track${tIds.length === 1 ? '' : 's'}!`);
      sheet.close();
    };
  }

  if (inlineInput) {
    inlineInput.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inlineCreateBtn?.click();
      }
    };
  }

  sheet.showModal();

  if (isQueue && inlineInput) {
    setTimeout(() => {
      inlineInput.focus();
      inlineInput.select();
    }, 60);
  }
}

$('#add-to-playlist-close')?.addEventListener('click', () => $('#add-to-playlist-sheet').close());
$('#add-to-playlist-cancel')?.addEventListener('click', () => $('#add-to-playlist-sheet').close());

// ---- renderContinueRail: kept as no-op for backwards compat (superseded by rec-dashboard) ----
function renderContinueRail() {
  // The old rail is now replaced by the full recommendation dashboard.
  // Kept here to avoid any lingering references breaking.
}

// ============================================================
// Recommendation Dashboard — Spotify / YouTube Music Style
// Loads from /api/recommend/dashboard, renders all shelves.
// ============================================================

let _recDashboardLoaded = false;
let _recDashboardLoading = false;
let _recCurrentlyPlayingId = null;

/** Returns time-of-day greeting string */
function getRecGreeting() {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return 'Good Morning';
  if (h >= 12 && h < 17) return 'Good Afternoon';
  if (h >= 17 && h < 22) return 'Good Evening';
  return 'Good Night';
}

/** Deterministic gradient index from a string (for cards without artwork) */
function recGradIndex(str) {
  let hash = 0;
  for (let i = 0; i < (str || '').length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 10;
}

/**
 * Builds a single recommendation card DOM element.
 * @param {Object} track   - Track data object
 * @param {boolean} wide   - If true, renders a wide landscape card (for Trending)
 */
function renderRecCard(track, wide = false) {
  const isYT = !!(track.is_online || (track.id && track.id.startsWith('yt:')));
  const vid = track.video_id || (track.id || '').replace('yt:', '');
  const thumb = track.artwork_url || (isYT && vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '');
  const gradIdx = recGradIndex((track.id || '') + (track.title || ''));
  const gradClass = `rec-card-grad-${gradIdx}`;
  const resumePos = track._resume_pos;
  const dur = track.duration || 0;
  const isPlaying = _recCurrentlyPlayingId && track.id === _recCurrentlyPlayingId;

  // First letter of title for gradient fallback
  const letter = (track.title || '?').trim().charAt(0).toUpperCase();

  const thumbClass = wide ? 'rec-card-thumb rec-card-thumb-wide' : 'rec-card-thumb';

  const thumbInner = thumb
    ? `<img src="${escapeHtml(thumb)}" alt="Art" loading="lazy" onerror="this.parentNode.innerHTML='<div class=\\'rec-card-thumb-fallback ${gradClass}\\'><span class=\\'rec-card-fallback-letter\\'>${escapeHtml(letter)}</span></div>'">`
    : `<div class="rec-card-thumb-fallback ${gradClass}"><span class="rec-card-fallback-letter">${escapeHtml(letter)}</span></div>`;

  const srcBadge = isYT
    ? `<span class="rec-card-src-badge rec-card-src-yt">YT</span>`
    : `<span class="rec-card-src-badge rec-card-src-local">Local</span>`;

  const resumeHtml = (resumePos && dur > 30)
    ? `<span class="rec-card-resume">▶ ${formatTime(resumePos)}</span>` : '';

  const div = document.createElement('div');
  div.className = `rec-card${wide ? ' rec-card-wide' : ''}${isPlaying ? ' now-playing' : ''}`;
  div.dataset.id = track.id;
  div.dataset.isYt = isYT ? '1' : '0';
  div.dataset.vid = vid || '';
  div.dataset.title = track.title || '';
  div.dataset.artist = track.artist || '';
  div.dataset.thumb = thumb || '';
  div.dataset.dur = dur || '';

  const pillHtml = isYT
    ? `<span class="rec-card-pill yt"><i class="ph-fill ph-youtube-logo"></i> YT</span>`
    : `<span class="rec-card-pill local">Local</span>`;

  if (wide) {
    // Landscape card — Thumbnail left, info middle with pill tag
    div.innerHTML = `
      <div class="${thumbClass}">
        ${thumbInner}
        <button class="rec-card-preview-btn" title="Quick 20s Preview" aria-label="20s Preview"><i class="ph-bold ph-speaker-simple-high"></i></button>
        <div class="rec-card-play-btn"><i class="ph-fill ph-play"></i></div>
        <button class="rec-card-radio-btn" title="Start Radio from this track" aria-label="Start Radio"><i class="ph-bold ph-radio"></i></button>
        <button class="rec-card-dislike-btn" title="Not interested in this song" aria-label="Not interested"><i class="ph ph-thumbs-down"></i></button>
      </div>
      <div class="rec-card-info">
        <span class="rec-card-title" title="${escapeHtml(track.title || '')}">${escapeHtml(track.title || 'Unknown')}</span>
        <span class="rec-card-artist">${escapeHtml(track.artist || '')}</span>
        ${pillHtml}
      </div>
    `;
  } else {
    // Square card — Mockup layout: Art with centered gold play circle, Title, Artist, Pill tag
    div.innerHTML = `
      <div class="${thumbClass}">
        ${thumbInner}
        <button class="rec-card-preview-btn" title="Quick 20s Preview" aria-label="20s Preview"><i class="ph-bold ph-speaker-simple-high"></i></button>
        <div class="rec-card-play-btn"><i class="ph-fill ph-play"></i></div>
        <button class="rec-card-radio-btn" title="Start Radio from this track" aria-label="Start Radio"><i class="ph-bold ph-radio"></i></button>
        <button class="rec-card-dislike-btn" title="Not interested in this song" aria-label="Not interested"><i class="ph ph-thumbs-down"></i></button>
      </div>
      <div class="rec-card-info">
        <span class="rec-card-title" title="${escapeHtml(track.title || '')}">${escapeHtml(track.title || 'Unknown')}</span>
        <span class="rec-card-artist">${escapeHtml(track.artist || '')}</span>
        ${pillHtml}
      </div>
    `;
  }

  const previewBtn = div.querySelector('.rec-card-preview-btn');
  if (previewBtn) {
    previewBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      toggleTrackAudioPreview(div, previewBtn);
    });
  }

  const radioBtn = div.querySelector('.rec-card-radio-btn');
  if (radioBtn) {
    radioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startTrackRadio(track);
    });
  }

  const dislikeBtn = div.querySelector('.rec-card-dislike-btn');
  if (dislikeBtn) {
    dislikeBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      div.style.transition = 'all 0.3s ease';
      div.style.opacity = '0';
      div.style.transform = 'scale(0.8)';
      setTimeout(() => div.remove(), 300);
      notify(`Removed "${(track.title || 'Track').slice(0, 25)}" from recommendations`);
      try {
        await api('/api/recommend/dislike', {
          method: 'POST',
          body: JSON.stringify({ track_id: track.id, session_id: typeof _userSessionId !== 'undefined' ? _userSessionId : '', context_source: 'dashboard' })
        });
      } catch (err) {}
    });
  }

  div.addEventListener('click', (e) => {
    if (e.target.closest('button, .rec-card-preview-btn, .rec-card-radio-btn, .rec-card-dislike-btn')) return;
    if (isYT && vid) {
      streamYouTubeAudio(vid, track.title, track.artist, thumb, dur);
    } else if (track.id) {
      playById(track.id);
    }
    document.querySelectorAll('.rec-card').forEach(c => c.classList.remove('now-playing'));
    div.classList.add('now-playing');
    _recCurrentlyPlayingId = track.id;
  });

  return div;
}

/**
 * Renders a single recommendation shelf.
 * Uses wide cards for the "trending" shelf (YouTube-style landscape layout).
 */
function renderRecShelf(section) {
  if (section.id === 'capsules') return; // Handled by renderDailyCapsules
  const shelfEl = document.getElementById(`shelf-${section.id}`);
  const cardsEl = document.getElementById(`cards-${section.id}`);
  if (!shelfEl || !cardsEl) return;

  if (!section.tracks || section.tracks.length === 0) {
    cardsEl.innerHTML = '';
    shelfEl.style.display = 'none';
    return;
  }

  // Trending uses wide landscape cards
  const useWide = section.id === 'trending';

  cardsEl.innerHTML = '';
  section.tracks.forEach(track => {
    if (!track) return;
    cardsEl.appendChild(renderRecCard(track, useWide));
  });

  // Only show if cards were actually added AND matches current mood filter
  if (cardsEl.children.length > 0) {
    const activeChip = document.querySelector('.mood-chip.active');
    const activeMood = activeChip ? (activeChip.dataset.mood || 'all') : 'all';
    const shelfMoods = (shelfEl.dataset.moods || 'all').split(',');

    if (activeMood === 'all' || shelfMoods.includes(activeMood)) {
      shelfEl.style.display = 'block';
    } else {
      shelfEl.style.display = 'none';
    }
  } else {
    shelfEl.style.display = 'none';
  }
}



/** Renders the 6-item Quick Launchpad directly below greeting */
function renderQuickLaunchGrid(items) {
  const container = document.getElementById('rec-quick-grid');
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = '';
    return;
  }

  container.innerHTML = items.map(item => {
    const artHtml = item.artwork_url
      ? `<img src="${escapeHtml(item.artwork_url)}" alt="Art" loading="lazy" onerror="this.style.display='none';this.parentNode.innerHTML='<i class=\\'${item.icon || 'ph-fill ph-music-note'}\\'></i>'">`
      : `<i class="${item.icon || 'ph-fill ph-music-note'}"></i>`;

    const bgGradient = item.gradient || 'linear-gradient(135deg, rgba(229, 169, 93, 0.4), rgba(0,0,0,0.6))';

    return `
      <div class="quick-card" data-id="${escapeHtml(item.id)}" data-type="${escapeHtml(item.type)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist || '')}">
        <div class="quick-card-art" style="background:${bgGradient}">
          ${artHtml}
        </div>
        <div class="quick-card-info">
          <span class="quick-card-title">${escapeHtml(item.title)}</span>
          <span class="quick-card-sub">${escapeHtml(item.subtitle || '')}</span>
        </div>
        <button class="quick-play-btn" title="Play ${escapeHtml(item.title)}" aria-label="Play">
          <i class="ph-fill ph-play"></i>
        </button>
      </div>
    `;
  }).join('');

  // Wire click events
  container.querySelectorAll('.quick-card').forEach((card, idx) => {
    const item = items[idx];
    card.addEventListener('click', async () => {
      if (item.tracks && item.tracks.length > 0) {
        queue = [...item.tracks];
        currentIndex = 0;
        const first = queue[0];
        if (first.is_online || (first.id && first.id.startsWith('yt:'))) {
          const vid = first.video_id || first.id.replace('yt:', '');
          streamYouTubeAudio(vid, first.title, first.artist, first.artwork_url, first.duration || 0);
        } else {
          playById(first.id);
        }
        renderQueue();
        notify(`▶ Playing ${item.title}`);
      } else if (item.type === 'artist_radio' && item.artist) {
        notify(`⚡ Starting ${item.artist} Radio...`);
        try {
          const res = await api('/api/recommend/batch', {
            method: 'POST',
            body: JSON.stringify({ mode: 'online', artist: item.artist, title: item.title, count: 25 })
          });
          if (res.tracks && res.tracks.length > 0) {
            queue = [...res.tracks];
            currentIndex = 0;
            const first = queue[0];
            const vid = first.video_id || (first.id || '').replace('yt:', '');
            streamYouTubeAudio(vid, first.title, first.artist, first.artwork_url, first.duration || 0);
            renderQueue();
          }
        } catch (e) {
          notify(`Failed to start ${item.artist} Radio`);
        }
      } else if (item.type === 'mood' || item.type === 'trending') {
        const moodSection = document.getElementById('shelf-mood') || document.getElementById('shelf-trending');
        if (moodSection) {
          moodSection.scrollIntoView({ behavior: 'smooth' });
        }
      }
    });
  });
}

/** Renders the Daily Mix Capsules */
function renderDailyCapsules(capsules) {
  const container = document.getElementById('cards-capsules');
  const shelf = document.getElementById('shelf-capsules');
  if (!container || !shelf) return;

  if (!capsules || capsules.length === 0) {
    shelf.style.display = 'none';
    return;
  }

  container.innerHTML = capsules.map(cap => {
    return `
      <div class="capsule-card" data-id="${escapeHtml(cap.id)}" data-mood="${escapeHtml(cap.mood_tag || 'all')}">
        <div class="capsule-card-banner" style="background:${cap.gradient}">
          <span class="capsule-badge-pill">${escapeHtml(cap.vibe || 'Daily Mix')}</span>
          <h4 class="capsule-banner-title">${escapeHtml(cap.title)}</h4>
          <i class="${cap.icon || 'ph-fill ph-sparkle'} capsule-banner-icon"></i>
        </div>
        <div class="capsule-card-bottom">
          <div class="capsule-card-meta">
            <span class="capsule-card-title">${escapeHtml(cap.title)}</span>
            <span class="capsule-card-sub">${escapeHtml(cap.subtitle || '')}</span>
          </div>
          <button class="capsule-play-circle" title="Play ${escapeHtml(cap.title)}" aria-label="Play">
            <i class="ph-fill ph-play"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.capsule-card').forEach((card, idx) => {
    const cap = capsules[idx];
    card.addEventListener('click', () => {
      if (cap.tracks && cap.tracks.length > 0) {
        queue = [...cap.tracks];
        currentIndex = 0;
        const first = queue[0];
        if (first.is_online || (first.id && first.id.startsWith('yt:'))) {
          const vid = first.video_id || first.id.replace('yt:', '');
          streamYouTubeAudio(vid, first.title, first.artist, first.artwork_url, first.duration || 0);
        } else {
          playById(first.id);
        }
        renderQueue();
        notify(`✨ Playing ${cap.title} (${cap.vibe})`);
      }
    });
  });

  shelf.style.display = 'block';
}

/** Renders the Sonic DNA Profile card */
function renderSonicDnaCard(tasteSummary, topArtist) {
  const container = document.getElementById('sonic-dna-card');
  const shelf = document.getElementById('shelf-sonic-dna');
  if (!container || !shelf) return;

  if (!tasteSummary) {
    shelf.style.display = 'none';
    return;
  }

  const streak = tasteSummary.listening_streak_days || 1;
  const hours = tasteSummary.total_listen_hours || 0.0;
  const vibe = tasteSummary.sonic_vibe_badge || '✨ Serene Music Voyager';
  const genres = tasteSummary.top_genres_breakdown || [];

  // New analytics
  const weeklyPlays = tasteSummary.weekly_plays || 0;
  const peakHour = tasteSummary.peak_hour_label || '';
  const avgSession = tasteSummary.avg_session_minutes || 0;
  const discoveryScore = tasteSummary.discovery_score || 0;
  const skipRate = tasteSummary.skip_rate_overall || 0;
  const artistsDetail = tasteSummary.top_artists_detail || [];

  const streakValEl = document.getElementById('streak-days-val');
  if (streakValEl) streakValEl.textContent = streak;

  const genresHtml = genres.length > 0
    ? genres.map(g => `
        <div class="sonic-meter-row">
          <div class="sonic-meter-meta">
            <span class="sonic-meter-name">${escapeHtml(g.name)}</span>
            <span class="sonic-meter-percent">${g.percent}%</span>
          </div>
          <div class="sonic-meter-track">
            <div class="sonic-meter-fill" style="width:${Math.max(8, g.percent)}%"></div>
          </div>
        </div>
      `).join('')
    : `
      <div class="sonic-meter-row">
        <div class="sonic-meter-meta">
          <span class="sonic-meter-name">Discovery &amp; Chill</span>
          <span class="sonic-meter-percent">100%</span>
        </div>
        <div class="sonic-meter-track">
          <div class="sonic-meter-fill" style="width:100%"></div>
        </div>
      </div>
    `;

  // Top Artists Detail panel
  const artistDetailHtml = artistsDetail.length > 0 ? `
    <div class="sonic-artists-detail">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.45);font-weight:600;margin-bottom:8px;">Your Top Artists</div>
      ${artistsDetail.map((a, i) => `
        <div class="sonic-artist-row">
          <span class="sonic-artist-rank">#${i + 1}</span>
          <span class="sonic-artist-name" title="${escapeHtml(a.name)}">${escapeHtml((a.name || '').slice(0, 20))}</span>
          <span class="sonic-artist-plays">${a.play_count} plays</span>
          <span class="sonic-artist-comp" title="Avg completion">${a.completion_rate}%</span>
        </div>
      `).join('')}
    </div>
  ` : '';

  // Listening Insights row
  const insightsHtml = `
    <div class="sonic-insights-row">
      ${weeklyPlays > 0 ? `<div class="sonic-insight-chip"><i class="ph ph-calendar-check"></i> ${weeklyPlays} plays this week</div>` : ''}
      ${peakHour ? `<div class="sonic-insight-chip"><i class="ph ph-clock"></i> Peak: ${escapeHtml(peakHour)}</div>` : ''}
      ${avgSession > 0 ? `<div class="sonic-insight-chip"><i class="ph ph-timer"></i> ~${avgSession}m sessions</div>` : ''}
      ${discoveryScore > 0 ? `<div class="sonic-insight-chip"><i class="ph ph-compass"></i> ${discoveryScore}% explored</div>` : ''}
      ${skipRate > 0 ? `<div class="sonic-insight-chip ${skipRate < 20 ? 'chip-good' : skipRate < 50 ? 'chip-mid' : 'chip-warn'}"><i class="ph ph-skip-forward"></i> ${skipRate}% skip rate</div>` : ''}
    </div>
  `;

  container.innerHTML = `
    <div class="sonic-dna-left">
      <span class="sonic-dna-vibe-pill">
        <i class="ph-fill ph-sparkle"></i> ${escapeHtml(vibe)}
      </span>
      <h3 class="sonic-dna-title">Your Sonic Identity</h3>
      <div class="sonic-dna-stats-row">
        <div class="sonic-stat-item">
          <span class="sonic-stat-val"><i class="ph-fill ph-fire" style="color:var(--accent);"></i> ${streak}</span>
          <span class="sonic-stat-label">Day Streak</span>
        </div>
        <div class="sonic-stat-item">
          <span class="sonic-stat-val"><i class="ph-fill ph-hourglass-simple" style="color:var(--accent);"></i> ${hours}h</span>
          <span class="sonic-stat-label">Total Listened</span>
        </div>
        ${topArtist ? `
        <div class="sonic-stat-item">
          <span class="sonic-stat-val" title="${escapeHtml(topArtist)}">${escapeHtml(topArtist.slice(0, 12))}</span>
          <span class="sonic-stat-label">Top Artist</span>
        </div>` : ''}
      </div>
      ${insightsHtml}
      ${artistDetailHtml}
    </div>
    <div class="sonic-dna-right">
      <div style="font-size:11.5px;text-transform:uppercase;letter-spacing:1px;color:rgba(255,255,255,0.45);font-weight:600;margin-bottom:4px;">Top Soundscapes</div>
      ${genresHtml}
    </div>
  `;

  shelf.style.display = 'block';
}

// ============================================================
// Music Intelligence & Listening Insights Subsystem
// Modularized into /static/recommendations.js (v1.0)
// Manages: Weekly Sound Rewind, Daily Streak Heatmap & 2D Vibe Compass
// ============================================================
window.openWeeklyRewindModal = window.openWeeklyRewindModal || function() {};
window.openVibeCompassModal = window.openVibeCompassModal || function() {};

// ── Animated Golden Waveform Visualizer Canvas on Now Playing Card ──
let _heroWaveformRaf = null;

function initHeroWaveformVisualizer() {
  const canvas = document.getElementById('hero-waveform-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const barCount = 42;
  const barSpacing = 4;

  function drawWaveform() {
    _heroWaveformRaf = requestAnimationFrame(drawWaveform);
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const isPlaying = !audio.paused && audio.currentTime > 0;
    let freqData = null;
    const curAnalyser = window.analyser || analyser;
    const curDataArray = window.audioDataArray || audioDataArray;
    if (isPlaying && curAnalyser && curDataArray) {
      try {
        curAnalyser.getByteFrequencyData(curDataArray);
        freqData = curDataArray;
      } catch (e) {}
    }

    const totalBarWidth = (width - (barCount - 1) * barSpacing) / barCount;
    const centerY = height / 2;

    for (let i = 0; i < barCount; i++) {
      let normHeight = 0.2;
      if (isPlaying && freqData && freqData.length > 0) {
        const binIndex = Math.floor((i / barCount) * Math.min(freqData.length, 32));
        const val = freqData[binIndex] || 0;
        normHeight = 0.18 + (val / 255) * 0.76;
      } else {
        // Aesthetic resting sine wave like the mockup
        const sine = Math.sin((i / barCount) * Math.PI);
        normHeight = 0.15 + sine * 0.35;
      }

      const barH = Math.max(4, height * normHeight);
      const x = i * (totalBarWidth + barSpacing);
      const y = centerY - barH / 2;

      // Warm Golden Amber Gradient matching mockup
      const grad = ctx.createLinearGradient(0, y, 0, y + barH);
      grad.addColorStop(0, '#f2ca8a');
      grad.addColorStop(0.5, '#e5a95d');
      grad.addColorStop(1, '#b87c35');

      ctx.fillStyle = grad;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, totalBarWidth, barH, 2);
      } else {
        ctx.rect(x, y, totalBarWidth, barH);
      }
      ctx.fill();
    }
  }

  if (!_heroWaveformRaf) drawWaveform();
}

// ── Shelf Navigation Arrow Scrolling Handler (< > buttons) ──
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.rec-shelf-arrow');
  if (!btn) return;
  const targetId = btn.dataset.target;
  const dir = parseInt(btn.dataset.dir, 10) || 1;
  const scrollContainer = document.getElementById(targetId);
  if (scrollContainer) {
    scrollContainer.scrollBy({ left: dir * 360, behavior: 'smooth' });
  }
});

// ── Wire Hero Deck Secondary Actions ──
$('#hero-prev')?.addEventListener('click', () => $('#prev')?.click());
$('#hero-next')?.addEventListener('click', () => $('#next')?.click());
$('#hero-open-queue')?.addEventListener('click', () => {
  const playlistsBtn = document.querySelector('[data-view="playlists"]');
  if (playlistsBtn) playlistsBtn.click();
});

function renderVideos() {
  const query = $('#search').value.trim().toLowerCase();
  let videos = state.tracks.filter(t => t.media_type === 'video');
  if (query) {
    videos = videos.filter(t => `${t.title} ${t.artist} ${t.category}`.toLowerCase().includes(query));
  }
  const grid = $('#video-grid');
  $('#videos-status').textContent = `${videos.length} video${videos.length===1?'':'s'}`;
  $('#empty-videos-state').classList.toggle('hidden', videos.length > 0);

  grid.innerHTML = videos.map((v, i) => `
    <div class="video-card" data-id="${escapeHtml(v.id)}">
      <div class="video-thumb"><i class="ph-fill ph-play-circle"></i></div>
      <div class="video-info">
        <strong>${escapeHtml(v.title)}</strong>
        <span>${escapeHtml(v.artist)}</span>
        ${v.category ? `<span class="track-cat-tag" style="align-self:flex-start;margin-top:4px;">${escapeHtml(v.category)}</span>` : ''}
      </div>
    </div>
  `).join('');
  
  grid.querySelectorAll('.video-card').forEach(card =>
    card.addEventListener('click', () => openVideoPlayer(card.dataset.id))
  );
}

// ---- Search (Ultra-Smooth 120ms Debounced) -------------------
let _localSearchTimer = null;
$('#search').addEventListener('input', () => {
  clearTimeout(_localSearchTimer);
  _localSearchTimer = setTimeout(() => {
    const q = ($('#search')?.value || '').trim();
    renderTracks(state.tracks.filter(t => t.media_type !== 'video'));
    renderVideos();
    renderFavorites();
    if (currentOpenPlaylistName && !$('#playlist-detail-view')?.classList.contains('hidden')) {
      if (currentOpenPlaylistName.startsWith('folder:')) {
        const folderName = currentOpenPlaylistName.slice(7);
        const folderTracks = state.tracks.filter(t => t.folder_name === folderName && t.media_type !== 'video').map(t => t.id);
        openFolderPlaylistDetail(folderName, folderTracks, q);
      } else {
        openPlaylistDetail(currentOpenPlaylistName, q);
      }
    }
  }, 120);
});

// ---- Playback -----------------------------------------------
function trackById(id) { 
  if (!id) return null;
  const ytKey = id.startsWith('yt:') ? id : `yt:${id}`;
  const rawId = id.startsWith('yt:') ? id.slice(3) : id;
  const isYt = id.startsWith('yt:') 
    || Boolean(state.online_tracks_cache && (state.online_tracks_cache[ytKey] || state.online_tracks_cache[id]))
    || Boolean(state.tracks.find(t => t.id === ytKey || t.video_id === rawId));

  if (isYt) {
    const fromQueue = queue.find(t => t.id === id || t.id === ytKey || t.video_id === rawId);
    if (fromQueue) return fromQueue;
    const fromOnlineCache = state.online_tracks_cache && (state.online_tracks_cache[ytKey] || state.online_tracks_cache[id]);
    if (fromOnlineCache) return { ...fromOnlineCache, id: ytKey };
    const fromTracks = state.tracks.find(t => t.id === id || t.id === ytKey || t.video_id === rawId);
    if (fromTracks) return fromTracks;
    return {
      id: ytKey,
      video_id: rawId,
      title: "YouTube Stream",
      artist: "YouTube",
      album: "YouTube",
      duration: 0,
      has_artwork: true,
      artwork_url: `https://i.ytimg.com/vi/${rawId}/hqdefault.jpg`,
      media_type: 'audio',
      is_online: true
    };
  }
  return state.tracks.find(t => t.id === id) 
    || (state.online_tracks_cache && (state.online_tracks_cache[id] || state.online_tracks_cache[ytKey]))
    || { id, title: "Missing Track", artist: "File not found", album: "", duration: 0, missing: true, category: '' }; 
}

let transitionTimeout1, transitionTimeout2;

// ---- 🎧 Feature 10: Auto-DJ Engine Core Functions ------------

function syncNowPlayingUI(track) {
  if (!track) return;
  const id = track.id;
  $('#now-title').textContent = track.title || 'Unknown Title';
  $('#now-artist').textContent = track.artist || 'Unknown Artist';
  if (track.has_artwork && track.artwork_url) {
    $('#now-art').innerHTML = `<img src="${escapeHtml(track.artwork_url)}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
    $('#album-art-box').innerHTML = `<img src="${escapeHtml(track.artwork_url)}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;box-shadow:0 0 20px rgba(0,0,0,0.6);">`;
  } else {
    $('#now-art').innerHTML = `<i class="ph-fill ph-music-notes"></i>`;
    $('#album-art-box').innerHTML = `<i class="ph-fill ph-music-notes-simple"></i>`;
  }

  $('#hero-title').innerHTML = `${escapeHtml(track.title || 'Unknown')}<br><em>is playing.</em>`;
  $('#hero-artist').textContent = `${track.artist || 'Unknown'} · ${track.album || 'Unknown'}`;
  const durStr = track.duration ? ` · ${formatTime(track.duration)}` : '';
  $('#hero-format').textContent = `${(track.extension || 'MP3').toUpperCase()} · ${track.quality || 'Standard'}${durStr}`;

  $('#current-time').textContent = '0:00';
  if (track.duration > 0) {
    $('#total-time').textContent = formatTime(track.duration);
    $('#progress').value = 0;
  }

  const colors = [
    ['#1a1a2e', '#0f3460'], ['#2d4059', '#ea5455'], 
    ['#111113', '#2a2a35'], ['#2c3e50', '#3498db'],
    ['#0b0b0c', '#d4b07a'], ['#1C1C21', '#8FA998']
  ];
  const [c1, c2] = colors[Math.floor(Math.random() * colors.length)];
  const vinylRecord = $('#vinyl-record');
  if (vinylRecord) {
    vinylRecord.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
    vinylRecord.classList.add('playing');
  }
  $('#hero-now-playing-card')?.classList.add('playing');
  const npBar = $('#hero-np-bar');
  if (npBar) npBar.style.width = '0%';
  $('#play').innerHTML = '<i class="ph-fill ph-pause"></i>';
  $('#fs-play').innerHTML = '<i class="ph-fill ph-pause"></i>';

  if (id) {
    state.history = [id, ...state.history.filter(k => k !== id)].slice(0, 100);
    saveState();
  }
  renderQueue();
  loadLyricsInline(track);
  updateMediaSessionMetadata(track);
  applyChameleonPalette(track);
  updateFullscreenUI(track);
  if (typeof window.refreshTrackWaveform === 'function') {
    window.refreshTrackWaveform(track);
  }
  if (id) {
    syncNowPlayingFavorite(id);
    if (typeof updateRecDashboardPlayingState === 'function') {
      updateRecDashboardPlayingState(id);
    } else if (typeof window.updateRecDashboardPlayingState === 'function') {
      window.updateRecDashboardPlayingState(id);
    }
  }
}

function estimateTrackBPM(track) {
  if (track && track.bpm && Number(track.bpm) > 0) return Number(track.bpm);
  const title = (track?.title || '').toLowerCase();
  const artist = (track?.artist || '').toLowerCase();
  const genre = (track?.genre || track?.category || '').toLowerCase();
  const text = `${title} ${artist} ${genre}`;

  let base = 118.0;
  if (/edm|house|techno|electro|dance/.test(text)) base = 126.0;
  else if (/punjabi|bhangra|club|remix/.test(text)) base = 124.0;
  else if (/pop|disco|funk|upbeat|summer/.test(text)) base = 120.0;
  else if (/rock|metal|grunge|punk|alternative/.test(text)) base = 116.0;
  else if (/hip-hop|hip hop|rap|trap|r&b/.test(text)) base = 92.0;
  else if (/lofi|lo-fi|chill|relax|coffee/.test(text)) base = 82.0;
  else if (/acoustic|ambient|classical|piano|sleep|slow/.test(text)) base = 74.0;

  // Deterministic scatter +-3.5 BPM based on title & artist
  let h = 0;
  const key = `${track?.title || ''}_${track?.artist || ''}`;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0xffff;
  const scatter = ((h % 70) / 10.0) - 3.5;
  return Math.round((base + scatter) * 10) / 10;
}

let _autoDJPillTimer = null;

function showAutoDJBlendingPill(bpmA, bpmB, duration) {
  const pill = $('#autodj-blending-pill');
  const txt = $('#autodj-blending-text');
  const quickBtn = $('#autodj-quick-btn');
  const fsBtn = $('#fs-autodj-btn');
  if (quickBtn) quickBtn.classList.add('blending');
  if (fsBtn) fsBtn.classList.add('blending');
  if (pill && txt) {
    txt.textContent = `Auto-DJ Blending • ${bpmA} → ${bpmB} BPM (${duration}s)`;
    pill.classList.add('show');
  }
  clearTimeout(_autoDJPillTimer);
  _autoDJPillTimer = setTimeout(() => {
    hideAutoDJBlendingPill();
  }, (duration + 0.5) * 1000);
}

function hideAutoDJBlendingPill() {
  clearTimeout(_autoDJPillTimer);
  const pill = $('#autodj-blending-pill');
  const quickBtn = $('#autodj-quick-btn');
  const fsBtn = $('#fs-autodj-btn');
  if (quickBtn) quickBtn.classList.remove('blending');
  if (fsBtn) fsBtn.classList.remove('blending');
  if (pill) pill.classList.remove('show');
}

function smoothlyRestoreTempo(audioEl, fromRate, toRate, durationMs = 3000) {
  if (!audioEl || Math.abs(fromRate - toRate) < 0.005) {
    if (audioEl) audioEl.playbackRate = toRate;
    return;
  }
  const startTime = performance.now();
  const step = (now) => {
    const progress = Math.min(1.0, (now - startTime) / durationMs);
    const ease = 0.5 * (1 - Math.cos(progress * Math.PI));
    audioEl.playbackRate = fromRate + (toRate - fromRate) * ease;
    if (progress < 1.0) {
      requestAnimationFrame(step);
    } else {
      audioEl.playbackRate = toRate;
    }
  };
  requestAnimationFrame(step);
}

let isCrossfading = false;

function preloadNextDeckAudio(nextTrack) {
  if (!nextTrack || isCrossfading) return;
  const standbyAudio = getStandbyAudio();
  if (!standbyAudio) return;
  const incomingUrl = nextTrack.is_online && nextTrack.video_id 
    ? `/api/youtube/stream/${encodeURIComponent(nextTrack.video_id)}`
    : (nextTrack.url || '');
  if (!incomingUrl) return;
  if (standbyAudio.dataset.preloadedUrl !== incomingUrl && standbyAudio.src !== incomingUrl) {
    standbyAudio.dataset.preloadedUrl = incomingUrl;
    standbyAudio.src = incomingUrl;
    standbyAudio.preload = 'auto';
    try { standbyAudio.load(); } catch (_) {}
  }
}

async function startAutoDJCrossfade(nextTrack, customDuration = null) {
  if (isCrossfading || !nextTrack) return false;
  if (!isAutoDJEnabled && customDuration === null) return false;

  const duration = (customDuration !== null) ? customDuration : autoDJDuration;
  if (duration <= 0) return false;

  const outgoingAudio = getActiveAudio();
  const incomingAudio = getStandbyAudio();
  if (!outgoingAudio || !incomingAudio) return false;

  const curAudioCtx = window.audioCtx || (typeof audioCtx !== 'undefined' ? audioCtx : null);
  if (typeof initAudioContext === 'function') initAudioContext();
  else if (window.initAudioContext) window.initAudioContext();

  if (curAudioCtx && curAudioCtx.state === 'suspended') {
    curAudioCtx.resume();
  }

  isCrossfading = true;

  const currentTrack = (queue && queue[currentIndex]) || {};
  const currentBpm = estimateTrackBPM(currentTrack);
  const targetBpm = estimateTrackBPM(nextTrack);
  showAutoDJBlendingPill(currentBpm, targetBpm, duration);

  const incomingUrl = nextTrack.is_online && nextTrack.video_id 
    ? `/api/youtube/stream/${encodeURIComponent(nextTrack.video_id)}`
    : (nextTrack.url || '');

  if (!incomingUrl) {
    isCrossfading = false;
    hideAutoDJBlendingPill();
    return false;
  }

  // Setup standby audio element
  incomingAudio.src = incomingUrl;
  incomingAudio.currentTime = 0;
  incomingAudio.preservesPitch = true;

  // Beat-Match Tempo Sync (±6% musical pitch bend limit)
  const tempoRatio = Math.max(0.94, Math.min(1.06, currentBpm / targetBpm));
  incomingAudio.playbackRate = tempoRatio;

  const outgoingDeck = activeDeck;
  const incomingDeck = activeDeck === 'A' ? 'B' : 'A';
  const dAGain = window.deckAGain || (typeof deckAGain !== 'undefined' ? deckAGain : null);
  const dBGain = window.deckBGain || (typeof deckBGain !== 'undefined' ? deckBGain : null);
  const outGain = outgoingDeck === 'A' ? dAGain : dBGain;
  const inGain = incomingDeck === 'A' ? dAGain : dBGain;

  if (curAudioCtx && inGain) {
    inGain.gain.setValueAtTime(0, curAudioCtx.currentTime);
  } else {
    incomingAudio.volume = 0;
  }

  try {
    await incomingAudio.play();
  } catch (err) {
    console.warn('AutoDJ incoming play error:', err);
    isCrossfading = false;
    hideAutoDJBlendingPill();
    return false;
  }

  // Equal-power crossfade curve math (cos/sin preserve total acoustic power)
  const steps = 64;
  const outCurve = new Float32Array(steps);
  const inCurve = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    outCurve[i] = Math.cos(t * 0.5 * Math.PI);
    inCurve[i] = Math.sin(t * 0.5 * Math.PI);
  }

  if (curAudioCtx && outGain && inGain) {
    const now = curAudioCtx.currentTime;
    outGain.gain.cancelScheduledValues(now);
    inGain.gain.cancelScheduledValues(now);
    outGain.gain.setValueCurveAtTime(outCurve, now, duration);
    inGain.gain.setValueCurveAtTime(inCurve, now, duration);
  } else {
    const startTime = performance.now();
    const interval = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(1.0, elapsed / duration);
      outgoingAudio.volume = Math.cos(progress * 0.5 * Math.PI);
      incomingAudio.volume = Math.sin(progress * 0.5 * Math.PI);
      if (progress >= 1.0) clearInterval(interval);
    }, 40);
  }

  // Update track index and UI immediately so the user sees the incoming track
  const existingIdx = queue.findIndex(t => t.id === nextTrack.id);
  if (existingIdx >= 0) {
    currentIndex = existingIdx;
  } else {
    queue.splice(currentIndex + 1, 0, nextTrack);
    currentIndex++;
  }

  activeDeck = incomingDeck;
  syncNowPlayingUI(nextTrack);
  state.last_played_track_id = nextTrack.id;
  state.last_played_position = 0;
  startTrackingTrackPlayback(nextTrack, nextTrack.is_online ? 'youtube_stream' : 'library');

  // Complete crossfade after duration
  setTimeout(() => {
    outgoingAudio.pause();
    outgoingAudio.src = '';
    outgoingAudio.playbackRate = 1.0;
    outgoingAudio.volume = 1.0;
    if (curAudioCtx && outGain) {
      outGain.gain.cancelScheduledValues(curAudioCtx.currentTime);
      outGain.gain.value = 1.0; // Ready for next use
    }

    // Smoothly restore incoming deck's tempo to 1.0
    smoothlyRestoreTempo(incomingAudio, tempoRatio, 1.0, 3000);

    isCrossfading = false;
    hideAutoDJBlendingPill();
  }, duration * 1000);

  return true;
}

function playById(id) {
  stopHoverPreview();
  if (id && id.startsWith('yt:')) {
    const vid = id.replace('yt:', '');
    const t = trackById(id);
    streamYouTubeAudio(t.video_id || vid, t.title, t.artist, t.artwork_url, t.duration);
    return;
  }

  const track = trackById(id);
  if (!track || track.missing) return notify('Track is missing from disk.');
  if (track.media_type === 'video') { openVideoPlayer(id); return; }

  currentIndex = queue.findIndex(t => t.id === id);
  if (currentIndex < 0) {
    queue = [...state.tracks.filter(t=>t.media_type!=='video')];
    currentIndex = queue.findIndex(t => t.id === id);
  }

  // Precompute queue in background for local tracks
  populate25SongQueue();

  const player = $('#hero-now-playing-card') || $('.hero-player'); // new card, fallback to old
  clearTimeout(transitionTimeout1);

  clearTimeout(transitionTimeout2);

  // The function to actually swap data and play
  const doChange = () => {
    _lastPrewarmedTrackId = null;
    startTrackingTrackPlayback(track, 'library');
    initAudioContext();
    audio.src = track.url;
    audio.currentTime = 0; // Always play from the beginning when user selects any song
    audio.play().catch(() => notify('Playback failed.'));
    
    state.last_played_track_id = id;
    state.last_played_position = 0;
    
    syncNowPlayingUI(track);
    const fsDiskContainer = $('#fs-disk-container');
    if (fsDiskContainer) fsDiskContainer.classList.remove('changing');

    // Trigger visual slide-in
    player.classList.remove('anim-out');
    player.classList.add('anim-in');
    
    transitionTimeout2 = setTimeout(() => {
      player.classList.remove('anim-in');
    }, 500); // Wait for the 0.5s CSS animation to finish
  };

  // Immediate Zero-Delay Song Transition
  const targetVol = parseFloat($('#volume').value) || 1;
  audio.volume = targetVol;
  doChange();
}

function togglePlayGlobal() {
  if (!audio || !audio.src) { 
    const first = (queue && queue[0]) || (state.tracks && state.tracks.find(t=>t.media_type!=='video'));
    if (first) playById(first.id); 
    return; 
  }
  if (typeof initAudioContext === 'function') initAudioContext();
  if (typeof audioCtx !== 'undefined' && audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  if (audio.paused) { 
    audio.play().catch(err => console.warn('Playback resume error:', err)); 
    if ($('#play')) $('#play').innerHTML = '<i class="ph-fill ph-pause"></i>'; 
    if ($('#hero-play')) $('#hero-play').innerHTML = '<i class="ph-fill ph-pause-circle"></i>';
    if ($('#fs-play')) $('#fs-play').innerHTML = '<i class="ph-fill ph-pause"></i>';
    $('#vinyl-record')?.classList.add('playing');
    $('#hero-now-playing-card')?.classList.add('playing');
    const fsP = document.getElementById('fs-player');
    if (fsP) fsP.classList.add('playing');
    if (_ytCurrentStreamId) _updateStreamButtonStates('playing');
  } else { 
    audio.pause(); 
    if ($('#play')) $('#play').innerHTML = '<i class="ph-fill ph-play"></i>';
    if ($('#hero-play')) $('#hero-play').innerHTML = '<i class="ph-fill ph-play-circle"></i>';
    if ($('#fs-play')) $('#fs-play').innerHTML = '<i class="ph-fill ph-play"></i>';
    $('#vinyl-record')?.classList.remove('playing');
    $('#hero-now-playing-card')?.classList.remove('playing');
    const fsP = document.getElementById('fs-player');
    if (fsP) fsP.classList.remove('playing');
    if (_ytCurrentStreamId) _updateStreamButtonStates('paused');
    if (typeof debouncedSaveState === 'function') debouncedSaveState(1200);
    else if (typeof saveState === 'function') saveState();
  }
}
window.togglePlayGlobal = togglePlayGlobal;

if (!window._playBound) {
  window._playBound = true;
  $('#play')?.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePlayGlobal();
  });
}
$('#hero-play')?.addEventListener('click', (e) => {
  e.stopPropagation();
  togglePlayGlobal();
});

// ============================================================
// Linus CMI v6.0 Centralized Telemetry & Tracking Engine
// ============================================================
let radioMode = localStorage.getItem('linus_radio_mode') || 'online'; // 'online' or 'offline'
let previousTrackId = null;
let consecutiveSkipCount = 0;
let isFetchingRadioBatch = false;
let _lastPrewarmedTrackId = null;

let _telemetryCurrentTrack = null;
let _telemetryPlayStartTime = 0;
let _telemetryMaxTimePlayed = 0;
let _userSessionId = 'sess_' + Math.random().toString(36).slice(2, 10);

function flushCurrentTrackPlayback(reason = 'change', isExplicitSkip = false) {
  if (!_telemetryCurrentTrack || !_telemetryCurrentTrack.id) return;

  const currentTrack = _telemetryCurrentTrack;
  const durPlayed = Math.max(audio.currentTime || 0, _telemetryMaxTimePlayed || 0);
  const totalDur = audio.duration || currentTrack.duration || durPlayed || 0;
  
  const isSkip = isExplicitSkip || (reason === 'skip') || (reason === 'change' && durPlayed < 20 && totalDur > 45);

  const payload = {
    track_id: currentTrack.id,
    duration_played: durPlayed,
    total_duration: totalDur,
    skipped: isSkip,
    prev_track_id: previousTrackId || '',
    title: currentTrack.title || '',
    artist: currentTrack.artist || '',
    album: currentTrack.album || '',
    artwork_url: currentTrack.artwork_url || '',
    is_online: !!(currentTrack.is_online || (currentTrack.id && currentTrack.id.startsWith('yt:'))),
    context_source: reason,
    session_id: _userSessionId
  };

  previousTrackId = currentTrack.id;

  if (reason === 'unload' && navigator.sendBeacon) {
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon('/api/recommend/record-event', blob);
      return;
    } catch (e) {}
  }

  api('/api/recommend/record-event', {
    method: 'POST',
    body: JSON.stringify(payload)
  }).then(() => {
    if (typeof loadStreakHeatmap === 'function') {
      loadStreakHeatmap();
    } else if (typeof window.loadStreakHeatmap === 'function') {
      window.loadStreakHeatmap();
    }
  }).catch(() => {});

  _telemetryCurrentTrack = null;
  _telemetryMaxTimePlayed = 0;
}

function startTrackingTrackPlayback(newTrack, context = 'library') {
  if (!newTrack || !newTrack.id) return;
  if (_telemetryCurrentTrack && _telemetryCurrentTrack.id !== newTrack.id) {
    flushCurrentTrackPlayback(context, false);
  }
  _telemetryCurrentTrack = { ...newTrack };
  _telemetryPlayStartTime = Date.now();
  _telemetryMaxTimePlayed = 0;
}

function updateRadioModeUI() {
  const btn = $('#radio-mode-toggle-btn');
  const icon = $('#radio-mode-icon');
  const text = $('#radio-mode-text');
  if (!btn) return;

  if (radioMode === 'online') {
    btn.className = 'cozy-quick-btn radio-mode-toggle-btn online';
    if (icon) icon.className = 'ph-fill ph-globe';
    if (text) text.textContent = 'Online Radio';
    btn.title = 'Current Mode: Online Radio (YouTube infinite discovery). Click to switch to Offline Library.';
  } else {
    btn.className = 'cozy-quick-btn radio-mode-toggle-btn offline';
    if (icon) icon.className = 'ph-fill ph-hard-drives';
    if (text) text.textContent = 'Offline Radio';
    btn.title = 'Current Mode: Offline Radio (Local Library similarity). Click to switch to Online YouTube.';
  }
}

$('#radio-mode-toggle-btn')?.addEventListener('click', () => {
  radioMode = radioMode === 'online' ? 'offline' : 'online';
  try { localStorage.setItem('linus_radio_mode', radioMode); } catch (e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ radio_mode: radioMode });
  updateRadioModeUI();
  // Clear upcoming auto-generated songs so new mode immediately populates
  if (queue.length > currentIndex + 1) {
    queue = queue.slice(0, currentIndex + 1);
  }
  populate25SongQueue();
  notify(radioMode === 'online' ? '🌐 Switched to Online Radio (Infinite YouTube Discovery)' : '💾 Switched to Offline Radio (Local Library)');
});

// ---- 1-Click Infinite Radio Station Engine ----
let _activeRadioSeed = null;

async function startTrackRadio(seedTrackOrId = null) {
  let seed = null;
  if (typeof seedTrackOrId === 'object' && seedTrackOrId !== null) {
    seed = seedTrackOrId;
  } else if (typeof seedTrackOrId === 'string' && seedTrackOrId) {
    seed = trackById(seedTrackOrId);
  } else {
    seed = queue[currentIndex] || (state.tracks && state.tracks.length ? state.tracks[0] : null);
  }

  if (!seed || (!seed.id && !seed.video_id)) {
    notify('Select or play a song first to start a radio station.');
    return;
  }

  const title = seed.title || 'Selected Track';
  const artist = seed.artist || 'Unknown Artist';
  _activeRadioSeed = { ...seed, title, artist };

  notify(`🪄 Starting Infinite Radio from "${title}"...`);

  // 1. Play seed track immediately
  const isOnline = Boolean(seed.is_online || (seed.id && seed.id.startsWith('yt:')) || seed.video_id);
  const cleanVid = seed.video_id || (seed.id && seed.id.startsWith('yt:') ? seed.id.replace('yt:', '') : '');

  if (isOnline && cleanVid) {
    streamYouTubeAudio(cleanVid, title, artist, seed.artwork_url || seed.thumbnail || '', seed.duration || 0);
  } else if (seed.id) {
    playById(seed.id);
  }

  // 2. Set queue starting from seed track
  queue = [seed];
  currentIndex = 0;
  renderQueue();

  // 3. Fetch 25 acoustically matched songs
  isFetchingRadioBatch = true;
  try {
    const res = await api('/api/recommend/batch', {
      method: 'POST',
      body: JSON.stringify({
        mode: radioMode === 'offline' && !isOnline ? 'offline' : 'online',
        track_id: seed.id || (cleanVid ? `yt:${cleanVid}` : ''),
        title: title,
        artist: artist,
        category: seed.category || '',
        count: 25,
        consecutive_skips: 0,
        history: (state.history || []).slice(0, 15)
      })
    });

    if (res && res.status === 'success' && res.tracks && res.tracks.length > 0) {
      const seedKey = (seed.id || cleanVid).toLowerCase();
      const peers = res.tracks.filter(t => {
        if (!t) return false;
        const tid = (t.id || t.video_id || '').toLowerCase();
        return tid && tid !== seedKey;
      });
      queue = [seed, ...peers];
      renderQueue();
      notify(`📻 Infinite Radio ready: ${peers.length} matching songs queued for "${title}"`);
    } else {
      notify(`📻 Radio station playing "${title}"`);
    }
  } catch (err) {
    console.error('Start radio error:', err);
    notify(`📻 Radio station playing "${title}"`);
  } finally {
    isFetchingRadioBatch = false;
  }
}

// Populates a 25-song cohesive precomputed queue in the background
async function populate25SongQueue(forceReset = false) {
  if (isFetchingRadioBatch) return;
  const currentTrack = queue[currentIndex] || {};
  const currentId = currentTrack.id || '';
  const title = currentTrack.title || '';
  const artist = currentTrack.artist || '';

  // Only replenish if remaining songs in queue < 6 or forceReset
  const remaining = queue.length - (currentIndex + 1);
  if (!forceReset && remaining >= 6) return;

  isFetchingRadioBatch = true;
  try {
    const res = await api('/api/recommend/batch', {
      method: 'POST',
      body: JSON.stringify({
        mode: radioMode,
        track_id: currentId,
        title: title,
        artist: artist,
        category: currentTrack.category || '',
        count: 25,
        consecutive_skips: consecutiveSkipCount,
        history: (state.history || []).slice(0, 15)
      })
    });

    if (res && res.status === 'success' && res.tracks && res.tracks.length > 0) {
      const newTracks = res.tracks.filter(t => t && t.id && t.id !== currentId);
      if (forceReset) {
        queue = [currentTrack, ...newTracks];
        currentIndex = 0;
      } else {
        // Append unique upcoming songs
        const existingIds = new Set(queue.map(t => t.id));
        const toAdd = newTracks.filter(t => !existingIds.has(t.id));
        queue.push(...toAdd);
        // Cap maximum queue length to 35 to guarantee zero memory bloat
        if (queue.length > 35) {
          queue = queue.slice(Math.max(0, currentIndex - 3), currentIndex + 26);
          currentIndex = queue.findIndex(t => t.id === currentId);
          if (currentIndex < 0) currentIndex = 0;
        }
      }
      renderQueue();
      debouncedSaveQueue();
    }
  } catch (err) {
    console.error('Queue batch error:', err);
  } finally {
    isFetchingRadioBatch = false;
  }
}

// When a user quickly skips a song, remove 4-5 matching songs from the same artist/type from queue
function pruneSkippedAffinitiesFromQueue(skippedTrack) {
  if (!skippedTrack) return;
  const skipArtist = (skippedTrack.artist || '').toLowerCase().trim();
  const skipTitle = (skippedTrack.title || '').toLowerCase().trim();
  if (!skipArtist && !skipTitle) return;

  let removedCount = 0;
  const maxToRemove = 4; // Remove 4-5 matching songs

  const preservedBefore = queue.slice(0, currentIndex + 1);
  const upcoming = queue.slice(currentIndex + 1);

  const filteredUpcoming = upcoming.filter(t => {
    if (removedCount >= maxToRemove) return true;
    const tArtist = (t.artist || '').toLowerCase().trim();
    if (skipArtist && (tArtist === skipArtist || tArtist.includes(skipArtist) || skipArtist.includes(tArtist))) {
      removedCount++;
      return false;
    }
    return true;
  });

  queue = [...preservedBefore, ...filteredUpcoming];
  renderQueue();
  debouncedSaveQueue();
  // If upcoming pool is depleted, fetch fresh variety batch immediately
  if (queue.length - (currentIndex + 1) < 5) {
    populate25SongQueue();
  }
}

async function playNextRecommendedSong() {
  // If queue has upcoming precomputed songs, play immediately with zero delay
  if (currentIndex + 1 < queue.length) {
    currentIndex++;
    const nextTrack = queue[currentIndex];
    debouncedSaveQueue();
    if (nextTrack.is_online && nextTrack.video_id) {
      streamYouTubeAudio(nextTrack.video_id, nextTrack.title, nextTrack.artist, nextTrack.artwork_url, nextTrack.duration);
    } else {
      playById(nextTrack.id);
    }
    populate25SongQueue();
    return;
  }

  // If queue is empty, fetch and play
  notify(`📻 ${radioMode === 'online' ? 'Discovering next song from YouTube...' : 'Finding best matching local song...'}`);

  try {
    const res = await api('/api/recommend/next', {
      method: 'POST',
      body: JSON.stringify({
        mode: radioMode,
        track_id: queue[currentIndex]?.id || '',
        title: queue[currentIndex]?.title || '',
        artist: queue[currentIndex]?.artist || '',
        category: queue[currentIndex]?.category || '',
        consecutive_skips: consecutiveSkipCount,
        history: (state.history || []).slice(0, 15)
      })
    });

    if (res && res.status === 'success' && res.track) {
      const nextTrack = res.track;
      if (nextTrack.is_online && nextTrack.video_id) {
        streamYouTubeAudio(nextTrack.video_id, nextTrack.title, nextTrack.artist, nextTrack.artwork_url, nextTrack.duration);
      } else if (nextTrack.id) {
        playById(nextTrack.id);
      }
      populate25SongQueue();
      return;
    }
  } catch (err) {
    console.error('Recommendation autoplay error:', err);
  }

  if (queue.length) {
    currentIndex = 0;
    const first = queue[0];
    if (first.is_online && first.video_id) {
      streamYouTubeAudio(first.video_id, first.title, first.artist, first.artwork_url, first.duration);
    } else {
      playById(first.id);
    }
  }
}

// Log playback stats on song end
audio.addEventListener('ended', () => {
  consecutiveSkipCount = 0; // Completed song resets skip count
  flushCurrentTrackPlayback('ended', false);

  if (repeatMode === 'one') {
    audio.currentTime = 0;
    audio.play();
    return;
  }

  playNextRecommendedSong();
});

$('#next').addEventListener('click', () => {
  if (!queue.length) return;
  if (repeatMode === 'one') { audio.currentTime = 0; audio.play(); return; }

  const currentTrack = queue[currentIndex] || {};
  const durPlayed = audio.currentTime;
  const isSkip = durPlayed < 20;

  if (isSkip) {
    consecutiveSkipCount++;
    pruneSkippedAffinitiesFromQueue(currentTrack);
  } else {
    consecutiveSkipCount = 0;
  }

  flushCurrentTrackPlayback('skip', isSkip);

  // If Auto-DJ is enabled and next track is ready in queue, perform snappy 1.8s beat-matched DJ blend!
  if (isAutoDJEnabled && autoDJDuration > 0 && !audio.paused && audio.src && currentIndex + 1 < queue.length) {
    const nextTrack = queue[currentIndex + 1];
    startAutoDJCrossfade(nextTrack, 1.8).then(blended => {
      if (blended) {
        populate25SongQueue();
      } else {
        playNextRecommendedSong();
      }
    });
    return;
  }

  playNextRecommendedSong();
});

$('#previous')?.addEventListener('click', () => {
  if (audio.currentTime > 3) {
    audio.currentTime = 0;
    return;
  }
  if (currentIndex > 0) {
    flushCurrentTrackPlayback('prev', false);
    currentIndex--;
    const prevTrack = queue[currentIndex];
    if (prevTrack && prevTrack.is_online && prevTrack.video_id) {
      streamYouTubeAudio(prevTrack.video_id, prevTrack.title, prevTrack.artist, prevTrack.artwork_url, prevTrack.duration);
    } else if (prevTrack && prevTrack.id) {
      playById(prevTrack.id);
    }
  }
});

window.addEventListener('beforeunload', () => {
  flushCurrentTrackPlayback('unload', false);
});

// Reliable, Jitter-Free Audio Scrubber with Live Timestamp Feedback
window.isUserScrubbing = false;
const progressSlider = $('#progress');
if (progressSlider) {
  const onStartScrub = () => {
    window.isUserScrubbing = true;
  };
  const onScrubbing = e => {
    window.isUserScrubbing = true;
    if (audio.duration) {
      const seekSec = (parseFloat(e.target.value) / 100) * audio.duration;
      const curTimeEl = $('#current-time');
      if (curTimeEl) curTimeEl.textContent = formatTime(seekSec);
    }
  };
  const onEndScrub = e => {
    if (audio.duration) {
      audio.currentTime = (parseFloat(e.target.value) / 100) * audio.duration;
    }
    setTimeout(() => {
      window.isUserScrubbing = false;
    }, 100);
  };

  progressSlider.addEventListener('pointerdown', onStartScrub);
  progressSlider.addEventListener('touchstart', onStartScrub, { passive: true });
  progressSlider.addEventListener('mousedown', onStartScrub);

  progressSlider.addEventListener('input', onScrubbing);

  progressSlider.addEventListener('change', onEndScrub);
  progressSlider.addEventListener('pointerup', onEndScrub);
  progressSlider.addEventListener('touchend', onEndScrub);
}

var lastUnmutedVolume = 1;
window.lastUnmutedVolume = lastUnmutedVolume;
const volIcon = $('#vol-icon');
const volMuteBtn = $('#vol-mute-btn');

function updateVolumeUI(v) {
  const volSlider = $('#volume');
  if (volSlider) volSlider.value = v;
  if (volIcon) {
    if (v === 0 || audio.muted) volIcon.className = 'ph ph-speaker-slash';
    else if (v < 0.5) volIcon.className = 'ph ph-speaker-low';
    else volIcon.className = 'ph ph-speaker-high';
  }
}
window.updateVolumeUI = updateVolumeUI;

function toggleMuteGlobal() {
  const volSlider = $('#volume');
  if (audio.muted || audio.volume === 0) {
    audio.muted = false;
    const restore = lastUnmutedVolume > 0 ? lastUnmutedVolume : 1;
    audio.volume = restore;
    updateVolumeUI(restore);
    notify(`Unmuted (${Math.round(restore * 100)}%)`);
  } else {
    lastUnmutedVolume = audio.volume > 0 ? audio.volume : 1;
    window.lastUnmutedVolume = lastUnmutedVolume;
    audio.muted = true;
    audio.volume = 0;
    updateVolumeUI(0);
    notify('Muted');
  }
}
window.toggleMuteGlobal = toggleMuteGlobal;

$('#volume')?.addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  audio.volume = v;
  audio.muted = (v === 0);
  if (v > 0) lastUnmutedVolume = v;
  updateVolumeUI(v);
});

if (volMuteBtn) {
  volMuteBtn.addEventListener('click', () => {
    toggleMuteGlobal();
  });
}

// Studio FX Popover Launcher
const fxLauncherBtn = $('#fx-launcher-btn');
const fxPopover = $('#studio-fx-popover');

if (fxLauncherBtn && fxPopover) {
  fxLauncherBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShown = fxPopover.classList.toggle('show');
    fxLauncherBtn.classList.toggle('open', isShown);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.fx-launcher-wrapper')) {
      fxPopover.classList.remove('show');
      fxLauncherBtn.classList.remove('open');
    }
  });

  fxPopover.querySelectorAll('.fx-popover-item').forEach(item => {
    if (item.id === 'norm-toggle-btn' || item.id === 'hover-preview-toggle-btn' || item.id === 'chameleon-toggle-btn' || item.id === 'karaoke-toggle-btn' || item.id === 'autodj-toggle-btn') return; // Keep popover open so user sees ON/OFF toggle state
    item.addEventListener('click', () => {
      fxPopover.classList.remove('show');
      fxLauncherBtn.classList.remove('open');
    });
  });

  const normToggleBtn = $('#norm-toggle-btn');
  if (normToggleBtn) {
    normToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleAudioNormalization();
    });
  }

  const hoverPreviewToggleBtn = $('#hover-preview-toggle-btn');
  if (hoverPreviewToggleBtn) {
    hoverPreviewToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleHoverPreview();
    });
  }

  const chameleonToggleBtn = $('#chameleon-toggle-btn');
  if (chameleonToggleBtn) {
    chameleonToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleChameleonGlow();
    });
  }

  const karaokeToggleBtn = $('#karaoke-toggle-btn');
  if (karaokeToggleBtn) {
    karaokeToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleKaraokeMode();
    });
  }
}

// ---- Linus CMI Smart Shuffle (Taste Affinity & Artist Dispersion) ----
function smartShuffle(tracks, currentTrack = null) {
  if (!tracks || tracks.length <= 1) return [...(tracks || [])];
  if (tracks.length === 2) {
    return Math.random() > 0.5 ? [tracks[1], tracks[0]] : [...tracks];
  }

  const favoritesSet = new Set(state.favorites || []);
  const currentArtist = (currentTrack?.artist || queue[currentIndex]?.artist || '').trim().toLowerCase();

  // 1. Calculate smart weights for each candidate
  const scored = tracks.map(t => {
    let weight = 50.0;
    const isFav = favoritesSet.has(t.id);
    if (isFav) weight += 35.0;

    // Favor tracks with complete artwork or recognized artists
    if (t.has_artwork) weight += 10.0;
    const tArtist = (t.artist || '').trim().toLowerCase();
    if (tArtist && tArtist !== 'unknown' && tArtist !== 'local collection') {
      weight += 10.0;
    }

    // Small bonus if in user playlists
    for (const pName of Object.keys(state.playlists || {})) {
      if ((state.playlists[pName] || []).includes(t.id)) {
        weight += 15.0;
        break;
      }
    }

    // Stochastic temperature noise (+/- 25) so each shuffle click yields a fresh unique journey
    weight += (Math.random() - 0.5) * 50.0;

    return {
      track: t,
      artist: tArtist || 'unknown',
      weight: Math.max(5.0, weight)
    };
  });

  // Sort initially by calculated affinity weight
  scored.sort((a, b) => b.weight - a.weight);

  // 2. Artist Dispersion / Interleaving Constraint:
  // Strictly prevent adjacent tracks from having the same artist
  const result = [];
  const remaining = [...scored];
  let lastArtist = currentArtist;

  while (remaining.length > 0) {
    let pickIdx = remaining.findIndex(item => item.artist && item.artist !== lastArtist && item.artist !== 'unknown');
    if (pickIdx === -1) {
      // Fallback: pick any track if no different artist is available
      pickIdx = 0;
    }
    const chosen = remaining.splice(pickIdx, 1)[0];
    result.push(chosen.track);
    lastArtist = chosen.artist;
  }

  return result;
}

// ---- Shuffle / Repeat (Spotify-Grade Smart Queue Shuffle) ----
$('#shuffle-btn').addEventListener('click', () => {
  shuffleOn = !shuffleOn;
  $('#shuffle-btn').classList.toggle('control-active', shuffleOn);
  if (shuffleOn) {
    if (queue.length > currentIndex + 1) {
      const before = queue.slice(0, currentIndex + 1);
      const upcoming = queue.slice(currentIndex + 1);
      const currentTrack = queue[currentIndex];
      const shuffledUpcoming = smartShuffle(upcoming, currentTrack);
      queue = [...before, ...shuffledUpcoming];
      renderQueue();
    }
    notify('🔀 Smart Shuffle On — Dynamic taste weighting & artist dispersion');
  } else {
    notify('➡️ Shuffle Off — Sequential playback');
  }
});

$('#repeat-btn').addEventListener('click', () => {
  if (repeatMode === 'none') {
    repeatMode = 'all';
    $('#repeat-btn').classList.add('control-active');
    $('#repeat-btn').innerHTML = '<i class="ph-fill ph-repeat"></i>';
  } else if (repeatMode === 'all') {
    repeatMode = 'one';
    $('#repeat-btn').innerHTML = '<i class="ph-fill ph-repeat-once"></i>';
  } else {
    repeatMode = 'none';
    $('#repeat-btn').classList.remove('control-active');
    $('#repeat-btn').innerHTML = '<i class="ph ph-repeat"></i>';
  }
});

// ---- Playback Speed Engine -----------------------------------
const PLAYBACK_SPEEDS = [0.75, 1.0, 1.25, 1.5, 2.0];
let currentSpeedIdx = 1;

function setPlaybackSpeed(newSpeed) {
  audio.playbackRate = newSpeed;
  audio.preservesPitch = true;
  audio.mozPreservesPitch = true;
  audio.webkitPreservesPitch = true;
  
  const btn = $('#playback-speed-btn');
  if (btn) {
    btn.textContent = `${newSpeed}x`;
    btn.title = `Playback Speed: ${newSpeed}x`;
  }
}

$('#playback-speed-btn')?.addEventListener('click', () => {
  currentSpeedIdx = (currentSpeedIdx + 1) % PLAYBACK_SPEEDS.length;
  const speed = PLAYBACK_SPEEDS[currentSpeedIdx];
  setPlaybackSpeed(speed);
  notify(`⚡ Playback speed: ${speed}x`);
});

// ---- 🎧 Feature 10: Smart Auto-DJ Beat-Matched Crossfader Engine ----
const AUTODJ_MODES = [4, 6, 8, 12, 2, 0]; // seconds (0 = 0s Gapless)
var autoDJDuration = parseInt(localStorage.getItem('linus_autodj_duration') || '4', 10);
var isAutoDJEnabled = localStorage.getItem('linus_autodj_enabled') !== 'false' && autoDJDuration > 0;
window.autoDJDuration = autoDJDuration;
window.isAutoDJEnabled = isAutoDJEnabled;

function updateAutoDJUI() {
  const badge = $('#autodj-status-badge');
  const sub = $('#autodj-status-sub');
  const toggleBtn = $('#autodj-toggle-btn');
  const quickBtn = $('#autodj-quick-btn');
  const fsBtn = $('#fs-autodj-btn');
  const cfBadge = $('#crossfade-status-badge');
  const cfSub = $('#crossfade-status-sub');
  const cfBtn = $('#crossfade-toggle-btn');

  if (badge) {
    badge.textContent = (isAutoDJEnabled && autoDJDuration > 0) ? `${autoDJDuration}s DJ` : '0s Gapless';
    badge.className = `norm-status-pill ${(isAutoDJEnabled || autoDJDuration === 0) ? 'on' : 'off'}`;
  }
  if (sub) {
    sub.textContent = (isAutoDJEnabled && autoDJDuration > 0)
      ? `${autoDJDuration}s beat-matched equal-power blend` 
      : '0s zero-silence gapless cuts';
  }
  if (toggleBtn) {
    toggleBtn.classList.toggle('active', isAutoDJEnabled || autoDJDuration === 0);
  }
  if (quickBtn) {
    quickBtn.classList.toggle('active', isAutoDJEnabled || autoDJDuration === 0);
  }
  if (fsBtn) {
    fsBtn.classList.toggle('active', isAutoDJEnabled || autoDJDuration === 0);
  }

  if (cfBadge) {
    if (!isAutoDJEnabled || autoDJDuration === 0) {
      cfBadge.textContent = '0s Gapless';
      cfBadge.className = 'norm-status-pill on';
    } else {
      cfBadge.textContent = `${autoDJDuration}s Blend`;
      cfBadge.className = 'norm-status-pill on';
    }
  }
  if (cfSub) {
    cfSub.textContent = (!isAutoDJEnabled || autoDJDuration === 0)
      ? 'Zero-silence seamless gapless transitions'
      : `${autoDJDuration}s audiophile equal-power crossfade`;
  }
  if (cfBtn) {
    cfBtn.classList.toggle('active', isAutoDJEnabled || autoDJDuration === 0);
  }
}

function cycleAutoDJMode() {
  const curIdx = AUTODJ_MODES.indexOf(autoDJDuration);
  const nextIdx = (curIdx + 1) % AUTODJ_MODES.length;
  autoDJDuration = AUTODJ_MODES[nextIdx];
  isAutoDJEnabled = autoDJDuration > 0;
  try {
    localStorage.setItem('linus_autodj_duration', String(autoDJDuration));
    localStorage.setItem('linus_autodj_enabled', isAutoDJEnabled ? 'true' : 'false');
  } catch (e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ autodj_duration: autoDJDuration, autodj_enabled: isAutoDJEnabled });
  updateAutoDJUI();
  if (isAutoDJEnabled && autoDJDuration > 0) {
    notify(`🎧 Seamless Crossfade: ${autoDJDuration}s Equal-Power Blend`);
  } else {
    notify('🎧 Seamless Crossfade: 0s Gapless Mode (Zero-silence cuts)');
  }
}

function toggleAutoDJQuick() {
  if (isAutoDJEnabled && autoDJDuration > 0) {
    isAutoDJEnabled = false;
    autoDJDuration = 0;
  } else {
    isAutoDJEnabled = true;
    if (autoDJDuration <= 0) autoDJDuration = 4;
  }
  try {
    localStorage.setItem('linus_autodj_enabled', isAutoDJEnabled ? 'true' : 'false');
    localStorage.setItem('linus_autodj_duration', String(autoDJDuration));
  } catch (e) {}
  if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ autodj_duration: autoDJDuration, autodj_enabled: isAutoDJEnabled });
  updateAutoDJUI();
  if (isAutoDJEnabled && autoDJDuration > 0) {
    notify(`🎧 Seamless Crossfade: ON (${autoDJDuration}s Equal-Power Crossfader)`);
  } else {
    notify('🎧 Seamless Crossfade: 0s Gapless Mode');
  }
}

$('#autodj-toggle-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  cycleAutoDJMode();
});

$('#crossfade-toggle-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  cycleAutoDJMode();
});

$('#autodj-quick-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAutoDJQuick();
});

$('#fs-autodj-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleAutoDJQuick();
});

updateAutoDJUI();

// ---- Queue --------------------------------------------------
$('#queue-toggle').addEventListener('click', () => $('#queue-drawer').classList.toggle('open'));
$('#queue-close').addEventListener('click', () => $('#queue-drawer').classList.remove('open'));

$('#queue-shuffle-btn')?.addEventListener('click', () => {
  if (queue.length <= 1) return notify('Queue is too short to shuffle.');
  const current = queue[currentIndex];
  const rest = queue.filter((_, idx) => idx !== currentIndex);
  const shuffledRest = smartShuffle(rest, current);
  queue = current ? [current, ...shuffledRest] : shuffledRest;
  currentIndex = 0;
  renderQueue();
  debouncedSaveQueue();
  notify('🔀 Queue Smart-Shuffled (Artist dispersed)');
});

$('#queue-save-playlist-btn')?.addEventListener('click', () => {
  openAddToPlaylistModal(null, true);
});

$('#hero-save-queue-btn')?.addEventListener('click', () => {
  openAddToPlaylistModal(null, true);
});

$('#queue-clear-btn')?.addEventListener('click', () => {
  if (queue.length === 0) return;
  const current = queue[currentIndex];
  const upcomingCount = queue.length - (currentIndex + 1);
  if (upcomingCount > 0) {
    queue = current ? [current] : [];
    currentIndex = 0;
    renderQueue();
    debouncedSaveQueue();
    notify(`🗑️ Cleared ${upcomingCount} upcoming track${upcomingCount === 1 ? '' : 's'} (current track kept).`);
  } else {
    queue = [];
    currentIndex = -1;
    renderQueue();
    debouncedSaveQueue();
    notify('🗑️ Queue cleared completely.');
  }
});

let _draggedQueueIdx = null;

function renderQueue() {
  const list = $('#queue-list');
  if (!list) return;

  const upcomingTracks = queue.slice(currentIndex + 1);
  const remainingCount = upcomingTracks.length;
  const remainingSeconds = upcomingTracks.reduce((acc, t) => acc + (parseFloat(t.duration) || 0), 0);

  const statsEl = $('#queue-stats');
  if (statsEl) {
    if (remainingCount > 0) {
      const mins = Math.floor(remainingSeconds / 60);
      const durText = mins >= 60 
        ? `${Math.floor(mins / 60)}h ${mins % 60}m` 
        : `${mins}m ${Math.floor(remainingSeconds % 60)}s`;
      statsEl.textContent = `${remainingCount} upcoming · ${durText}`;
      statsEl.style.display = 'block';
    } else if (queue.length > 0) {
      statsEl.textContent = 'End of queue';
      statsEl.style.display = 'block';
    } else {
      statsEl.style.display = 'none';
    }
  }

  const headerTitle = $('#queue-drawer .queue-header h2');
  if (headerTitle) {
    if (_activeRadioSeed && _activeRadioSeed.title) {
      const shortTitle = _activeRadioSeed.title.length > 18 ? _activeRadioSeed.title.slice(0, 16) + '...' : _activeRadioSeed.title;
      headerTitle.innerHTML = `📻 Radio: ${escapeHtml(shortTitle)}`;
    } else {
      headerTitle.innerHTML = `Play Queue`;
    }
  }

  const slice = queue.slice(currentIndex, currentIndex + 40);
  if (!slice.length) {
    list.innerHTML = `
      <div style="text-align:center;padding:48px 16px;color:var(--text-muted);">
        <i class="ph-bold ph-music-notes" style="font-size:36px;opacity:0.3;margin-bottom:8px;display:block;"></i>
        <strong style="display:block;font-size:14px;color:var(--text);margin-bottom:4px;">Queue is empty</strong>
        <p style="font-size:12px;margin:0;">Play a song or click "Add to Queue" to build your mix.</p>
      </div>
    `;
    return;
  }

  const currentTrack = slice[0];
  const upcomingSlice = slice.slice(1);

  const renderTrackItem = (t, i, isPlaying) => {
    const realIdx = isPlaying ? currentIndex : currentIndex + 1 + i;
    const art = t.artwork_url 
      ? `<img src="${escapeHtml(t.artwork_url)}" style="width:36px;height:36px;border-radius:6px;object-fit:cover;box-shadow:0 2px 6px rgba(0,0,0,0.3);">`
      : `<div style="width:36px;height:36px;border-radius:6px;background:rgba(255,255,255,0.06);display:grid;place-items:center;color:var(--accent);"><i class="ph-fill ph-music-note"></i></div>`;

    const badge = t.is_online
      ? `<span style="font-size:9px;padding:2px 6px;border-radius:10px;background:rgba(56,189,248,0.18);color:#38bdf8;font-weight:600;"><i class="ph-fill ph-globe"></i> YouTube</span>`
      : `<span style="font-size:9px;padding:2px 6px;border-radius:10px;background:rgba(52,211,153,0.18);color:#34d399;font-weight:600;"><i class="ph-fill ph-folder"></i> Local</span>`;

    const actions = `
      <div class="q-actions" style="display:flex;align-items:center;gap:3px;opacity:0.75;">
        ${!isPlaying ? `
          <button class="q-action-btn q-move-up" data-idx="${realIdx}" title="Move up" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:3px 5px;font-size:13px;border-radius:4px;${i === 0 ? 'visibility:hidden;' : ''}"><i class="ph ph-caret-up"></i></button>
          <button class="q-action-btn q-move-down" data-idx="${realIdx}" title="Move down" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:3px 5px;font-size:13px;border-radius:4px;${i === upcomingSlice.length - 1 ? 'visibility:hidden;' : ''}"><i class="ph ph-caret-down"></i></button>
        ` : ''}
        <button class="q-action-btn q-add-playlist" data-id="${escapeHtml(t.id)}" title="Add track to playlist" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:3px 5px;font-size:13px;border-radius:4px;"><i class="ph ph-plus-circle"></i></button>
        ${!isPlaying ? `
          <button class="q-action-btn q-remove-item" data-idx="${realIdx}" title="Remove from queue" style="background:transparent;border:none;color:var(--text-muted);cursor:pointer;padding:3px 5px;font-size:13px;border-radius:4px;"><i class="ph ph-x"></i></button>
        ` : ''}
      </div>
    `;

    const dragHandle = !isPlaying ? `
      <span class="q-drag-handle" title="Drag to reorder" style="cursor:grab;opacity:0.4;display:inline-flex;align-items:center;padding:0 2px;font-size:14px;color:var(--text-muted);">
        <i class="ph-bold ph-dots-six-vertical"></i>
      </span>
    ` : '';

    return `
      <div class="queue-item ${isPlaying ? 'active' : ''}" data-id="${escapeHtml(t.id)}" data-idx="${realIdx}" draggable="${!isPlaying}" style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.15s ease, border-top 0.1s ease;${isPlaying ? 'background:rgba(212, 176, 122, 0.12);border-left:3px solid var(--accent);' : ''}">
        ${dragHandle}
        <span class="q-idx" style="font-size:12px;width:18px;text-align:center;">${isPlaying ? '<i class="ph-fill ph-speaker-high" style="color:var(--accent)"></i>' : (i + 1)}</span>
        ${art}
        <div class="q-info" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;">
          <strong style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;${isPlaying ? 'color:var(--accent);' : ''}">${escapeHtml(t.title)}</strong>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:11px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(t.artist)}</span>
            ${badge}
          </div>
        </div>
        ${actions}
      </div>
    `;
  };

  let html = '';
  if (currentTrack) {
    html += `
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--accent);margin:6px 0 6px 4px;display:flex;align-items:center;gap:6px;">
        <i class="ph-fill ph-speaker-high"></i> Now Playing
      </div>
      ${renderTrackItem(currentTrack, 0, true)}
    `;
  }

  if (upcomingSlice.length > 0) {
    html += `
      <div style="font-size:11px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:var(--text-muted);margin:16px 0 6px 4px;display:flex;justify-content:space-between;align-items:center;">
        <span>Up Next</span>
        <span style="font-size:11px;font-weight:400;opacity:0.85;">${remainingCount} upcoming</span>
      </div>
    `;
    html += upcomingSlice.map((t, idx) => renderTrackItem(t, idx, false)).join('');
  }
 
  if (queue.length > 0) {
    html += `
      <div class="queue-save-banner" style="margin-top:16px;padding:12px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="width:34px;height:34px;border-radius:8px;background:rgba(229,169,93,0.15);color:var(--accent);display:grid;place-items:center;font-size:17px;flex-shrink:0;">
            <i class="ph-fill ph-playlist"></i>
          </div>
          <div style="display:flex;flex-direction:column;">
            <strong style="font-size:12.5px;color:var(--text);">Save Queue as Playlist</strong>
            <span style="font-size:11px;color:var(--text-muted);">${queue.length} track${queue.length === 1 ? '' : 's'} ready to export</span>
          </div>
        </div>
        <button type="button" class="btn-primary" id="queue-footer-save-btn" style="padding:6px 14px;font-size:12px;font-weight:600;border-radius:8px;white-space:nowrap;display:inline-flex;align-items:center;gap:5px;">
          <i class="ph-bold ph-bookmark-simple"></i> Save
        </button>
      </div>
    `;
  }

  list.innerHTML = html;

  // Wire footer save queue button
  list.querySelector('#queue-footer-save-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    openAddToPlaylistModal(null, true);
  });

  // Click to play
  list.querySelectorAll('.queue-item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.q-action-btn') || e.target.closest('.q-drag-handle')) return;
      const targetId = item.dataset.id;
      if (targetId && targetId !== queue[currentIndex]?.id) {
        const found = queue.find(x => x && x.id === targetId);
        if (found && found.is_online && found.video_id) {
          streamYouTubeAudio(found.video_id, found.title, found.artist, found.artwork_url, found.duration);
        } else {
          playById(targetId);
        }
      }
    });

    // Drag and drop reordering
    if (item.getAttribute('draggable') === 'true') {
      item.addEventListener('dragstart', (e) => {
        _draggedQueueIdx = parseInt(item.dataset.idx, 10);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', String(_draggedQueueIdx));
        }
        item.style.opacity = '0.35';
      });
      item.addEventListener('dragend', () => {
        item.style.opacity = '1';
        list.querySelectorAll('.queue-item').forEach(el => {
          el.style.borderTop = '';
          el.style.background = '';
        });
      });
      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
        item.style.borderTop = '2px solid var(--accent, #d4b07a)';
        item.style.background = 'rgba(212, 176, 122, 0.08)';
      });
      item.addEventListener('dragleave', () => {
        item.style.borderTop = '';
        item.style.background = '';
      });
      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.style.borderTop = '';
        item.style.background = '';
        const targetIdx = parseInt(item.dataset.idx, 10);
        if (_draggedQueueIdx !== null && _draggedQueueIdx !== targetIdx && targetIdx > currentIndex && _draggedQueueIdx > currentIndex) {
          const [moved] = queue.splice(_draggedQueueIdx, 1);
          queue.splice(targetIdx, 0, moved);
          renderQueue();
          debouncedSaveQueue();
          notify(`Moved "${moved.title ? moved.title.slice(0, 20) : 'Song'}" to position ${targetIdx - currentIndex}`);
        }
      });
    }
  });

  // Add single queue item to playlist
  list.querySelectorAll('.q-add-playlist').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openAddToPlaylistModal(btn.dataset.id, false);
    });
  });

  // Remove from queue
  list.querySelectorAll('.q-remove-item').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      if (!isNaN(idx) && idx > currentIndex && idx < queue.length) {
        queue.splice(idx, 1);
        renderQueue();
        debouncedSaveQueue();
        notify('Removed track from queue.');
      }
    });
  });

  // Move up
  list.querySelectorAll('.q-move-up').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      if (!isNaN(idx) && idx > currentIndex + 1 && idx < queue.length) {
        [queue[idx], queue[idx - 1]] = [queue[idx - 1], queue[idx]];
        renderQueue();
        debouncedSaveQueue();
      }
    });
  });

  // Move down
  list.querySelectorAll('.q-move-down').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx, 10);
      if (!isNaN(idx) && idx > currentIndex && idx < queue.length - 1) {
        [queue[idx], queue[idx + 1]] = [queue[idx + 1], queue[idx]];
        renderQueue();
        debouncedSaveQueue();
      }
    });
  });

  if (typeof renderDashboardUpNext === 'function') {
    renderDashboardUpNext();
  } else if (typeof window.renderDashboardUpNext === 'function') {
    window.renderDashboardUpNext();
  }
}

// ---- Favorites & Ecstatic Particle Burst -------------------
function syncNowPlayingFavorite(trackId) {
  if (!trackId && queue[currentIndex]) trackId = queue[currentIndex].id;
  if (!trackId) return;
  const isFav = state.favorites.includes(trackId);

  const heroFav = $('#hero-fav-btn');
  if (heroFav) {
    heroFav.innerHTML = `<i class="ph${isFav ? '-fill' : ''} ph-star" style="${isFav ? 'color:var(--accent);' : ''}"></i>`;
    heroFav.classList.toggle('active-fav', isFav);
  }

  const nowFav = $('#now-fav-btn');
  if (nowFav) {
    nowFav.innerHTML = `<i class="ph${isFav ? '-fill' : ''} ph-star" style="${isFav ? 'color:var(--accent);' : ''}"></i>`;
    nowFav.classList.toggle('active-fav', isFav);
  }

  const fsLike = $('#fs-like');
  if (fsLike) {
    fsLike.innerHTML = `<i class="ph${isFav ? '-fill' : ''} ph-star" style="${isFav ? 'color:var(--accent);' : ''}"></i>`;
    fsLike.classList.toggle('active-fav', isFav);
  }
}

function toggleFavorite(id, clickX, clickY) {
  const isFav = state.favorites.includes(id);
  if (isFav) {
    state.favorites = state.favorites.filter(k => k !== id);
    notify('Removed from Favorites');
  } else {
    state.favorites.push(id);
    notify('💖 Added to Favorites!');
    if (clickX && clickY) {
      spawnConfettiParticles(clickX, clickY);
    }
  }
  syncNowPlayingFavorite(id);
  saveState();
  renderTracks(state.tracks.filter(t => t.media_type !== 'video'));
  if ($('#favorite-view') && !$('#favorite-view').classList.contains('hidden')) {
    renderFavorites();
  }
}

// Add Currently Playing Track -> To Playlist
$('#hero-add-playlist')?.addEventListener('click', () => {
  const current = queue[currentIndex];
  if (!current) return notify('Play a song first to add it to a playlist.');
  openAddToPlaylistModal(current.id);
});

$('#now-add-playlist')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = queue[currentIndex];
  if (!current) return notify('Play a song first to add it to a playlist.');
  openAddToPlaylistModal(current.id);
});

$('#now-start-radio-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  startTrackRadio();
});

$('#fs-add-playlist')?.addEventListener('click', () => {
  const current = queue[currentIndex];
  if (!current) return notify('Play a song first to add it to a playlist.');
  openAddToPlaylistModal(current.id);
});

// Currently Playing Track -> Toggle Favorite
$('#hero-fav-btn')?.addEventListener('click', (e) => {
  const current = queue[currentIndex];
  if (!current) return notify('Play a song first to favorite.');
  const rect = e.currentTarget.getBoundingClientRect();
  toggleFavorite(current.id, rect.left + rect.width / 2, rect.top);
});

$('#now-fav-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const current = queue[currentIndex];
  if (!current) return notify('Play a song first to favorite.');
  const rect = e.currentTarget.getBoundingClientRect();
  toggleFavorite(current.id, rect.left + rect.width / 2, rect.top);
});

$('#fs-like')?.addEventListener('click', (e) => {
  const current = queue[currentIndex];
  if (!current) return notify('Play a song first to favorite.');
  const rect = e.currentTarget.getBoundingClientRect();
  toggleFavorite(current.id, rect.left + rect.width / 2, rect.top);
});

function spawnConfettiParticles(x, y) {
  const container = $('#vibe-confetti-container');
  if (!container) return;
  const count = 16;
  const icons = ['✨', '💖', '⭐', '💫', '🌸', '☕'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-particle';
    p.textContent = icons[Math.floor(Math.random() * icons.length)];
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5) * 0.5;
    const dist = 60 + Math.random() * 90;
    const tx = Math.cos(angle) * dist;
    const ty = Math.sin(angle) * dist - 40;
    const tr = Math.floor(Math.random() * 80 - 40);
    p.style.setProperty('--tx', `${tx}px`);
    p.style.setProperty('--ty', `${ty}px`);
    p.style.setProperty('--tr', `${tr}deg`);
    p.style.fontSize = `${14 + Math.random() * 12}px`;
    container.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
}
window.spawnConfettiParticles = spawnConfettiParticles;

// ---- Video Player -------------------------------------------
const vModal = $('#video-modal');
const vPlayer = $('#video-player');

function openVideoPlayer(id) {
  const t = trackById(id);
  if (!t) return;
  currentVideoTrack = t;
  audio.pause();
  $('#play').innerHTML = '<i class="ph-fill ph-play"></i>';
  $('#vinyl-record').classList.remove('playing');

  $('#video-modal-title').textContent = t.title;
  $('#video-modal-artist').textContent = t.artist;

  const ytPlayer = $('#youtube-video-player');
  if (ytPlayer) { ytPlayer.src = ''; ytPlayer.classList.add('hidden'); }
  vPlayer.classList.remove('hidden');
  vPlayer.src = t.url;
  vModal.classList.remove('hidden');
  vPlayer.play().catch(console.error);
}

function closeVideoModal() {
  if (vPlayer) { vPlayer.pause(); vPlayer.src = ''; }
  const ytPlayer = $('#youtube-video-player');
  if (ytPlayer) { ytPlayer.src = ''; ytPlayer.classList.add('hidden'); }
  vModal.classList.add('hidden');

  if (_ytCurrentStreamType === 'video') {
    _ytCurrentStreamId = '';
    _ytCurrentStreamType = '';
    _updateStreamButtonStates('idle');
    document.querySelectorAll('.explore-card').forEach(c => c.classList.remove('now-streaming'));
  }
  currentVideoTrack = null;
}

$('#video-modal-close').addEventListener('click', closeVideoModal);
$('#video-modal-backdrop').addEventListener('click', closeVideoModal);

// ---- Downloads ----------------------------------------------
$('#download-button').addEventListener('click', () => {
  closeSidebar();
  $('#download-sheet').showModal();
});
$('[value="cancel"]').addEventListener('click', (e) => {
  e.preventDefault(); $('#download-sheet').close();
});

$('#type-audio').addEventListener('click', () => {
  $('#type-audio').classList.add('active');
  $('#type-video').classList.remove('active');
  $('#audio-options').classList.remove('hidden');
  $('#video-options').classList.add('hidden');
});
$('#type-video').addEventListener('click', () => {
  $('#type-video').classList.add('active');
  $('#type-audio').classList.remove('active');
  $('#video-options').classList.remove('hidden');
  $('#audio-options').classList.add('hidden');
});

$('#download-form').addEventListener('submit', async e => {
  e.preventDefault();
  const submit  = $('#download-submit');
  const cancelBtn = $('#download-cancel');
  const note    = $('#download-note');
  const wrap    = $('#dl-progress-wrap');
  const isVideo = $('#type-video').classList.contains('active');

  submit.classList.add('hidden');
  cancelBtn.classList.remove('hidden');
  wrap.classList.remove('hidden');
  $('#dl-progress-fill').style.width = '2%';
  note.textContent = 'Fetching metadata...';

  const payload = {
    url:        $('#download-url').value.trim(),
    media_type: isVideo ? 'video' : 'audio',
    category:   $('#download-category').value.trim(),
  };

  if (isVideo) {
    payload.format  = $('#download-video-format').value;
    payload.quality = $('#download-video-quality').value;
  } else {
    payload.format  = $('#download-format').value;
    payload.quality = $('#download-quality').value;
  }

  try {
    const data = await api('/api/download', { method: 'POST', body: JSON.stringify(payload) });
    activeJobId = data.job_id;
    startProgressSSE(activeJobId);
  } catch (err) {
    note.textContent = `Error: ${err.message}`;
    submit.classList.remove('hidden');
    cancelBtn.classList.add('hidden');
  }
});

$('#download-cancel').addEventListener('click', async () => {
  if (activeJobId) {
    try {
      await api(`/api/download/cancel/${activeJobId}`, { method: 'POST' });
      notify('Download cancelled.');
      if (progressSSE) progressSSE.close();
      $('#download-submit').classList.remove('hidden');
      $('#download-cancel').classList.add('hidden');
      $('#dl-progress-wrap').classList.add('hidden');
      $('#download-note').textContent = 'Saved to downloads folder.';
    } catch (err) { notify('Failed to cancel.'); }
  }
});

function startProgressSSE(jobId) {
  if (progressSSE) progressSSE.close();
  progressSSE = new EventSource(`/api/download/progress/${jobId}`);

  progressSSE.onmessage = e => {
    const d = JSON.parse(e.data);
    if (d.status === 'queued') return;

    if (d.status === 'error') {
      $('#dl-progress-label').textContent = 'Error: ' + (d.error || 'Download failed');
      $('#download-submit').classList.remove('hidden');
      $('#download-cancel').classList.add('hidden');
      progressSSE.close();
      return;
    }

    $('#dl-progress-fill').style.width = d.percent + '%';
    if (d.status === 'downloading') {
      $('#dl-progress-label').textContent = `${d.title ? d.title.substring(0,30)+'...' : 'Downloading'} - ${d.percent}% (${d.speed} - ETA ${d.eta})`;
    } else if (d.status === 'processing') {
      $('#dl-progress-label').textContent = `Processing and extracting metadata...`;
    }
  };

  // Named 'done' event — auto-refresh library
  progressSSE.addEventListener('done', () => {
    $('#dl-progress-label').textContent = 'Complete!';
    progressSSE.close();
    setTimeout(() => {
      $('#download-sheet').close();
      $('#download-submit').classList.remove('hidden');
      $('#download-cancel').classList.add('hidden');
      $('#dl-progress-wrap').classList.add('hidden');
      $('#download-url').value = '';
      pollDownloadsStatus(jobId);
    }, 1500);
  });

  // Named 'cancelled' event — reset UI immediately
  progressSSE.addEventListener('cancelled', () => {
    progressSSE.close();
    $('#dl-progress-label').textContent = 'Download cancelled.';
    $('#download-submit').classList.remove('hidden');
    $('#download-cancel').classList.add('hidden');
    $('#dl-progress-wrap').classList.add('hidden');
  });

  // Network error fallback
  progressSSE.onerror = () => {
    progressSSE.close();
    $('#dl-progress-label').textContent = 'Connection lost. Check Downloads tab for status.';
    $('#download-submit').classList.remove('hidden');
    $('#download-cancel').classList.add('hidden');
  };
}

async function pollDownloadsStatus(jobId) {
  try {
    const data = await api(`/api/download/status/${jobId}`);
    if (data.status === 'done') {
      notify('Download complete!');
      hydrate(data); // data has {tracks, state, categories} at top level
    } else {
      setTimeout(() => pollDownloadsStatus(jobId), 1000);
    }
  } catch (e) {
    notify('Finished but failed to refresh library.');
  }
}

async function renderDownloadsView() {
  const list = $('#downloads-list');
  try {
    const data = await api('/api/downloads');
    const jobs = data.jobs || [];
    $('#downloads-count').textContent = `${jobs.length} task${jobs.length===1?'':'s'}`;
    list.innerHTML = jobs.reverse().map(j => `
      <div class="dl-job-row">
        <div class="dl-job-top">
          <strong title="${escapeHtml(j.url)}">${escapeHtml(j.title || j.id)}</strong>
          <span class="dl-status" style="color:${j.status==='done'?'#8de0c0':j.status==='error'?'#ff6b5f':'var(--accent)'}">${j.status}</span>
        </div>
        <div style="font-size:12px;color:var(--text-muted);display:flex;gap:12px;">
          <span>${j.media_type.toUpperCase()} / ${j.format.toUpperCase()}</span>
          ${j.category ? `<span>CAT: ${escapeHtml(j.category)}</span>` : ''}
          ${j.status === 'downloading' ? `<span>${j.percent}% · ${j.speed} · ETA ${j.eta}</span>` : ''}
          ${j.status === 'error' ? `<span style="color:#ff6b5f">${escapeHtml(j.error)}</span>` : ''}
        </div>
        ${j.status !== 'error' && j.status !== 'done' ? `
          <div class="dl-progress-bar"><div class="dl-progress-fill" style="width:${j.percent}%"></div></div>
        ` : ''}
      </div>
    `).join('');
  } catch (e) { list.innerHTML = '<p class="muted">Failed to load history.</p>'; }
}

$('#refresh-downloads').addEventListener('click', renderDownloadsView);


// ============================================================
// YouTube Explore & Streaming — Moved to static/youtube.js
// ============================================================

// ---- Synchronized Karaoke Lyrics Engine ----------------------
let currentLyricsData = { found: false, synced: false, lines: [], plain: '' };
let lastActiveLyricIdx = -1;

$('#hero-lyrics').addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="lyrics"]')?.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#lyrics-view')?.classList.remove('hidden');
  const t = getActivePlaybackTrack();
  if (t) loadLyricsInline(t);
});

$('#lyrics-tab-karaoke').addEventListener('click', () => {
  $('#lyrics-tab-karaoke').classList.add('active');
  $('#lyrics-tab-editor').classList.remove('active');
  $('#karaoke-live-stage').classList.remove('hidden');
  $('#lyrics-editor-wrap').classList.add('hidden');
});

$('#lyrics-tab-editor').addEventListener('click', () => {
  $('#lyrics-tab-editor').classList.add('active');
  $('#lyrics-tab-karaoke').classList.remove('active');
  $('#lyrics-editor-wrap').classList.remove('hidden');
  $('#karaoke-live-stage').classList.add('hidden');
});

function updateLyricsBadge(source, synced) {
  const badge = $('#lyrics-source-badge');
  if (!badge) return;
  if (!source || source === 'none') {
    badge.classList.add('hidden');
    return;
  }
  badge.classList.remove('hidden');
  let label = source.toUpperCase();
  if (source === 'auto_aligned') label = 'AI Auto-Aligned (Synced)';
  else if (source === 'lrclib') label = synced ? 'LRCLIB (Synced)' : 'LRCLIB (Plain)';
  else if (source === 'netease') label = 'NetEase (Synced)';
  else if (source === 'local') label = 'Local .LRC';
  else if (source === 'local_cache') label = synced ? 'Disk Cache (Synced)' : 'Disk Cache (Plain)';
  else if (source === 'custom') label = synced ? 'Custom (Synced)' : 'Custom (Plain)';
  else if (source === 'lyrics.ovh') label = 'Lyrics.ovh (Plain)';
  badge.innerHTML = `<i class="ph${synced ? '-fill ph-lightning' : ' ph-file-text'}"></i> ${label}`;
}

function checkPlainLyricsBanner(show) {
  const banner = $('#lyrics-plain-sync-banner');
  if (!banner) return;
  if (show) {
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

async function loadLyricsInline(track) {
  if (!track) return;
  $('#lyrics-title').textContent = track.title;
  $('#lyrics-artist').textContent = track.artist;
  $('#lyrics-editor').value = state.lyrics[track.id] || '';
  lastActiveLyricIdx = -1;
  currentLyricsData = { found: false, synced: false, lines: [], plain: '' };
  checkPlainLyricsBanner(false);

  const stageContainers = [$('#karaoke-lines-container'), $('#fs-karaoke-stream'), $('#stage-lyrics-stream')].filter(Boolean);
  stageContainers.forEach(c => {
    c.innerHTML = '<p class="karaoke-empty">Streaming synchronized lyrics...</p>';
  });

  // If user saved custom lyrics for this track, show it immediately
  if (state.lyrics[track.id]) {
    const isSynced = state.lyrics[track.id].includes('[') && state.lyrics[track.id].includes(']');
    updateLyricsBadge('custom', isSynced);
    renderKaraokeLines({ found: true, synced: isSynced, plain: state.lyrics[track.id], lines: [] });
    checkPlainLyricsBanner(!isSynced);
  } else {
    updateLyricsBadge('none', false);
  }

  try {
    const data = await api(`/api/lyrics?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&file_path=${encodeURIComponent(track.id)}`);
    currentLyricsData = data;
    if (data.found) {
      updateLyricsBadge(data.source, data.synced);
      renderKaraokeLines(data);
      if (!state.lyrics[track.id] && data.plain) {
        $('#lyrics-editor').value = data.plain;
      }
      checkPlainLyricsBanner(!data.synced);
    } else if (!state.lyrics[track.id]) {
      updateLyricsBadge('none', false);
      checkPlainLyricsBanner(false);
      stageContainers.forEach(c => {
        c.innerHTML = '<p class="karaoke-empty">No lyrics found automatically. Click "Search Lyrics" to find manually.</p>';
      });
    }
  } catch (e) {
    if (!state.lyrics[track.id]) {
      updateLyricsBadge('none', false);
      checkPlainLyricsBanner(false);
      stageContainers.forEach(c => {
        c.innerHTML = '<p class="karaoke-empty">Could not load lyrics. Try searching manually.</p>';
      });
    }
  }
}

// ---- Apple Music-Style Interactive Synced Lyrics Engine ----
const _lyricsStages = [
  {
    name: 'main',
    getScroll: () => $('#karaoke-live-stage'),
    getLines: () => $('#karaoke-lines-container'),
    getSnapBtn: () => $('#lyrics-snap-pill-main'),
    isUserScrolling: false,
    scrollTimer: null
  },
  {
    name: 'stage',
    getScroll: () => $('#stage-lyrics-stream'),
    getLines: () => $('#stage-lyrics-stream'),
    getSnapBtn: () => $('#lyrics-snap-pill-stage'),
    isUserScrolling: false,
    scrollTimer: null
  },
  {
    name: 'fs',
    getScroll: () => $('#fs-karaoke-stream'),
    getLines: () => $('#fs-karaoke-stream'),
    getSnapBtn: () => $('#lyrics-snap-pill-fs'),
    isUserScrolling: false,
    scrollTimer: null
  }
];

let _lyricsEventsInitialized = false;

function smoothScrollLyricToCenter(scrollContainer, activeEl) {
  if (!scrollContainer || !activeEl) return;
  const containerRect = scrollContainer.getBoundingClientRect();
  const elRect = activeEl.getBoundingClientRect();
  const relativeTop = elRect.top - containerRect.top + scrollContainer.scrollTop;
  const targetTop = relativeTop - (scrollContainer.clientHeight / 2) + (activeEl.clientHeight / 2);
  
  scrollContainer.scrollTo({
    top: Math.max(0, targetTop),
    behavior: 'smooth'
  });
}

function snapStageToActiveLyric(stage) {
  const linesCont = stage.getLines();
  const sc = stage.getScroll();
  if (!linesCont || !sc) return;
  const activeEl = linesCont.querySelector('.karaoke-line.active-line');
  if (activeEl) {
    smoothScrollLyricToCenter(sc, activeEl);
  }
}

function initLyricsStageEvents() {
  if (_lyricsEventsInitialized) return;
  _lyricsEventsInitialized = true;

  _lyricsStages.forEach(stage => {
    const sc = stage.getScroll();
    const snap = stage.getSnapBtn();
    if (!sc) return;

    const onUserScrollAction = () => {
      stage.isUserScrolling = true;
      const curSnap = stage.getSnapBtn();
      if (curSnap) curSnap.classList.remove('hidden');

      clearTimeout(stage.scrollTimer);
      stage.scrollTimer = setTimeout(() => {
        stage.isUserScrolling = false;
        const s = stage.getSnapBtn();
        if (s) s.classList.add('hidden');
        snapStageToActiveLyric(stage);
      }, 6000);
    };

    sc.addEventListener('wheel', onUserScrollAction, { passive: true });
    sc.addEventListener('touchmove', onUserScrollAction, { passive: true });

    if (snap) {
      snap.addEventListener('click', (e) => {
        e.stopPropagation();
        stage.isUserScrolling = false;
        clearTimeout(stage.scrollTimer);
        snap.classList.add('hidden');
        snapStageToActiveLyric(stage);
      });
    }
  });
}

function renderKaraokeLines(data) {
  initLyricsStageEvents();

  _lyricsStages.forEach(stage => {
    const c = stage.getLines();
    const snap = stage.getSnapBtn();
    stage.isUserScrolling = false;
    clearTimeout(stage.scrollTimer);
    if (snap) snap.classList.add('hidden');
    if (!c) return;

    if (data.synced && data.lines && data.lines.length > 0) {
      const html = data.lines.map((l, i) => `
        <div class="karaoke-line future-line far-line" data-idx="${i}" data-time="${l.time}">
          <span class="lyric-seek-hint"><i class="ph-fill ph-play"></i></span>
          <span class="lyric-text">${escapeHtml(l.text || '♪')}</span>
        </div>
      `).join('');
      c.innerHTML = html;
      c.querySelectorAll('.karaoke-line').forEach(el => {
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          const t = parseFloat(el.getAttribute('data-time'));
          if (Number.isFinite(t)) {
            el.classList.add('seeking-ripple');
            setTimeout(() => el.classList.remove('seeking-ripple'), 350);
            audio.currentTime = Math.max(0, t);
            if (audio.paused) togglePlayGlobal();
            stage.isUserScrolling = false;
            clearTimeout(stage.scrollTimer);
            if (snap) snap.classList.add('hidden');
            updateKaraokeHighlight(audio.currentTime);
          }
        });
      });
    } else if (data.plain) {
      const plainLines = data.plain.split('\n').filter(l => l.trim().length > 0);
      const html = plainLines.map(l => `<div class="karaoke-line past-line">${escapeHtml(l)}</div>`).join('');
      c.innerHTML = html;
    }
  });

  if (data.synced && data.lines && data.lines.length > 0) {
    updateKaraokeHighlight(audio.currentTime);
  }
}

function updateKaraokeHighlight(currentTime) {
  if (!currentLyricsData || !currentLyricsData.synced || !currentLyricsData.lines || currentLyricsData.lines.length === 0) return;
  const lines = currentLyricsData.lines;
  let activeIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (currentTime >= lines[i].time) {
      activeIdx = i;
    } else {
      break;
    }
  }

  // Audio bass reactive pulse on active line
  if (!audio.paused && (window.analyser || (typeof analyser !== 'undefined' ? analyser : null)) && (window.audioDataArray || (typeof audioDataArray !== 'undefined' ? audioDataArray : null))) {
    try {
      const curAnalyser = window.analyser || analyser;
      const curArray = window.audioDataArray || audioDataArray;
      curAnalyser.getByteFrequencyData(curArray);
      const bassEnergy = (curArray[0] + curArray[1] + curArray[2]) / (3 * 255);
      if (bassEnergy > 0.76) {
        document.querySelectorAll('.karaoke-line.active-line').forEach(el => {
          if (!el.classList.contains('bass-pulse')) {
            el.classList.add('bass-pulse');
            setTimeout(() => el.classList.remove('bass-pulse'), 180);
          }
        });
      }
    } catch (_) {}
  }

  if (activeIdx === lastActiveLyricIdx) return;
  lastActiveLyricIdx = activeIdx;

  _lyricsStages.forEach(stage => {
    const c = stage.getLines();
    const sc = stage.getScroll();
    if (!c || !sc) return;

    const domLines = c.querySelectorAll('.karaoke-line');
    domLines.forEach((el, idx) => {
      const dist = Math.abs(idx - activeIdx);
      if (idx === activeIdx) {
        el.className = 'karaoke-line active-line';
        if (!stage.isUserScrolling) {
          smoothScrollLyricToCenter(sc, el);
        }
      } else if (dist <= 2) {
        el.className = `karaoke-line near-line ${idx < activeIdx ? 'past-line' : 'future-line'}`;
      } else {
        el.className = `karaoke-line far-line ${idx < activeIdx ? 'past-line' : 'future-line'}`;
      }
    });
  });
}

$('#save-lyrics').addEventListener('click', async () => {
  const t = getActivePlaybackTrack();
  if (!t) return notify('Play a song first.');
  const text = $('#lyrics-editor').value;
  try {
    const res = await api('/api/lyrics/save', {
      method: 'POST',
      body: JSON.stringify({
        track_id: t.id,
        artist: t.artist,
        title: t.title,
        content: text
      })
    });
    state.lyrics[t.id] = text;
    notify('Lyrics saved to disk & library.');
    if (res.lyrics) {
      currentLyricsData = res.lyrics;
      updateLyricsBadge('custom', res.lyrics.synced);
      renderKaraokeLines(res.lyrics);
      checkPlainLyricsBanner(!res.lyrics.synced);
    }
  } catch (err) {
    state.lyrics[t.id] = text;
    saveState();
    checkPlainLyricsBanner(!text.includes('[') || !text.includes(']'));
    notify('Lyrics saved locally.');
  }
});

$('#fetch-lyrics-btn').addEventListener('click', async () => {
  const t = getActivePlaybackTrack();
  if (!t) return notify('Play a song first.');
  notify('Fetching lyrics from all providers...');
  try {
    const data = await api(`/api/lyrics?artist=${encodeURIComponent(t.artist)}&title=${encodeURIComponent(t.title)}&file_path=${encodeURIComponent(t.id)}`);
    currentLyricsData = data;
    if (data.found) {
      updateLyricsBadge(data.source, data.synced);
      renderKaraokeLines(data);
      if (data.plain) $('#lyrics-editor').value = data.plain;
      checkPlainLyricsBanner(!data.synced);
      notify(`Lyrics found via ${data.source.toUpperCase()}!`);
    } else {
      checkPlainLyricsBanner(false);
      notify('No lyrics found automatically. Use Search Lyrics.');
    }
  } catch (e) { notify('Error fetching lyrics.'); }
});

// ---- Forced Alignment: ⚡ Auto-Sync Lyrics to Audio Engine -----
async function triggerAutoSyncLyrics(explicitText = null) {
  const t = getActivePlaybackTrack();
  if (!t) return notify('Play a song first.');

  const syncBtns = [$('#karaoke-auto-sync-btn'), $('#editor-auto-sync-btn')].filter(Boolean);
  syncBtns.forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> ⚡ Aligning to Audio...';
  });

  notify('⚡ AI is aligning official lyrics to song audio... Please wait (~15-30s)');

  const textToAlign = explicitText !== null ? explicitText : ($('#lyrics-editor').value || currentLyricsData.plain || '');

  try {
    const res = await api('/api/lyrics/align', {
      method: 'POST',
      body: JSON.stringify({
        track_id: t.id,
        artist: t.artist,
        title: t.title,
        content: textToAlign
      })
    });

    if (res.lyrics) {
      currentLyricsData = res.lyrics;
      state.lyrics[t.id] = res.lyrics.raw_lrc;
      $('#lyrics-editor').value = res.lyrics.raw_lrc;
      updateLyricsBadge('auto_aligned', true);
      renderKaraokeLines(res.lyrics);
      checkPlainLyricsBanner(false);

      // Switch to live karaoke tab to see synchronized lyrics in action
      $('#lyrics-tab-karaoke')?.click();
      notify('⚡ Lyrics successfully aligned to audio timestamps!');
    } else {
      notify('Could not align lyrics.');
    }
  } catch (err) {
    console.error('Forced alignment error:', err);
    notify(err?.message || 'Failed to auto-sync lyrics to audio.');
  } finally {
    syncBtns.forEach(btn => {
      btn.disabled = false;
      btn.innerHTML = '<i class="ph-fill ph-lightning"></i> ⚡ Auto-Sync Lyrics to Audio';
    });
  }
}

$('#karaoke-auto-sync-btn')?.addEventListener('click', () => triggerAutoSyncLyrics());
$('#editor-auto-sync-btn')?.addEventListener('click', () => {
  const text = $('#lyrics-editor').value;
  triggerAutoSyncLyrics(text);
});

// ---- Manual Lyrics Search & Switcher ------------------------
async function executeLyricsSearch(query) {
  const q = (query || '').trim();
  if (!q) return;
  const loading = $('#lyrics-search-loading');
  const resultsContainer = $('#lyrics-search-results');
  
  loading.classList.remove('hidden');
  resultsContainer.innerHTML = '';

  try {
    const data = await api(`/api/lyrics/search?q=${encodeURIComponent(q)}`);
    loading.classList.add('hidden');
    const candidates = data.candidates || [];

    if (candidates.length === 0) {
      resultsContainer.innerHTML = `
        <div style="text-align:center; padding: 24px 0; color: var(--text-muted);">
          <i class="ph ph-magnifying-glass" style="font-size: 24px; margin-bottom: 8px;"></i>
          <p>No lyric matches found for "${escapeHtml(q)}". Try different keywords or artist name.</p>
        </div>`;
      return;
    }

    resultsContainer.innerHTML = candidates.map(c => {
      const syncBadge = c.synced 
        ? `<span class="lyrics-badge-tag lyrics-badge-synced"><i class="ph-fill ph-lightning"></i> Synced</span>`
        : `<span class="lyrics-badge-tag lyrics-badge-plain"><i class="ph ph-file-text"></i> Plain</span>`;

      return `
        <div class="lyrics-candidate-card" data-id="${escapeHtml(c.id)}">
          <div class="lyrics-candidate-info">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="lyrics-candidate-title">${escapeHtml(c.title)}</span>
              ${syncBadge}
              <span style="font-size:10px;color:var(--accent);font-weight:600;text-transform:uppercase;">${escapeHtml(c.source)}</span>
            </div>
            <div class="lyrics-candidate-meta">${escapeHtml(c.artist)}${c.album ? ` · ${escapeHtml(c.album)}` : ''}</div>
            <div class="lyrics-candidate-preview">"${escapeHtml(c.preview)}"</div>
          </div>
          <button class="btn-primary lyrics-apply-btn" style="padding:6px 14px;font-size:12px;white-space:nowrap;" data-raw="${encodeURIComponent(c.raw_lrc || c.plain)}">
            <i class="ph ph-check-circle"></i> Apply
          </button>
        </div>
      `;
    }).join('');

    resultsContainer.querySelectorAll('.lyrics-apply-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const rawContent = decodeURIComponent(btn.dataset.raw || '');
        const currentTrack = getActivePlaybackTrack();
        if (!currentTrack) return notify('Play a song first.');

        btn.disabled = true;
        btn.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> Applying...';

        try {
          const res = await api('/api/lyrics/apply', {
            method: 'POST',
            body: JSON.stringify({
              track_id: currentTrack.id,
              artist: currentTrack.artist,
              title: currentTrack.title,
              content: rawContent
            })
          });

          state.lyrics[currentTrack.id] = rawContent;
          $('#lyrics-editor').value = rawContent;
          if (res.lyrics) {
            currentLyricsData = res.lyrics;
            updateLyricsBadge(res.lyrics.source, res.lyrics.synced);
            renderKaraokeLines(res.lyrics);
            checkPlainLyricsBanner(!res.lyrics.synced);
          }
          $('#lyrics-search-sheet').close();
          notify('Lyrics applied and saved permanently!');
        } catch (err) {
          notify('Failed to apply lyrics.');
          btn.disabled = false;
          btn.innerHTML = '<i class="ph ph-check-circle"></i> Apply';
        }
      });
    });

  } catch (err) {
    loading.classList.add('hidden');
    resultsContainer.innerHTML = `<p class="muted" style="text-align:center;padding:20px 0;">Failed to search lyrics providers.</p>`;
  }
}

function openLyricsSearchModal() {
  const t = getActivePlaybackTrack();
  const modal = $('#lyrics-search-sheet');
  if (!modal) return;
  
  if (t) {
    $('#lyrics-search-target').innerHTML = `Target: <strong>${escapeHtml(t.title)}</strong> · <span class="muted">${escapeHtml(t.artist)}</span>`;
    $('#lyrics-search-input').value = `${t.title} ${t.artist !== 'Local collection' && t.artist !== 'YouTube' ? t.artist : ''}`.trim();
  } else {
    $('#lyrics-search-target').innerHTML = `Target: <span class="muted">No active song</span>`;
    $('#lyrics-search-input').value = '';
  }

  modal.showModal();
  if ($('#lyrics-search-input').value) {
    executeLyricsSearch($('#lyrics-search-input').value);
  }
}

$('#open-lyrics-search-btn')?.addEventListener('click', openLyricsSearchModal);
$('#search-lyrics-btn-edit')?.addEventListener('click', openLyricsSearchModal);

$('#lyrics-search-close')?.addEventListener('click', () => $('#lyrics-search-sheet')?.close());
$('#lyrics-search-cancel-btn')?.addEventListener('click', () => $('#lyrics-search-sheet')?.close());

$('#lyrics-search-submit-btn')?.addEventListener('click', () => {
  executeLyricsSearch($('#lyrics-search-input').value);
});

$('#lyrics-search-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    executeLyricsSearch($('#lyrics-search-input').value);
  }
});

$('#video-modal-lyrics')?.addEventListener('click', () => {
  const t = getActivePlaybackTrack() || currentVideoTrack;
  closeVideoModal();
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="lyrics"]')?.classList.add('active');
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  $('#lyrics-view')?.classList.remove('hidden');
  if (t) loadLyricsInline(t);
});

// ---- Theme Engine -------------------------------------------
const themes = [
  { name: 'Warm Sand', color: '#d4b07a' },
  { name: 'Muted Sage', color: '#97a996' },
  { name: 'Dusty Rose', color: '#ba9497' },
  { name: 'Slate Blue', color: '#889eb8' }
];
let currentTheme = 0;

$('#theme-button').addEventListener('click', () => {
  currentTheme = (currentTheme + 1) % themes.length;
  document.documentElement.style.setProperty('--accent', themes[currentTheme].color);
  notify(`Theme set to ${themes[currentTheme].name}`);
});

$('#rescan').addEventListener('click', async () => {
  notify('Rescanning library folders...');
  try {
    const data = await api('/api/rescan', { method: 'POST' });
    hydrate(data);
    notify(`Library refreshed! Found ${data.count || state.tracks.length} tracks.`);
  } catch (e) { notify('Error refreshing library.'); }
});

function renderFoldersList() {
  const list = $('#folders-list');
  if (!state.library_folders || state.library_folders.length === 0) {
    list.innerHTML = '<p class="muted">No folders imported.</p>';
    return;
  }
  list.innerHTML = state.library_folders.map(f => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.1);">
      <span style="font-family:monospace;font-size:12px;color:#ccc;word-break:break-all;">${escapeHtml(f)}</span>
      <button class="round-action folder-remove-btn" data-folder="${escapeHtml(f)}" style="margin-left:10px;"><i class="ph ph-trash"></i></button>
    </div>
  `).join('');
  
  list.querySelectorAll('.folder-remove-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const f = btn.dataset.folder;
      state.library_folders = state.library_folders.filter(x => x !== f);
      await saveState();
      renderFoldersList();
      notify('Folder removed. Rescan to clear tracks.');
    });
  });
}

$('#manage-folders').addEventListener('click', () => {
  closeSidebar();
  renderFoldersList();
  $('#folders-sheet').showModal();
});

$('#folders-close').addEventListener('click', () => $('#folders-sheet').close());

$('#add-folder-btn').addEventListener('click', async () => {
  const p = $('#new-folder-path').value.trim();
  if (!p) return;
  notify('Importing...');
  try {
    const data = await api('/api/import-folder', { method: 'POST', body: JSON.stringify({ folder: p }) });
    hydrate(data);
    $('#new-folder-path').value = '';
    renderFoldersList();
    notify('Import successful!');
  } catch (err) { 
    notify(err.message || 'Import failed.'); 
  }
});

// ---- Init ---------------------------------------------------
(async function init() {
  try {
    const data = await api('/api/library');
    hydrate(data);
  } catch (e) {
    notify('Failed to load library data.');
  }
})();

// ---- Full-Screen Player -------------------------------------
// Modularized into /static/fullscreen.js (v1.0)
// Manages: 3D CD Jewel Case, Grooved Vinyl Turntable, 90s Winamp/Walkman CRT,
// Celestial Halo, True Fullscreen API, Auto-Hide HUD, and Seek Ring.
window.updateFullscreenUI = window.updateFullscreenUI || function() {};
window.updateFullscreenRing = window.updateFullscreenRing || function() {};
window.openFullscreenPlayer = window.openFullscreenPlayer || function() {};
window.closeFullscreenPlayer = window.closeFullscreenPlayer || function() {};
window.setFullscreenMode = window.setFullscreenMode || function() {};
window.cycleFullscreenMode = window.cycleFullscreenMode || function() {};
window.toggleTrueFullscreen = window.toggleTrueFullscreen || function() {};

// Hook into audio timeupdate to update main bottom player timeline and fullscreen player
audio.addEventListener('timeupdate', () => {
  const cur = audio.currentTime || 0;
  const dur = audio.duration || queue[currentIndex]?.duration || 0;
  if (typeof _telemetryMaxTimePlayed !== 'undefined') {
    _telemetryMaxTimePlayed = Math.max(_telemetryMaxTimePlayed, cur);
  }

  const curTimeEl = $('#current-time');
  const totalTimeEl = $('#total-time');
  const progressEl = $('#progress');

  if (!window.isUserScrubbing) {
    if (curTimeEl) curTimeEl.textContent = formatTime(cur);
    if (progressEl && dur > 0 && !progressEl.matches(':active')) {
      progressEl.value = (cur / dur) * 100;
    }
  }
  if (totalTimeEl && dur > 0) totalTimeEl.textContent = formatTime(dur);

  if (typeof window.updateWaveformProgress === 'function') {
    window.updateWaveformProgress(cur, dur);
  }

  const heroNpBar = $('#hero-np-bar');
  if (heroNpBar && dur > 0) {
    heroNpBar.style.width = `${Math.min(100, (cur / dur) * 100)}%`;
  }

  const isSeeking = window.isDraggingSeek || (typeof isDraggingSeek !== 'undefined' ? isDraggingSeek : false);
  if (!isSeeking) {
    if (typeof updateFullscreenRing === 'function') {
      updateFullscreenRing(cur, dur);
    } else if (typeof window.updateFullscreenRing === 'function') {
      window.updateFullscreenRing(cur, dur);
    }
  }
  updateKaraokeHighlight(cur);

  // Smart Auto-DJ Beat-Matched Crossfader Trigger:
  // When track is within autoDJDuration of its end, trigger equal-power blend to next track
  if (isAutoDJEnabled && autoDJDuration > 0 && !isCrossfading && dur > 15) {
    const timeLeft = dur - cur;
    if (timeLeft <= autoDJDuration && timeLeft > 0.4) {
      const nextTrack = queue[currentIndex + 1];
      if (nextTrack) {
        startAutoDJCrossfade(nextTrack, autoDJDuration);
      }
    }
  }

  // Lookahead Pre-warming: Pre-cache next tracks early (halfway or within 30 seconds of ending)
  if (dur > 15 && (cur / dur >= 0.45 || (dur - cur) <= 30)) {
    const nextTrack = queue[currentIndex + 1];
    if (nextTrack && nextTrack.id !== _lastPrewarmedTrackId) {
      _lastPrewarmedTrackId = nextTrack.id;
      const vid = nextTrack.video_id || (nextTrack.id && nextTrack.id.startsWith('yt:') ? nextTrack.id.slice(3) : null);
      if (vid) {
        api(`/api/youtube/prewarm/${encodeURIComponent(vid)}`, { method: 'POST' }).catch(() => {});
      }
      if (typeof preloadNextDeckAudio === 'function') {
        preloadNextDeckAudio(nextTrack);
      }
    }
  }
});

audio.addEventListener('loadedmetadata', () => {
  const dur = audio.duration || queue[currentIndex]?.duration || 0;
  const totalTimeEl = $('#total-time');
  if (totalTimeEl && dur > 0) {
    totalTimeEl.textContent = formatTime(dur);
  }
});

audio.addEventListener('durationchange', () => {
  const dur = audio.duration || queue[currentIndex]?.duration || 0;
  const totalTimeEl = $('#total-time');
  if (totalTimeEl && dur > 0) {
    totalTimeEl.textContent = formatTime(dur);
  }
});

audio.addEventListener('ended', () => {
  updateFullscreenRing(audio.duration, audio.duration);
  fsPlayer.classList.remove('playing');
});


// ============================================================
// 10-Band EQ, DSP & Audio FX Engine — Moved to static/audio_dsp.js
// ============================================================

// ---- 3D Holographic Audio-Reactive Galaxy Particle Engine ----
const galaxyCanvas = document.getElementById('fs-galaxy-canvas');
let galaxyCtx = null;
let galaxyParticles = [];
const NUM_GALAXY_STARS = 950;
let galaxyRotation = 0;
let mouseTiltX = 0, mouseTiltY = 0;
let targetTiltX = 0, targetTiltY = 0;

function initGalaxyEngine() {
  if (!galaxyCanvas) return;
  galaxyCtx = galaxyCanvas.getContext('2d');
  
  const size = 600;
  galaxyCanvas.width = size;
  galaxyCanvas.height = size;

  galaxyParticles = [];
  const arms = 3;
  for (let i = 0; i < NUM_GALAXY_STARS; i++) {
    const armIndex = i % arms;
    const distance = Math.pow(Math.random(), 1.6) * 230 + 10;
    const angle = (armIndex * (Math.PI * 2 / arms)) + (distance * 0.022) + (Math.random() * 0.45);
    const z = (Math.random() - 0.5) * 80;
    const size = Math.random() * 2 + 0.8;
    const colorMix = Math.random();

    galaxyParticles.push({
      distance,
      baseAngle: angle,
      angle: angle,
      z: z,
      baseZ: z,
      size: size,
      colorMix: colorMix,
      speed: (1 / (distance + 20)) * 1.2
    });
  }
}

if (galaxyCanvas) {
  galaxyCanvas.addEventListener('mousemove', (e) => {
    const rect = galaxyCanvas.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    targetTiltX = ny * 0.9;
    targetTiltY = -nx * 0.9;
  });
  galaxyCanvas.addEventListener('mouseleave', () => {
    targetTiltX = 0; targetTiltY = 0;
  });
}

function renderGalaxyFrame(bass, mid, treble) {
  if (!galaxyCtx || !galaxyCanvas) return;
  const w = galaxyCanvas.width;
  const h = galaxyCanvas.height;
  const cx = w / 2;
  const cy = h / 2;

  mouseTiltX += (targetTiltX - mouseTiltX) * 0.08;
  mouseTiltY += (targetTiltY - mouseTiltY) * 0.08;

  galaxyCtx.fillStyle = 'rgba(6, 6, 10, 0.28)';
  galaxyCtx.fillRect(0, 0, w, h);

  galaxyRotation += 0.008 + mid * 0.035;

  const fov = 340;
  const shockwave = 1 + bass * 0.38;

  // Central supermassive core
  const coreGrad = galaxyCtx.createRadialGradient(cx, cy, 0, cx, cy, 32 + bass * 40);
  coreGrad.addColorStop(0, 'rgba(255, 255, 255, 0.95)');
  coreGrad.addColorStop(0.3, 'rgba(212, 176, 122, 0.75)');
  coreGrad.addColorStop(0.7, 'rgba(180, 100, 255, 0.35)');
  coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
  galaxyCtx.fillStyle = coreGrad;
  galaxyCtx.beginPath();
  galaxyCtx.arc(cx, cy, 38 + bass * 45, 0, Math.PI * 2);
  galaxyCtx.fill();

  // Draw 3D projected galaxy stars
  for (let i = 0; i < galaxyParticles.length; i++) {
    const p = galaxyParticles[i];
    p.angle += p.speed + mid * 0.006;
    const curDist = p.distance * shockwave;

    let px = Math.cos(p.angle + galaxyRotation) * curDist;
    let py = Math.sin(p.angle + galaxyRotation) * curDist * 0.45;
    let pz = p.baseZ + Math.sin(p.angle * 3) * (15 + bass * 25);

    const cosX = Math.cos(mouseTiltX);
    const sinX = Math.sin(mouseTiltX);
    const py1 = py * cosX - pz * sinX;
    const pz1 = py * sinX + pz * cosX;

    const cosY = Math.cos(mouseTiltY);
    const sinY = Math.sin(mouseTiltY);
    const px1 = px * cosY + pz1 * sinY;
    const pz2 = -px * sinY + pz1 * cosY;

    const scale = fov / (fov + pz2 + 120);
    const x2d = cx + px1 * scale;
    const y2d = cy + py1 * scale;

    if (x2d < 0 || x2d > w || y2d < 0 || y2d > h) continue;

    const pSize = Math.max(0.8, p.size * scale * (1 + bass * 0.8 + (p.colorMix > 0.7 ? treble * 1.5 : 0)));
    const alpha = Math.min(1, Math.max(0.15, (0.4 + p.colorMix * 0.5 + treble * 0.4) * scale));

    galaxyCtx.beginPath();
    galaxyCtx.arc(x2d, y2d, pSize, 0, Math.PI * 2);

    if (p.colorMix < 0.35) {
      galaxyCtx.fillStyle = `rgba(212, 176, 122, ${alpha})`;
    } else if (p.colorMix < 0.7) {
      galaxyCtx.fillStyle = `rgba(140, 200, 255, ${alpha})`;
    } else {
      galaxyCtx.fillStyle = `rgba(240, 140, 255, ${alpha})`;
    }
    galaxyCtx.fill();
  }
}

initGalaxyEngine();

// ---- Celestial Halo, Spectrum & Visualizer Loop Engine -------
// Modularized into /static/visualizers.js (v1.0)
window.startAudioVisualizer = window.startAudioVisualizer || function() {};
window.initCelestialHaloEngine = window.initCelestialHaloEngine || function() {};
window.initWinampEngine = window.initWinampEngine || function() {};
window.resizeVisualizerCanvases = window.resizeVisualizerCanvases || function() {};

audio.addEventListener('play', () => {
  startAudioVisualizer();
  if (is8DActive) run8DSpatialLoop();
});
audio.addEventListener('pause', () => {
  if (visualizerRaf) cancelAnimationFrame(visualizerRaf);
  if (spatialRaf) { cancelAnimationFrame(spatialRaf); spatialRaf = null; }
});

// ---- Media Session & Lockscreen Controls ---------------------
function updateMediaSessionMetadata(track) {
  if (!('mediaSession' in navigator) || !track) return;

  const artworkList = [];
  if (track.artwork_url) {
    const fullUrl = track.artwork_url.startsWith('http')
      ? track.artwork_url
      : (window.location.origin + track.artwork_url);
    artworkList.push(
      { src: fullUrl, sizes: '96x96', type: 'image/jpeg' },
      { src: fullUrl, sizes: '128x128', type: 'image/jpeg' },
      { src: fullUrl, sizes: '256x256', type: 'image/jpeg' },
      { src: fullUrl, sizes: '512x512', type: 'image/jpeg' }
    );
  }

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album || 'Linus Collection',
    artwork: artworkList
  });

  try {
    window.DiscordRPC?.updateActivity?.(track, !audio.paused, audio.currentTime);
  } catch (e) {}
}

function updateMediaSessionPosition() {
  if (!('mediaSession' in navigator) || !('setPositionState' in navigator.mediaSession)) return;
  if (audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration,
        playbackRate: audio.playbackRate || 1,
        position: Math.min(audio.currentTime, audio.duration)
      });
    } catch (e) {}
  }
}

function initMediaSessionHandlers() {
  if (!('mediaSession' in navigator)) return;

  const handlers = [
    ['play', () => { if (audio.paused) togglePlayGlobal(); }],
    ['pause', () => { if (!audio.paused) togglePlayGlobal(); }],
    ['previoustrack', () => $('#previous').click()],
    ['nexttrack', () => $('#next').click()],
    ['stop', () => { audio.pause(); audio.currentTime = 0; }],
    ['seekto', (details) => {
      if (details.seekTime !== undefined && details.seekTime !== null) {
        audio.currentTime = details.seekTime;
        updateMediaSessionPosition();
      }
    }],
    ['seekforward', (details) => {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + (details.seekOffset || 10));
      updateMediaSessionPosition();
    }],
    ['seekbackward', (details) => {
      audio.currentTime = Math.max(0, audio.currentTime - (details.seekOffset || 10));
      updateMediaSessionPosition();
    }]
  ];

  handlers.forEach(([action, handler]) => {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch (e) {}
  });
}

initMediaSessionHandlers();

// Sync playback state to mediaSession
audio.addEventListener('play', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
audio.addEventListener('pause', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
});
audio.addEventListener('timeupdate', updateMediaSessionPosition);


// ============================================================
// Global Keyboard Shortcuts — Moved to static/keyboard.js
// ============================================================

// ---- Lofi Zen Soundstage & Ambient Atmosphere Engine ----------
const ZEN_PRESETS = {
  rainy_cafe: { rain: 0.45, vinyl: 0.35, fire: 0.0, ocean: 0.0, wind: 0.15, binaural: 0.20, balance: 0.25, name: 'Rainy Cafe' },
  late_night: { rain: 0.20, vinyl: 0.40, fire: 0.0, ocean: 0.0, wind: 0.25, binaural: 0.35, balance: 0.30, name: 'Late Night Study' },
  fireside: { rain: 0.15, vinyl: 0.25, fire: 0.55, ocean: 0.0, wind: 0.20, binaural: 0.0, balance: 0.25, name: 'Fireside Cabin' },
  deep_zen: { rain: 0.20, vinyl: 0.0, fire: 0.0, ocean: 0.50, wind: 0.15, binaural: 0.45, balance: 0.40, name: 'Deep Meditation' },
  ocean_breeze: { rain: 0.0, vinyl: 0.10, fire: 0.0, ocean: 0.60, wind: 0.30, binaural: 0.15, balance: 0.30, name: 'Oceanic Coast' }
};

class AmbientSoundscapeEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.zenBalance = 0.20; // 0.0 to 1.0 (music vs atmosphere)
    this.activePreset = null;
    this.binauralHz = 10; // 10 (Alpha), 6 (Theta), 2 (Delta)
    this.layers = {
      rain: { gainNode: null, source: null, vol: 0 },
      vinyl: { gainNode: null, source: null, vol: 0 },
      fire: { gainNode: null, source: null, vol: 0 },
      ocean: { gainNode: null, source: null, vol: 0 },
      wind: { gainNode: null, source: null, vol: 0 },
      binaural: { gainNode: null, source: null, oscL: null, oscR: null, vol: 0 }
    };
  }

  ensureContext() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
        this.masterGain.connect(this.ctx.destination);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    return this.ctx;
  }

  createNoiseBuffer(type = 'pink') {
    const ctx = this.ensureContext();
    const bufferSize = ctx.sampleRate * 4;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    let lastOut = 0.0;

    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      if (type === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else if (type === 'brown') {
        lastOut = (lastOut + (0.02 * white)) / 1.02;
        data[i] = lastOut * 3.5;
      } else if (type === 'vinyl_crackle') {
        const surface = (Math.random() * 2 - 1) * 0.035;
        let crackle = 0;
        if (Math.random() < 0.0018) {
          crackle = (Math.random() > 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.65);
        }
        data[i] = surface + crackle;
      } else {
        data[i] = white * 0.2;
      }
    }
    return buffer;
  }

  setVolume(layerKey, vol) {
    this.ensureContext();
    const layer = this.layers[layerKey];
    if (!layer) return;
    layer.vol = vol;

    if (vol > 0 && !layer.source && !layer.oscL) {
      this.startLayer(layerKey);
    }
    if (layer.gainNode && this.ctx) {
      layer.gainNode.gain.setTargetAtTime(vol * 0.38, this.ctx.currentTime, 0.05);
    }
    this.updateUI();
  }

  setBinauralFrequency(hz) {
    this.binauralHz = hz;
    const layer = this.layers.binaural;
    if (layer.oscL && layer.oscR && this.ctx) {
      const baseFreq = 216;
      layer.oscL.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);
      layer.oscR.frequency.setValueAtTime(baseFreq + hz, this.ctx.currentTime);
    }
    const label = $('#binaural-freq-label');
    if (label) {
      const mode = hz === 10 ? '10Hz Alpha Focus Waves' : (hz === 6 ? '6Hz Theta Relaxation Waves' : '2Hz Delta Deep Sleep Waves');
      label.textContent = mode;
    }
  }

  setZenBalance(val) {
    this.zenBalance = Math.max(0, Math.min(1.0, val));
    const sub = $('#zen-balance-sub');
    const label = $('#zen-balance-val');
    const pctAtm = Math.round(this.zenBalance * 100);
    const pctMus = 100 - pctAtm;
    if (sub) sub.textContent = `${pctMus}% Music · ${pctAtm}% Ambient Layer`;
    if (label) {
      if (pctAtm <= 15) label.textContent = 'Music Focus';
      else if (pctAtm >= 75) label.textContent = 'Pure Zen';
      else label.textContent = 'Balanced';
    }
    if (this.masterGain && this.ctx) {
      const gainScale = Math.min(1.0, 0.4 + this.zenBalance * 1.2);
      this.masterGain.gain.setTargetAtTime(gainScale, this.ctx.currentTime, 0.05);
    }
  }

  loadPreset(presetKey) {
    const preset = ZEN_PRESETS[presetKey];
    if (!preset) return;
    this.activePreset = presetKey;
    this.ensureContext();
    this.setZenBalance(preset.balance || 0.25);
    const sliderBal = $('#zen-balance-slider');
    if (sliderBal) sliderBal.value = preset.balance || 0.25;

    ['rain', 'vinyl', 'fire', 'ocean', 'wind', 'binaural'].forEach(k => {
      const v = preset[k] || 0;
      this.setVolume(k, v);
      const slider = $(`#ambient-${k}-slider`);
      if (slider) slider.value = v;
      const valLabel = $(`#vol-${k}-val`);
      if (valLabel) valLabel.textContent = `${Math.round(v * 100)}%`;
      const card = $(`#card-${k}`);
      if (card) card.classList.toggle('active', v > 0);
    });

    const badge = $('#zen-active-preset-badge');
    if (badge) {
      badge.textContent = preset.name;
      badge.classList.add('active');
    }
    document.querySelectorAll('.zen-preset-pill').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.preset === presetKey);
    });
    notify(`🌧️ Atmosphere: ${preset.name}`);
    this.updateUI();
  }

  startLayer(key) {
    const ctx = this.ensureContext();
    const layer = this.layers[key];
    if (layer.source || layer.oscL) return;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(layer.vol * 0.38, ctx.currentTime);

    if (key === 'binaural') {
      const merger = ctx.createChannelMerger(2);
      const oscL = ctx.createOscillator();
      const oscR = ctx.createOscillator();
      const baseFreq = 216;
      oscL.type = 'sine';
      oscR.type = 'sine';
      oscL.frequency.value = baseFreq;
      oscR.frequency.value = baseFreq + this.binauralHz;

      oscL.connect(merger, 0, 0);
      oscR.connect(merger, 0, 1);
      merger.connect(gain);

      oscL.start();
      oscR.start();
      layer.oscL = oscL;
      layer.oscR = oscR;
    } else {
      let noiseType = 'pink';
      if (key === 'ocean' || key === 'fire') noiseType = 'brown';
      else if (key === 'vinyl') noiseType = 'vinyl_crackle';

      const noiseBuffer = this.createNoiseBuffer(noiseType);
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer;
      src.loop = true;

      if (key === 'rain') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 1350;
        src.connect(filter);
        filter.connect(gain);
      } else if (key === 'vinyl') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 250;
        src.connect(filter);
        filter.connect(gain);
      } else if (key === 'fire') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 480;
        filter.Q.value = 1.3;
        src.connect(filter);
        filter.connect(gain);
      } else if (key === 'ocean') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 380;

        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.11;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.2;
        lfo.connect(lfoGain.gain);
        lfo.start();

        src.connect(filter);
        filter.connect(gain);
      } else if (key === 'wind') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 320;
        filter.Q.value = 2.2;

        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.08;
        lfo.connect(filter.frequency);
        lfo.start();

        src.connect(filter);
        filter.connect(gain);
      }

      src.start(0);
      layer.source = src;
    }

    gain.connect(this.masterGain || ctx.destination);
    layer.gainNode = gain;
  }

  muteAll() {
    this.activePreset = null;
    ['rain', 'vinyl', 'fire', 'ocean', 'wind', 'binaural'].forEach(k => {
      this.setVolume(k, 0);
      const slider = $(`#ambient-${k}-slider`);
      if (slider) slider.value = 0;
      const valLabel = $(`#vol-${k}-val`);
      if (valLabel) valLabel.textContent = '0%';
      const card = $(`#card-${k}`);
      if (card) card.classList.remove('active');
    });
    document.querySelectorAll('.zen-preset-pill').forEach(btn => btn.classList.remove('active'));
    const presetBadge = $('#zen-active-preset-badge');
    if (presetBadge) {
      presetBadge.textContent = 'Muted';
      presetBadge.classList.remove('active');
    }
    this.updateUI();
  }

  updateUI() {
    const activeLayers = Object.entries(this.layers).filter(([_, l]) => l.vol > 0);
    const activeCount = activeLayers.length;
    
    const badge = $('#ambient-status-badge');
    const sub = $('#ambient-status-sub');
    const toggleBtn = $('#ambient-toggle-btn');
    const fsBtn = $('#fs-zen-btn');
    const summary = $('#ambient-active-layers-summary');

    if (badge) {
      if (activeCount > 0) {
        badge.textContent = this.activePreset ? (ZEN_PRESETS[this.activePreset]?.name || `${activeCount} On`) : `${activeCount} Layers`;
        badge.className = 'norm-status-pill on';
      } else {
        badge.textContent = 'OFF';
        badge.className = 'norm-status-pill off';
      }
    }

    if (sub) {
      sub.textContent = activeCount > 0 
        ? `${activeLayers.map(([k]) => k.toUpperCase()).join(' · ')} in background` 
        : 'Rain, vinyl crackle, hearth & binaural';
    }

    if (toggleBtn) {
      toggleBtn.classList.toggle('active', activeCount > 0);
    }
    if (fsBtn) {
      fsBtn.classList.toggle('active', activeCount > 0);
    }

    if (summary) {
      if (activeCount > 0) {
        summary.innerHTML = `<i class="ph-fill ph-circle" style="color:var(--accent);font-size:10px;"></i> ${activeCount} Soundstage layers active`;
      } else {
        summary.innerHTML = `<i class="ph-bold ph-circle" style="font-size:10px;"></i> Atmosphere Idle`;
      }
    }
  }
}

const ambientEngine = new AmbientSoundscapeEngine();

// Hook Ambient Sliders
['rain', 'vinyl', 'fire', 'ocean', 'wind', 'binaural'].forEach(key => {
  const slider = $(`#ambient-${key}-slider`);
  if (!slider) return;
  slider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    ambientEngine.setVolume(key, val);
    $(`#vol-${key}-val`).textContent = `${Math.round(val * 100)}%`;
    $(`#card-${key}`).classList.toggle('active', val > 0);
  });
});

// Hook Preset Pills
document.querySelectorAll('.zen-preset-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    const preset = btn.dataset.preset;
    if (preset) ambientEngine.loadPreset(preset);
  });
});

// Hook Binaural Frequency Pills
document.querySelectorAll('.binaural-type-pill').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.binaural-type-pill').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const hz = parseInt(btn.dataset.hz, 10) || 10;
    ambientEngine.setBinauralFrequency(hz);
  });
});

// Hook Zen Master Balance Slider
$('#zen-balance-slider')?.addEventListener('input', (e) => {
  const val = parseFloat(e.target.value);
  ambientEngine.setZenBalance(val);
});

$('#ambient-mute-all-btn')?.addEventListener('click', () => {
  ambientEngine.muteAll();
  notify('Atmosphere muted.');
});

// Sleep Timer Logic
let sleepTimerInterval = null;
let sleepTimeRemaining = 0;

function startSleepTimer(minutes) {
  if (sleepTimerInterval) clearInterval(sleepTimerInterval);
  sleepTimeRemaining = minutes * 60;

  const badge = $('#sleep-timer-badge');
  const cancelBtn = $('#sleep-cancel-btn');
  if (badge) badge.classList.add('running');
  if (cancelBtn) cancelBtn.classList.remove('hidden');

  document.querySelectorAll('.sleep-preset-btn:not(#sleep-cancel-btn)').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.minutes) === minutes);
  });
  document.querySelectorAll('.sleep-quick-item:not(#sleep-quick-cancel-btn)').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.minutes) === minutes);
  });

  const quickIcon = $('#sleep-quick-icon');
  if (quickIcon) {
    quickIcon.className = 'ph-fill ph-moon-stars';
    quickIcon.style.color = 'var(--accent, #d4b07a)';
  }
  $('#sleep-quick-cancel-btn')?.classList.remove('hidden');

  notify(`🌙 Sleep timer set for ${minutes} minutes.`);
  updateSleepTimerDisplay();

  sleepTimerInterval = setInterval(() => {
    sleepTimeRemaining--;

    // Final 45 seconds: Gentle Volume Fade-Out
    if (sleepTimeRemaining <= 45 && sleepTimeRemaining > 0) {
      const fadeFraction = sleepTimeRemaining / 45;
      const userVol = parseFloat($('#volume')?.value) || 1;
      audio.volume = Math.max(0, fadeFraction * userVol);
    }

    if (sleepTimeRemaining <= 0) {
      clearInterval(sleepTimerInterval);
      sleepTimerInterval = null;
      audio.pause();
      if (typeof ambientEngine !== 'undefined' && ambientEngine && ambientEngine.muteAll) {
        ambientEngine.muteAll();
      }
      if (badge) {
        badge.textContent = 'Off';
        badge.classList.remove('running');
      }
      if (cancelBtn) cancelBtn.classList.add('hidden');
      const quickBadge = $('#sleep-quick-badge');
      if (quickBadge) quickBadge.classList.add('hidden');
      const qi = $('#sleep-quick-icon');
      if (qi) { qi.className = 'ph ph-moon'; qi.style.color = ''; }
      $('#sleep-quick-cancel-btn')?.classList.add('hidden');
      document.querySelectorAll('.sleep-preset-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sleep-quick-item').forEach(b => b.classList.remove('active'));
      notify('💤 Sleep timer finished. Goodnight!');
      return;
    }

    updateSleepTimerDisplay();
  }, 1000);
}

function updateSleepTimerDisplay() {
  const mins = Math.floor(sleepTimeRemaining / 60);
  const secs = sleepTimeRemaining % 60;
  const timeStr = `${mins}:${secs < 10 ? '0' : ''}${secs}`;

  const badge = $('#sleep-timer-badge');
  if (badge) badge.textContent = timeStr;

  const quickBadge = $('#sleep-quick-badge');
  if (quickBadge) {
    quickBadge.textContent = mins > 0 ? `${mins}m` : `${secs}s`;
    quickBadge.classList.remove('hidden');
  }
}

function cancelSleepTimer() {
  if (sleepTimerInterval) clearInterval(sleepTimerInterval);
  sleepTimerInterval = null;
  sleepTimeRemaining = 0;
  audio.volume = parseFloat($('#volume')?.value || 1);
  const badge = $('#sleep-timer-badge');
  if (badge) {
    badge.textContent = 'Off';
    badge.classList.remove('running');
  }
  $('#sleep-cancel-btn')?.classList.add('hidden');
  const quickBadge = $('#sleep-quick-badge');
  if (quickBadge) quickBadge.classList.add('hidden');
  const quickIcon = $('#sleep-quick-icon');
  if (quickIcon) {
    quickIcon.className = 'ph ph-moon';
    quickIcon.style.color = '';
  }
  $('#sleep-quick-cancel-btn')?.classList.add('hidden');
  document.querySelectorAll('.sleep-preset-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.sleep-quick-item').forEach(b => b.classList.remove('active'));
  notify('Sleep timer cancelled.');
}

document.querySelectorAll('.sleep-preset-btn:not(#sleep-cancel-btn)').forEach(btn => {
  btn.addEventListener('click', () => {
    startSleepTimer(parseInt(btn.dataset.minutes));
  });
});
$('#sleep-cancel-btn')?.addEventListener('click', cancelSleepTimer);

// Quick Player Bar Sleep Timer Popover
const sleepQuickBtn = $('#sleep-timer-quick-btn');
const sleepQuickPopover = $('#sleep-quick-popover');

if (sleepQuickBtn && sleepQuickPopover) {
  sleepQuickBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isShowing = sleepQuickPopover.classList.contains('show');
    document.querySelectorAll('.studio-fx-popover, .sleep-quick-popover').forEach(p => p.classList.remove('show'));
    if (!isShowing) sleepQuickPopover.classList.add('show');
  });

  document.querySelectorAll('.sleep-quick-item:not(#sleep-quick-cancel-btn)').forEach(btn => {
    btn.addEventListener('click', () => {
      startSleepTimer(parseInt(btn.dataset.minutes));
      sleepQuickPopover.classList.remove('show');
    });
  });

  $('#sleep-quick-cancel-btn')?.addEventListener('click', () => {
    cancelSleepTimer();
    sleepQuickPopover.classList.remove('show');
  });

  document.addEventListener('click', (e) => {
    if (!sleepQuickPopover.contains(e.target) && e.target !== sleepQuickBtn) {
      sleepQuickPopover.classList.remove('show');
    }
  });
}

// Dialog Open / Close
$('#ambient-toggle-btn')?.addEventListener('click', () => {
  ambientEngine.ensureContext();
  $('#ambient-sheet')?.showModal();
});
$('#fs-zen-btn')?.addEventListener('click', () => {
  ambientEngine.ensureContext();
  $('#ambient-sheet')?.showModal();
});
$('#ambient-close')?.addEventListener('click', () => $('#ambient-sheet')?.close());

// ---- Floating Picture-in-Picture Mini Player Engine ----------
let pipWindow = null;
let pipCanvas = null;
let pipVideo = null;
let pipCanvasCtx = null;

async function togglePictureInPicture() {
  if (!audio.src) {
    return notify('Play a song first to open the Mini Player.');
  }

  // 1. Modern Document Picture-in-Picture API (Interactive Window on top of all desktop apps)
  if ('documentPictureInPicture' in window) {
    try {
      if (pipWindow) {
        pipWindow.close();
        pipWindow = null;
        return;
      }

      pipWindow = await window.documentPictureInPicture.requestWindow({
        width: 380,
        height: 220
      });

      const pipDoc = pipWindow.document;
      pipDoc.title = 'Linus Mini Player';
      
      const style = pipDoc.createElement('style');
      style.textContent = `
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; user-select: none; }
        body {
          background: #09090b; color: #fff; height: 100vh; display: flex; flex-direction: column;
          justify-content: space-between; padding: 18px; overflow: hidden;
        }
        .pip-body { display: flex; align-items: center; gap: 14px; }
        .pip-disc {
          width: 64px; height: 64px; border-radius: 50%; background: #18181b;
          display: grid; place-items: center; overflow: hidden; position: relative;
          box-shadow: 0 4px 16px rgba(0,0,0,0.6); flex-shrink: 0;
          animation: spin 16s linear infinite; animation-play-state: paused;
        }
        .pip-disc.playing { animation-play-state: running; }
        .pip-disc img { width: 100%; height: 100%; object-fit: cover; }
        @keyframes spin { 100% { transform: rotate(360deg); } }
        .pip-info { display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
        .pip-title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pip-artist { font-size: 12px; color: rgba(255,255,255,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .pip-progress-track {
          width: 100%; height: 4px; background: rgba(255,255,255,0.15); border-radius: 2px;
          margin: 10px 0; overflow: hidden; cursor: pointer;
        }
        .pip-progress-fill { width: 0%; height: 100%; background: #d4b07a; }
        .pip-controls { display: flex; align-items: center; justify-content: center; gap: 16px; }
        .pip-btn {
          background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.12);
          color: #fff; border-radius: 50%; width: 36px; height: 36px;
          display: grid; place-items: center; cursor: pointer; transition: 0.2s; font-size: 15px;
        }
        .pip-btn:hover { background: rgba(255,255,255,0.2); transform: scale(1.08); }
        .pip-btn-play {
          width: 44px; height: 44px; background: #fff; color: #000; font-size: 20px;
        }
      `;
      pipDoc.head.appendChild(style);

      pipDoc.body.innerHTML = `
        <div class="pip-body">
          <div class="pip-disc" id="p-disc">
            <div id="p-art" style="font-size:24px;">🎵</div>
          </div>
          <div class="pip-info">
            <div class="pip-title" id="p-title">Playing Track</div>
            <div class="pip-artist" id="p-artist">Artist</div>
          </div>
        </div>
        <div>
          <div class="pip-progress-track" id="p-track">
            <div class="pip-progress-fill" id="p-fill"></div>
          </div>
          <div class="pip-controls">
            <button class="pip-btn" id="p-prev">⏮</button>
            <button class="pip-btn pip-btn-play" id="p-play">⏸</button>
            <button class="pip-btn" id="p-next">⏭</button>
          </div>
        </div>
      `;

      const updatePipDom = () => {
        const curTrack = queue[currentIndex];
        if (!curTrack || !pipWindow) return;
        pipDoc.getElementById('p-title').textContent = curTrack.title;
        pipDoc.getElementById('p-artist').textContent = curTrack.artist;
        const disc = pipDoc.getElementById('p-disc');
        if (disc) disc.classList.toggle('playing', !audio.paused);
        
        const artBox = pipDoc.getElementById('p-art');
        if (artBox) {
          if (curTrack.has_artwork && curTrack.artwork_url) {
            artBox.innerHTML = `<img src="${window.location.origin + curTrack.artwork_url}">`;
          } else {
            artBox.innerHTML = `🎵`;
          }
        }
        pipDoc.getElementById('p-play').textContent = audio.paused ? '▶' : '⏸';
      };

      updatePipDom();

      pipDoc.getElementById('p-play').addEventListener('click', () => togglePlayGlobal());
      pipDoc.getElementById('p-prev').addEventListener('click', () => $('#previous').click());
      pipDoc.getElementById('p-next').addEventListener('click', () => $('#next').click());
      pipDoc.getElementById('p-track').addEventListener('click', (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        if (audio.duration) audio.currentTime = pct * audio.duration;
      });

      const pipProgressInterval = setInterval(() => {
        if (!pipWindow || pipWindow.closed) {
          clearInterval(pipProgressInterval);
          pipWindow = null;
          return;
        }
        if (audio.duration) {
          const pct = (audio.currentTime / audio.duration) * 100;
          const fill = pipDoc.getElementById('p-fill');
          if (fill) fill.style.width = `${pct}%`;
        }
        const playBtn = pipDoc.getElementById('p-play');
        if (playBtn) playBtn.textContent = audio.paused ? '▶' : '⏸';
        const disc = pipDoc.getElementById('p-disc');
        if (disc) disc.classList.toggle('playing', !audio.paused);
      }, 250);

      pipWindow.addEventListener('pagehide', () => {
        pipWindow = null;
      });

      notify('🪟 Mini Player opened (Always-on-Top)!');
      return;
    } catch (err) {
      console.warn('Document PiP fallback:', err);
    }
  }

  // 2. HTML5 Video Picture-in-Picture Fallback (Canvas stream)
  try {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
      return;
    }
    if (!pipCanvas) {
      pipCanvas = document.createElement('canvas');
      pipCanvas.width = 480;
      pipCanvas.height = 270;
      pipCanvasCtx = pipCanvas.getContext('2d');
      pipVideo = document.createElement('video');
      pipVideo.muted = true;
      pipVideo.srcObject = pipCanvas.captureStream(30);
      pipVideo.play();
    }

    const curTrack = queue[currentIndex] || { title: 'Linus Audio', artist: 'Playing' };
    pipCanvasCtx.fillStyle = '#0a0a0f';
    pipCanvasCtx.fillRect(0, 0, 480, 270);
    pipCanvasCtx.fillStyle = '#ffffff';
    pipCanvasCtx.font = 'bold 22px sans-serif';
    pipCanvasCtx.fillText(curTrack.title.slice(0, 30), 30, 120);
    pipCanvasCtx.fillStyle = 'rgba(255,255,255,0.6)';
    pipCanvasCtx.font = '16px sans-serif';
    pipCanvasCtx.fillText(curTrack.artist, 30, 155);

    await pipVideo.requestPictureInPicture();
    notify('🪟 Picture-in-Picture Mini Player active!');
  } catch (e) {
    notify('Picture-in-Picture not supported on this browser.');
  }
}

$('#pip-btn').addEventListener('click', togglePictureInPicture);
$('#fs-pip-btn').addEventListener('click', togglePictureInPicture);

// ---- In-App ID3 Tag Editor & Custom Artwork Uploader ----------
let currentEditArtworkBase64 = null;

function openEditTrackModal(trackId) {
  const track = trackById(trackId);
  if (!track) return;

  $('#edit-track-id').value = track.id;
  $('#edit-track-title').value = track.title || '';
  $('#edit-track-artist').value = track.artist || '';
  $('#edit-track-album').value = track.album || '';
  $('#edit-track-category').value = track.category || '';
  currentEditArtworkBase64 = null;

  const previewImg = $('#edit-art-img');
  const icon = $('#edit-art-icon');

  if (track.has_artwork && track.artwork_url) {
    previewImg.src = track.artwork_url;
    previewImg.classList.remove('hidden');
    icon.classList.add('hidden');
  } else {
    previewImg.src = '';
    previewImg.classList.add('hidden');
    icon.classList.remove('hidden');
  }

  $('#edit-track-sheet').showModal();
}

$('#edit-track-close').addEventListener('click', () => $('#edit-track-sheet').close());
$('#edit-track-cancel-btn').addEventListener('click', () => $('#edit-track-sheet').close());

$('#edit-art-preview').addEventListener('click', () => {
  $('#edit-art-input').click();
});

$('#edit-art-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (ev) => {
    currentEditArtworkBase64 = ev.target.result;
    const previewImg = $('#edit-art-img');
    const icon = $('#edit-art-icon');
    previewImg.src = currentEditArtworkBase64;
    previewImg.classList.remove('hidden');
    icon.classList.add('hidden');
  };
  reader.readAsDataURL(file);
});

$('#edit-track-save-btn').addEventListener('click', async () => {
  const trackId = $('#edit-track-id').value;
  const title = $('#edit-track-title').value.trim();
  const artist = $('#edit-track-artist').value.trim();
  const album = $('#edit-track-album').value.trim();
  const category = $('#edit-track-category').value.trim();

  if (!title) {
    return notify('Title cannot be empty.');
  }

  const saveBtn = $('#edit-track-save-btn');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving...';

  try {
    const res = await api('/api/track/edit', {
      method: 'POST',
      body: JSON.stringify({
        track_id: trackId,
        title,
        artist,
        album,
        category,
        artwork: currentEditArtworkBase64
      })
    });

    if (res.success && res.tracks) {
      state.tracks = res.tracks;
      state.categories = res.categories || [];
      saveState();

      if (queue[currentIndex]?.id === trackId) {
        $('#hero-title').innerHTML = `${escapeHtml(title)}<br><em>is playing.</em>`;
        $('#hero-artist').textContent = `${artist} · ${album}`;
        $('#fs-title').textContent = title;
        $('#fs-artist').textContent = artist;
        if (currentEditArtworkBase64) {
          $('#album-art-box').innerHTML = `<img src="${currentEditArtworkBase64}">`;
        }
      }

      if ($('#search')) {
    $('#search').value = '';
  }
  renderCategoryBar();
      renderTracks(state.tracks.filter(t => t.media_type !== 'video'));
      renderContinueRail();

      $('#edit-track-sheet').close();
      notify('✨ Track tags and artwork updated successfully!');
    }
  } catch (err) {
    notify('Failed to save track tags: ' + err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="ph ph-floppy-disk"></i> Save Changes';
  }
});

// ---- Atmospheric Vibe & Living Aura Canvas Engine ------------
const VIBE_COLOR_PALETTES = {
  cozy: ['#e5a95d', '#b45309', '#78350f', '#f59e0b'],
  ecstatic: ['#d946ef', '#6366f1', '#a855f7', '#06b6d4'],
  sakura: ['#fb7185', '#db2777', '#f43f5e', '#fda4af'],
  emerald: ['#34d399', '#059669', '#10b981', '#6ee7b7'],
  ocean: ['#38bdf8', '#2563eb', '#0284c7', '#3b82f6'],
  noir: ['#ffffff', '#a1a1aa', '#71717a', '#52525b']
};

let currentVibe = localStorage.getItem('linus_vibe') || 'cozy';

function applyVibe(vibeKey, save = true) {
  if (!VIBE_COLOR_PALETTES[vibeKey]) vibeKey = 'cozy';
  currentVibe = vibeKey;
  document.body.dataset.vibe = vibeKey;
  if (save) {
    try { localStorage.setItem('linus_vibe', vibeKey); } catch (e) {}
    if (typeof syncUserSettingsToDB === 'function') syncUserSettingsToDB({ vibe: vibeKey });
  }

  document.querySelectorAll('.vibe-preset-card').forEach(card => {
    card.classList.toggle('active', card.dataset.vibe === vibeKey);
  });

  if (vibeKey === 'cozy') {
    $('#cozy-mode-quick-btn')?.classList.add('active');
  } else {
    $('#cozy-mode-quick-btn')?.classList.remove('active');
  }

  updateLivingAuraColors();
}

// Living Fluid Aura Canvas Engine
const livingCanvas = document.getElementById('living-aura-canvas');
let livingCtx = null;
let livingOrbs = [];

let livingRaf = null;

function renderLivingFrame() {
  if (document.hidden || !livingCanvas || livingCanvas.classList.contains('hidden')) {
    livingRaf = null;
    return;
  }
  livingRaf = requestAnimationFrame(renderLivingFrame);
  if (!livingCtx) return;

  const w = livingCanvas.width;
  const h = livingCanvas.height;
  livingCtx.clearRect(0, 0, w, h);

  let bassBoost = 0;
  const curAnalyser = window.analyser || analyser;
  const curDataArray = window.audioDataArray || audioDataArray;
  if (!audio.paused && curAnalyser && curDataArray) {
    try {
      curAnalyser.getByteFrequencyData(curDataArray);
      bassBoost = (curDataArray[0] + curDataArray[1] + curDataArray[2] + curDataArray[3]) / (4 * 255);
    } catch (e) {}
  }

  const isChameleon = window._isChameleonGlowEnabled || document.body.classList.contains('chameleon-active');
  const organicSine = (Math.sin(Date.now() / 1500) * 0.5 + 0.5);

  // Smooth real-time beat + continuous organic breathing pulse
  if (isChameleon) {
    const effectivePulse = audio.paused ? (organicSine * 0.22) : (bassBoost * 0.78 + organicSine * 0.22);
    const beatGlowPx = Math.round(18 + effectivePulse * 46);
    const beatScale = (1 + (audio.paused ? (organicSine * 0.005) : (bassBoost * 0.024))).toFixed(4);
    document.documentElement.style.setProperty('--chameleon-beat-glow', `${beatGlowPx}px`);
    document.documentElement.style.setProperty('--chameleon-beat-scale', `${beatScale}`);
  }

  livingCtx.save();
  livingCtx.globalCompositeOperation = 'screen';

  livingOrbs.forEach(orb => {
    // Smooth color transition lerp across tracks
    orb.r += (orb.targetR - orb.r) * 0.055;
    orb.g += (orb.targetG - orb.g) * 0.055;
    orb.b += (orb.targetB - orb.b) * 0.055;
    orb.alpha += (orb.targetAlpha - orb.alpha) * 0.055;

    orb.phase += 0.0085 * (orb.speedMult || 1);
    orb.x += orb.vx + Math.sin(orb.phase) * 0.35;
    orb.y += orb.vy + Math.cos(orb.phase * 0.8) * 0.35;

    if (orb.x < -orb.radius) orb.x = w + orb.radius;
    if (orb.x > w + orb.radius) orb.x = -orb.radius;
    if (orb.y < -orb.radius) orb.y = h + orb.radius;
    if (orb.y > h + orb.radius) orb.y = -orb.radius;

    const dynamicRadius = orb.radius * (1 + Math.sin(orb.phase) * 0.16 + (audio.paused ? organicSine * 0.08 : bassBoost * 0.38));
    const cr = Math.round(orb.r);
    const cg = Math.round(orb.g);
    const cb = Math.round(orb.b);
    const calpha = Math.min(0.85, orb.alpha * (1 + (audio.paused ? organicSine * 0.12 : bassBoost * 0.32)));

    const grad = livingCtx.createRadialGradient(orb.x, orb.y, 0, orb.x, orb.y, dynamicRadius);
    grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${calpha.toFixed(3)})`);
    grad.addColorStop(0.48, `rgba(${cr}, ${cg}, ${cb}, ${(calpha * 0.42).toFixed(3)})`);
    grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);

    livingCtx.fillStyle = grad;
    livingCtx.beginPath();
    livingCtx.arc(orb.x, orb.y, dynamicRadius, 0, Math.PI * 2);
    livingCtx.fill();
  });

  livingCtx.restore();
}

function resumeLivingAura() {
  if (!livingRaf && livingCanvas && !livingCanvas.classList.contains('hidden') && !document.hidden) {
    renderLivingFrame();
  }
}

function initLivingAuraEngine() {
  if (!livingCanvas) return;
  livingCtx = livingCanvas.getContext('2d');

  function resizeLiving() {
    livingCanvas.width = window.innerWidth;
    livingCanvas.height = window.innerHeight;
  }
  window.addEventListener('resize', resizeLiving);
  resizeLiving();

  const orbCount = 6;
  livingOrbs = [];
  window.livingOrbs = livingOrbs;

  for (let i = 0; i < orbCount; i++) {
    livingOrbs.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.42,
      vy: (Math.random() - 0.5) * 0.42,
      radius: Math.random() * 280 + 250,
      r: 229, g: 169, b: 93,
      targetR: 229, targetG: 169, targetB: 93,
      alpha: 0.55, targetAlpha: 0.55,
      phase: Math.random() * Math.PI * 2,
      speedMult: 0.75 + Math.random() * 0.5
    });
  }

  updateLivingAuraColors();

  if (window._isChameleonGlowEnabled && window._currentChameleonPalette) {
    updateLivingAuraColors(window._currentChameleonPalette);
  }

  resumeLivingAura();
}

function updateLivingAuraColors(customChameleonPalette = null) {
  const activePal = customChameleonPalette || window._currentChameleonPalette;
  if (window._isChameleonGlowEnabled && activePal && activePal.primary && livingOrbs.length > 0) {
    const [r1, g1, b1] = activePal.primary;
    const [r2, g2, b2] = activePal.secondary;
    const [r3, g3, b3] = activePal.accent || [Math.round((r1 + r2) / 2), Math.round((g1 + g2) / 2), Math.round((b1 + b2) / 2)];

    const paletteTargets = [
      { r: r1, g: g1, b: b1, a: 0.62 },
      { r: r2, g: g2, b: b2, a: 0.54 },
      { r: r3, g: g3, b: b3, a: 0.58 },
      { r: r1, g: g1, b: b1, a: 0.48 },
      { r: r2, g: g2, b: b2, a: 0.50 },
      { r: r3, g: g3, b: b3, a: 0.46 }
    ];
    livingOrbs.forEach((orb, i) => {
      const target = paletteTargets[i % paletteTargets.length];
      orb.targetR = target.r;
      orb.targetG = target.g;
      orb.targetB = target.b;
      orb.targetAlpha = target.a;
    });
    return;
  }

  const palette = VIBE_COLOR_PALETTES[currentVibe] || VIBE_COLOR_PALETTES.cozy;
  livingOrbs.forEach((orb, i) => {
    const col = palette[i % palette.length];
    let parsed = [229, 169, 93];
    if (col && col.startsWith('#')) {
      parsed = [
        parseInt(col.slice(1, 3), 16) || 229,
        parseInt(col.slice(3, 5), 16) || 169,
        parseInt(col.slice(5, 7), 16) || 93
      ];
    }
    orb.targetR = parsed[0];
    orb.targetG = parsed[1];
    orb.targetB = parsed[2];
    orb.targetAlpha = 0.42;
  });
}
window.updateLivingAuraColors = updateLivingAuraColors;

// Vibe Popover Trigger
const themeBtn = $('#theme-button');
const vibePopover = $('#vibe-popover');

if (themeBtn && vibePopover) {
  themeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    vibePopover.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.vibe-switcher-wrapper')) {
      vibePopover.classList.remove('show');
    }
  });

  document.querySelectorAll('.vibe-preset-card').forEach(card => {
    card.addEventListener('click', () => {
      applyVibe(card.dataset.vibe);
      vibePopover.classList.remove('show');
      notify(`✨ Switched vibe to ${card.querySelector('strong').textContent}`);
    });
  });
}

// 1-Click Cozy Mode Toggle
let isCozyModeActive = false;
const cozyQuickBtn = $('#cozy-mode-quick-btn');

if (cozyQuickBtn) {
  cozyQuickBtn.addEventListener('click', () => {
    isCozyModeActive = !isCozyModeActive;
    if (isCozyModeActive) {
      applyVibe('cozy');
      ambientEngine.ensureContext();
      ambientEngine.setVolume('rain', 0.16);
      ambientEngine.setVolume('fire', 0.14);
      $('#vol-rain-val').textContent = '16%';
      $('#vol-fire-val').textContent = '14%';
      $('#ambient-rain-slider').value = 0.16;
      $('#ambient-fire-slider').value = 0.14;
      $('#card-rain').classList.add('active');
      $('#card-fire').classList.add('active');
      cozyQuickBtn.classList.add('active');
      notify('☕ Cozy Listening Mode Activated (Rain + Fireplace)');
    } else {
      ambientEngine.setVolume('rain', 0);
      ambientEngine.setVolume('fire', 0);
      $('#vol-rain-val').textContent = '0%';
      $('#vol-fire-val').textContent = '0%';
      $('#ambient-rain-slider').value = 0;
      $('#ambient-fire-slider').value = 0;
      $('#card-rain').classList.remove('active');
      $('#card-fire').classList.remove('active');
      cozyQuickBtn.classList.remove('active');
      notify('Cozy Mode Deactivated');
    }
  });
}

// Initialize Vibe and Living Aura on startup
// ============================================================
// ============================================================
// Procedural Live Motion Canvas Engine
// Modularized into /static/visualizers.js (v1.0)
// ============================================================
window.initProceduralLiveMotion = window.initProceduralLiveMotion || function() {};
window.startMotionAnimationLoop = window.startMotionAnimationLoop || function() {};

// Global Tab Visibility Performance Controller
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    if (!audio.paused) {
      startAudioVisualizer();
      if (is8DActive) run8DSpatialLoop();
    }
    startMotionAnimationLoop();
    if (typeof resumeLivingAura === 'function') resumeLivingAura();
  }
});

// ============================================================
// Personalization Studio & Live Atmosphere Engine
// Modularized into /static/theme_studio.js (v1.0)
// Manages: Real-Time Color Palette, Fullscreen Dedicated Customizer,
// IndexedDB 4K/8K Wallpapers, and 50+ Curated Wallpaper Gallery.
// ============================================================
window.applyUserTheme = window.applyUserTheme || function() {};
window.applyFullscreenTheme = window.applyFullscreenTheme || function() {};
window.openWallpaperGallery = window.openWallpaperGallery || function() {};

// ============================================================
// Click-Outside Auto-Dismiss & Auto-Save for All Modals / Dialogs
// ============================================================
document.querySelectorAll('dialog').forEach(dialog => {
  dialog.addEventListener('click', (e) => {
    // When clicking directly on the dialog element (the backdrop area outside the inner container)
    const rect = dialog.getBoundingClientRect();
    const isInDialog = (
      e.clientX >= rect.left &&
      e.clientX <= rect.right &&
      e.clientY >= rect.top &&
      e.clientY <= rect.bottom
    );

    // If click occurred on the backdrop area outside the content box
    if (!isInDialog || e.target === dialog) {
      dialog.close();
      if (dialog.id === 'theme-studio-sheet' || dialog.id === 'fs-theme-studio-sheet') {
        notify('✨ Changes saved and applied!');
      }
    }
  });
});

// Video Modal Backdrop Click-Outside
$('#video-modal-backdrop')?.addEventListener('click', () => {
  $('#video-modal')?.classList.add('hidden');
  const vp = $('#video-player');
  if (vp) vp.pause();
  const ytp = $('#youtube-video-player');
  if (ytp) ytp.src = '';
});

// ============================================================
// Real-Time Live Slider Dragging Peek Transparency
// ============================================================
function initSliderPeekTransparency() {
  document.querySelectorAll('input[type="range"]').forEach(slider => {
    const dialog = slider.closest('dialog');
    if (!dialog) return;

    const startPeek = () => {
      dialog.classList.add('slider-peek-active');
    };

    const stopPeek = () => {
      dialog.classList.remove('slider-peek-active');
    };

    slider.addEventListener('pointerdown', startPeek);
    slider.addEventListener('mousedown', startPeek);
    slider.addEventListener('touchstart', startPeek, { passive: true });

    slider.addEventListener('pointerup', stopPeek);
    slider.addEventListener('mouseup', stopPeek);
    slider.addEventListener('touchend', stopPeek);
    slider.addEventListener('change', stopPeek);
    slider.addEventListener('blur', stopPeek);
  });

  // Global safety release if dragged and released outside slider bounds
  window.addEventListener('pointerup', () => {
    document.querySelectorAll('dialog.slider-peek-active').forEach(d => d.classList.remove('slider-peek-active'));
  });
  window.addEventListener('mouseup', () => {
    document.querySelectorAll('dialog.slider-peek-active').forEach(d => d.classList.remove('slider-peek-active'));
  });
  window.addEventListener('touchend', () => {
    document.querySelectorAll('dialog.slider-peek-active').forEach(d => d.classList.remove('slider-peek-active'));
  });
}

// Initialize Full Screen theme & Wallpapers on boot (guarded for modular subsystems)
if (typeof renderFeaturedWallpapersTray === 'function') renderFeaturedWallpapersTray();
if (typeof initProceduralLiveMotion === 'function') initProceduralLiveMotion();
if (typeof initSliderPeekTransparency === 'function') initSliderPeekTransparency();
if (typeof updateRadioModeUI === 'function') updateRadioModeUI();
if (typeof updateAudioNormUI === 'function') updateAudioNormUI();
if (typeof updateKaraokeUI === 'function') updateKaraokeUI();
if (typeof updateChameleonUI === 'function') updateChameleonUI();
if (typeof initHoverPreview === 'function') initHoverPreview();
if (typeof initWeeklyRewind === 'function') initWeeklyRewind();
if (typeof initStreakHeatmap === 'function') initStreakHeatmap();
if (typeof initVibeCompass === 'function') initVibeCompass();
if (typeof applyFullscreenTheme === 'function' && typeof fsTheme !== 'undefined') applyFullscreenTheme(fsTheme, false);

// Launch smooth introductory sidebar roll-out animation & check pinned state
initSidebarRolloutIntro();

// ============================================================
// Welcome Quote Splash Engine (Offline-First & Zero-Latency)
// ============================================================

const BUNDLED_INSPIRATIONAL_QUOTES = [
  { text: "Knowing yourself is the beginning of all wisdom.", author: "Aristotle", tag: "Wisdom" },
  { text: "You have power over your mind - not outside events. Realize this, and you will find strength.", author: "Marcus Aurelius", tag: "Philosophy" },
  { text: "We suffer more often in imagination than in reality.", author: "Seneca", tag: "Stoicism" },
  { text: "The journey of a thousand miles begins with a single step.", author: "Lao Tzu", tag: "Wisdom" },
  { text: "In the depth of winter, I finally learned that within me there lay an invincible summer.", author: "Albert Camus", tag: "Resilience" },
  { text: "Smile, breathe, and go slowly.", author: "Thich Nhat Hanh", tag: "Mindfulness" },
  { text: "Muddy water is best cleared by leaving it alone.", author: "Alan Watts", tag: "Peace" },
  { text: "Your time is limited, so don't waste it living someone else's life.", author: "Steve Jobs", tag: "Purpose" },
  { text: "Be like water making its way through cracks. Do not be assertive, but adjust to the object.", author: "Bruce Lee", tag: "Courage" },
  { text: "It always seems impossible until it's done.", author: "Nelson Mandela", tag: "Resilience" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci", tag: "Design" },
  { text: "Creativity is intelligence having fun.", author: "Albert Einstein", tag: "Creativity" },
  { text: "Adopt the pace of nature: her secret is patience.", author: "Ralph Waldo Emerson", tag: "Nature" },
  { text: "Somewhere, something incredible is waiting to be known.", author: "Carl Sagan", tag: "Wonder" },
  { text: "Dwell on the beauty of life. Watch the stars, and see yourself running with them.", author: "Marcus Aurelius", tag: "Wonder" },
  { text: "Look up at the stars and not down at your feet. Try to make sense of what you see.", author: "Stephen Hawking", tag: "Curiosity" },
  { text: "Twenty years from now you will be more disappointed by the things that you didn't do than by the ones you did do.", author: "Mark Twain", tag: "Life" },
  { text: "Beauty will save the world.", author: "Fyodor Dostoevsky", tag: "Humanity" },
  { text: "The wound is the place where the Light enters you.", author: "Rumi", tag: "Spiritual" },
  { text: "Music is the silence between the notes.", author: "Claude Debussy", tag: "Acoustics" },
  { text: "Where words fail, music speaks.", author: "Hans Christian Andersen", tag: "Music" },
  { text: "There is nothing more musical than a sunset.", author: "Claude Debussy", tag: "Atmosphere" },
  { text: "Everything in the universe has a rhythm, everything dances.", author: "Maya Angelou", tag: "Rhythm" },
  { text: "Live in the sunshine, swim the sea, drink the wild air.", author: "Ralph Waldo Emerson", tag: "Life" },
  { text: "Silence is an answer too.", author: "Rumi", tag: "Peace" }
];

let quoteSplashIsDismissed = false;

function getRandomLocalQuote() {
  return BUNDLED_INSPIRATIONAL_QUOTES[Math.floor(Math.random() * BUNDLED_INSPIRATIONAL_QUOTES.length)];
}

function dismissQuoteSplash() {
  if (quoteSplashIsDismissed) return;
  quoteSplashIsDismissed = true;
  window.quoteSplashIsDismissed = true;
  window.quoteSplashDismissedAt = Date.now();

  const overlay = $('#quote-splash-overlay');
  if (!overlay) return;

  // Unfocus active button immediately so focus doesn't jump to topbar search or background inputs
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }

  overlay.classList.add('dissolve');
  overlay.style.pointerEvents = 'none';

  // Mark today's date so "daily" frequency knows it was shown today
  const todayStr = new Date().toISOString().slice(0, 10);
  try {
    localStorage.setItem('linus_last_quote_date', todayStr);
  } catch (e) {}

  setTimeout(() => {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  }, 320);
}
window.dismissQuoteSplash = dismissQuoteSplash;

function renderSplashQuote(quote, animate = false) {
  const textEl = $('#quote-splash-text');
  const authorEl = $('#quote-splash-author');
  const tagEl = $('#quote-splash-tag');
  if (!textEl || !authorEl || !quote) return;

  const cleanText = quote.text ? quote.text.replace(/^[“"]|[”"]$/g, '') : '';

  if (animate) {
    textEl.classList.add('quote-fade-out');
    $('#quote-splash-meta')?.classList.add('quote-fade-out');
    setTimeout(() => {
      textEl.textContent = `“${cleanText}”`;
      authorEl.textContent = quote.author || 'Anonymous';
      if (tagEl) tagEl.textContent = quote.tag ? quote.tag.toUpperCase() : 'INSPIRATION';
      textEl.classList.remove('quote-fade-out');
      $('#quote-splash-meta')?.classList.remove('quote-fade-out');
    }, 220);
  } else {
    textEl.textContent = `“${cleanText}”`;
    authorEl.textContent = quote.author || 'Anonymous';
    if (tagEl) tagEl.textContent = quote.tag ? quote.tag.toUpperCase() : 'INSPIRATION';
  }
}

window.shuffleSplashQuote = async function() {
  try {
    const res = await fetch('/api/quote/random');
    if (res.ok) {
      const q = await res.json();
      renderSplashQuote(q, true);
    } else {
      renderSplashQuote(getRandomLocalQuote(), true);
    }
  } catch {
    renderSplashQuote(getRandomLocalQuote(), true);
  }
};

function initQuoteSplash() {
  const overlay = $('#quote-splash-overlay');
  if (!overlay) return;

  // Check user settings with safe fallbacks
  let userThemeObj = {};
  try {
    userThemeObj = window.userTheme || JSON.parse(localStorage.getItem('linus_custom_theme') || '{}') || {};
  } catch (e) {}

  const isEnabled = (localStorage.getItem('linus_welcome_quote') !== 'false') && (userThemeObj.welcomeQuote !== false);
  if (!isEnabled) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
    quoteSplashIsDismissed = true;
    return;
  }

  const frequency = localStorage.getItem('linus_welcome_quote_freq') || userThemeObj.welcomeQuoteFrequency || 'always';
  const todayStr = new Date().toISOString().slice(0, 10);
  const lastShownDate = localStorage.getItem('linus_last_quote_date');

  if (frequency === 'daily' && lastShownDate === todayStr) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
    quoteSplashIsDismissed = true;
    return;
  }

  // 1. Instant 0ms render from offline bundle
  const initialQuote = getRandomLocalQuote();
  renderSplashQuote(initialQuote, false);

  // 2. Fetch fresh quote from backend in parallel if online
  fetch('/api/quote/random')
    .then(r => r.ok ? r.json() : null)
    .then(q => {
      if (q && q.text && !quoteSplashIsDismissed) {
        renderSplashQuote(q, false);
      }
    })
    .catch(() => {}); // Gracefully fallback to bundled quote

  // 3. Dismiss on screen touch or click anywhere
  const handleDismissInteraction = (e) => {
    // If user tapped/clicked shuffle button or its children, don't dismiss!
    if (e.target.closest('#quote-splash-shuffle-btn')) return;
    dismissQuoteSplash();
  };

  overlay.addEventListener('click', handleDismissInteraction);

  $('#quote-splash-enter-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissQuoteSplash();
  });

  $('#quote-splash-corner-skip')?.addEventListener('click', (e) => {
    e.stopPropagation();
    dismissQuoteSplash();
  });

  // 4. Shuffle button interaction
  $('#quote-splash-shuffle-btn')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    window.shuffleSplashQuote();
  });

  // 5. Global Keyboard Shortcuts for instant entry (Space, Enter, Escape) in capture phase
  const onQuoteKeydown = (e) => {
    if (quoteSplashIsDismissed) {
      window.removeEventListener('keydown', onQuoteKeydown, true);
      return;
    }
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Enter' || e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      dismissQuoteSplash();
      window.removeEventListener('keydown', onQuoteKeydown, true);
    }
  };
  window.addEventListener('keydown', onQuoteKeydown, true);
}

function initExploreQuoteCard() {
  const quoteText = $('#explore-quote-text');
  const quoteAuthor = $('#explore-quote-author');
  const refreshBtn = $('#explore-quote-refresh-btn');
  if (!quoteText || !quoteAuthor) return;

  const updateCard = (quote, animate = true) => {
    if (animate) {
      quoteText.style.opacity = '0';
      quoteAuthor.style.opacity = '0';
      setTimeout(() => {
        quoteText.textContent = `“${quote.text.replace(/^[“"]|[”"]$/g, '')}”`;
        quoteAuthor.textContent = `— ${quote.author || 'Anonymous'}`;
        quoteText.style.opacity = '1';
        quoteAuthor.style.opacity = '1';
      }, 200);
    } else {
      quoteText.textContent = `“${quote.text.replace(/^[“"]|[”"]$/g, '')}”`;
      quoteAuthor.textContent = `— ${quote.author || 'Anonymous'}`;
    }
  };

  // Initial load: try daily quote
  fetch('/api/quote/daily')
    .then(r => r.ok ? r.json() : null)
    .then(q => {
      if (q && q.text) updateCard(q, false);
      else updateCard(getRandomLocalQuote(), false);
    })
    .catch(() => {
      updateCard(getRandomLocalQuote(), false);
    });

  // Refresh button
  refreshBtn?.addEventListener('click', async () => {
    try {
      const r = await fetch('/api/quote/random');
      if (r.ok) {
        const q = await r.json();
        updateCard(q, true);
      } else {
        updateCard(getRandomLocalQuote(), true);
      }
    } catch {
      updateCard(getRandomLocalQuote(), true);
    }
  });
}

// Launch Welcome Quote Splash & Explore Quote card & Living Aura Engine
initQuoteSplash();
initExploreQuoteCard();
initLivingAuraEngine();

// Expose core player APIs to global window
window.renderRecShelf = renderRecShelf;
window.renderQuickLaunchGrid = renderQuickLaunchGrid;
window.renderDailyCapsules = renderDailyCapsules;
window.renderSonicDnaCard = renderSonicDnaCard;
window.renderRecCard = renderRecCard;
window.playById = playById;
window.renderQueue = renderQueue;
window.togglePlayGlobal = togglePlayGlobal;
window.startTrackRadio = startTrackRadio;
window.startAutoDJCrossfade = startAutoDJCrossfade;
