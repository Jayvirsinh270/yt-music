// ---- YouTube Explore & Instant 1-Click Download + Stream -----

// Pagination state
if (typeof _ytSearchQuery === 'undefined') var _ytSearchQuery = '';
if (typeof _ytSearchOffset === 'undefined') var _ytSearchOffset = 0;
const _YT_PAGE_SIZE = 12;
if (typeof _ytCurrentStreamId === 'undefined') var _ytCurrentStreamId = '';
if (typeof _ytCurrentStreamType === 'undefined') var _ytCurrentStreamType = '';
if (typeof _ytCurrentStreamTrack === 'undefined') var _ytCurrentStreamTrack = null;

function getActivePlaybackTrack() {
  if (_ytCurrentStreamId && _ytCurrentStreamTrack) {
    return _ytCurrentStreamTrack;
  }
  return queue[currentIndex] || null;
}

function _buildExploreCardHTML(item) {
  const isStreaming = item.id && item.id === _ytCurrentStreamId;
  const isAudioPlaying = isStreaming && _ytCurrentStreamType === 'audio';
  const isVideoPlaying = isStreaming && _ytCurrentStreamType === 'video';

  return `
    <div class="explore-card${isStreaming ? ' now-streaming' : ''}" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(item.title)}" data-vid="${escapeHtml(item.id)}">
      <div class="explore-card-thumb">
        <img src="${escapeHtml(item.thumbnail)}" alt="Thumbnail" loading="lazy">
        ${item.duration_string ? `<span class="explore-dur-badge">${escapeHtml(item.duration_string)}</span>` : ''}
      </div>
      <div class="explore-card-body">
        <div class="explore-card-info">
          <strong title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</strong>
          <span><i class="ph ph-youtube-logo" style="color:#ff4444;margin-right:4px;"></i>${escapeHtml(item.artist)}</span>
        </div>
        <div class="explore-card-quick">
          <button class="explore-stream-btn${isAudioPlaying ? ' is-playing' : ''}" data-vid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist)}" data-thumb="${escapeHtml(item.thumbnail)}" data-dur="${item.duration || 0}" title="Stream Audio">
            <i class="ph-fill ${isAudioPlaying ? 'ph-pause' : 'ph-play'}"></i>
          </button>
          <button class="explore-preview-btn" data-vid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist)}" data-thumb="${escapeHtml(item.thumbnail)}" data-dur="${item.duration || 0}" title="Quick 20s Preview">
            <i class="ph-bold ph-speaker-simple-high"></i>
          </button>
          <button class="explore-play-next-btn" data-vid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist)}" data-thumb="${escapeHtml(item.thumbnail)}" data-dur="${item.duration || 0}" title="Play Next in Queue">
            <i class="ph-bold ph-queue"></i>
          </button>
          <button class="explore-queue-add-btn" data-vid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist)}" data-thumb="${escapeHtml(item.thumbnail)}" data-dur="${item.duration || 0}" title="Add to Play Queue">
            <i class="ph-bold ph-list-plus"></i>
          </button>
          <button class="explore-radio-btn" data-vid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist)}" data-thumb="${escapeHtml(item.thumbnail)}" data-dur="${item.duration || 0}" title="Start Radio from this track">
            <i class="ph-bold ph-radio"></i>
          </button>
          <button class="explore-video-stream-btn${isVideoPlaying ? ' is-playing' : ''}" data-vid="${escapeHtml(item.id)}" data-title="${escapeHtml(item.title)}" data-artist="${escapeHtml(item.artist)}" data-thumb="${escapeHtml(item.thumbnail)}" data-dur="${item.duration || 0}" title="Stream Video">
            <i class="ph-fill ph-monitor-play"></i>
            <span>Video</span>
          </button>
          <button class="explore-expand-btn" title="Download options">
            <i class="ph ph-download-simple"></i>
          </button>
        </div>
        <div class="explore-card-expand hidden">
          <div class="explore-expand-label"><i class="ph ph-download-simple"></i> Download Options</div>
          <div class="explore-expand-actions">
            <button class="explore-dl-btn dl-mp3-btn" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(item.title)}">
              <i class="ph ph-music-notes"></i> MP3
            </button>
            <button class="explore-dl-btn dl-mp4-btn" data-url="${escapeHtml(item.url)}" data-title="${escapeHtml(item.title)}">
              <i class="ph ph-video-camera"></i> MP4
            </button>
            <button class="explore-dl-btn btn-custom dl-custom-btn" data-url="${escapeHtml(item.url)}" title="Custom Quality / Format">
              <i class="ph ph-gear"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function _attachExploreCardHandlers(container) {
  // Clicking anywhere on card (except buttons) toggles the download options
  container.querySelectorAll('.explore-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const expandSection = card.querySelector('.explore-card-expand');
      const expandBtn = card.querySelector('.explore-expand-btn');
      const isOpen = !expandSection.classList.contains('hidden');

      container.querySelectorAll('.explore-card-expand').forEach(sec => sec.classList.add('hidden'));
      container.querySelectorAll('.explore-expand-btn').forEach(btn => btn.classList.remove('active'));

      if (!isOpen) {
        expandSection.classList.remove('hidden');
        if (expandBtn) expandBtn.classList.add('active');
      }
    });
  });

  // Stream Audio buttons
  container.querySelectorAll('.explore-stream-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const vid = btn.dataset.vid;
      if (_ytCurrentStreamId === vid && _ytCurrentStreamType === 'audio') {
        togglePlayGlobal();
        return;
      }
      streamYouTubeAudio(vid, btn.dataset.title, btn.dataset.artist, btn.dataset.thumb, parseFloat(btn.dataset.dur) || 0);
    });
  });

  // Stream Video buttons
  container.querySelectorAll('.explore-video-stream-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const vid = btn.dataset.vid;
      streamYouTubeVideo(vid, btn.dataset.title, btn.dataset.artist, btn.dataset.thumb, parseFloat(btn.dataset.dur) || 0);
    });
  });

  // 20s Quick Preview buttons
  container.querySelectorAll('.explore-preview-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const card = btn.closest('.explore-card');
      if (card) {
        toggleTrackAudioPreview(card, btn);
      }
    });
  });

  function _cacheOnlineTrack(item) {
    if (!item || !item.id) return;
    if (typeof state !== 'undefined') {
      if (!state.online_tracks_cache) state.online_tracks_cache = {};
      state.online_tracks_cache[item.id] = item;
      if (typeof syncOnlineTrackToDB === 'function') {
        syncOnlineTrackToDB(item);
      }
    }
  }

  // Play Next buttons
  container.querySelectorAll('.explore-play-next-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ytItem = {
        id: `yt:${btn.dataset.vid}`,
        video_id: btn.dataset.vid,
        title: btn.dataset.title,
        artist: btn.dataset.artist,
        artwork_url: btn.dataset.thumb,
        duration: parseFloat(btn.dataset.dur) || 0,
        is_online: true
      };
      _cacheOnlineTrack(ytItem);
      if (typeof playNext === 'function') playNext(ytItem);
    });
  });

  // Add to Queue buttons
  container.querySelectorAll('.explore-queue-add-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ytItem = {
        id: `yt:${btn.dataset.vid}`,
        video_id: btn.dataset.vid,
        title: btn.dataset.title,
        artist: btn.dataset.artist,
        artwork_url: btn.dataset.thumb,
        duration: parseFloat(btn.dataset.dur) || 0,
        is_online: true
      };
      _cacheOnlineTrack(ytItem);
      if (typeof addToQueue === 'function') addToQueue(ytItem);
    });
  });

  // Start Radio buttons
  container.querySelectorAll('.explore-radio-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const ytItem = {
        id: `yt:${btn.dataset.vid}`,
        video_id: btn.dataset.vid,
        title: btn.dataset.title,
        artist: btn.dataset.artist,
        artwork_url: btn.dataset.thumb,
        duration: parseFloat(btn.dataset.dur) || 0,
        is_online: true
      };
      _cacheOnlineTrack(ytItem);
      startTrackRadio(ytItem);
    });
  });

  // Expand / Download toggle button
  container.querySelectorAll('.explore-expand-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const card = btn.closest('.explore-card');
      const expandSection = card.querySelector('.explore-card-expand');
      const isOpen = !expandSection.classList.contains('hidden');

      container.querySelectorAll('.explore-card-expand').forEach(sec => sec.classList.add('hidden'));
      container.querySelectorAll('.explore-expand-btn').forEach(b => b.classList.remove('active'));

      if (!isOpen) {
        expandSection.classList.remove('hidden');
        btn.classList.add('active');
      }
    });
  });

  // MP3 download buttons
  container.querySelectorAll('.dl-mp3-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerInstantDownload(btn.dataset.url, 'audio', 'mp3', '320', btn.dataset.title);
    });
  });

  // MP4 download buttons
  container.querySelectorAll('.dl-mp4-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      triggerInstantDownload(btn.dataset.url, 'video', 'mp4', '720', btn.dataset.title);
    });
  });

  // Custom download buttons
  container.querySelectorAll('.dl-custom-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      $('#download-url').value = btn.dataset.url;
      $('#download-sheet').showModal();
    });
  });
}

async function searchYouTube(query, append = false) {
  if (!query || !query.trim()) return;
  const q = query.trim();
  const loading = $('#explore-loading');
  const resultsContainer = $('#explore-results');
  const loadMoreContainer = $('#explore-load-more');

  if (!append) {
    _ytSearchQuery = q;
    _ytSearchOffset = 0;
    loading.classList.remove('hidden');
    // High-end shimmer skeleton grid while results stream in
    resultsContainer.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="skeleton-explore-card">
        <div class="skeleton-art linus-skeleton"></div>
        <div class="skeleton-line medium linus-skeleton" style="margin-top:8px;"></div>
        <div class="skeleton-line short linus-skeleton"></div>
      </div>
    `).join('');
    loadMoreContainer.classList.add('hidden');
  }

  try {
    const data = await api(`/api/youtube/search?q=${encodeURIComponent(q)}&limit=${_YT_PAGE_SIZE}&offset=${_ytSearchOffset}`);
    loading.classList.add('hidden');
    const results = data.results || [];

    if (results.length === 0 && !append) {
      resultsContainer.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="ph ph-magnifying-glass empty-icon"></i><h3>No results found</h3><p>Try searching for a different song, artist or genre name.</p></div>`;
      loadMoreContainer.classList.add('hidden');
      return;
    }

    const newCardsHTML = results.map(item => _buildExploreCardHTML(item)).join('');

    if (append) {
      const temp = document.createElement('div');
      temp.innerHTML = newCardsHTML;
      const newCards = Array.from(temp.children);
      newCards.forEach(card => resultsContainer.appendChild(card));
      _attachExploreCardHandlers(resultsContainer);
    } else {
      resultsContainer.innerHTML = newCardsHTML;
      _attachExploreCardHandlers(resultsContainer);
    }

    _ytSearchOffset += results.length;
    if (results.length >= _YT_PAGE_SIZE) {
      loadMoreContainer.classList.remove('hidden');
    } else {
      loadMoreContainer.classList.add('hidden');
    }
  } catch (e) {
    console.error('YouTube search error:', e);
    loading.classList.add('hidden');
    notify('Failed to search YouTube.');
  }
}

async function streamYouTubeAudio(videoId, title, artist, thumbnail, duration) {
  if (typeof stopHoverPreview === 'function') stopHoverPreview();
  else if (window.stopHoverPreview) window.stopHoverPreview();
  if (!videoId) return;

  const vp = $('#video-player');
  if (vp) { vp.pause(); vp.src = ''; }
  const ytPlayer = $('#youtube-video-player');
  if (ytPlayer) { ytPlayer.src = ''; ytPlayer.classList.add('hidden'); }
  $('#video-modal')?.classList.add('hidden');

  _ytCurrentStreamId = videoId;
  _ytCurrentStreamType = 'audio';
  _updateStreamButtonStates('buffering');

  document.querySelectorAll('.explore-card').forEach(c => c.classList.remove('now-streaming'));
  const activeCard = document.querySelector(`.explore-card[data-vid="${videoId}"]`);
  if (activeCard) activeCard.classList.add('now-streaming');

  const ytTrack = {
    id: `yt:${videoId}`,
    video_id: videoId,
    title: title || 'YouTube Stream',
    artist: artist || 'YouTube',
    album: 'YouTube',
    extension: 'stream',
    duration: duration || 0,
    has_artwork: !!thumbnail,
    artwork_url: thumbnail || '',
    media_type: 'audio',
    is_online: true,
    _isYouTubeStream: true,
  };
  _ytCurrentStreamTrack = ytTrack;
  _lastPrewarmedTrackId = null;

  if (typeof state !== 'undefined') {
    if (!state.online_tracks_cache) state.online_tracks_cache = {};
    state.online_tracks_cache[ytTrack.id] = ytTrack;
    if (typeof syncOnlineTrackToDB === 'function') {
      syncOnlineTrackToDB(ytTrack);
    }
  }

  try {
    startTrackingTrackPlayback(ytTrack, 'youtube_stream');
  } catch (e) {
    console.warn('startTrackingTrackPlayback error:', e);
  }

  // Check if this song is already in the upcoming precomputed queue
  try {
    const existingIdx = queue.findIndex(t => t && t.id === ytTrack.id);
    if (existingIdx >= 0) {
      currentIndex = existingIdx;
      queue[currentIndex] = { ...queue[currentIndex], ...ytTrack };
      renderQueue();
      if (typeof populate25SongQueue === 'function') populate25SongQueue(false);
    } else {
      // Starting a fresh track from search/explore: initialize new 25-song radio queue
      queue = [ytTrack];
      currentIndex = 0;
      renderQueue();
      if (typeof populate25SongQueue === 'function') populate25SongQueue(true);
    }
  } catch (e) {
    console.warn('Queue update error during stream:', e);
  }

  // Immediately load & stream synchronized lyrics for this YouTube song
  try {
    if (typeof loadLyricsInline === 'function') loadLyricsInline(ytTrack);
  } catch (e) {
    console.warn('loadLyricsInline error:', e);
  }

  try {
    if ($('#now-title')) $('#now-title').textContent = ytTrack.title;
    if ($('#now-artist')) $('#now-artist').textContent = ytTrack.artist;
    if (thumbnail) {
      if ($('#now-art')) $('#now-art').innerHTML = `<img src="${escapeHtml(thumbnail)}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
      if ($('#album-art-box')) $('#album-art-box').innerHTML = `<img src="${escapeHtml(thumbnail)}" alt="Artwork" style="width:100%;height:100%;object-fit:cover;border-radius:50%;box-shadow:0 0 20px rgba(0,0,0,0.6);">`;
    } else {
      if ($('#now-art')) $('#now-art').innerHTML = `<i class="ph-fill ph-music-notes"></i>`;
      if ($('#album-art-box')) $('#album-art-box').innerHTML = `<i class="ph-fill ph-music-notes-simple"></i>`;
    }

    if ($('#hero-title')) $('#hero-title').innerHTML = `${escapeHtml(ytTrack.title)}<br><em>is streaming.</em>`;
    if ($('#hero-artist')) $('#hero-artist').textContent = `${ytTrack.artist} · YouTube`;
    const durStr = duration ? ` · ${formatTime(duration)}` : '';
    if ($('#hero-format')) $('#hero-format').textContent = `STREAM · Best Quality${durStr}`;

    if ($('#current-time')) $('#current-time').textContent = '0:00';
    if (duration > 0) {
      if ($('#total-time')) $('#total-time').textContent = formatTime(duration);
      if ($('#progress')) $('#progress').value = 0;
    }

    const colors = [
      ['#1a1a2e', '#0f3460'], ['#2d4059', '#ea5455'],
      ['#111113', '#2a2a35'], ['#2c3e50', '#3498db'],
      ['#0b0b0c', '#d4b07a'], ['#1C1C21', '#8FA998']
    ];
    const [c1, c2] = colors[Math.floor(Math.random() * colors.length)];
    if ($('#vinyl-record')) $('#vinyl-record').style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
  } catch (e) {
    console.warn('UI update error:', e);
  }

  notify(`▶ Streaming "${(title || '').slice(0, 30)}..."`);

  try {
    initAudioContext();
    audio.pause();
    audio.src = `/api/youtube/stream/${encodeURIComponent(videoId)}`;
    audio.load();

    const playPromise = audio.play();
    if (playPromise) {
      playPromise.then(() => {
        _updateStreamButtonStates('playing');
        $('#vinyl-record')?.classList.add('playing');
        $('#hero-now-playing-card')?.classList.add('playing');
        const npBar = $('#hero-np-bar');
        if (npBar) npBar.style.width = '0%';
        if ($('#play')) $('#play').innerHTML = '<i class="ph-fill ph-pause"></i>';
        if ($('#hero-play')) $('#hero-play').innerHTML = '<i class="ph-fill ph-pause-circle"></i>';
        if ($('#fs-play')) $('#fs-play').innerHTML = '<i class="ph-fill ph-pause"></i>';
        try { if (typeof applyChameleonPalette === 'function') applyChameleonPalette(ytTrack); } catch (e) {}
        try {
          if (typeof updateFullscreenUI === 'function') updateFullscreenUI(ytTrack);
          else if (typeof window.updateFullscreenUI === 'function') window.updateFullscreenUI(ytTrack);
        } catch (e) {}
        try {
          if (typeof updateRecDashboardPlayingState === 'function') updateRecDashboardPlayingState(ytTrack.id);
          else if (typeof window.updateRecDashboardPlayingState === 'function') window.updateRecDashboardPlayingState(ytTrack.id);
        } catch (e) {}
        if ('mediaSession' in navigator && typeof MediaMetadata !== 'undefined') {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: ytTrack.title,
            artist: ytTrack.artist,
            artwork: thumbnail ? [{ src: thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
          });
        }
      }).catch(err => {
        console.warn('Stream autoplay blocked:', err);
        _updateStreamButtonStates('paused');
      });
    }

    const onError = () => {
      if (_ytCurrentStreamId === videoId) {
        notify('⚠️ï¸ Playback failed. If YouTube blocked the track, add cookies.txt.');
        _ytCurrentStreamId = '';
        _ytCurrentStreamType = '';
        _ytCurrentStreamTrack = null;
        _updateStreamButtonStates('idle');
        $('#vinyl-record')?.classList.remove('playing');
        $('#hero-now-playing-card')?.classList.remove('playing');
        if ($('#play')) $('#play').innerHTML = '<i class="ph-fill ph-play"></i>';
      }
      audio.removeEventListener('error', onError);
    };
    audio.addEventListener('error', onError, { once: true });

    const onEnded = () => {
      _ytCurrentStreamId = '';
      _ytCurrentStreamType = '';
      _ytCurrentStreamTrack = null;
      _updateStreamButtonStates('idle');
      document.querySelectorAll('.explore-card').forEach(c => c.classList.remove('now-streaming'));
      if (audio.paused) {
        $('#vinyl-record')?.classList.remove('playing');
        $('#hero-now-playing-card')?.classList.remove('playing');
        if ($('#hero-play')) $('#hero-play').innerHTML = '<i class="ph-fill ph-play-circle"></i>';
      }
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
    audio.addEventListener('ended', onEnded);

  } catch (err) {
    console.error('streamYouTubeAudio error:', err);
    notify('Could not stream audio. Try again.');
    _ytCurrentStreamId = '';
    _ytCurrentStreamType = '';
    _ytCurrentStreamTrack = null;
    _updateStreamButtonStates('idle');
  }
}

