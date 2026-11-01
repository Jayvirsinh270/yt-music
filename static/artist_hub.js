/**
 * artist_hub.js — Artist & Album Discography Hub Controller for Linus
 */

window.LinusArtistHub = (() => {
  let _artists = [];
  let _albums = [];
  let _activeTab = 'artists';
  let _loaded = false;

  // DOM Elements
  const tabArtistsBtn = document.getElementById('tab-artists-btn');
  const tabAlbumsBtn = document.getElementById('tab-albums-btn');
  const searchInput = document.getElementById('artist-hub-search-input');
  const countLabel = document.getElementById('artist-hub-count-label');

  const mainContainer = document.getElementById('artist-hub-main-container');
  const artistsSection = document.getElementById('artist-hub-artists-section');
  const albumsSection = document.getElementById('artist-hub-albums-section');
  const artistsGrid = document.getElementById('artists-grid');
  const albumsGrid = document.getElementById('albums-grid');

  const artistProfilePanel = document.getElementById('artist-profile-panel');
  const albumDetailPanel = document.getElementById('album-detail-panel');

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(sec) {
    if (!sec) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  async function loadData(force = false) {
    if (_loaded && !force) return;
    countLabel.textContent = 'Refreshing catalog...';

    try {
      const [artistsRes, albumsRes] = await Promise.all([
        fetch('/api/artists').then(r => r.json()),
        fetch('/api/albums').then(r => r.json())
      ]);

      _artists = artistsRes.artists || [];
      _albums = albumsRes.albums || [];
      _loaded = true;

      render();
    } catch (e) {
      countLabel.textContent = 'Failed to load artists & albums.';
    }
  }

  function render() {
    const q = (searchInput?.value || '').trim().toLowerCase();

    if (_activeTab === 'artists') {
      artistsSection.classList.remove('hidden');
      albumsSection.classList.add('hidden');

      const filtered = _artists.filter(a => !q || a.name.toLowerCase().includes(q));
      countLabel.textContent = `${filtered.length} Artist${filtered.length === 1 ? '' : 's'}`;

      if (filtered.length === 0) {
        artistsGrid.innerHTML = `<div class="muted py-8 text-center" style="grid-column: 1/-1;">No artists found matching "${escapeHtml(q)}"</div>`;
        return;
      }

      artistsGrid.innerHTML = filtered.map(a => `
        <div class="artist-card" data-artist="${escapeHtml(a.name)}">
          <div class="artist-avatar-wrap">
            ${a.artwork_url 
              ? `<img class="artist-avatar-img" src="${escapeHtml(a.artwork_url)}" alt="${escapeHtml(a.name)}" loading="lazy" onerror="this.outerHTML='<i class=\\'ph-fill ph-user artist-avatar-icon\\'></i>'">`
              : `<i class="ph-fill ph-user artist-avatar-icon"></i>`
            }
          </div>
          <div class="artist-name" title="${escapeHtml(a.name)}">${escapeHtml(a.name)}</div>
          <div class="artist-meta">${a.track_count} Track${a.track_count === 1 ? '' : 's'} • ${a.album_count} Album${a.album_count === 1 ? '' : 's'}</div>
        </div>
      `).join('');

      artistsGrid.querySelectorAll('.artist-card').forEach(card => {
        card.addEventListener('click', () => openArtist(card.dataset.artist));
      });

    } else {
      artistsSection.classList.add('hidden');
      albumsSection.classList.remove('hidden');

      const filtered = _albums.filter(alb => 
        !q || alb.name.toLowerCase().includes(q) || alb.artist.toLowerCase().includes(q)
      );
      countLabel.textContent = `${filtered.length} Album${filtered.length === 1 ? '' : 's'}`;

      if (filtered.length === 0) {
        albumsGrid.innerHTML = `<div class="muted py-8 text-center" style="grid-column: 1/-1;">No albums found matching "${escapeHtml(q)}"</div>`;
        return;
      }

      albumsGrid.innerHTML = filtered.map(alb => `
        <div class="album-card" data-album="${escapeHtml(alb.name)}">
          <div class="album-cover-wrap">
            ${alb.artwork_url 
              ? `<img class="album-cover-img" src="${escapeHtml(alb.artwork_url)}" alt="${escapeHtml(alb.name)}" loading="lazy" onerror="this.outerHTML='<i class=\\'ph-fill ph-disc album-cover-icon\\'></i>'">`
              : `<i class="ph-fill ph-disc album-cover-icon"></i>`
            }
            <div class="album-play-overlay" title="Play Album"><i class="ph-fill ph-play"></i></div>
          </div>
          <div class="album-info">
            <div class="album-title" title="${escapeHtml(alb.name)}">${escapeHtml(alb.name)}</div>
            <div class="album-artist" title="${escapeHtml(alb.artist)}">${escapeHtml(alb.artist)}</div>
            <div class="album-meta">${alb.track_count} Track${alb.track_count === 1 ? '' : 's'}</div>
          </div>
        </div>
      `).join('');

      albumsGrid.querySelectorAll('.album-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.album-play-overlay')) {
            playAlbumByName(card.dataset.album);
          } else {
            openAlbum(card.dataset.album);
          }
        });
      });
    }
  }

  // Open Artist Profile
  async function openArtist(artistName) {
    if (!artistName) return;
    mainContainer.classList.add('hidden');
    albumDetailPanel.classList.add('hidden');
    artistProfilePanel.classList.remove('hidden');

    // Make sure we're on the artist-hub view
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    document.querySelector('[data-view="artist-hub"]')?.classList.add('active');
    document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
    document.getElementById('artist-hub-view')?.classList.remove('hidden');

    try {
      const res = await fetch(`/api/artist/${encodeURIComponent(artistName)}`).then(r => r.json());
      if (!res.artist) return;
      const art = res.artist;

      document.getElementById('artist-hero-name').textContent = art.name;
      document.getElementById('artist-hero-stats').textContent = `${art.track_count} Tracks • ${art.album_count} Albums • ${Math.round(art.total_duration / 60)} mins total`;

      const avatarImg = document.getElementById('artist-hero-avatar');
      const placeholder = document.getElementById('artist-hero-placeholder');
      if (art.artwork_url) {
        avatarImg.src = art.artwork_url;
        avatarImg.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        avatarImg.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }

      // Top tracks
      const topList = document.getElementById('artist-top-tracks-list');
      topList.innerHTML = art.top_tracks.map((t, idx) => `
        <div class="track-row" data-id="${escapeHtml(t.id)}">
          <span class="track-num">${idx + 1}</span>
          <div class="track-info" style="flex:1;">
            <div class="track-title">${escapeHtml(t.title)}</div>
            <div class="track-sub muted text-xs">${escapeHtml(t.album || 'Single')}</div>
          </div>
          <span class="track-duration text-xs muted">${formatDuration(t.duration)}</span>
          <button class="track-action play-btn" title="Play"><i class="ph-fill ph-play"></i></button>
        </div>
      `).join('');

      topList.querySelectorAll('.track-row').forEach(row => {
        row.addEventListener('click', () => {
          if (typeof playById === 'function') {
            if (typeof queue !== 'undefined') queue = [...art.all_tracks];
            playById(row.dataset.id);
          }
        });
      });

      // Discography
      const discoGrid = document.getElementById('artist-discography-grid');
      discoGrid.innerHTML = art.albums.map(alb => `
        <div class="album-card" data-album="${escapeHtml(alb.name)}">
          <div class="album-cover-wrap">
            ${alb.artwork_url 
              ? `<img class="album-cover-img" src="${escapeHtml(alb.artwork_url)}" alt="${escapeHtml(alb.name)}" loading="lazy">`
              : `<i class="ph-fill ph-disc album-cover-icon"></i>`
            }
            <div class="album-play-overlay"><i class="ph-fill ph-play"></i></div>
          </div>
          <div class="album-info">
            <div class="album-title">${escapeHtml(alb.name)}</div>
            <div class="album-meta">${alb.track_count} Tracks • ${formatDuration(alb.duration)}</div>
          </div>
        </div>
      `).join('');

      discoGrid.querySelectorAll('.album-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('.album-play-overlay')) {
            playAlbumByName(card.dataset.album);
          } else {
            openAlbum(card.dataset.album);
          }
        });
      });

      // Play All & Shuffle Buttons
      document.getElementById('artist-play-all-btn').onclick = () => {
        if (art.all_tracks.length && typeof playById === 'function') {
          if (typeof queue !== 'undefined') queue = [...art.all_tracks];
          playById(art.all_tracks[0].id);
        }
      };

      document.getElementById('artist-shuffle-btn').onclick = () => {
        if (art.all_tracks.length && typeof playById === 'function') {
          const shuffled = [...art.all_tracks].sort(() => Math.random() - 0.5);
          if (typeof queue !== 'undefined') queue = shuffled;
          playById(shuffled[0].id);
        }
      };

    } catch (e) {
      console.error('Error loading artist:', e);
    }
  }

  // Open Album Detail
  async function openAlbum(albumName) {
    if (!albumName) return;
    mainContainer.classList.add('hidden');
    artistProfilePanel.classList.add('hidden');
    albumDetailPanel.classList.remove('hidden');

    try {
      const res = await fetch(`/api/album/${encodeURIComponent(albumName)}`).then(r => r.json());
      if (!res.album) return;
      const alb = res.album;

      document.getElementById('album-hero-title').textContent = alb.name;
      document.getElementById('album-hero-artist').textContent = `by ${alb.artist}`;
      document.getElementById('album-hero-stats').textContent = `${alb.track_count} Tracks • ${Math.round(alb.total_duration / 60)} mins total`;

      const coverImg = document.getElementById('album-hero-cover');
      const placeholder = document.getElementById('album-hero-placeholder');
      if (alb.artwork_url) {
        coverImg.src = alb.artwork_url;
        coverImg.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        coverImg.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }

      const list = document.getElementById('album-tracks-list');
      list.innerHTML = alb.tracks.map((t, idx) => `
        <div class="track-row" data-id="${escapeHtml(t.id)}">
          <span class="track-num">${idx + 1}</span>
          <div class="track-info" style="flex:1;">
            <div class="track-title">${escapeHtml(t.title)}</div>
            <div class="track-sub muted text-xs">${escapeHtml(t.artist)}</div>
          </div>
          <span class="track-duration text-xs muted">${formatDuration(t.duration)}</span>
          <button class="track-action play-btn" title="Play"><i class="ph-fill ph-play"></i></button>
        </div>
      `).join('');

      list.querySelectorAll('.track-row').forEach(row => {
        row.addEventListener('click', () => {
          if (typeof playById === 'function') {
            if (typeof queue !== 'undefined') queue = [...alb.tracks];
            playById(row.dataset.id);
          }
        });
      });

      document.getElementById('album-play-all-btn').onclick = () => {
        if (alb.tracks.length && typeof playById === 'function') {
          if (typeof queue !== 'undefined') queue = [...alb.tracks];
          playById(alb.tracks[0].id);
        }
      };

      document.getElementById('album-shuffle-btn').onclick = () => {
        if (alb.tracks.length && typeof playById === 'function') {
          const shuffled = [...alb.tracks].sort(() => Math.random() - 0.5);
          if (typeof queue !== 'undefined') queue = shuffled;
          playById(shuffled[0].id);
        }
      };

    } catch (e) {
      console.error('Error loading album:', e);
    }
  }

  async function playAlbumByName(albumName) {
    try {
      const res = await fetch(`/api/album/${encodeURIComponent(albumName)}`).then(r => r.json());
      if (res.album && res.album.tracks.length && typeof playById === 'function') {
        if (typeof queue !== 'undefined') queue = [...res.album.tracks];
        playById(res.album.tracks[0].id);
      }
    } catch (e) {}
  }

  function init() {
    tabArtistsBtn?.addEventListener('click', () => {
      _activeTab = 'artists';
      tabArtistsBtn.classList.add('active');
      tabAlbumsBtn.classList.remove('active');
      render();
    });

    tabAlbumsBtn?.addEventListener('click', () => {
      _activeTab = 'albums';
      tabAlbumsBtn.classList.add('active');
      tabArtistsBtn.classList.remove('active');
      render();
    });

    searchInput?.addEventListener('input', () => {
      render();
    });

    document.getElementById('artist-profile-back-btn')?.addEventListener('click', () => {
      artistProfilePanel.classList.add('hidden');
      mainContainer.classList.remove('hidden');
    });

    document.getElementById('album-detail-back-btn')?.addEventListener('click', () => {
      albumDetailPanel.classList.add('hidden');
      mainContainer.classList.remove('hidden');
    });

    // Auto-fetch when nav item is clicked
    document.querySelector('[data-view="artist-hub"]')?.addEventListener('click', () => {
      loadData();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    openArtist,
    openAlbum,
    loadData
  };
})();
