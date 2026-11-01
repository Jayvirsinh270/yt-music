// ============================================================
// Linus — Smart Rule-Based Dynamic Playlists Frontend Engine
// Auto-updating Curation, Tempo/BPM Filtering, and Mosaic Stage
// ============================================================

(function () {
  'use strict';

  const $ = window.$ || (sel => document.querySelector(sel));
  let cachedSmartPlaylists = [];
  let currentSmartPlaylistId = null;

  async function loadSmartPlaylists() {
    const container = $('#smart-playlists-list');
    if (!container) return;

    try {
      const res = await fetch('/api/smart-playlists').then(r => r.json());
      if (res.status !== 'success' || !res.playlists) return;

      cachedSmartPlaylists = res.playlists;
      renderSmartCards(res.playlists);
    } catch (e) {
      console.warn('[SmartPlaylists] Failed to load smart playlists:', e);
    }
  }

  function renderSmartCards(playlists) {
    const container = $('#smart-playlists-list');
    if (!container) return;

    container.innerHTML = playlists.map(p => {
      const countStr = `${p.count} track${p.count === 1 ? '' : 's'}`;
      const durMin = Math.round((p.total_duration || 0) / 60);
      const timeStr = durMin > 0 ? ` · ${durMin} min` : '';

      // Cover: 2x2 mosaic if 4+ thumbnails available, else icon on gradient
      let coverHtml;
      if (p.sample_thumbnails && p.sample_thumbnails.length >= 4) {
        coverHtml = `
          <div class="smart-mosaic-grid">
            <img src="${p.sample_thumbnails[0]}" alt="Art">
            <img src="${p.sample_thumbnails[1]}" alt="Art">
            <img src="${p.sample_thumbnails[2]}" alt="Art">
            <img src="${p.sample_thumbnails[3]}" alt="Art">
          </div>
        `;
      } else if (p.sample_thumbnails && p.sample_thumbnails.length > 0) {
        coverHtml = `<img src="${p.sample_thumbnails[0]}" alt="Cover" style="width:100%;height:100%;object-fit:cover;">`;
      } else {
        coverHtml = `<i class="${p.icon}" style="color:${p.accent};font-size:46px;filter:drop-shadow(0 0 16px ${p.accent}66);"></i>`;
      }

      return `
        <div class="playlist-card smart-playlist-card" data-smart-id="${p.id}" style="border-left: 3px solid ${p.accent};">
          <span class="smart-playlist-badge" style="color:${p.accent};border-color:${p.accent}55;background:${p.accent}20;">
            <i class="${p.icon}"></i> ${p.badge}
          </span>
          <div class="playlist-cover-art" style="background: ${p.gradient};">
            ${coverHtml}
          </div>
          <div class="playlist-info">
            <strong>${escapeSmartHtml(p.title)}</strong>
            <span style="display:block;margin-bottom:2px;font-size:11.5px;color:rgba(255,255,255,0.7);line-height:1.3;">
              ${escapeSmartHtml(p.description)}
            </span>
            <span style="color:${p.accent};font-weight:600;font-size:12px;">${countStr}${timeStr}</span>
          </div>
          <div class="playlist-actions-row">
            <button class="playlist-play-btn smart-play-btn" data-smart-play="${p.id}" title="Play Smart Playlist">
              <i class="ph-fill ph-play"></i> Play
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Bind event handlers
    container.querySelectorAll('.smart-playlist-card').forEach(card => {
      const smartId = card.dataset.smartId;
      card.addEventListener('click', (e) => {
        if (e.target.closest('.smart-play-btn')) return;
        openSmartPlaylistDetail(smartId);
      });
    });

    container.querySelectorAll('.smart-play-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const smartId = btn.dataset.smartPlay;
        playSmartPlaylist(smartId, false);
      });
    });
  }

  async function openSmartPlaylistDetail(smartId) {
    const meta = cachedSmartPlaylists.find(p => p.id === smartId);
    if (!meta) return;

    currentSmartPlaylistId = smartId;

    // Toggle view elements
    $('#playlists-overview')?.classList.add('hidden');
    $('#playlist-detail-view')?.classList.remove('hidden');

    // Update Header Meta
    $('#playlist-detail-title').textContent = meta.title;
    const durMin = Math.round((meta.total_duration || 0) / 60);
    $('#playlist-detail-stats').innerHTML = `<span style="color:${meta.accent};font-weight:600;"><i class="${meta.icon}"></i> Smart Autoplaylist</span> · ${meta.count} tracks · ${durMin} min (Auto-Updating)`;

    // Update Cover
    const coverBox = $('#playlist-detail-cover');
    if (coverBox) {
      coverBox.style.background = meta.gradient;
      if (meta.sample_thumbnails && meta.sample_thumbnails.length >= 4) {
        coverBox.innerHTML = `
          <div class="smart-mosaic-grid" style="width:100%;height:100%;">
            <img src="${meta.sample_thumbnails[0]}" alt="Art">
            <img src="${meta.sample_thumbnails[1]}" alt="Art">
            <img src="${meta.sample_thumbnails[2]}" alt="Art">
            <img src="${meta.sample_thumbnails[3]}" alt="Art">
          </div>
        `;
      } else if (meta.sample_thumbnails && meta.sample_thumbnails.length > 0) {
        coverBox.innerHTML = `<img src="${meta.sample_thumbnails[0]}" alt="Art" style="width:100%;height:100%;object-fit:cover;">`;
      } else {
        coverBox.innerHTML = `<i class="${meta.icon}" style="color:${meta.accent};font-size:56px;filter:drop-shadow(0 0 20px ${meta.accent}88);"></i>`;
      }
    }

    // Hide delete button for built-in smart playlist
    const delBtn = $('#playlist-detail-delete');
    if (delBtn) delBtn.style.display = 'none';

    // Fetch live tracks
    const trackList = $('#playlist-track-list');
    const emptyState = $('#playlist-detail-empty');
    if (trackList) trackList.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);"><i class="ph-bold ph-spinner ph-spin" style="font-size:24px;"></i><br>Evaluating smart rules...</div>';

    try {
      const res = await fetch(`/api/smart-playlists/${smartId}`).then(r => r.json());
      const tracks = res.tracks || [];

      if (!tracks.length) {
        if (trackList) trackList.innerHTML = '';
        if (emptyState) emptyState.classList.remove('hidden');
        return;
      }

      if (emptyState) emptyState.classList.add('hidden');
      renderSmartTrackTable(tracks);

      // Bind Play & Shuffle buttons
      const playBtn = $('#playlist-detail-play');
      const shufBtn = $('#playlist-detail-shuffle');

      if (playBtn) {
        playBtn.onclick = () => playTracksInQueue(tracks, false);
      }
      if (shufBtn) {
        shufBtn.onclick = () => playTracksInQueue(tracks, true);
      }
    } catch (e) {
      if (trackList) trackList.innerHTML = '<div style="padding:40px;text-align:center;color:#ef4444;">Failed to load smart playlist tracks.</div>';
    }
  }

  function renderSmartTrackTable(tracks) {
    const list = $('#playlist-track-list');
    if (!list) return;

    const currentPlayingId = (window.queue && typeof window.currentIndex === 'number' && window.queue[window.currentIndex]) ? window.queue[window.currentIndex].id : null;

    list.innerHTML = tracks.map((t, i) => {
      const isCurrent = t.id === currentPlayingId;
      const artHtml = (t.has_artwork && t.artwork_url)
        ? `<img src="${t.artwork_url}" alt="art" class="track-thumb">`
        : `<div class="track-thumb-placeholder"><i class="ph-fill ph-music-notes"></i></div>`;

      const bpmBadge = t.bpm ? `<span style="font-size:10.5px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.08);color:var(--accent);margin-left:6px;">${Math.round(t.bpm)} BPM</span>` : '';

      return `
        <div class="track-row ${isCurrent ? 'playing' : ''}" data-id="${t.id}" data-index="${i}">
          <div class="track-index">
            <span class="track-num">${i + 1}</span>
            <i class="ph-fill ph-play track-play-icon"></i>
          </div>
          <div class="track-title-col">
            ${artHtml}
            <div class="track-meta">
              <span class="track-name">${escapeSmartHtml(t.title)} ${bpmBadge}</span>
              <span class="track-artist-sub">${escapeSmartHtml(t.artist || 'Unknown')}</span>
            </div>
          </div>
          <div class="track-album-col">${escapeSmartHtml(t.album || '—')}</div>
          <div class="track-duration-col">${formatSmartTime(t.duration)}</div>
          <div class="track-actions-col">
            <button class="icon-btn-ghost fav-btn" data-id="${t.id}" title="Toggle Favorite"><i class="ph ph-heart"></i></button>
            <button class="icon-btn-ghost queue-add-btn" data-id="${t.id}" title="Add to Queue"><i class="ph ph-list-plus"></i></button>
          </div>
        </div>
      `;
    }).join('');

    // Row click to play
    list.querySelectorAll('.track-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.fav-btn') || e.target.closest('.queue-add-btn')) return;
        const idx = parseInt(row.dataset.index, 10);
        window.queue = [...tracks];
        window.currentIndex = idx;
        const targetTrack = tracks[idx];
        if (targetTrack && typeof window.playById === 'function') {
          window.playById(targetTrack.id);
        }
      });
    });
  }

  async function playSmartPlaylist(smartId, shuffle = false) {
    try {
      const res = await fetch(`/api/smart-playlists/${smartId}`).then(r => r.json());
      const tracks = res.tracks || [];
      if (!tracks.length) {
        window.showToast?.('No tracks found for this smart rule.');
        return;
      }
      playTracksInQueue(tracks, shuffle);
      const meta = cachedSmartPlaylists.find(p => p.id === smartId);
      window.showToast?.(`▶ Playing Smart Playlist: ${meta ? meta.title : smartId}`);
    } catch (e) {
      window.showToast?.('Error starting smart playlist');
    }
  }

  function playTracksInQueue(tracks, shuffle = false) {
    if (!tracks || !tracks.length) return;
    let playQueue = [...tracks];
    if (shuffle) {
      for (let i = playQueue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [playQueue[i], playQueue[j]] = [playQueue[j], playQueue[i]];
      }
    }
    window.queue = playQueue;
    window.currentIndex = 0;
    if (typeof window.renderQueue === 'function') window.renderQueue();
    if (typeof window.playById === 'function') {
      window.playById(playQueue[0].id);
    }
  }

  function escapeSmartHtml(str) {
    return String(str || '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
  }

  function formatSmartTime(s) {
    if (!Number.isFinite(s)) return '0:00';
    return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  // Hook into navigation & back button
  document.addEventListener('DOMContentLoaded', () => {
    // When back button is clicked in playlist details, restore overview
    const backBtn = $('#playlist-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', () => {
        const delBtn = $('#playlist-detail-delete');
        if (delBtn) delBtn.style.display = '';
        currentSmartPlaylistId = null;
      });
    }

    // Load smart playlists when entering playlist view
    document.querySelectorAll('[data-view="playlists"]').forEach(btn => {
      btn.addEventListener('click', () => {
        setTimeout(loadSmartPlaylists, 50);
      });
    });

    // Initial load
    setTimeout(loadSmartPlaylists, 800);
  });

  // Global exports
  window.SmartPlaylists = {
    load: loadSmartPlaylists,
    play: playSmartPlaylist,
    openDetail: openSmartPlaylistDetail,
    getAll: () => cachedSmartPlaylists
  };

})();