async function streamYouTubeVideo(videoId, title, artist, thumbnail = '', duration = 0) {
  if (!videoId) return;

  // Pause audio playback
  audio.pause();
  $('#play').innerHTML = '<i class="ph-fill ph-play"></i>';
  $('#vinyl-record').classList.remove('playing');

  _ytCurrentStreamId = videoId;
  _ytCurrentStreamType = 'video';
  _updateStreamButtonStates('playing');

  document.querySelectorAll('.explore-card').forEach(c => c.classList.remove('now-streaming'));
  const activeCard = document.querySelector(`.explore-card[data-vid="${videoId}"]`);
  if (activeCard) activeCard.classList.add('now-streaming');

  notify(`🎬 Playing video "${(title || '').slice(0, 30)}..."`);

  const vModal = $('#video-modal');
  const vPlayer = $('#video-player');
  const ytPlayer = $('#youtube-video-player');

  $('#video-modal-title').textContent = title || 'YouTube Video';
  $('#video-modal-artist').textContent = artist || 'YouTube';

  // Watch on YouTube button link
  const ytLink = $('#video-modal-yt-link');
  if (ytLink) ytLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;

  // Stream Audio fallback button
  const audioBtn = $('#video-modal-stream-audio');
  if (audioBtn) {
    audioBtn.onclick = () => {
      closeVideoModal();
      streamYouTubeAudio(videoId, title, artist, thumbnail, duration);
    };
  }

  // Hide native video player, show YouTube iframe
  if (vPlayer) { vPlayer.pause(); vPlayer.src = ''; vPlayer.classList.add('hidden'); }
  if (ytPlayer) {
    ytPlayer.classList.remove('hidden');
    ytPlayer.src = `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1&rel=0&playsinline=1&modestbranding=1`;
  }

  vModal.classList.remove('hidden');
}

