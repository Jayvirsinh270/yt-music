// ============================================================
// Linus — Universal Command Palette & Spotlight Search Subsystem
// Instant Keyboard Navigation (Ctrl+K / Cmd+K), In-Memory Fuzzy Search,
// Audio DSP Quick Toggles, Visualizer Mode Jumps, and App Routing
// ============================================================

(function() {
  'use strict';

  const $ = window.$ || (sel => document.querySelector(sel));
  const $$ = window.$$ || (sel => document.querySelectorAll(sel));

  let activeIndex = 0;
  let currentFilter = 'all';
  let filteredResults = [];

  // Static Action Catalog
  const COMMAND_CATALOG = [
    // --- Audio DSP & Atmosphere ---
    {
      id: 'fx-cozy',
      category: 'fx',
      title: 'Toggle Cozy Listening Mode',
      subtitle: 'Gentle rain on glass & crackling vinyl fireplace ambiance',
      icon: 'ph-bold ph-coffee',
      color: '#e5a95d',
      badge: 'Audio FX',
      action: () => $('#cozy-mode-quick-btn')?.click()
    },
    {
      id: 'fx-8d',
      category: 'fx',
      title: 'Toggle 8D 360° Spatial Audio',
      subtitle: 'Dynamic orbital binaural panning simulation',
      icon: 'ph-bold ph-headphones',
      color: '#a78bfa',
      badge: 'Audio FX',
      action: () => {
        const toggle = $('#spatial-toggle');
        if (toggle) {
          toggle.checked = !toggle.checked;
          toggle.dispatchEvent(new Event('change'));
          window.showToast?.(`8D Spatial Audio: ${toggle.checked ? 'Enabled' : 'Disabled'}`);
        }
      }
    },
    {
      id: 'fx-karaoke',
      category: 'fx',
      title: 'Toggle Karaoke / Vocal Remover DSP',
      subtitle: 'Real-time vocal suppression using mid-side phase inversion',
      icon: 'ph-bold ph-microphone-slash',
      color: '#f43f5e',
      badge: 'Audio FX',
      action: () => {
        if (typeof toggleKaraokeMode === 'function') toggleKaraokeMode();
        else if (window.toggleKaraokeMode) window.toggleKaraokeMode();
      }
    },
    {
      id: 'fx-norm',
      category: 'fx',
      title: 'Toggle Smart Gain Loudness Normalization',
      subtitle: 'Consistent, balanced volume across quiet and loud recordings',
      icon: 'ph-bold ph-waveform',
      color: '#34d399',
      badge: 'Audio FX',
      action: () => {
        if (typeof toggleAudioNormalization === 'function') toggleAudioNormalization();
        else if (window.toggleAudioNormalization) window.toggleAudioNormalization();
      }
    },
    {
      id: 'fx-autodj',
      category: 'fx',
      title: 'Toggle Smart Auto-DJ Beat-Matched Crossfader',
      subtitle: 'Seamless equal-power crossfade blends between songs',
      icon: 'ph-bold ph-disc',
      color: '#38bdf8',
      badge: 'Audio FX',
      action: () => {
        if (typeof toggleAutoDJQuick === 'function') toggleAutoDJQuick();
        else if (window.toggleAutoDJQuick) window.toggleAutoDJQuick();
      }
    },
    {
      id: 'fx-eq-modal',
      category: 'fx',
      title: 'Open 10-Band Audiophile Equalizer & Bass Boost',
      subtitle: 'Custom frequency curves and audio presets',
      icon: 'ph-bold ph-sliders',
      color: '#f59e0b',
      badge: 'Audio FX',
      action: () => $('#eq-sheet')?.showModal()
    },
    {
      id: 'fx-ambient-modal',
      category: 'fx',
      title: 'Open Ambient Soundscapes & Sleep Timer',
      subtitle: 'Rain, Fireplace, Waves, Wind mixer & fade-out timer',
      icon: 'ph-bold ph-cloud-rain',
      color: '#60a5fa',
      badge: 'Audio FX',
      action: () => $('#ambient-sheet')?.showModal()
    },
    {
      id: 'fx-sleep-30',
      category: 'fx',
      title: 'Set Sleep Timer: 30 Minutes',
      subtitle: 'Gentle 45-second volume fade-out then stop playback',
      icon: 'ph-bold ph-moon-stars',
      color: '#818cf8',
      badge: 'Timer',
      action: () => {
        if (typeof startSleepTimer === 'function') startSleepTimer(30);
        else window.showToast?.('Sleep timer set for 30 minutes.');
      }
    },
    {
      id: 'fx-sleep-60',
      category: 'fx',
      title: 'Set Sleep Timer: 60 Minutes',
      subtitle: 'Gentle 45-second volume fade-out then stop playback',
      icon: 'ph-bold ph-moon-stars',
      color: '#818cf8',
      badge: 'Timer',
      action: () => {
        if (typeof startSleepTimer === 'function') startSleepTimer(60);
        else window.showToast?.('Sleep timer set for 60 minutes.');
      }
    },
    {
      id: 'fx-sleep-cancel',
      category: 'fx',
      title: 'Cancel Active Sleep Timer',
      subtitle: 'Stop countdown and restore full playback volume',
      icon: 'ph-bold ph-x-circle',
      color: '#f43f5e',
      badge: 'Timer',
      action: () => {
        if (typeof cancelSleepTimer === 'function') cancelSleepTimer();
      }
    },

    // --- Visualizer Modes ---
    {
      id: 'mode-stage',
      category: 'modes',
      title: 'Switch to Modern Split Stage (3D CD Jewel Case)',
      subtitle: 'Interactive acrylic CD case, peeking disc & synced lyrics',
      icon: 'ph-bold ph-columns',
      color: '#e5a95d',
      badge: 'Visualizer',
      action: () => {
        window.setFullscreenMode?.('stage');
        window.openFullscreenPlayer?.();
      }
    },
    {
      id: 'mode-vinyl',
      category: 'modes',
      title: 'Switch to Audiophile Vinyl Turntable Mode',
      subtitle: 'Grooved spinning vinyl record with progress ring',
      icon: 'ph-fill ph-vinyl-record',
      color: '#e5a95d',
      badge: 'Visualizer',
      action: () => {
        window.setFullscreenMode?.('vinyl');
        window.openFullscreenPlayer?.();
      }
    },
    {
      id: 'mode-retro90s',
      category: 'modes',
      title: 'Switch to 90s Retro (Winamp 2.x & Sony Walkman)',
      subtitle: 'Green phosphor CRT oscilloscope, Sony Discman LCD & ESP ring',
      icon: 'ph-bold ph-cassette-tape',
      color: '#22c55e',
      badge: 'Visualizer',
      action: () => {
        window.setFullscreenMode?.('retro90s');
        window.openFullscreenPlayer?.();
      }
    },
    {
      id: 'mode-halo',
      category: 'modes',
      title: 'Switch to Celestial Halo Visualizer',
      subtitle: 'Harmonic orbital translucent audio particle ring',
      icon: 'ph-bold ph-circle-dashed',
      color: '#38bdf8',
      badge: 'Visualizer',
      action: () => {
        window.setFullscreenMode?.('halo');
        window.openFullscreenPlayer?.();
      }
    },
    {
      id: 'mode-clean',
      category: 'modes',
      title: 'Switch to Clean Wallpaper Canvas Mode',
      subtitle: 'Zero HUD distractions, 100% full artwork immersion',
      icon: 'ph-bold ph-image',
      color: '#cbd5e1',
      badge: 'Visualizer',
      action: () => {
        window.setFullscreenMode?.('clean');
        window.openFullscreenPlayer?.();
      }
    },
    {
      id: 'fs-expand',
      category: 'modes',
      title: 'Expand Fullscreen Player (HUD)',
      subtitle: 'Open full-window aesthetic visualizer stage',
      icon: 'ph-bold ph-arrows-out',
      color: '#e5a95d',
      badge: 'View',
      action: () => window.openFullscreenPlayer?.()
    },
    {
      id: 'fs-true',
      category: 'modes',
      title: 'Toggle True Browser Fullscreen (F11)',
      subtitle: 'Hide address bar and browser tabs for pure music immersion',
      icon: 'ph-bold ph-corners-out',
      color: '#94a3b8',
      badge: 'System',
      action: () => window.toggleTrueFullscreen?.()
    },

    // --- App Views ---
    {
      id: 'nav-library',
      category: 'views',
      title: 'Navigate to Library (Home)',
      subtitle: 'Browse your personal music tracks, albums and categories',
      icon: 'ph-bold ph-music-notes-simple',
      color: '#e5a95d',
      badge: 'Navigation',
      action: () => switchView('library')
    },
    {
      id: 'nav-explore',
      category: 'views',
      title: 'Navigate to Explore (YouTube Search)',
      subtitle: 'Search worldwide YouTube songs, artists and trending music',
      icon: 'ph-bold ph-compass',
      color: '#ef4444',
      badge: 'Navigation',
      action: () => switchView('explore')
    },
    {
      id: 'nav-dj',
      category: 'views',
      title: 'Navigate to DJ Remix Studio',
      subtitle: 'Dual-deck pro mixer, 3-band isolator EQ, resonant filters & cue pads',
      icon: 'ph-bold ph-sliders',
      color: '#38bdf8',
      badge: 'Navigation',
      action: () => switchView('dj-studio')
    },
    {
      id: 'nav-playlists',
      category: 'views',
      title: 'Navigate to Playlists',
      subtitle: 'View, create and curate personalized playlists',
      icon: 'ph-bold ph-list-dashes',
      color: '#a855f7',
      badge: 'Navigation',
      action: () => switchView('playlists')
    },
    {
      id: 'nav-favorites',
      category: 'views',
      title: 'Navigate to Favorites',
      subtitle: 'Tracks close to the heart',
      icon: 'ph-fill ph-star',
      color: '#f59e0b',
      badge: 'Navigation',
      action: () => switchView('favorites')
    },
    {
      id: 'nav-lyrics',
      category: 'views',
      title: 'Navigate to Synced Lyrics & Karaoke',
      subtitle: 'Live synchronized LRCLIB timestamps and lyric editor',
      icon: 'ph-bold ph-quotes',
      color: '#ec4899',
      badge: 'Navigation',
      action: () => switchView('lyrics')
    },
    {
      id: 'nav-downloads',
      category: 'views',
      title: 'Navigate to Downloads Manager',
      subtitle: 'Monitor active and finished YouTube audio/video downloads',
      icon: 'ph-bold ph-download-simple',
      color: '#10b981',
      badge: 'Navigation',
      action: () => switchView('downloads')
    },

    // --- Actions & Music Intelligence ---
    {
      id: 'act-rewind',
      category: 'actions',
      title: 'Weekly Sound Rewind & Persona Recap',
      subtitle: 'Spotify Wrapped-style stats, active time, top tracks & listening identity',
      icon: 'ph-bold ph-calendar-star',
      color: '#f5c87a',
      badge: 'Insights',
      action: () => window.openWeeklyRewindModal?.()
    },
    {
      id: 'act-heatmap',
      category: 'actions',
      title: 'Daily Streak & Music Calendar Heatmap',
      subtitle: 'Track your daily listening habit with GitHub-style activity grid',
      icon: 'ph-fill ph-fire',
      color: '#ea580c',
      badge: 'Insights',
      action: () => $('#rec-streak-badge')?.click()
    },
    {
      id: 'act-compass',
      category: 'actions',
      title: 'Open 2D Vibe Compass / Mood Dial',
      subtitle: 'Interactive Energy vs Valence mood dial for queue sorting',
      icon: 'ph-bold ph-compass',
      color: '#38bdf8',
      badge: 'Intelligence',
      action: () => window.openVibeCompassModal?.()
    },
    {
      id: 'act-theme-studio',
      category: 'actions',
      title: 'Open Personalization & Atmosphere Studio',
      subtitle: 'Tune hex colors, fonts, glass opacity and custom backgrounds',
      icon: 'ph-fill ph-paint-brush-broad',
      color: '#e5a95d',
      badge: 'Customize',
      action: () => $('#theme-studio-sheet')?.showModal()
    },
    {
      id: 'act-gallery',
      category: 'actions',
      title: 'Browse 50+ Wallpaper Gallery',
      subtitle: 'Explore anime, nature, space, cozy and minimalist art',
      icon: 'ph-bold ph-sparkle',
      color: '#818cf8',
      badge: 'Gallery',
      action: () => window.openWallpaperGallery?.('main')
    },
    {
      id: 'act-rescan',
      category: 'actions',
      title: 'Rescan Music Library',
      subtitle: 'Detect new audio files and update SQLite metadata cache',
      icon: 'ph-bold ph-arrows-clockwise',
      color: '#34d399',
      badge: 'Library',
      action: () => {
        fetch('/api/rescan?sync=1', { method: 'POST' })
          .then(r => r.json())
          .then(d => {
            window.showToast?.(`Rescanned ${d.count || 0} tracks.`);
            if (typeof renderLibrary === 'function') renderLibrary();
          })
          .catch(() => window.showToast?.('Rescan started in background.'));
      }
    },
    {
      id: 'act-folders',
      category: 'actions',
      title: 'Manage Music Folders',
      subtitle: 'Add local hard drive directories (e.g. D:\\Music) to library',
      icon: 'ph-bold ph-folder-open',
      color: '#e5a95d',
      badge: 'Library',
      action: () => $('#folders-sheet')?.showModal()
    },
    {
      id: 'act-download',
      category: 'actions',
      title: 'Download Media by URL',
      subtitle: 'Acquire YouTube audio (MP3/FLAC) or video (MP4) from URL',
      icon: 'ph-bold ph-link',
      color: '#60a5fa',
      badge: 'Acquire',
      action: () => $('#download-sheet')?.showModal()
    },
    {
      id: 'act-clear-cache',
      category: 'actions',
      title: 'Clear Stream Cache (Free Disk Space)',
      subtitle: 'Purge locally cached YouTube audio streams and release disk storage',
      icon: 'ph-bold ph-trash',
      color: '#f43f5e',
      badge: 'System',
      action: async () => {
        try {
          const info = await fetch('/api/stream-cache/info').then(r => r.json());
          const sizeStr = info.size_mb ? `${info.size_mb} MB (${info.count} tracks)` : 'cache';
          if (confirm(`Clear ${sizeStr} of temporary cached stream data?`)) {
            const res = await fetch('/api/stream-cache/clear', { method: 'POST' }).then(r => r.json());
            window.showToast?.(`Cleared ${res.freed_mb || 0} MB of cached streams.`);
          }
        } catch (e) {
          window.showToast?.('Error clearing stream cache');
        }
      }
    },
    {
      id: 'act-discord-rpc',
      category: 'actions',
      title: 'Toggle Discord Rich Presence (RPC)',
      subtitle: 'Broadcast current song, artist, album art and timeline to Discord profile',
      icon: 'ph-fill ph-discord-logo',
      color: '#5865F2',
      badge: 'Presence',
      action: () => {
        if (window.DiscordRPC?.toggleRPC) {
          window.DiscordRPC.toggleRPC();
        } else {
          fetch('/api/discord-rpc/toggle', { method: 'POST' })
            .then(r => r.json())
            .then(d => window.showToast?.(`Discord RPC: ${d.enabled ? 'Enabled' : 'Disabled'}`))
            .catch(() => window.showToast?.('Discord RPC toggled.'));
        }
      }
    },

    // --- Smart Autoplaylists ---
    {
      id: 'smart-heavy-rotation',
      category: 'actions',
      title: 'Play Smart Playlist: Heavy Rotation',
      subtitle: 'Your most played anthems and high-completion repeat favorites',
      icon: 'ph-fill ph-fire',
      color: '#ef4444',
      badge: 'Smart Playlist',
      action: () => window.SmartPlaylists?.play('heavy-rotation')
    },
    {
      id: 'smart-high-energy',
      category: 'actions',
      title: 'Play Smart Playlist: High Energy (130+ BPM)',
      subtitle: 'Pumping uptempo beats and workout power tracks',
      icon: 'ph-fill ph-lightning',
      color: '#f59e0b',
      badge: 'Smart Playlist',
      action: () => window.SmartPlaylists?.play('high-energy')
    },
    {
      id: 'smart-deep-focus',
      category: 'actions',
      title: 'Play Smart Playlist: Deep Focus & Chill',
      subtitle: 'Low-tempo ambient, acoustic, and peaceful melodies for flow state',
      icon: 'ph-fill ph-brain',
      color: '#38bdf8',
      badge: 'Smart Playlist',
      action: () => window.SmartPlaylists?.play('deep-focus')
    },
    {
      id: 'smart-forgotten-gems',
      category: 'actions',
      title: 'Play Smart Playlist: Forgotten Gems',
      subtitle: 'Hidden gems and previous favorites waiting for your rediscovery',
      icon: 'ph-fill ph-sketch-logo',
      color: '#a855f7',
      badge: 'Smart Playlist',
      action: () => window.SmartPlaylists?.play('forgotten-gems')
    },
    {
      id: 'smart-recently-added',
      category: 'actions',
      title: 'Play Smart Playlist: Recently Added',
      subtitle: 'The freshest additions imported into your local library',
      icon: 'ph-bold ph-clock-clockwise',
      color: '#34d399',
      badge: 'Smart Playlist',
      action: () => window.SmartPlaylists?.play('recently-added')
    },

    // --- Transport Quick Actions ---
    {
      id: 'act-play-pause',
      category: 'actions',
      title: 'Play / Pause Current Track',
      subtitle: 'Toggle active audio playback',
      icon: 'ph-fill ph-play-pause',
      color: '#e5a95d',
      badge: 'Transport',
      action: () => {
        if (typeof togglePlay === 'function') togglePlay();
        else if (window.togglePlay) window.togglePlay();
      }
    },
    {
      id: 'act-next',
      category: 'actions',
      title: 'Next Track in Queue',
      subtitle: 'Skip forward to up next song',
      icon: 'ph-fill ph-skip-forward',
      color: '#94a3b8',
      badge: 'Transport',
      action: () => {
        if (typeof nextTrack === 'function') nextTrack();
        else if (window.nextTrack) window.nextTrack();
      }
    },
    {
      id: 'act-prev',
      category: 'actions',
      title: 'Previous Track in Queue',
      subtitle: 'Skip back to previous song or track start',
      icon: 'ph-fill ph-skip-back',
      color: '#94a3b8',
      badge: 'Transport',
      action: () => {
        if (typeof previousTrack === 'function') previousTrack();
        else if (window.previousTrack) window.previousTrack();
      }
    },
    {
      id: 'act-shuffle',
      category: 'actions',
      title: 'Toggle Queue Shuffle',
      subtitle: 'Randomize playback order of upcoming tracks',
      icon: 'ph-bold ph-shuffle',
      color: '#a78bfa',
      badge: 'Transport',
      action: () => {
        if (typeof toggleShuffle === 'function') toggleShuffle();
        else if (window.toggleShuffle) window.toggleShuffle();
      }
    },
    {
      id: 'act-repeat',
      category: 'actions',
      title: 'Cycle Repeat Mode (None / All / One)',
      subtitle: 'Change repeat behavior for current song or queue',
      icon: 'ph-bold ph-repeat',
      color: '#a78bfa',
      badge: 'Transport',
      action: () => {
        if (typeof cycleRepeat === 'function') cycleRepeat();
        else if (window.cycleRepeat) window.cycleRepeat();
      }
    },
    {
      id: 'act-tour',
      category: 'actions',
      title: 'Start Interactive Feature Tour',
      subtitle: 'Explore guided highlights and onboard new capabilities',
      icon: 'ph-fill ph-sparkle',
      color: '#e5a95d',
      badge: 'Tour',
      action: () => {
        if (window.LinusTour && typeof window.LinusTour.start === 'function') {
          window.LinusTour.start();
        } else {
          $('#sidebar-tour-btn')?.click();
        }
      }
    },
    {
      id: 'act-clear-browser-cache',
      category: 'actions',
      title: 'Clean Browser Cache & Offline Storage',
      subtitle: 'Free browser disk storage. All playlists, tracks and settings remain saved in SQLite',
      icon: 'ph-bold ph-broom',
      color: '#ef4444',
      badge: 'Storage',
      action: () => {
        if (typeof window.clearLinusBrowserCache === 'function') {
          window.clearLinusBrowserCache(true);
        }
      }
    }
  ];

  function switchView(viewName) {
    const navBtn = document.querySelector(`.nav-item[data-view="${viewName}"]`);
    if (navBtn) {
      navBtn.click();
    } else {
      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      $(`#${viewName}-view`)?.classList.remove('hidden');
    }
  }

  // Live Track Search Helper
  function getTrackMatches(query) {
    if (!query) return [];
    const tracks = (window.state && window.state.tracks) ? window.state.tracks : [];
    const q = query.toLowerCase().trim();

    const matches = [];
    for (const t of tracks) {
      const title = (t.title || '').toLowerCase();
      const artist = (t.artist || '').toLowerCase();
      const album = (t.album || '').toLowerCase();
      const category = (t.category || '').toLowerCase();

      let score = 0;
      if (title.startsWith(q)) score += 100;
      else if (title.includes(q)) score += 60;

      if (artist.startsWith(q)) score += 50;
      else if (artist.includes(q)) score += 30;

      if (album.includes(q)) score += 15;
      if (category.includes(q)) score += 10;

      if (score > 0) {
        matches.push({ track: t, score });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 15).map(m => {
      const t = m.track;
      return {
        id: `track-${t.id}`,
        category: 'tracks',
        title: t.title || 'Unknown Title',
        subtitle: `${t.artist || 'Unknown Artist'} • ${t.album || 'Single'}`,
        icon: t.media_type === 'video' ? 'ph-bold ph-film-strip' : 'ph-bold ph-music-notes',
        color: '#e5a95d',
        artworkUrl: t.artwork_url || null,
        badge: t.media_type === 'video' ? 'Video' : 'Track',
        action: () => {
          if (typeof playById === 'function') {
            playById(t.id);
          } else {
            const idx = (window.state?.tracks || []).findIndex(x => x.id === t.id);
            if (idx >= 0 && typeof playTrack === 'function') playTrack(idx);
          }
        },
        queueAction: () => {
          if (typeof addToQueue === 'function') {
            addToQueue(t.id);
            window.showToast?.(`Queued: ${t.title}`);
          }
        }
      };
    });
  }

  // Filter Catalog & Search
  function searchResults(query, filter) {
    const q = (query || '').toLowerCase().trim();

    // 1. Filtered Actions from Catalog
    let actionResults = COMMAND_CATALOG.filter(item => {
      if (filter !== 'all' && item.category !== filter) return false;
      if (!q) return true;
      return item.title.toLowerCase().includes(q) ||
             item.subtitle.toLowerCase().includes(q) ||
             item.id.toLowerCase().includes(q);
    });

    // 2. Track Search (if filter is 'all' or 'tracks')
    let trackResults = [];
    if (filter === 'all' || filter === 'tracks') {
      trackResults = getTrackMatches(q);
    }

    // Combine: if user typed something specific, put high-scoring tracks first, followed by actions
    if (q) {
      return [...trackResults, ...actionResults];
    }
    return actionResults;
  }

  // Render Result DOM Items
  function renderPaletteResults() {
    const container = $('#cmd-palette-results');
    const emptyState = $('#cmd-palette-empty');
    const queryInput = $('#cmd-palette-input');
    const q = queryInput?.value.trim() || '';

    filteredResults = searchResults(q, currentFilter);

    if (filteredResults.length === 0) {
      container.innerHTML = '';
      container.classList.add('hidden');
      if (emptyState) {
        emptyState.classList.remove('hidden');
        const fallbackTxt = $('#cmd-fallback-query');
        if (fallbackTxt) fallbackTxt.textContent = q || 'music';
      }
      return;
    }

    if (emptyState) emptyState.classList.add('hidden');
    container.classList.remove('hidden');

    if (activeIndex >= filteredResults.length) {
      activeIndex = Math.max(0, filteredResults.length - 1);
    }

    let currentGroup = null;
    let html = '';

    filteredResults.forEach((item, idx) => {
      const isSelected = idx === activeIndex;
      const groupName = item.category === 'tracks' ? 'Tracks in Library' :
                        item.category === 'fx' ? 'Audio DSP & Atmosphere' :
                        item.category === 'modes' ? 'Visualizer & Fullscreen Modes' :
                        item.category === 'views' ? 'Navigation' : 'Quick Actions';

      if (groupName !== currentGroup) {
        currentGroup = groupName;
        html += `<div class="cmd-group-header">${currentGroup}</div>`;
      }

      const iconMarkup = item.artworkUrl
        ? `<img src="${item.artworkUrl}" class="cmd-item-art" alt="Cover" loading="lazy" />`
        : `<div class="cmd-item-icon" style="color:${item.color};background:${item.color}15"><i class="${item.icon}"></i></div>`;

      html += `
        <div class="cmd-result-item ${isSelected ? 'active' : ''}" data-idx="${idx}" role="option" aria-selected="${isSelected}">
          ${iconMarkup}
          <div class="cmd-item-meta">
            <span class="cmd-item-title">${escapeHtml(item.title)}</span>
            <span class="cmd-item-sub">${escapeHtml(item.subtitle)}</span>
          </div>
          <div class="cmd-item-right">
            <span class="cmd-badge">${escapeHtml(item.badge)}</span>
            <kbd class="cmd-key-hint">${item.category === 'tracks' ? '↵ Play' : '↵'}</kbd>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    // Scroll active item into view smoothly
    const activeEl = container.querySelector('.cmd-result-item.active');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }

    // Attach click events
    container.querySelectorAll('.cmd-result-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-idx'), 10);
        executeItem(idx);
      });
    });
  }

  function executeItem(idx, isShift = false) {
    if (idx < 0 || idx >= filteredResults.length) return;
    const item = filteredResults[idx];
    closeCommandPalette();

    if (isShift && typeof item.queueAction === 'function') {
      item.queueAction();
    } else if (typeof item.action === 'function') {
      item.action();
    }
  }

  function isQuoteSplashActive() {
    if (window.quoteSplashDismissedAt && (Date.now() - window.quoteSplashDismissedAt < 600)) {
      return true;
    }
    const splash = $('#quote-splash-overlay');
    if (!splash) return false;
    if (window.quoteSplashIsDismissed !== true) {
      if (!splash.classList.contains('hidden') && splash.style.display !== 'none') {
        return true;
      }
    }
    return !splash.classList.contains('hidden') && splash.style.display !== 'none' && !splash.classList.contains('dissolve');
  }

  function openCommandPalette(initialQuery = '') {
    const dialog = $('#command-palette-modal');
    if (!dialog) return;

    // Never open command palette / spotlight while the welcome quote splash is active
    if (isQuoteSplashActive()) return;

    if (!dialog.open) {
      dialog.showModal();
    }

    const input = $('#cmd-palette-input');
    if (input) {
      input.value = initialQuery || '';
      input.focus();
      if (initialQuery) {
        input.select();
      }
    }
    const clearBtn = $('#cmd-palette-clear');
    if (clearBtn) clearBtn.classList.toggle('hidden', !initialQuery);

    activeIndex = 0;
    currentFilter = 'all';

    // Reset filter chips
    $$('#cmd-palette-filter-bar .cmd-filter-chip').forEach(c => {
      c.classList.toggle('active', c.getAttribute('data-filter') === 'all');
    });

    renderPaletteResults();
  }

  function closeCommandPalette() {
    const dialog = $('#command-palette-modal');
    if (dialog && dialog.open) {
      dialog.close();
    }
  }

  // Safe HTML escaper
  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>'"]/g, c => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[c]));
  }

  // Initialize Event Listeners
  function initCommandPalette() {
    const dialog = $('#command-palette-modal');
    const input = $('#cmd-palette-input');
    const clearBtn = $('#cmd-palette-clear');
    const escBadge = $('#cmd-palette-esc-badge');
    const ytFallbackBtn = $('#cmd-yt-fallback-btn');

    if (!dialog || !input) return;

    // 1. Global Keyboard Shortcut: Ctrl+K / Cmd+K and '/'
    window.addEventListener('keydown', (e) => {
      // Never open via keyboard shortcuts while quote splash overlay is visible
      if (isQuoteSplashActive()) return;

      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const cmdKey = isMac ? e.metaKey : e.ctrlKey;

      if (cmdKey && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        if (dialog.open) {
          closeCommandPalette();
        } else {
          const topbarSearch = $('#search');
          const currentVal = topbarSearch ? topbarSearch.value.trim() : '';
          openCommandPalette(currentVal);
        }
        return;
      }

      // Quick '/' shortcut when not typing in an input -> focus top search bar
      if (e.key === '/' && !dialog.open) {
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        if (activeTag !== 'input' && activeTag !== 'textarea') {
          e.preventDefault();
          const topbarSearch = $('#search');
          if (topbarSearch) {
            topbarSearch.focus();
            topbarSearch.select();
          } else {
            openCommandPalette();
          }
          return;
        }
      }
    });

    // 2. Topbar search: Hybrid Direct Typing + Spotlight Palette Trigger
    const topbarSearchWrap = $('.topbar-search');
    const topbarSearch = $('#search');
    const kbdShortcut = $('#search-kbd-shortcut') || $('.search-kbd-hint');

    // Actively purge any unwanted browser autofill (e.g. "groq key" or cached history)
    const purgeStaleAutofill = () => {
      if (!topbarSearch) return;
      if (topbarSearch.value.toLowerCase().includes('groq key') || (!topbarSearch.dataset.userTyped && document.activeElement !== topbarSearch)) {
        topbarSearch.value = '';
      }
    };
    purgeStaleAutofill();
    window.addEventListener('pageshow', purgeStaleAutofill);
    [25, 75, 150, 300, 600, 1000].forEach(ms => setTimeout(purgeStaleAutofill, ms));

    if (topbarSearch) {
      topbarSearch.value = '';
      topbarSearch.addEventListener('input', () => {
        topbarSearch.dataset.userTyped = 'true';
      });
      topbarSearch.addEventListener('focus', () => {
        if (topbarSearch.value.toLowerCase().includes('groq key')) {
          topbarSearch.value = '';
        }
      });
    }

    // Display platform-specific shortcut text (⌘ K on Mac, Ctrl + K on others)
    const isMacPlatform = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    if (kbdShortcut) {
      kbdShortcut.textContent = isMacPlatform ? '⌘ K' : 'Ctrl + K';
      kbdShortcut.setAttribute('title', isMacPlatform ? 'Open Spotlight Palette (Cmd+K)' : 'Open Spotlight Palette (Ctrl+K)');

      // Clicking the shortcut badge opens Spotlight Command Palette
      kbdShortcut.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isQuoteSplashActive()) return;
        const currentVal = topbarSearch ? topbarSearch.value.trim() : '';
        openCommandPalette(currentVal);
      });
    }

    // Clicking search icon opens Spotlight Command Palette
    const searchIcon = $('#topbar-search-icon');
    if (searchIcon) {
      searchIcon.style.cursor = 'pointer';
      searchIcon.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isQuoteSplashActive()) return;
        const currentVal = topbarSearch ? topbarSearch.value.trim() : '';
        openCommandPalette(currentVal);
      });
    }

    // Clicking search wrap background focuses the input field for direct typing
    if (topbarSearchWrap && topbarSearch) {
      topbarSearchWrap.addEventListener('click', (e) => {
        if (e.target !== kbdShortcut && e.target !== searchIcon && document.activeElement !== topbarSearch) {
          topbarSearch.focus();
        }
      });
    }

    // 3. Input Keydown (Arrow navigation, Enter, Shift+Enter, Esc)
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (filteredResults.length > 0) {
          activeIndex = (activeIndex + 1) % filteredResults.length;
          renderPaletteResults();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (filteredResults.length > 0) {
          activeIndex = (activeIndex - 1 + filteredResults.length) % filteredResults.length;
          renderPaletteResults();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        executeItem(activeIndex, e.shiftKey);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
      }
    });

    // 4. Input Live Search
    input.addEventListener('input', () => {
      const val = input.value;
      if (clearBtn) {
        clearBtn.classList.toggle('hidden', val.length === 0);
      }
      activeIndex = 0;
      renderPaletteResults();
    });

    // 5. Clear Button
    clearBtn?.addEventListener('click', () => {
      input.value = '';
      clearBtn.classList.add('hidden');
      input.focus();
      activeIndex = 0;
      renderPaletteResults();
    });

    // 6. Esc badge click
    escBadge?.addEventListener('click', closeCommandPalette);

    // 7. Filter category chips
    $$('#cmd-palette-filter-bar .cmd-filter-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        $$('#cmd-palette-filter-bar .cmd-filter-chip').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.getAttribute('data-filter') || 'all';
        activeIndex = 0;
        renderPaletteResults();
      });
    });

    // 8. YouTube Fallback Search Button
    ytFallbackBtn?.addEventListener('click', () => {
      const q = input.value.trim();
      closeCommandPalette();
      switchView('explore');
      const exploreInput = $('#explore-input');
      const exploreSubmit = $('#explore-submit-btn');
      if (exploreInput && exploreSubmit) {
        exploreInput.value = q;
        exploreSubmit.click();
      }
    });

    // 9. Backdrop Click Auto-Dismiss
    dialog.addEventListener('click', (e) => {
      const rect = dialog.getBoundingClientRect();
      const inDialog = (
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom
      );
      if (!inDialog) {
        closeCommandPalette();
      }
    });
  }

  // Auto-init on DOM ready
  document.addEventListener('DOMContentLoaded', initCommandPalette);

  // Expose API to window
  window.openCommandPalette = openCommandPalette;
  window.closeCommandPalette = closeCommandPalette;

})();
