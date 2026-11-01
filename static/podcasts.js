/**
 * podcasts.js — Podcast & RSS Audio Feed Controller for Linus
 */

window.LinusPodcasts = (() => {
  let _podcasts = [];
  let _currentPodcast = null;
  let _activeEpisode = null;
  let _saveInterval = null;

  const showsContainer = document.getElementById('podcast-shows-container');
  const detailPanel = document.getElementById('podcast-detail-panel');
  const grid = document.getElementById('podcasts-grid');
  const episodesList = document.getElementById('podcast-episodes-list');

  const subscribeDialog = document.getElementById('podcast-subscribe-dialog');
  const subscribeInput = document.getElementById('podcast-rss-input');
  const subscribeBtn = document.getElementById('podcast-confirm-subscribe-btn');
  const dialogStatus = document.getElementById('podcast-dialog-status');

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function formatDuration(sec) {
    if (!sec) return 'Variable length';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) {
      return `${h}h ${m}m`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  async function loadPodcasts() {
    try {
      const res = await fetch('/api/podcasts').then(r => r.json());
      _podcasts = res.podcasts || [];
      renderShows();
    } catch (e) {
      console.error('Failed to load podcasts:', e);
    }
  }

  function renderShows() {
    if (!grid) return;
    if (_podcasts.length === 0) {
      grid.innerHTML = `
        <div class="muted py-8 text-center" style="grid-column: 1/-1;">
          No podcast subscriptions yet. Click <strong>Subscribe RSS</strong> or pick one of the featured shows above!
        </div>
      `;
      return;
    }

    grid.innerHTML = _podcasts.map(p => `
      <div class="podcast-card" data-id="${escapeHtml(p.id)}">
        <div class="podcast-cover-wrap">
          ${p.artwork_url 
            ? `<img class="podcast-cover-img" src="${escapeHtml(p.artwork_url)}" alt="${escapeHtml(p.title)}" loading="lazy" onerror="this.outerHTML='<i class=\\'ph-fill ph-broadcast podcast-cover-icon\\'></i>'">`
            : `<i class="ph-fill ph-broadcast podcast-cover-icon"></i>`
          }
        </div>
        <div class="podcast-card-info">
          <div class="podcast-card-title" title="${escapeHtml(p.title)}">${escapeHtml(p.title)}</div>
          <div class="podcast-card-author" title="${escapeHtml(p.author)}">${escapeHtml(p.author)}</div>
          <div class="podcast-card-meta">${p.episode_count} Episodes</div>
        </div>
      </div>
    `).join('');

    grid.querySelectorAll('.podcast-card').forEach(card => {
      card.addEventListener('click', () => openPodcast(card.dataset.id));
    });
  }

  async function openPodcast(podcastId) {
    if (!podcastId) return;
    showsContainer.classList.add('hidden');
    detailPanel.classList.remove('hidden');

    try {
      const res = await fetch(`/api/podcast/${encodeURIComponent(podcastId)}`).then(r => r.json());
      if (!res.podcast) return;
      _currentPodcast = res.podcast;

      document.getElementById('podcast-hero-title').textContent = _currentPodcast.title;
      document.getElementById('podcast-hero-author').textContent = `Hosted by ${_currentPodcast.author}`;
      document.getElementById('podcast-hero-desc').textContent = _currentPodcast.description || '';

      const coverImg = document.getElementById('podcast-hero-cover');
      const placeholder = document.getElementById('podcast-hero-placeholder');
      if (_currentPodcast.artwork_url) {
        coverImg.src = _currentPodcast.artwork_url;
        coverImg.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        coverImg.classList.add('hidden');
        placeholder.classList.remove('hidden');
      }

      // Render episodes
      episodesList.innerHTML = (_currentPodcast.episodes || []).map(ep => {
        const resumePos = ep.playback_position > 30 ? Math.floor(ep.playback_position) : 0;
        return `
          <div class="podcast-episode-row" data-id="${escapeHtml(ep.id)}">
            <button class="podcast-ep-play-btn" title="Play Episode"><i class="ph-fill ph-play"></i></button>
            <div class="podcast-ep-details">
              <div class="podcast-ep-title">${escapeHtml(ep.title)}</div>
              <div class="podcast-ep-desc">${escapeHtml(ep.description)}</div>
              <div class="podcast-ep-meta">
                <span>${escapeHtml(ep.pub_date || '')}</span>
                <span>•</span>
                <span>${formatDuration(ep.duration)}</span>
                ${resumePos ? `<span class="podcast-resume-badge">Resume at ${Math.floor(resumePos / 60)}m</span>` : ''}
              </div>
            </div>
          </div>
        `;
      }).join('');

      episodesList.querySelectorAll('.podcast-episode-row').forEach(row => {
        row.addEventListener('click', () => {
          const ep = _currentPodcast.episodes.find(e => e.id === row.dataset.id);
          if (ep) playEpisode(ep, _currentPodcast);
        });
      });

      document.getElementById('podcast-unsubscribe-btn').onclick = async () => {
        if (!confirm(`Unsubscribe from ${_currentPodcast.title}?`)) return;
        await fetch(`/api/podcast/unsubscribe/${encodeURIComponent(_currentPodcast.id)}`, { method: 'POST' });
        detailPanel.classList.add('hidden');
        showsContainer.classList.remove('hidden');
        loadPodcasts();
      };

    } catch (e) {
      console.error('Error opening podcast:', e);
    }
  }

  function playEpisode(episode, podcast) {
    _activeEpisode = episode;
    const audioEl = window.audio || document.querySelector('#audio');
    if (!audioEl) return;

    // Load stream into main audio player
    audioEl.src = episode.audio_url;

    // Resume position if available
    if (episode.playback_position > 30) {
      audioEl.currentTime = episode.playback_position;
    } else {
      audioEl.currentTime = 0;
    }

    audioEl.play().catch(() => {});

    // Update player UI elements
    const nowTitle = document.querySelector('#now-title');
    const nowArtist = document.querySelector('#now-artist');
    const nowArt = document.querySelector('#now-art');

    if (nowTitle) nowTitle.textContent = episode.title;
    if (nowArtist) nowArtist.textContent = podcast.title || podcast.author;
    if (nowArt && (episode.artwork_url || podcast.artwork_url)) {
      nowArt.src = episode.artwork_url || podcast.artwork_url;
      nowArt.classList.remove('hidden');
    }

    window.showToast?.(`🎙️ Playing: ${episode.title}`);

    // Auto-save playback position every 15 seconds
    if (_saveInterval) clearInterval(_saveInterval);
    _saveInterval = setInterval(() => {
      if (_activeEpisode && audioEl && !audioEl.paused) {
        savePosition(_activeEpisode.id, audioEl.currentTime);
      }
    }, 15000);
  }

  async function savePosition(epId, pos) {
    try {
      await fetch('/api/podcast/episode/position', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episode_id: epId, position: pos })
      });
    } catch (e) {}
  }

  async function subscribe(url) {
    if (!url) return;
    if (dialogStatus) {
      dialogStatus.style.color = '#38bdf8';
      dialogStatus.textContent = '⏳ Fetching and indexing RSS feed...';
    }

    try {
      const res = await fetch('/api/podcast/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() })
      });
      const data = await res.json();

      if (res.ok && data.podcast) {
        if (dialogStatus) {
          dialogStatus.style.color = '#10b981';
          dialogStatus.textContent = `✅ Subscribed to ${data.podcast.title}!`;
        }
        setTimeout(() => {
          subscribeDialog?.close();
          if (dialogStatus) dialogStatus.textContent = '';
          if (subscribeInput) subscribeInput.value = '';
          loadPodcasts();
          openPodcast(data.podcast.id);
        }, 1000);
      } else {
        if (dialogStatus) {
          dialogStatus.style.color = '#ef4444';
          dialogStatus.textContent = `❌ ${data.message || 'Could not parse RSS feed.'}`;
        }
      }
    } catch (e) {
      if (dialogStatus) {
        dialogStatus.style.color = '#ef4444';
        dialogStatus.textContent = '❌ Failed to reach RSS feed server.';
      }
    }
  }

  function init() {
    loadPodcasts();

    document.getElementById('podcast-subscribe-modal-btn')?.addEventListener('click', () => {
      if (dialogStatus) dialogStatus.textContent = '';
      if (subscribeInput) subscribeInput.value = '';
      subscribeDialog?.showModal();
    });

    document.getElementById('podcast-dialog-close')?.addEventListener('click', () => {
      subscribeDialog?.close();
    });

    subscribeBtn?.addEventListener('click', () => {
      const url = (subscribeInput?.value || '').trim();
      subscribe(url);
    });

    // Quick suggestion pills
    document.querySelectorAll('.podcast-quick-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        window.showToast?.('Subscribing to podcast...');
        subscribe(pill.dataset.feed);
      });
    });

    document.getElementById('podcast-detail-back-btn')?.addEventListener('click', () => {
      detailPanel.classList.add('hidden');
      showsContainer.classList.remove('hidden');
      loadPodcasts();
    });

    // Auto-fetch when nav item is clicked
    document.querySelector('[data-view="podcasts"]')?.addEventListener('click', () => {
      loadPodcasts();
    });
  }

  document.addEventListener('DOMContentLoaded', init);

  return {
    loadPodcasts,
    openPodcast,
    subscribe
  };
})();