function _updateStreamButtonStates(mode) {
  document.querySelectorAll('.explore-stream-btn, .explore-video-stream-btn').forEach(btn => {
    const vid = btn.dataset.vid;
    const icon = btn.querySelector('i');
    const isAudioBtn = btn.classList.contains('explore-stream-btn');
    const isVideoBtn = btn.classList.contains('explore-video-stream-btn');

    btn.classList.remove('is-buffering', 'is-playing');

    if (vid === _ytCurrentStreamId) {
      if (isAudioBtn && _ytCurrentStreamType === 'audio') {
        if (mode === 'buffering') {
          btn.classList.add('is-buffering');
          if (icon) icon.className = 'ph ph-spinner-gap';
        } else if (mode === 'playing') {
          btn.classList.add('is-playing');
          if (icon) icon.className = 'ph-fill ph-pause';
        } else if (mode === 'paused') {
          btn.classList.add('is-playing');
          if (icon) icon.className = 'ph-fill ph-play';
        } else {
          if (icon) icon.className = 'ph-fill ph-play';
        }
      } else if (isVideoBtn && _ytCurrentStreamType === 'video') {
        if (mode === 'buffering') {
          btn.classList.add('is-buffering');
          if (icon) icon.className = 'ph ph-spinner-gap';
        } else if (mode === 'playing' || mode === 'paused') {
          btn.classList.add('is-playing');
          if (icon) icon.className = 'ph-fill ph-monitor-play';
        } else {
          if (icon) icon.className = 'ph-fill ph-monitor-play';
        }
      } else {
        if (isAudioBtn && icon) icon.className = 'ph-fill ph-play';
        if (isVideoBtn && icon) icon.className = 'ph-fill ph-monitor-play';
      }
    } else {
      if (isAudioBtn && icon) icon.className = 'ph-fill ph-play';
      if (isVideoBtn && icon) icon.className = 'ph-fill ph-monitor-play';
    }
  });
}

