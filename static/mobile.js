/**
 * Linus Mobile Engine (v2.0)
 * Clean, separated YouTube streaming & Local storage playback.
 * Apple Music Frosted Glassmorphism + Spotify Mobile Dark UX.
 */

(function () {
  'use strict';

  // State Management
  const state = {
    currentTab: 'view-youtube',
    currentTrack: null,
    isPlaying: false,
    isShuffle: false,
    repeatMode: 'off', // 'off' | 'all' | 'one'
    queue: [],
    history: JSON.parse(localStorage.getItem('linus_mobile_history') || '[]'),
    favorites: new Set(JSON.parse(localStorage.getItem('linus_mobile_favs') || '[]')),
    
    // Separate Media Stores
    localTracks: [],
    youtubeTracks: [],
    searchResults: [],
    
    // Active Filters
    localFilter: 'all', // 'all' | 'artists' | 'albums' | 'folders'
    searchSource: 'yt', // 'yt' | 'local'
    
    // Lyrics & Sleep Timer
    syncedLyrics: [],
    sleepTimerId: null,
    sleepTimerEndTimestamp: null,
    sleepTimerMode: null, // 'minutes' | 'end_of_track'
    
    // Touch tracking for gestures
    touchStartY: 0,
    touchStartX: 0,
    isDraggingScrubber: false,
  };

  // DOM Elements
  const audio = document.getElementById('global-audio-player');
  const miniPlayer = document.getElementById('mini-player');
  const fullPlayer = document.getElementById('full-player-sheet');
  const toast = document.getElementById('mobile-toast');
  const toastText = document.getElementById('toast-text');

  // Mini Player Elements
  const miniArt = document.getElementById('mini-art-img');
  const miniTitle = document.getElementById('mini-track-title');
  const miniArtist = document.getElementById('mini-track-artist');
  const miniPlayIcon = document.getElementById('mini-play-icon');
  const miniProgressFill = document.getElementById('mini-progress-fill');
  const miniSourceBadge = document.getElementById('mini-source-badge');

  // Full Player Elements
  const fullArt = document.getElementById('full-artwork-img');
  const fullTitle = document.getElementById('full-track-title');
  const fullArtist = document.getElementById('full-track-artist');
  const fullPlayIcon = document.getElementById('full-play-icon');
  const fullFavIcon = document.getElementById('full-fav-icon');
  const fullBtnFav = document.getElementById('full-btn-fav');
  const fullSourcePill = document.getElementById('sheet-source-pill');
  const fullTimeElapsed = document.getElementById('full-time-elapsed');
  const fullTimeRemaining = document.getElementById('full-time-remaining');
  const fullScrubSlider = document.getElementById('full-scrub-slider');
  const fullBtnShuffle = document.getElementById('full-btn-shuffle');
  const fullBtnRepeat = document.getElementById('full-btn-repeat');
  const fullRepeatIcon = document.getElementById('full-repeat-icon');
  const saveLocalBtn = document.getElementById('btn-save-to-local');
  const saveLocalLabel = document.getElementById('save-local-label');
  const saveLocalIcon = document.getElementById('save-local-icon');

  // Synced Lyrics Elements
  const lyricsContainer = document.getElementById('full-lyrics-container');
  const lyricsWrapper = document.getElementById('lyrics-lines-wrapper');
  const btnToggleLyrics = document.getElementById('btn-toggle-lyrics');
  const btnCloseLyrics = document.getElementById('btn-close-lyrics-view');

  // Sleep Timer Elements
  const sleepSheet = document.getElementById('sleep-timer-sheet');
  const sleepBtnLabel = document.getElementById('sleep-btn-label');
  const sleepTimerCardStatus = document.getElementById('sleep-timer-card-status');
  const sleepBadgeHeader = document.getElementById('sleep-badge-header');

  // Queue Elements
  const queueSheet = document.getElementById('queue-sheet');
  const queueCount = document.getElementById('queue-count');
  const queueTracksList = document.getElementById('queue-tracks-list');
  const queueCurrentTrackItem = document.getElementById('queue-current-track-item');

  // =========================================================================
  // Utilities
  // =========================================================================
  function haptic(ms = 10) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (_) {}
    }
  }

  function showToast(msg, iconClass = 'ph-bold ph-info') {
    toastText.textContent = msg;
    const icon = document.getElementById('toast-icon');
    if (icon) icon.className = iconClass;
    toast.classList.remove('hidden');
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.classList.add('hidden');
    }, 2800);
  }

  function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  function saveStatePersistence() {
    localStorage.setItem('linus_mobile_favs', JSON.stringify(Array.from(state.favorites)));
    localStorage.setItem('linus_mobile_history', JSON.stringify(state.history.slice(0, 50)));
  }

  // =========================================================================
  // Navigation & Tabs
  // =========================================================================
  function initNavigation() {
    const tabs = document.querySelectorAll('.mobile-tab-bar .tab-item');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetId = tab.getAttribute('data-tab');
        switchTab(targetId);
        haptic(8);
      });
    });

    // Sub-segment filters for Local
    const localSegments = document.querySelectorAll('#view-local .segment-btn');
    localSegments.forEach(btn => {
      btn.addEventListener('click', () => {
        localSegments.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.localFilter = btn.getAttribute('data-filter');
        renderLocalTracks();
        haptic(6);
      });
    });

    // Unified Search Source Toggle (Separates YouTube vs Local)
    const ytToggle = document.getElementById('search-toggle-yt');
    const localToggle = document.getElementById('search-toggle-local');
    const unifiedInput = document.getElementById('unified-search-input');

    ytToggle.addEventListener('click', () => {
      ytToggle.classList.add('active');
      localToggle.classList.remove('active');
      state.searchSource = 'yt';
      unifiedInput.placeholder = 'Search YouTube Music...';
      performUnifiedSearch(unifiedInput.value.trim());
      haptic(6);
    });

    localToggle.addEventListener('click', () => {
      localToggle.classList.add('active');
      ytToggle.classList.remove('active');
      state.searchSource = 'local';
      unifiedInput.placeholder = 'Search Local Storage songs, artists...';
      performUnifiedSearch(unifiedInput.value.trim());
      haptic(6);
    });

    // Library Sub-tabs
    const libFavs = document.getElementById('lib-tab-favs');
    const libCached = document.getElementById('lib-tab-cached');
    const libRecents = document.getElementById('lib-tab-recents');

    [libFavs, libCached, libRecents].forEach(btn => {
      btn.addEventListener('click', () => {
        [libFavs, libCached, libRecents].forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        if (btn === libFavs) renderFavoritesList();
        else if (btn === libCached) renderCachedDownloadsList();
        else if (btn === libRecents) renderHistoryList();
        haptic(6);
      });
    });
  }

  function switchTab(tabId) {
    state.currentTab = tabId;
    document.querySelectorAll('.mobile-view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.mobile-tab-bar .tab-item').forEach(t => {
      t.classList.toggle('active', t.getAttribute('data-tab') === tabId);
    });

    const activeView = document.getElementById(tabId);
    if (activeView) activeView.classList.add('active');

    if (tabId === 'view-library') {
      updateLibraryStats();
      renderFavoritesList();
    }
  }

  // =========================================================================
  // YouTube Section (Dedicated Streaming & Search)
  // =========================================================================
  function initYouTubeSection() {
    const searchInput = document.getElementById('yt-search-input');
    const clearBtn = document.getElementById('yt-search-clear');
    const vibeChips = document.querySelectorAll('.vibe-chip');

    searchInput.addEventListener('input', () => {
      clearBtn.classList.toggle('hidden', searchInput.value.length === 0);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const q = searchInput.value.trim();
        if (q) {
          fetchYouTubeTracks(q);
          searchInput.blur();
          haptic(10);
        }
      }
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.classList.add('hidden');
      searchInput.focus();
    });

    vibeChips.forEach(chip => {
      chip.addEventListener('click', () => {
        vibeChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const q = chip.getAttribute('data-query');
        searchInput.value = '';
        clearBtn.classList.add('hidden');
        fetchYouTubeTracks(q);
        haptic(8);
      });
    });

    // Initial Trending Load
    fetchYouTubeTracks('Trending Music 2026');
  }

  async function fetchYouTubeTracks(query) {
    const loader = document.getElementById('yt-loader');
    const list = document.getElementById('yt-tracks-list');
    const titleEl = document.getElementById('yt-section-title');
    const countEl = document.getElementById('yt-results-count');

    loader.classList.remove('hidden');
    list.innerHTML = '';
    titleEl.textContent = query.length > 25 ? `Results for "${query.slice(0, 22)}..."` : query;

    try {
      const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=16`);
      const data = await res.json();
      state.youtubeTracks = (data.results || []).map(item => ({
        id: item.id.startsWith('yt:') ? item.id : `yt:${item.id}`,
        cleanId: item.id.replace('yt:', ''),
        title: item.title,
        artist: item.artist || 'YouTube',
        album: 'YouTube Stream',
        duration: item.duration || 0,
        thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.id.replace('yt:', '')}/hqdefault.jpg`,
        url: `/api/youtube/stream/${item.id.replace('yt:', '')}`,
        source: 'youtube',
      }));

      countEl.textContent = `${state.youtubeTracks.length} tracks`;
      renderYouTubeTracks();
    } catch (err) {
      list.innerHTML = `<div class="empty-state"><p>Could not connect to YouTube stream. Check server connection.</p></div>`;
    } finally {
      loader.classList.add('hidden');
    }
  }

  function renderYouTubeTracks() {
    const list = document.getElementById('yt-tracks-list');
    list.innerHTML = '';

    if (state.youtubeTracks.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>No songs found on YouTube.</p></div>`;
      return;
    }

    state.youtubeTracks.forEach(track => {
      const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
      const card = document.createElement('div');
      card.className = `yt-card ${isCurrent ? 'playing' : ''}`;
      card.innerHTML = `
        <div class="yt-thumb-wrap">
          <img src="${track.thumbnail}" alt="" class="yt-thumb-img" loading="lazy">
          <span class="yt-dur-pill">${formatTime(track.duration)}</span>
        </div>
        <div class="yt-card-info">
          <h4 class="yt-card-title">${escapeHtml(track.title)}</h4>
          <span class="yt-card-channel">${escapeHtml(track.artist)}</span>
          <span class="yt-card-badge"><i class="ph-fill ph-youtube-logo"></i> Instant Stream</span>
        </div>
        <div class="yt-card-actions">
          <button class="card-btn download-btn" title="Save to Local Storage">
            <i class="ph-bold ph-download-simple"></i>
          </button>
          <button class="card-btn fav-btn ${state.favorites.has(track.id) ? 'text-red' : ''}" title="Favorite">
            <i class="${state.favorites.has(track.id) ? 'ph-fill' : 'ph-bold'} ph-heart"></i>
          </button>
        </div>
      `;

      // Play on card tap
      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-btn')) return;
        playTrack(track, state.youtubeTracks);
        haptic(12);
      });

      // Download / Save to Local
      const dlBtn = card.querySelector('.download-btn');
      dlBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        triggerDownloadToLocal(track, dlBtn);
        haptic(8);
      });

      // Favorite toggle
      const favBtn = card.querySelector('.fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track);
        favBtn.classList.toggle('text-red', state.favorites.has(track.id));
        const icon = favBtn.querySelector('i');
        icon.className = state.favorites.has(track.id) ? 'ph-fill ph-heart' : 'ph-bold ph-heart';
        haptic(8);
      });

      list.appendChild(card);
    });
  }

  // =========================================================================
  // Local Storage Section (100% Offline Playback)
  // =========================================================================
  function initLocalSection() {
    const searchInput = document.getElementById('local-search-input');
    const clearBtn = document.getElementById('local-search-clear');
    const rescanBtn = document.getElementById('btn-rescan-local');
    const playAllBtn = document.getElementById('btn-play-all-local');
    const shuffleBtn = document.getElementById('btn-shuffle-local');
    const goToYtBtn = document.getElementById('btn-go-to-youtube');

    searchInput.addEventListener('input', () => {
      clearBtn.classList.toggle('hidden', searchInput.value.length === 0);
      renderLocalTracks(searchInput.value.trim().toLowerCase());
    });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      clearBtn.classList.add('hidden');
      renderLocalTracks();
    });

    rescanBtn.addEventListener('click', async () => {
      haptic(10);
      showToast('Rescanning local device storage...');
      await fetchLocalLibrary(true);
    });

    playAllBtn.addEventListener('click', () => {
      if (state.localTracks.length > 0) {
        state.isShuffle = false;
        fullBtnShuffle.classList.remove('active');
        playTrack(state.localTracks[0], state.localTracks);
        haptic(10);
      }
    });

    shuffleBtn.addEventListener('click', () => {
      if (state.localTracks.length > 0) {
        state.isShuffle = true;
        fullBtnShuffle.classList.add('active');
        const shuffled = [...state.localTracks].sort(() => Math.random() - 0.5);
        playTrack(shuffled[0], shuffled);
        haptic(10);
      }
    });

    if (goToYtBtn) {
      goToYtBtn.addEventListener('click', () => switchTab('view-youtube'));
    }

    // Initial Local Load
    fetchLocalLibrary();
  }

  async function fetchLocalLibrary(forceRescan = false) {
    const loader = document.getElementById('local-loader');
    const emptyState = document.getElementById('local-empty-state');
    loader.classList.remove('hidden');

    try {
      if (forceRescan) {
        await fetch('/api/rescan', { method: 'POST' });
      }
      const res = await fetch('/api/library');
      const data = await res.json();
      
      state.localTracks = (data.tracks || []).map(item => ({
        id: item.id,
        cleanId: item.id,
        title: item.title,
        artist: item.artist || 'Local Collection',
        album: item.album || 'Local Storage',
        genre: item.genre || 'Local',
        duration: item.duration || 0,
        thumbnail: item.has_artwork ? item.artwork_url : '',
        url: item.url,
        source: 'local',
      }));

      const statusText = document.getElementById('local-status-text');
      if (statusText) {
        statusText.textContent = `${state.localTracks.length} Songs • 100% Offline`;
      }

      emptyState.classList.toggle('hidden', state.localTracks.length > 0);
      renderLocalTracks();
      updateLibraryStats();
    } catch (err) {
      console.error('Error loading local library:', err);
    } finally {
      loader.classList.add('hidden');
    }
  }

  function renderLocalTracks(filterQuery = '') {
    const list = document.getElementById('local-tracks-list');
    list.innerHTML = '';

    let tracks = state.localTracks;
    if (filterQuery) {
      tracks = tracks.filter(t => 
        t.title.toLowerCase().includes(filterQuery) || 
        t.artist.toLowerCase().includes(filterQuery) ||
        t.album.toLowerCase().includes(filterQuery)
      );
    }

    if (tracks.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>No local songs matching filter.</p></div>`;
      return;
    }

    tracks.forEach(track => {
      const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
      const item = document.createElement('div');
      item.className = `local-track-item ${isCurrent ? 'playing' : ''}`;
      item.innerHTML = `
        <div class="local-art-wrap">
          ${track.thumbnail ? `<img src="${track.thumbnail}" alt="" class="local-art-img" loading="lazy">` : `<i class="ph-fill ph-music-note"></i>`}
        </div>
        <div class="local-meta-wrap">
          <h4 class="local-title">${escapeHtml(track.title)}</h4>
          <p class="local-subtitle">${escapeHtml(track.artist)} • ${escapeHtml(track.album)}</p>
        </div>
        <span class="local-duration">${formatTime(track.duration)}</span>
        <button class="card-btn fav-btn ${state.favorites.has(track.id) ? 'text-red' : ''}">
          <i class="${state.favorites.has(track.id) ? 'ph-fill' : 'ph-bold'} ph-heart"></i>
        </button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-btn')) return;
        playTrack(track, tracks);
        haptic(10);
      });

      const favBtn = item.querySelector('.fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track);
        favBtn.classList.toggle('text-red', state.favorites.has(track.id));
        const icon = favBtn.querySelector('i');
        icon.className = state.favorites.has(track.id) ? 'ph-fill ph-heart' : 'ph-bold ph-heart';
        haptic(8);
      });

      list.appendChild(item);
    });
  }

  // =========================================================================
  // Unified Search (Separates YouTube vs Local with Tab Toggle)
  // =========================================================================
  function initUnifiedSearch() {
    const input = document.getElementById('unified-search-input');
    const clearBtn = document.getElementById('unified-search-clear');
    let debounceTimer;

    input.addEventListener('input', () => {
      clearBtn.classList.toggle('hidden', input.value.length === 0);
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performUnifiedSearch(input.value.trim());
      }, 350);
    });

    clearBtn.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.add('hidden');
      performUnifiedSearch('');
    });
  }

  async function performUnifiedSearch(query) {
    const list = document.getElementById('search-results-list');
    const loader = document.getElementById('search-loader');
    const recentSec = document.getElementById('recent-searches-section');

    if (!query) {
      list.innerHTML = '';
      recentSec.classList.remove('hidden');
      renderRecentSearchChips();
      return;
    }

    recentSec.classList.add('hidden');
    loader.classList.remove('hidden');
    list.innerHTML = '';

    saveRecentSearch(query);

    if (state.searchSource === 'yt') {
      try {
        const res = await fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=15`);
        const data = await res.json();
        const results = (data.results || []).map(item => ({
          id: item.id.startsWith('yt:') ? item.id : `yt:${item.id}`,
          cleanId: item.id.replace('yt:', ''),
          title: item.title,
          artist: item.artist || 'YouTube',
          album: 'YouTube Stream',
          duration: item.duration || 0,
          thumbnail: item.thumbnail || `https://i.ytimg.com/vi/${item.id.replace('yt:', '')}/hqdefault.jpg`,
          url: `/api/youtube/stream/${item.id.replace('yt:', '')}`,
          source: 'youtube',
        }));
        renderSearchResults(results);
      } catch (err) {
        list.innerHTML = `<div class="empty-state"><p>YouTube search failed. Check network.</p></div>`;
      } finally {
        loader.classList.add('hidden');
      }
    } else {
      // Local Storage In-Memory Search
      const q = query.toLowerCase();
      const localMatches = state.localTracks.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.artist.toLowerCase().includes(q) ||
        t.album.toLowerCase().includes(q)
      );
      loader.classList.add('hidden');
      renderSearchResults(localMatches);
    }
  }

  function renderSearchResults(results) {
    const list = document.getElementById('search-results-list');
    list.innerHTML = '';

    if (results.length === 0) {
      list.innerHTML = `<div class="empty-state"><p>No results found for current source.</p></div>`;
      return;
    }

    results.forEach(track => {
      const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
      const card = document.createElement('div');
      card.className = `yt-card ${isCurrent ? 'playing' : ''}`;
      card.innerHTML = `
        <div class="yt-thumb-wrap">
          <img src="${track.thumbnail || '/static/icons/icon-192.png'}" alt="" class="yt-thumb-img">
          <span class="yt-dur-pill">${formatTime(track.duration)}</span>
        </div>
        <div class="yt-card-info">
          <h4 class="yt-card-title">${escapeHtml(track.title)}</h4>
          <span class="yt-card-channel">${escapeHtml(track.artist)}</span>
          <span class="yt-card-badge" style="color: ${track.source === 'youtube' ? 'var(--accent-youtube)' : 'var(--accent-teal)'}">
            <i class="ph-fill ${track.source === 'youtube' ? 'ph-youtube-logo' : 'ph-folder'}"></i>
            ${track.source === 'youtube' ? 'YouTube Stream' : 'Local Offline'}
          </span>
        </div>
        <div class="yt-card-actions">
          ${track.source === 'youtube' ? `
            <button class="card-btn download-btn" title="Download to Local">
              <i class="ph-bold ph-download-simple"></i>
            </button>
          ` : ''}
          <button class="card-btn fav-btn ${state.favorites.has(track.id) ? 'text-red' : ''}">
            <i class="${state.favorites.has(track.id) ? 'ph-fill' : 'ph-bold'} ph-heart"></i>
          </button>
        </div>
      `;

      card.addEventListener('click', (e) => {
        if (e.target.closest('.card-btn')) return;
        playTrack(track, results);
        haptic(10);
      });

      if (track.source === 'youtube') {
        const dlBtn = card.querySelector('.download-btn');
        dlBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          triggerDownloadToLocal(track, dlBtn);
          haptic(8);
        });
      }

      const favBtn = card.querySelector('.fav-btn');
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track);
        favBtn.classList.toggle('text-red', state.favorites.has(track.id));
        const icon = favBtn.querySelector('i');
        icon.className = state.favorites.has(track.id) ? 'ph-fill ph-heart' : 'ph-bold ph-heart';
        haptic(8);
      });

      list.appendChild(card);
    });
  }

  function saveRecentSearch(q) {
    let recents = JSON.parse(localStorage.getItem('linus_mobile_recent_searches') || '[]');
    recents = recents.filter(item => item !== q);
    recents.unshift(q);
    localStorage.setItem('linus_mobile_recent_searches', JSON.stringify(recents.slice(0, 10)));
  }

  function renderRecentSearchChips() {
    const container = document.getElementById('recent-search-chips');
    const recents = JSON.parse(localStorage.getItem('linus_mobile_recent_searches') || '[]');
    container.innerHTML = '';
    recents.forEach(q => {
      const chip = document.createElement('button');
      chip.className = 'vibe-chip';
      chip.innerHTML = `<i class="ph ph-clock"></i> ${escapeHtml(q)}`;
      chip.addEventListener('click', () => {
        document.getElementById('unified-search-input').value = q;
        document.getElementById('unified-search-clear').classList.remove('hidden');
        performUnifiedSearch(q);
        haptic(6);
      });
      container.appendChild(chip);
    });

    const clearBtn = document.getElementById('btn-clear-recent-searches');
    clearBtn.onclick = () => {
      localStorage.removeItem('linus_mobile_recent_searches');
      container.innerHTML = '';
    };
  }

  // =========================================================================
  // Playback Engine & Full Player
  // =========================================================================
  function initAudioEngine() {
    // Play/Pause toggles
    document.getElementById('mini-btn-play').addEventListener('click', (e) => {
      e.stopPropagation();
      togglePlay();
      haptic(10);
    });

    document.getElementById('full-btn-play').addEventListener('click', () => {
      togglePlay();
      haptic(12);
    });

    // Skip controls
    document.getElementById('mini-btn-next').addEventListener('click', (e) => {
      e.stopPropagation();
      skipNext();
      haptic(10);
    });

    document.getElementById('full-btn-next').addEventListener('click', () => {
      skipNext();
      haptic(10);
    });

    document.getElementById('full-btn-prev').addEventListener('click', () => {
      skipPrevious();
      haptic(10);
    });

    // Shuffle & Repeat
    fullBtnShuffle.addEventListener('click', () => {
      state.isShuffle = !state.isShuffle;
      fullBtnShuffle.classList.toggle('active', state.isShuffle);
      showToast(state.isShuffle ? 'Shuffle On' : 'Shuffle Off');
      haptic(8);
    });

    fullBtnRepeat.addEventListener('click', () => {
      if (state.repeatMode === 'off') {
        state.repeatMode = 'all';
        fullBtnRepeat.classList.add('active');
        fullRepeatIcon.className = 'ph-bold ph-repeat';
        showToast('Repeat All');
      } else if (state.repeatMode === 'all') {
        state.repeatMode = 'one';
        fullBtnRepeat.classList.add('active');
        fullRepeatIcon.className = 'ph-bold ph-repeat-once';
        showToast('Repeat One');
      } else {
        state.repeatMode = 'off';
        fullBtnRepeat.classList.remove('active');
        fullRepeatIcon.className = 'ph-bold ph-repeat';
        showToast('Repeat Off');
      }
      haptic(8);
    });

    // Scrubber interaction
    fullScrubSlider.addEventListener('input', () => {
      state.isDraggingScrubber = true;
      const targetTime = (fullScrubSlider.value / 100) * (audio.duration || 1);
      fullTimeElapsed.textContent = formatTime(targetTime);
      fullTimeRemaining.textContent = '-' + formatTime(Math.max(0, (audio.duration || 0) - targetTime));
    });

    fullScrubSlider.addEventListener('change', () => {
      const targetTime = (fullScrubSlider.value / 100) * (audio.duration || 1);
      audio.currentTime = targetTime;
      state.isDraggingScrubber = false;
      haptic(6);
    });

    // Audio Event Listeners
    audio.addEventListener('timeupdate', () => {
      if (!audio.duration || state.isDraggingScrubber) return;
      const pct = (audio.currentTime / audio.duration) * 100;
      miniProgressFill.style.width = `${pct}%`;
      fullScrubSlider.value = pct;
      fullTimeElapsed.textContent = formatTime(audio.currentTime);
      fullTimeRemaining.textContent = '-' + formatTime(Math.max(0, audio.duration - audio.currentTime));

      syncLyricsPlayback(audio.currentTime);
    });

    audio.addEventListener('play', () => {
      state.isPlaying = true;
      updatePlayIcons(true);
    });

    audio.addEventListener('pause', () => {
      state.isPlaying = false;
      updatePlayIcons(false);
    });

    audio.addEventListener('ended', () => {
      if (state.sleepTimerMode === 'end_of_track') {
        stopPlayback();
        clearSleepTimer();
        showToast('Sleep timer reached end of track. Goodnight!');
        return;
      }

      if (state.repeatMode === 'one') {
        audio.currentTime = 0;
        audio.play();
      } else {
        skipNext();
      }
    });

    audio.addEventListener('error', () => {
      showToast('Playback error. Skipping track...');
      skipNext();
    });

    // Headphone disconnect detection
    navigator.mediaSession?.setActionHandler('stop', () => {
      audio.pause();
    });

    // Full Player expand / collapse
    miniPlayer.addEventListener('click', () => {
      openFullPlayer();
      haptic(10);
    });

    document.getElementById('btn-close-full-player').addEventListener('click', () => {
      closeFullPlayer();
      haptic(8);
    });

    // Favorite heart on full player
    fullBtnFav.addEventListener('click', () => {
      if (!state.currentTrack) return;
      toggleFavorite(state.currentTrack);
      updateFullPlayerMeta();
      haptic(12);
    });

    // Save to local button on full player
    saveLocalBtn.addEventListener('click', () => {
      if (!state.currentTrack || state.currentTrack.source !== 'youtube') return;
      triggerDownloadToLocal(state.currentTrack, saveLocalBtn);
      haptic(10);
    });

    // Touch Swipe Gestures
    initPlayerGestures();
  }

  function playTrack(track, contextQueue = null) {
    state.currentTrack = track;
    if (contextQueue) {
      state.queue = [...contextQueue];
    } else if (!state.queue.some(t => t.id === track.id)) {
      state.queue.unshift(track);
    }

    // Add to history
    state.history = [track, ...state.history.filter(t => t.id !== track.id)].slice(0, 50);
    saveStatePersistence();

    // Source URL
    audio.src = track.url;
    audio.play().catch(e => console.log('Autoplay prevented:', e));

    // Update UI elements
    miniPlayer.classList.remove('hidden');
    updateMiniPlayerMeta();
    updateFullPlayerMeta();
    fetchLyricsForTrack(track);

    // Dynamic Ambient Colors
    updateAmbientAura(track);

    // Setup MediaSession for lock screen
    setupMediaSession(track);
  }

  function togglePlay() {
    if (!state.currentTrack) {
      if (state.localTracks.length > 0) playTrack(state.localTracks[0]);
      return;
    }
    if (audio.paused) {
      audio.play();
    } else {
      audio.pause();
    }
  }

  function skipNext() {
    if (state.queue.length === 0) return;
    const currentIndex = state.queue.findIndex(t => t.id === state.currentTrack?.id);
    let nextIndex;
    if (state.isShuffle) {
      nextIndex = Math.floor(Math.random() * state.queue.length);
    } else {
      nextIndex = (currentIndex + 1) % state.queue.length;
    }
    playTrack(state.queue[nextIndex]);
  }

  function skipPrevious() {
    if (audio.currentTime > 3.0) {
      audio.currentTime = 0;
      return;
    }
    if (state.queue.length === 0) return;
    const currentIndex = state.queue.findIndex(t => t.id === state.currentTrack?.id);
    const prevIndex = (currentIndex - 1 + state.queue.length) % state.queue.length;
    playTrack(state.queue[prevIndex]);
  }

  function stopPlayback() {
    audio.pause();
    audio.currentTime = 0;
    state.isPlaying = false;
    updatePlayIcons(false);
  }

  function updatePlayIcons(playing) {
    miniPlayIcon.className = playing ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    fullPlayIcon.className = playing ? 'ph-fill ph-pause' : 'ph-fill ph-play';
  }

  function updateMiniPlayerMeta() {
    if (!state.currentTrack) return;
    miniTitle.textContent = state.currentTrack.title;
    miniArtist.textContent = state.currentTrack.artist;
    miniArt.src = state.currentTrack.thumbnail || '/static/icons/icon-192.png';
    miniSourceBadge.textContent = state.currentTrack.source === 'youtube' ? 'YT' : 'LOCAL';
    miniSourceBadge.style.color = state.currentTrack.source === 'youtube' ? 'var(--accent-youtube)' : 'var(--accent-teal)';
  }

  function updateFullPlayerMeta() {
    if (!state.currentTrack) return;
    fullTitle.textContent = state.currentTrack.title;
    fullArtist.textContent = state.currentTrack.artist;
    fullArt.src = state.currentTrack.thumbnail || '/static/icons/icon-512.png';

    const isFav = state.favorites.has(state.currentTrack.id);
    fullFavIcon.className = isFav ? 'ph-fill ph-heart' : 'ph-bold ph-heart';
    fullBtnFav.classList.toggle('favorited', isFav);

    const isYt = state.currentTrack.source === 'youtube';
    fullSourcePill.textContent = isYt ? 'YouTube Stream' : 'Local Storage';
    fullSourcePill.style.color = isYt ? 'var(--accent-youtube)' : 'var(--accent-teal)';

    saveLocalBtn.classList.toggle('hidden', !isYt);
  }

  function openFullPlayer() {
    fullPlayer.classList.remove('hidden');
    updateFullPlayerMeta();
  }

  function closeFullPlayer() {
    fullPlayer.classList.add('hidden');
    lyricsContainer.classList.add('hidden');
  }

  // Swipe Gestures for Mobile
  function initPlayerGestures() {
    const handle = document.querySelector('.player-sheet-header');
    const artCard = document.getElementById('artwork-card');

    // Swipe down to dismiss full player
    handle.addEventListener('touchstart', (e) => {
      state.touchStartY = e.touches[0].clientY;
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
      const diffY = e.touches[0].clientY - state.touchStartY;
      if (diffY > 60) {
        closeFullPlayer();
        haptic(8);
      }
    }, { passive: true });

    // Swipe left/right on album art to change track
    artCard.addEventListener('touchstart', (e) => {
      state.touchStartX = e.touches[0].clientX;
    }, { passive: true });

    artCard.addEventListener('touchend', (e) => {
      const diffX = e.changedTouches[0].clientX - state.touchStartX;
      if (diffX < -50) {
        skipNext();
        haptic(10);
      } else if (diffX > 50) {
        skipPrevious();
        haptic(10);
      }
    });

    // Tap artwork to toggle Lyrics view
    artCard.addEventListener('click', () => {
      toggleLyricsView();
      haptic(8);
    });
  }

  // =========================================================================
  // Apple Music Style Synced Lyrics (Karaoke Engine)
  // =========================================================================
  function initLyricsEngine() {
    btnToggleLyrics.addEventListener('click', () => {
      toggleLyricsView();
      haptic(8);
    });

    btnCloseLyrics.addEventListener('click', () => {
      lyricsContainer.classList.add('hidden');
      btnToggleLyrics.classList.remove('active');
      haptic(6);
    });
  }

  function toggleLyricsView() {
    const isHidden = lyricsContainer.classList.contains('hidden');
    lyricsContainer.classList.toggle('hidden', !isHidden);
    btnToggleLyrics.classList.toggle('active', isHidden);
  }

  async function fetchLyricsForTrack(track) {
    lyricsWrapper.innerHTML = `<p class="lyrics-placeholder">Loading synced lyrics...</p>`;
    state.syncedLyrics = [];

    try {
      const q = `/api/lyrics?track_id=${encodeURIComponent(track.id)}&artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}&duration=${track.duration}`;
      const res = await fetch(q);
      const data = await res.json();

      if (data.synced && Array.isArray(data.lines) && data.lines.length > 0) {
        state.syncedLyrics = data.lines;
        renderLyricsLines(data.lines);
      } else if (data.plain) {
        lyricsWrapper.innerHTML = `<div class="plain-lyrics-block">${data.plain.split('\n').map(l => `<p class="plain-lyric-line">${escapeHtml(l)}</p>`).join('')}</div>`;
      } else {
        lyricsWrapper.innerHTML = `<p class="lyrics-placeholder">No synchronized lyrics available for this song.</p>`;
      }
    } catch (_) {
      lyricsWrapper.innerHTML = `<p class="lyrics-placeholder">Lyrics could not be loaded.</p>`;
    }
  }

  function renderLyricsLines(lines) {
    lyricsWrapper.innerHTML = '';
    lines.forEach((line, idx) => {
      const p = document.createElement('p');
      p.className = 'lyric-line';
      p.id = `lyric-line-${idx}`;
      p.textContent = line.text;
      p.addEventListener('click', () => {
        audio.currentTime = line.time;
        haptic(8);
      });
      lyricsWrapper.appendChild(p);
    });
  }

  function syncLyricsPlayback(currentTime) {
    if (state.syncedLyrics.length === 0) return;

    let activeIdx = -1;
    for (let i = 0; i < state.syncedLyrics.length; i++) {
      if (currentTime >= state.syncedLyrics[i].time) {
        activeIdx = i;
      } else {
        break;
      }
    }

    if (activeIdx !== -1) {
      document.querySelectorAll('.lyric-line').forEach((el, idx) => {
        el.classList.toggle('active', idx === activeIdx);
      });

      const activeEl = document.getElementById(`lyric-line-${activeIdx}`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  // =========================================================================
  // Smartphone Feature: Bedtime Sleep Timer
  // =========================================================================
  function initSleepTimer() {
    const openBtns = [
      document.getElementById('btn-sleep-timer-header'),
      document.getElementById('btn-open-sleep-timer'),
      document.getElementById('btn-open-sleep-timer-card')
    ];

    openBtns.forEach(btn => {
      if (btn) {
        btn.addEventListener('click', () => {
          sleepSheet.classList.remove('hidden');
          haptic(8);
        });
      }
    });

    document.getElementById('btn-close-sleep-sheet').addEventListener('click', () => {
      sleepSheet.classList.add('hidden');
    });

    document.getElementById('sleep-timer-backdrop').addEventListener('click', () => {
      sleepSheet.classList.add('hidden');
    });

    // Sleep options
    document.querySelectorAll('.sleep-option').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-minutes');
        if (val === '0') {
          clearSleepTimer();
          showToast('Sleep timer disabled');
        } else if (val === 'end_of_track') {
          setEndOfTrackSleepTimer();
        } else {
          setSleepTimer(parseInt(val, 10));
        }
        sleepSheet.classList.add('hidden');
        haptic(10);
      });
    });
  }

  function setSleepTimer(minutes) {
    clearSleepTimer();
    const durationMs = minutes * 60 * 1000;
    state.sleepTimerEndTimestamp = Date.now() + durationMs;
    state.sleepTimerMode = 'minutes';

    state.sleepTimerId = setInterval(() => {
      const remainingMs = state.sleepTimerEndTimestamp - Date.now();
      if (remainingMs <= 0) {
        clearSleepTimer();
        fadeAndStopAudio();
        showToast('Sleep timer reached. Goodnight!');
      } else {
        const minsLeft = Math.ceil(remainingMs / 60000);
        updateSleepBadgeUI(`${minsLeft}m`);
      }
    }, 1000);

    updateSleepBadgeUI(`${minutes}m`);
    showToast(`Sleep timer set for ${minutes} minutes`);
  }

  function setEndOfTrackSleepTimer() {
    clearSleepTimer();
    state.sleepTimerMode = 'end_of_track';
    updateSleepBadgeUI('End Song');
    showToast('Sleep timer set to stop after this song');
  }

  function clearSleepTimer() {
    if (state.sleepTimerId) clearInterval(state.sleepTimerId);
    state.sleepTimerId = null;
    state.sleepTimerEndTimestamp = null;
    state.sleepTimerMode = null;
    updateSleepBadgeUI(null);
  }

  function updateSleepBadgeUI(text) {
    if (text) {
      sleepBadgeHeader.classList.remove('hidden');
      sleepBtnLabel.textContent = text;
      sleepTimerCardStatus.textContent = `Active timer: Stops in ${text}. Sweet dreams!`;
    } else {
      sleepBadgeHeader.classList.add('hidden');
      sleepBtnLabel.textContent = 'Timer';
      sleepTimerCardStatus.textContent = 'No active timer. Fall asleep to music without draining battery.';
    }
  }

  function fadeAndStopAudio() {
    let vol = audio.volume;
    const fadeInterval = setInterval(() => {
      vol = Math.max(0, vol - 0.1);
      audio.volume = vol;
      if (vol <= 0) {
        clearInterval(fadeInterval);
        stopPlayback();
        audio.volume = 1; // reset for next time
      }
    }, 300);
  }

  // =========================================================================
  // Up Next Queue Sheet
  // =========================================================================
  function initQueueSheet() {
    const openBtns = [
      document.getElementById('btn-open-queue'),
      document.getElementById('btn-header-queue')
    ];

    openBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        renderQueueSheet();
        queueSheet.classList.remove('hidden');
        haptic(8);
      });
    });

    document.getElementById('queue-sheet-backdrop').addEventListener('click', () => {
      queueSheet.classList.add('hidden');
    });

    document.getElementById('btn-clear-queue').addEventListener('click', () => {
      if (state.currentTrack) {
        state.queue = [state.currentTrack];
      } else {
        state.queue = [];
      }
      renderQueueSheet();
      showToast('Queue cleared');
      haptic(8);
    });
  }

  function renderQueueSheet() {
    queueCount.textContent = state.queue.length;

    // Current playing item
    if (state.currentTrack) {
      queueCurrentTrackItem.innerHTML = `
        <div class="local-track-item playing">
          <div class="local-art-wrap">
            <img src="${state.currentTrack.thumbnail || '/static/icons/icon-192.png'}" alt="" class="local-art-img">
          </div>
          <div class="local-meta-wrap">
            <h4 class="local-title">${escapeHtml(state.currentTrack.title)}</h4>
            <p class="local-subtitle">${escapeHtml(state.currentTrack.artist)}</p>
          </div>
          <i class="ph-fill ph-waveform text-teal"></i>
        </div>
      `;
    } else {
      queueCurrentTrackItem.innerHTML = `<p class="lyrics-placeholder">No track currently playing</p>`;
    }

    // Upcoming queue items
    queueTracksList.innerHTML = '';
    const currentIndex = state.queue.findIndex(t => t.id === state.currentTrack?.id);
    const upcoming = state.queue.slice(currentIndex + 1);

    if (upcoming.length === 0) {
      queueTracksList.innerHTML = `<p class="lyrics-placeholder">Queue ends after this song.</p>`;
      return;
    }

    upcoming.forEach((track, i) => {
      const item = document.createElement('div');
      item.className = 'local-track-item';
      item.innerHTML = `
        <div class="local-art-wrap">
          <img src="${track.thumbnail || '/static/icons/icon-192.png'}" alt="" class="local-art-img">
        </div>
        <div class="local-meta-wrap">
          <h4 class="local-title">${escapeHtml(track.title)}</h4>
          <p class="local-subtitle">${escapeHtml(track.artist)}</p>
        </div>
        <button class="card-btn btn-remove-queue" title="Remove from queue">
          <i class="ph-bold ph-x"></i>
        </button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove-queue')) return;
        playTrack(track);
        haptic(10);
      });

      item.querySelector('.btn-remove-queue').addEventListener('click', (e) => {
        e.stopPropagation();
        state.queue.splice(currentIndex + 1 + i, 1);
        renderQueueSheet();
        haptic(6);
      });

      queueTracksList.appendChild(item);
    });
  }

  // =========================================================================
  // YouTube Download to Local Storage Integration
  // =========================================================================
  async function triggerDownloadToLocal(track, buttonEl) {
    if (track.source !== 'youtube') return;
    const cleanId = track.cleanId || track.id.replace('yt:', '');
    const ytUrl = `https://www.youtube.com/watch?v=${cleanId}`;

    if (buttonEl) {
      buttonEl.classList.add('downloading');
    }
    showToast(`Downloading "${track.title.slice(0, 20)}..." to local storage`);

    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: ytUrl, media_type: 'audio' })
      });
      const data = await res.json();

      if (data.job_id) {
        pollDownloadJob(data.job_id, track, buttonEl);
      }
    } catch (_) {
      showToast('Download failed. Server unreachable.');
      if (buttonEl) buttonEl.classList.remove('downloading');
    }
  }

  function pollDownloadJob(jobId, track, buttonEl) {
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/download/status/${jobId}`);
        const data = await res.json();

        if (data.status === 'completed') {
          clearInterval(pollInterval);
          if (buttonEl) buttonEl.classList.remove('downloading');
          showToast(`Saved "${track.title.slice(0, 18)}..." to Local Storage!`, 'ph-bold ph-check-circle');
          // Refresh local library to include newly saved track
          fetchLocalLibrary();
        } else if (data.status === 'error') {
          clearInterval(pollInterval);
          if (buttonEl) buttonEl.classList.remove('downloading');
          showToast('Download encountered an error.');
        }
      } catch (_) {
        clearInterval(pollInterval);
        if (buttonEl) buttonEl.classList.remove('downloading');
      }
    }, 2000);
  }

  // =========================================================================
  // Library Tab Renders & Favorites
  // =========================================================================
  function toggleFavorite(track) {
    if (state.favorites.has(track.id)) {
      state.favorites.delete(track.id);
      showToast('Removed from Favorites');
    } else {
      state.favorites.add(track.id);
      showToast('Added to Favorites ❤️');
    }
    saveStatePersistence();
    updateLibraryStats();
  }

  function updateLibraryStats() {
    const favCount = document.getElementById('stat-favorites-count');
    const dlCount = document.getElementById('stat-downloads-count');
    const histCount = document.getElementById('stat-history-count');
    const summary = document.getElementById('lib-summary-text');

    if (favCount) favCount.textContent = state.favorites.size;
    if (dlCount) dlCount.textContent = state.localTracks.length;
    if (histCount) histCount.textContent = state.history.length;
    if (summary) {
      summary.textContent = `${state.localTracks.length} local tracks • ${state.favorites.size} favorites`;
    }
  }

  function renderFavoritesList() {
    const list = document.getElementById('library-tracks-list');
    list.innerHTML = '';

    const favList = [];
    // Collect from local and youtube history
    const allKnown = [...state.localTracks, ...state.youtubeTracks, ...state.history];
    state.favorites.forEach(favId => {
      const match = allKnown.find(t => t.id === favId);
      if (match && !favList.some(f => f.id === match.id)) {
        favList.push(match);
      }
    });

    if (favList.length === 0) {
      list.innerHTML = `<div class="empty-state"><i class="ph ph-heart"></i><h3>No Favorites Yet</h3><p>Tap the heart icon on any YouTube or Local song to keep it here.</p></div>`;
      return;
    }

    renderListItems(list, favList);
  }

  function renderCachedDownloadsList() {
    const list = document.getElementById('library-tracks-list');
    list.innerHTML = '';
    renderListItems(list, state.localTracks);
  }

  function renderHistoryList() {
    const list = document.getElementById('library-tracks-list');
    list.innerHTML = '';
    if (state.history.length === 0) {
      list.innerHTML = `<div class="empty-state"><i class="ph ph-clock-counter-clockwise"></i><h3>No Listening History</h3><p>Recently played songs will appear here.</p></div>`;
      return;
    }
    renderListItems(list, state.history);
  }

  function renderListItems(container, tracks) {
    tracks.forEach(track => {
      const isCurrent = state.currentTrack && state.currentTrack.id === track.id;
      const item = document.createElement('div');
      item.className = `local-track-item ${isCurrent ? 'playing' : ''}`;
      item.innerHTML = `
        <div class="local-art-wrap">
          <img src="${track.thumbnail || '/static/icons/icon-192.png'}" alt="" class="local-art-img">
        </div>
        <div class="local-meta-wrap">
          <h4 class="local-title">${escapeHtml(track.title)}</h4>
          <p class="local-subtitle">${escapeHtml(track.artist)} • ${track.source === 'youtube' ? 'YouTube' : 'Local'}</p>
        </div>
        <button class="card-btn fav-btn ${state.favorites.has(track.id) ? 'text-red' : ''}">
          <i class="${state.favorites.has(track.id) ? 'ph-fill' : 'ph-bold'} ph-heart"></i>
        </button>
      `;

      item.addEventListener('click', (e) => {
        if (e.target.closest('.card-btn')) return;
        playTrack(track, tracks);
        haptic(10);
      });

      item.querySelector('.fav-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(track);
        if (container.id === 'library-tracks-list' && document.getElementById('lib-tab-favs').classList.contains('active')) {
          renderFavoritesList();
        }
        haptic(8);
      });

      container.appendChild(item);
    });
  }

  // =========================================================================
  // Lock Screen Media Session API (iOS & Android)
  // =========================================================================
  function setupMediaSession(track) {
    if (!('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album || (track.source === 'youtube' ? 'YouTube Stream' : 'Local Collection'),
      artwork: [
        { src: track.thumbnail || '/static/icons/icon-192.png', sizes: '192x192', type: 'image/jpeg' },
        { src: track.thumbnail || '/static/icons/icon-512.png', sizes: '512x512', type: 'image/jpeg' }
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => { audio.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => { skipPrevious(); });
    navigator.mediaSession.setActionHandler('nexttrack', () => { skipNext(); });
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) audio.currentTime = details.seekTime;
    });
  }

  // =========================================================================
  // Dynamic Ambient Mesh Glow (Apple Music Style)
  // =========================================================================
  function updateAmbientAura(track) {
    const blob1 = document.querySelector('.blob-1');
    const blob2 = document.querySelector('.blob-2');
    const artGlow = document.getElementById('art-glow');

    if (track.source === 'youtube') {
      if (blob1) blob1.style.background = 'radial-gradient(circle, rgba(255, 51, 75, 0.45) 0%, transparent 70%)';
      if (blob2) blob2.style.background = 'radial-gradient(circle, rgba(234, 88, 12, 0.35) 0%, transparent 70%)';
      if (artGlow) artGlow.style.background = 'radial-gradient(circle, rgba(255, 51, 75, 0.45) 0%, transparent 70%)';
    } else {
      if (blob1) blob1.style.background = 'radial-gradient(circle, rgba(45, 212, 191, 0.45) 0%, transparent 70%)';
      if (blob2) blob2.style.background = 'radial-gradient(circle, rgba(56, 189, 248, 0.35) 0%, transparent 70%)';
      if (artGlow) artGlow.style.background = 'radial-gradient(circle, rgba(45, 212, 191, 0.45) 0%, transparent 70%)';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // =========================================================================
  // Initialization
  // =========================================================================
  window.addEventListener('DOMContentLoaded', () => {
    initNavigation();
    initYouTubeSection();
    initLocalSection();
    initUnifiedSearch();
    initAudioEngine();
    initLyricsEngine();
    initSleepTimer();
    initQueueSheet();
  });

})();