// Keep stream button states in sync with audio play/pause
(function() {
  const audio = document.querySelector('audio');
  if (audio) {
    audio.addEventListener('play', () => {
      if (_ytCurrentStreamId) _updateStreamButtonStates('playing');
    });
    audio.addEventListener('pause', () => {
      if (_ytCurrentStreamId) _updateStreamButtonStates('paused');
    });
  }
})();


async function triggerInstantDownload(url, mediaType, format, quality, title) {
  notify(`Starting download for "${title.slice(0, 24)}..."`);
  try {
    const res = await api('/api/download', {
      method: 'POST',
      body: JSON.stringify({
        url: url,
        media_type: mediaType,
        format: format,
        quality: quality,
        category: 'YouTube Explore'
      })
    });

    if (res.job_id) {
      notify(`Download started in background! (${mediaType.toUpperCase()} ${quality})`);
      trackBackgroundDownload(res.job_id, title);
    }
  } catch (err) {
    notify('Could not start download.');
  }
}

function trackBackgroundDownload(jobId, title) {
  const sse = new EventSource(`/api/download/progress/${jobId}`);
  sse.addEventListener('done', () => {
    sse.close();
    notify(`🎉 Finished downloading "${title.slice(0, 28)}"!`);
    pollDownloadsStatus(jobId); // Refresh library automatically
  });
  sse.addEventListener('cancelled', () => {
    sse.close();
    notify(`Download cancelled: "${title.slice(0, 28)}"`);
  });
  sse.addEventListener('error_event', (e) => {
    sse.close();
    notify(`Download error: ${e.data || 'Unknown error'}`);
  });
  sse.onerror = () => {
    sse.close();
    // Silently close — background downloads don't need to alert on network issues
  };
}

// Explore Search Bindings
$('#explore-submit-btn').addEventListener('click', () => {
  searchYouTube($('#explore-input').value);
});
$('#explore-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    searchYouTube($('#explore-input').value);
  }
});
document.querySelectorAll('.explore-tag').forEach(tag => {
  tag.addEventListener('click', () => {
    $('#explore-input').value = tag.dataset.q;
    searchYouTube(tag.dataset.q);
  });
});

// Load More button binding
$('#explore-load-more-btn').addEventListener('click', () => {
  const btn = $('#explore-load-more-btn');
  btn.classList.add('is-loading');
  btn.querySelector('i').className = 'ph ph-spinner-gap';
  btn.querySelector('span').textContent = 'Loading...';
  searchYouTube(_ytSearchQuery, true).finally(() => {
    btn.classList.remove('is-loading');
    btn.querySelector('i').className = 'ph ph-arrow-down';
    btn.querySelector('span').textContent = 'Load More';
  });
});

// Topbar Search Enter binding
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = $('#search') ? $('#search').value.trim() : '';
    if (q) {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelector('[data-view="explore"]')?.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
      $('#explore-view')?.classList.remove('hidden');
      if ($('#explore-input')) $('#explore-input').value = q;
      searchYouTube(q);
    }
  }
});

// Expose YouTube APIs to window
window.streamYouTubeAudio = streamYouTubeAudio;
window.streamYouTubeVideo = streamYouTubeVideo;
window.searchYouTube = searchYouTube;
window._updateStreamButtonStates = _updateStreamButtonStates;
window.triggerInstantDownload = triggerInstantDownload;
window.trackBackgroundDownload = trackBackgroundDownload;

