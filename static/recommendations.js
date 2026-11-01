// ============================================================
// Linus — Music Intelligence & Listening Insights Subsystem (static/recommendations.js)
// Weekly Sound Rewind & Persona Summary, Daily Listening Streak &
// Music Calendar Heatmap, and 2D Vibe Compass / Mood Dial Engine
// ============================================================

(function() {
  'use strict';

  const $ = window.$ || (sel => document.querySelector(sel));
  const $$ = window.$$ || (sel => document.querySelectorAll(sel));
  const escapeHtml = window.escapeHtml || (v => String(v).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])));

// ============================================================================
// 📅 Feature 6: Weekly Sound Rewind & Persona Summary Engine
// ============================================================================
let _lastRewindData = null;

async function openWeeklyRewindModal() {
  const modal = document.getElementById('weekly-rewind-modal');
  if (!modal) return;

  const spinner = document.getElementById('rewind-loading-spinner');
  const container = document.getElementById('rewind-loaded-container');
  if (spinner) spinner.style.display = 'flex';
  if (container) container.classList.add('hidden');

  if (typeof modal.showModal === 'function') {
    modal.showModal();
  } else {
    modal.setAttribute('open', '');
  }

  try {
    const res = await api('/api/rewind/weekly');
    if (!res || res.status !== 'success') throw new Error(res?.error || 'Failed to fetch rewind data');

    _lastRewindData = res;
    renderWeeklyRewindModal(res);

    if (spinner) spinner.style.display = 'none';
    if (container) container.classList.remove('hidden');
  } catch (err) {
    console.error('Weekly rewind fetch error:', err);
    notify('⚠️ Unable to load weekly sound rewind.');
    if (spinner) spinner.innerHTML = `<p style="color:#ff6b6b;margin-top:12px;">Failed to load rewind stats.</p>`;
  }
}

function closeWeeklyRewindModal() {
  const modal = document.getElementById('weekly-rewind-modal');
  if (!modal) return;
  if (typeof modal.close === 'function') {
    modal.close();
  } else {
    modal.removeAttribute('open');
  }
}

function renderWeeklyRewindModal(data) {
  const timeframeEl = document.getElementById('rewind-modal-timeframe');
  if (timeframeEl) timeframeEl.textContent = `Weekly Sound Rewind (${data.timeframe || 'Last 7 Days'})`;

  // 1. Persona
  const persona = data.persona || {};
  const emojiEl = document.getElementById('rewind-persona-emoji');
  const titleEl = document.getElementById('rewind-persona-title');
  const mottoEl = document.getElementById('rewind-persona-motto');
  const traitsEl = document.getElementById('rewind-persona-traits');
  const cardEl = document.getElementById('rewind-persona-card');
  const glowEl = document.getElementById('rewind-persona-glow');

  if (emojiEl) emojiEl.textContent = persona.emoji || '✨';
  if (titleEl) titleEl.textContent = persona.title || 'The Melodic Soul';
  if (mottoEl) mottoEl.textContent = persona.motto || 'Curating moments with perfect rhythm and harmony.';

  if (cardEl && persona.color) {
    cardEl.style.borderColor = persona.color;
  }
  if (glowEl && persona.glow) {
    glowEl.style.background = `radial-gradient(circle, ${persona.glow} 0%, transparent 70%)`;
  }

  if (traitsEl && Array.isArray(persona.traits)) {
    traitsEl.innerHTML = persona.traits.map(t => `<span class="rewind-trait-chip">${escapeHtml(t)}</span>`).join('');
  }

  // 2. Stats
  const timeEl = document.getElementById('rewind-stat-time');
  const playsEl = document.getElementById('rewind-stat-plays');
  const daysEl = document.getElementById('rewind-stat-days');
  const peakEl = document.getElementById('rewind-stat-peak');

  if (timeEl) timeEl.textContent = data.total_time_formatted || `${data.total_minutes || 0}m`;
  if (playsEl) playsEl.textContent = data.completed_plays || 0;
  if (daysEl) daysEl.textContent = `${data.active_days || 1} / 7 Days`;
  if (peakEl) peakEl.textContent = `${data.peak_day || 'Weekend'} · ${data.peak_hour || 'Evening'}`;

  // 3. Top Genre & Tracks
  const genreSubEl = document.getElementById('rewind-genre-sub');
  if (genreSubEl) genreSubEl.textContent = `Top Soundscape: ${data.top_genre || 'Pop'}`;

  const listEl = document.getElementById('rewind-tracks-list');
  if (listEl) {
    const tracks = data.top_tracks || [];
    if (tracks.length === 0) {
      listEl.innerHTML = `<p style="font-size:12px;color:var(--text-muted);text-align:center;padding:12px;">No tracks recorded this week yet. Start playing music!</p>`;
    } else {
      listEl.innerHTML = tracks.map((t, idx) => {
        const thumb = t.artwork_url || '';
        const thumbHtml = thumb
          ? `<img src="${escapeHtml(thumb)}" alt="Art" class="rewind-track-thumb" onerror="this.style.display='none'">`
          : `<div class="rewind-track-thumb" style="display:grid;place-items:center;color:#e5a95d;"><i class="ph-fill ph-music-note"></i></div>`;

        return `
          <div class="rewind-track-row" data-id="${escapeHtml(t.id)}" data-idx="${idx}">
            <span class="rewind-track-rank">#${idx + 1}</span>
            ${thumbHtml}
            <div class="rewind-track-meta">
              <span class="rewind-track-title" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</span>
              <span class="rewind-track-artist">${escapeHtml(t.artist)}</span>
            </div>
            <span class="rewind-track-badge">${t.play_count} plays</span>
            <button class="rewind-track-play-btn" title="Play track"><i class="ph-fill ph-play"></i></button>
          </div>
        `;
      }).join('');

      listEl.querySelectorAll('.rewind-track-row').forEach(row => {
        row.addEventListener('click', () => {
          const tid = row.dataset.id;
          if (tid) {
            playById(tid);
            closeWeeklyRewindModal();
            notify(`▶ Playing #${parseInt(row.dataset.idx) + 1} from your Weekly Rewind`);
          }
        });
      });
    }
  }
}

function initWeeklyRewind() {
  const openBtn = document.getElementById('open-weekly-rewind-btn');
  if (openBtn) {
    openBtn.addEventListener('click', openWeeklyRewindModal);
  }

  const closeBtn = document.getElementById('rewind-modal-close');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeWeeklyRewindModal);
  }

  const modal = document.getElementById('weekly-rewind-modal');
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeWeeklyRewindModal();
    });
  }

  // Play Weekly Mix
  const playMixBtn = document.getElementById('rewind-play-mix-btn');
  if (playMixBtn) {
    playMixBtn.addEventListener('click', () => {
      if (!_lastRewindData || !_lastRewindData.top_tracks || !_lastRewindData.top_tracks.length) {
        notify('No tracks found in Weekly Rewind.');
        return;
      }
      const topTracks = _lastRewindData.top_tracks;
      queue = [...topTracks];
      currentIndex = 0;
      renderQueue();
      playById(topTracks[0].id);
      closeWeeklyRewindModal();
      notify(`▶ Streaming your Weekly Top ${topTracks.length} Mix!`);
    });
  }

  // Share Summary (Copy to clipboard)
  const copyBtn = document.getElementById('rewind-copy-summary-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!_lastRewindData) return;
      const d = _lastRewindData;
      const persona = d.persona || {};
      const topSong = d.top_tracks && d.top_tracks[0] ? `${d.top_tracks[0].title} — ${d.top_tracks[0].artist}` : 'None';

      const text = [
        `🎵 My Linus Weekly Sound Rewind (${d.timeframe || 'This Week'})`,
        `✨ Musical Persona: ${persona.emoji || '✨'} ${persona.title || 'The Melodic Soul'}`,
        `💬 "${persona.motto || ''}"`,
        `🎧 ${d.total_time_formatted || (d.total_minutes + ' mins')} across ${d.completed_plays || 0} tracks`,
        `🏆 Top Song: ${topSong}`,
        `⏰ Peak Listening: ${d.peak_day || 'Friday'} · ${d.peak_hour || 'Evening'}`
      ].join('\n');

      try {
        await navigator.clipboard.writeText(text);
        notify('📋 Weekly Sound Rewind copied to clipboard!');
      } catch (err) {
        notify('⚠️ Could not copy to clipboard.');
      }
    });
  }

  const exportBtn = document.getElementById('rewind-export-card-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      if (!_lastRewindData) return;
      exportRewindVisualCard(_lastRewindData);
    });
  }
}

function exportRewindVisualCard(d) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const persona = d.persona || {};

  // 1. Dark Velvet Background
  ctx.fillStyle = '#0a0808';
  ctx.fillRect(0, 0, 1080, 1350);

  // 2. Ambient Glowing Orbs
  const radGlow1 = ctx.createRadialGradient(250, 300, 20, 250, 300, 450);
  radGlow1.addColorStop(0, 'rgba(229, 169, 93, 0.28)');
  radGlow1.addColorStop(1, 'transparent');
  ctx.fillStyle = radGlow1;
  ctx.fillRect(0, 0, 1080, 1350);

  const radGlow2 = ctx.createRadialGradient(850, 950, 30, 850, 950, 500);
  radGlow2.addColorStop(0, 'rgba(168, 85, 247, 0.22)');
  radGlow2.addColorStop(1, 'transparent');
  ctx.fillStyle = radGlow2;
  ctx.fillRect(0, 0, 1080, 1350);

  // 3. Specular Border Frame
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 2;
  ctx.strokeRect(36, 36, 1008, 1278);

  // 4. Header Eyebrow
  ctx.fillStyle = '#e5a95d';
  ctx.font = 'bold 24px -apple-system, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillText('LINUS · SOUND REWIND', 72, 110);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.font = '22px -apple-system, sans-serif';
  ctx.fillText((d.timeframe || 'WEEKLY RECAP').toUpperCase(), 72, 144);

  // 5. Musical Persona Card
  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.fillRect(72, 190, 936, 280);
  ctx.strokeStyle = 'rgba(229, 169, 93, 0.3)';
  ctx.lineWidth = 2;
  ctx.strokeRect(72, 190, 936, 280);

  // Emoji
  ctx.font = '100px sans-serif';
  ctx.fillText(persona.emoji || '✨', 110, 350);

  // Persona Title & Motto
  ctx.fillStyle = '#fdf6ec';
  ctx.font = 'bold 46px "Instrument Serif", Georgia, serif';
  ctx.fillText(persona.title || 'The Melodic Soul', 240, 310);

  ctx.fillStyle = '#9e8d7c';
  ctx.font = '24px -apple-system, sans-serif';
  ctx.fillText(`"${persona.motto || 'Music speaks where words fail.'}"`, 240, 360);

  // 6. Metrics Grid (4 tiles)
  const metrics = [
    { label: 'Listening Time', val: d.total_time_formatted || `${d.total_minutes || 0}m` },
    { label: 'Completed Tracks', val: String(d.completed_plays || 0) },
    { label: 'Active Days', val: `${d.active_days_count || 1} Days` },
    { label: 'Peak Hour', val: `${d.peak_day || 'Fri'} · ${d.peak_hour || 'Night'}` }
  ];

  metrics.forEach((m, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 72 + col * (456 + 24);
    const y = 505 + row * (140 + 20);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.fillRect(x, y, 456, 140);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.strokeRect(x, y, 456, 140);

    ctx.fillStyle = '#e5a95d';
    ctx.font = 'bold 38px -apple-system, sans-serif';
    ctx.fillText(m.val, x + 30, y + 65);

    ctx.fillStyle = '#9e8d7c';
    ctx.font = '20px -apple-system, sans-serif';
    ctx.fillText(m.label, x + 30, y + 105);
  });

  // 7. Top Tracks
  ctx.fillStyle = '#fdf6ec';
  ctx.font = 'bold 28px -apple-system, sans-serif';
  ctx.fillText('TOP TRACKS', 72, 870);

  const topTracks = (d.top_tracks || []).slice(0, 4);
  topTracks.forEach((t, i) => {
    const y = 925 + i * 75;
    ctx.fillStyle = '#e5a95d';
    ctx.font = 'bold 28px -apple-system, sans-serif';
    ctx.fillText(`${i + 1}`, 72, y);

    ctx.fillStyle = '#fdf6ec';
    ctx.font = 'bold 24px -apple-system, sans-serif';
    const titleText = (t.title || 'Track').length > 34 ? (t.title || 'Track').slice(0, 32) + '...' : (t.title || 'Track');
    ctx.fillText(titleText, 120, y);

    ctx.fillStyle = '#9e8d7c';
    ctx.font = '20px -apple-system, sans-serif';
    ctx.fillText(t.artist || 'Artist', 650, y);
  });

  // 8. Footer Watermark
  ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
  ctx.font = '20px -apple-system, sans-serif';
  ctx.fillText('Linus Music Player · High-Fidelity Aesthetic Audio Space', 72, 1260);

  // Trigger Download
  canvas.toBlob(blob => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `linus-weekly-rewind-${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    if (typeof notify === 'function') {
      notify('📸 Exported high-res Weekly Rewind card!');
    }
  }, 'image/png');
}

// ============================================================================
// 🔥 Feature 8: Daily Listening Streak & Music Calendar Heatmap Engine
// ============================================================================
let _lastHeatmapData = null;
let _heatmapTooltipEl = null;

function ensureHeatmapTooltip() {
  if (!_heatmapTooltipEl) {
    _heatmapTooltipEl = document.createElement('div');
    _heatmapTooltipEl.className = 'heatmap-tooltip';
    _heatmapTooltipEl.id = 'heatmap-interactive-tooltip';
    document.body.appendChild(_heatmapTooltipEl);
  }
  return _heatmapTooltipEl;
}

async function loadStreakHeatmap(forceRefresh = false) {
  const container = document.getElementById('streak-heatmap-card');
  const shelf = document.getElementById('shelf-streak-heatmap');
  if (!container || !shelf) return;

  try {
    const res = await api('/api/user/streak-heatmap');
    if (!res || res.status !== 'success') {
      console.warn('[StreakHeatmap] Failed to fetch streak heatmap data:', res);
      return;
    }
    _lastHeatmapData = res;
    renderStreakHeatmap(res);
  } catch (err) {
    console.error('[StreakHeatmap] Error loading streak heatmap:', err);
  }
}

function renderStreakHeatmap(data) {
  const container = document.getElementById('streak-heatmap-card');
  const shelf = document.getElementById('shelf-streak-heatmap');
  if (!container || !shelf || !data) return;

  const currentStreak = data.current_streak || 0;
  const longestStreak = data.longest_streak || 0;
  const streakStatus = data.streak_status || 'inactive';
  const streakMsg = data.streak_message || 'Play a track today to ignite your streak!';
  const activeDays = data.total_active_days || 0;
  const totalHours = data.total_hours || 0.0;
  const totalPlays = data.total_plays || 0;
  const milestone = data.milestone || { name: '3-Day Spark', target: 3, progress_percent: 0, days_left: 3 };

  // Sync with top hero streak counter badge
  const streakValEl = document.getElementById('streak-days-val');
  if (streakValEl) streakValEl.textContent = currentStreak;

  // Header status pill
  const headerPill = document.getElementById('streak-header-pill');
  const headerPillText = document.getElementById('streak-header-pill-text');
  if (headerPill && headerPillText) {
    headerPill.className = `streak-header-pill status-${streakStatus}`;
    if (streakStatus === 'active_today') {
      headerPillText.textContent = `${currentStreak} Day Streak · Active Today`;
    } else if (streakStatus === 'at_risk') {
      headerPillText.textContent = `${currentStreak} Day Streak · At Risk`;
    } else {
      headerPillText.textContent = `Streak Inactive · Ready to Ignite`;
    }
  }

  // Build Month Labels HTML
  const monthLabels = data.month_labels || [];
  let monthsHtml = '';
  monthLabels.forEach(m => {
    const leftPx = (m.col_index * 18);
    monthsHtml += `<span class="heatmap-month-tag" style="left:${leftPx}px">${escapeHtml(m.name)}</span>`;
  });

  // Build Weeks & Days Grid
  const weeks = data.weeks || [];
  let weeksHtml = '';
  weeks.forEach(col => {
    let daysHtml = '';
    col.forEach(day => {
      const isFuture = day.is_future;
      const level = day.level;
      const levelClass = isFuture ? 'level-future' : `level-${level}`;
      const todayClass = day.is_today ? 'is-today' : '';
      daysHtml += `
        <div class="heatmap-cell ${levelClass} ${todayClass}"
             data-date="${escapeHtml(day.date)}"
             data-formatted-date="${escapeHtml(day.formatted_date)}"
             data-minutes="${day.minutes}"
             data-plays="${day.play_count}"
             data-level="${level}"
             data-future="${isFuture ? '1' : '0'}"
             data-today="${day.is_today ? '1' : '0'}">
        </div>
      `;
    });
    weeksHtml += `<div class="heatmap-week-column">${daysHtml}</div>`;
  });

  // Status icon
  let bannerIcon = 'ph-sparkle';
  if (streakStatus === 'active_today') bannerIcon = 'ph-fire';
  else if (streakStatus === 'at_risk') bannerIcon = 'ph-warning-circle';

  container.innerHTML = `
    <!-- Top Metrics Row -->
    <div class="streak-metrics-grid">
      <div class="streak-metric-box streak-metric-hero">
        <span class="streak-metric-label"><i class="ph-fill ph-fire streak-fire-icon"></i> Current Streak</span>
        <span class="streak-metric-value">${currentStreak} <span style="font-size:16px;font-weight:500;">Days</span></span>
        <span class="streak-metric-sub">${streakStatus === 'active_today' ? '🔥 Safe for today' : streakStatus === 'at_risk' ? '⚠️ Ends tonight' : '✨ Start fresh'}</span>
      </div>
      <div class="streak-metric-box">
        <span class="streak-metric-label"><i class="ph-fill ph-trophy"></i> Best Record</span>
        <span class="streak-metric-value">${longestStreak} <span style="font-size:16px;font-weight:500;">Days</span></span>
        <span class="streak-metric-sub">Personal All-Time High</span>
      </div>
      <div class="streak-metric-box">
        <span class="streak-metric-label"><i class="ph-fill ph-calendar-check"></i> Active Days</span>
        <span class="streak-metric-value">${activeDays} <span style="font-size:14px;color:rgba(255,255,255,0.4);">/ 84</span></span>
        <span class="streak-metric-sub">Last 12 Weeks</span>
      </div>
      <div class="streak-metric-box">
        <span class="streak-metric-label"><i class="ph-fill ph-clock"></i> Listening Time</span>
        <span class="streak-metric-value">${totalHours}h</span>
        <span class="streak-metric-sub">${totalPlays} tracks played</span>
      </div>
    </div>

    <!-- Motivational Callout & Milestone Progress -->
    <div class="streak-banner-row">
      <div class="streak-banner-left">
        <div class="streak-banner-icon-circle">
          <i class="ph-fill ${bannerIcon}"></i>
        </div>
        <div class="streak-banner-text">
          <div class="streak-banner-title">${escapeHtml(streakMsg)}</div>
          <div class="streak-banner-desc">Playing at least 1 song per day keeps your flame burning.</div>
        </div>
      </div>
      <div class="streak-milestone-wrap">
        <div class="streak-milestone-head">
          <span>${milestone.icon || '⚡'} Next: ${escapeHtml(milestone.name)}</span>
          <span>${milestone.days_left > 0 ? `${milestone.days_left}d left` : 'Completed!'}</span>
        </div>
        <div class="streak-milestone-track">
          <div class="streak-milestone-fill" style="width:${Math.max(4, milestone.progress_percent || 0)}%;"></div>
        </div>
      </div>
    </div>

    <!-- 12-Week Heatmap Calendar Section -->
    <div class="heatmap-section">
      <div class="heatmap-scroll-container">
        <div class="heatmap-table-wrap">
          <!-- Month labels -->
          <div class="heatmap-months-row">
            ${monthsHtml}
          </div>

          <!-- Heatmap body with Weekdays and 12-Week Matrix -->
          <div class="heatmap-grid-body">
            <div class="heatmap-weekdays-col">
              <span class="heatmap-weekday-label">Mon</span>
              <span class="heatmap-weekday-label">Wed</span>
              <span class="heatmap-weekday-label">Fri</span>
              <span class="heatmap-weekday-label">Sun</span>
            </div>
            <div class="heatmap-weeks-track">
              ${weeksHtml}
            </div>
          </div>
        </div>
      </div>

      <!-- Legend & Tip Footer -->
      <div class="heatmap-footer-row">
        <span><i class="ph-bold ph-info" style="color:var(--accent);"></i> Hover or tap any day to inspect detailed listening telemetry</span>
        <div class="heatmap-legend-group">
          <span>Less</span>
          <span class="heatmap-legend-cell level-0" title="0 minutes"></span>
          <span class="heatmap-legend-cell level-1" title="1-15 minutes"></span>
          <span class="heatmap-legend-cell level-2" title="16-45 minutes"></span>
          <span class="heatmap-legend-cell level-3" title="46-90 minutes"></span>
          <span class="heatmap-legend-cell level-4" title="90+ minutes"></span>
          <span>More</span>
        </div>
      </div>
    </div>
  `;

  shelf.style.display = 'block';

  // Attach interactive tooltip handlers to cells
  const tooltip = ensureHeatmapTooltip();
  const cells = container.querySelectorAll('.heatmap-cell');

  cells.forEach(cell => {
    if (cell.dataset.future === '1') return;

    function showTooltip(e) {
      const formattedDate = cell.dataset.formattedDate || cell.dataset.date;
      const minutes = parseInt(cell.dataset.minutes || '0', 10);
      const plays = parseInt(cell.dataset.plays || '0', 10);
      const isToday = cell.dataset.today === '1';

      let timeText = '';
      if (minutes >= 60) {
        const hrs = Math.floor(minutes / 60);
        const mins = minutes % 60;
        timeText = `${hrs}h ${mins}m`;
      } else {
        timeText = `${minutes} min${minutes === 1 ? '' : 's'}`;
      }

      let tierText = 'No activity';
      if (minutes > 90) tierText = '🔥 Supercharged Day';
      else if (minutes > 45) tierText = '⚡ High Energy Session';
      else if (minutes > 15) tierText = '☕ Focused Flow';
      else if (plays > 0) tierText = '✨ Light Spark';

      tooltip.innerHTML = `
        <div class="heatmap-tooltip-date">${escapeHtml(formattedDate)} ${isToday ? '(Today)' : ''}</div>
        <div class="heatmap-tooltip-meta">
          <i class="ph-fill ${plays > 0 ? 'ph-headphones' : 'ph-moon'}"></i>
          <span>${plays > 0 ? `${timeText} · ${plays} track${plays === 1 ? '' : 's'}` : 'Quiet day'}</span>
        </div>
        <div class="heatmap-tooltip-tier">${tierText}</div>
      `;

      const rect = cell.getBoundingClientRect();
      tooltip.style.left = `${rect.left + rect.width / 2}px`;
      tooltip.style.top = `${rect.top}px`;
      tooltip.classList.add('visible');
    }

    function hideTooltip() {
      tooltip.classList.remove('visible');
    }

    cell.addEventListener('mouseenter', showTooltip);
    cell.addEventListener('mouseleave', hideTooltip);
    cell.addEventListener('touchstart', showTooltip, { passive: true });
  });
}

function initStreakHeatmap() {
  // Click on top hero streak badge smoothly scrolls to heatmap
  const streakBadge = document.getElementById('rec-streak-badge');
  if (streakBadge && !streakBadge._boundHeatmap) {
    streakBadge._boundHeatmap = true;
    streakBadge.addEventListener('click', () => {
      const heatmapShelf = document.getElementById('shelf-streak-heatmap');
      if (heatmapShelf) {
        heatmapShelf.style.display = 'block';
        heatmapShelf.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const card = document.getElementById('streak-heatmap-card');
        if (card) {
          card.classList.add('heatmap-highlight-pulse');
          setTimeout(() => card.classList.remove('heatmap-highlight-pulse'), 1800);
        }
      }
    });
  }

  // Initial load
  loadStreakHeatmap();
}

// ============================================================================
// 🧭 Feature 9: 2D Vibe Compass / Mood Dial Engine
// ============================================================================
let _vibeTargetX = 0.0;
let _vibeTargetY = 0.0;
let _activeVibeTitle = "Sunburst & Euphoric";
let _isDraggingVibePuck = false;

function setVibeCoordinates(x, y, animate = false) {
  _vibeTargetX = Math.max(-1.0, Math.min(1.0, parseFloat(x) || 0.0));
  _vibeTargetY = Math.max(-1.0, Math.min(1.0, parseFloat(y) || 0.0));

  const puck = document.getElementById('vibe-puck');
  const coordXEl = document.getElementById('vibe-coord-x');
  const coordYEl = document.getElementById('vibe-coord-y');
  const badge = document.getElementById('vibe-compass-badge');
  const icon = document.getElementById('vibe-compass-icon');
  const title = document.getElementById('vibe-compass-title');

  // Convert (-1..1) to percentage on pad (Y=+1 is top=0%)
  const pctX = ((_vibeTargetX + 1.0) / 2.0) * 100.0;
  const pctY = ((1.0 - _vibeTargetY) / 2.0) * 100.0;

  if (puck) {
    if (animate) puck.style.transition = 'left 0.25s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
    else puck.style.transition = 'none';

    puck.style.left = `${pctX}%`;
    puck.style.top = `${pctY}%`;
  }

  if (coordXEl) coordXEl.textContent = `V: ${_vibeTargetX >= 0 ? '+' : ''}${_vibeTargetX.toFixed(2)}`;
  if (coordYEl) coordYEl.textContent = `E: ${_vibeTargetY >= 0 ? '+' : ''}${_vibeTargetY.toFixed(2)}`;

  // Evaluate quadrant
  let qName = 'Sunburst & Euphoric';
  let qIcon = 'ph-sun';
  let qColor = '#f59e0b';

  if (_vibeTargetX >= 0.0 && _vibeTargetY >= 0.0) {
    qName = 'Sunburst & Euphoric';
    qIcon = 'ph-sun';
    qColor = '#f59e0b';
  } else if (_vibeTargetX < 0.0 && _vibeTargetY >= 0.0) {
    qName = 'Storm & Dark Voltage';
    qIcon = 'ph-lightning';
    qColor = '#a855f7';
  } else if (_vibeTargetX < 0.0 && _vibeTargetY < 0.0) {
    qName = 'Midnight & Nocturnal';
    qIcon = 'ph-moon-stars';
    qColor = '#3b82f6';
  } else {
    qName = 'Sunset & Cozy Serene';
    qIcon = 'ph-coffee';
    qColor = '#10b981';
  }

  _activeVibeTitle = qName;

  if (title) title.textContent = qName;
  if (icon) icon.className = `ph-fill ${qIcon}`;
  if (badge) {
    badge.style.borderColor = `${qColor}88`;
    badge.style.boxShadow = `0 2px 10px ${qColor}33`;
  }
  if (puck) {
    puck.style.setProperty('--vibe-glow', qColor);
  }

  // Update active preset chip
  document.querySelectorAll('.vibe-preset-chip').forEach(chip => {
    const cx = parseFloat(chip.dataset.x);
    const cy = parseFloat(chip.dataset.y);
    const dist = Math.hypot(cx - _vibeTargetX, cy - _vibeTargetY);
    if (dist < 0.15) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}
let _vibeCompassInitialized = false;

function openVibeCompassModal() {
  const libraryNav = document.querySelector('[data-view="library"]');
  if (libraryNav && !libraryNav.classList.contains('active')) {
    libraryNav.click();
  } else if (typeof window.switchView === 'function') {
    window.switchView('library');
  }

  const tabVibe = document.getElementById('tab-up-next-vibe');
  const tabQueue = document.getElementById('tab-up-next-queue');
  const listQueue = document.getElementById('hero-up-next-list');
  const viewVibe = document.getElementById('hero-vibe-compass-view');

  if (tabVibe) {
    tabVibe.classList.add('active');
    if (tabQueue) tabQueue.classList.remove('active');
    if (listQueue) listQueue.classList.add('hidden');
    if (viewVibe) viewVibe.classList.remove('hidden');
    if (typeof setVibeCoordinates === 'function') {
      setVibeCoordinates(_vibeTargetX, _vibeTargetY, false);
    }
  }

  const card = document.getElementById('hero-up-next-card');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('heatmap-highlight-pulse');
    setTimeout(() => card.classList.remove('heatmap-highlight-pulse'), 1500);
  }
}

function initVibeCompass() {
  const pad = document.getElementById('vibe-radar-pad');
  const tabQueue = document.getElementById('tab-up-next-queue');
  const tabVibe = document.getElementById('tab-up-next-vibe');
  const listQueue = document.getElementById('hero-up-next-list');
  const viewVibe = document.getElementById('hero-vibe-compass-view');

  if (!pad) return;
  if (_vibeCompassInitialized) return;
  _vibeCompassInitialized = true;

  // Segmented Tabs Switcher
  if (tabQueue && tabVibe && listQueue && viewVibe) {
    tabQueue.addEventListener('click', () => {
      tabQueue.classList.add('active');
      tabVibe.classList.remove('active');
      listQueue.classList.remove('hidden');
      viewVibe.classList.add('hidden');
    });

    tabVibe.addEventListener('click', () => {
      tabVibe.classList.add('active');
      tabQueue.classList.remove('active');
      listQueue.classList.add('hidden');
      viewVibe.classList.remove('hidden');
      setVibeCoordinates(_vibeTargetX, _vibeTargetY, false);
    });
  }

  // Queue drawer "Vibe" button
  const drawerVibeBtn = document.getElementById('queue-vibe-compass-btn');
  if (drawerVibeBtn) {
    drawerVibeBtn.addEventListener('click', () => {
      const drawer = document.getElementById('queue-drawer');
      if (drawer) drawer.classList.remove('open');
      if (tabVibe) tabVibe.click();
      const card = document.getElementById('hero-up-next-card');
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        card.classList.add('heatmap-highlight-pulse');
        setTimeout(() => card.classList.remove('heatmap-highlight-pulse'), 1500);
      }
    });
  }

  // Drag & Pointer handling on Pad
  function onPointerMove(e) {
    if (!_isDraggingVibePuck && e.type !== 'click') return;
    const rect = pad.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const rawX = (clientX - rect.left) / rect.width;
    const rawY = (clientY - rect.top) / rect.height;

    const clampedX = Math.max(0, Math.min(1, rawX));
    const clampedY = Math.max(0, Math.min(1, rawY));

    const x = parseFloat(((clampedX * 2.0) - 1.0).toFixed(2));
    const y = parseFloat((1.0 - (clampedY * 2.0)).toFixed(2));

    setVibeCoordinates(x, y, false);
  }

  pad.addEventListener('pointerdown', (e) => {
    _isDraggingVibePuck = true;
    pad.setPointerCapture(e.pointerId);
    onPointerMove(e);
  });

  pad.addEventListener('pointermove', onPointerMove);

  pad.addEventListener('pointerup', (e) => {
    _isDraggingVibePuck = false;
    try { pad.releasePointerCapture(e.pointerId); } catch (_) {}
  });

  pad.addEventListener('pointercancel', () => {
    _isDraggingVibePuck = false;
  });

  // Presets Bar
  document.querySelectorAll('.vibe-preset-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const x = parseFloat(chip.dataset.x);
      const y = parseFloat(chip.dataset.y);
      setVibeCoordinates(x, y, true);
    });
  });

  // Morph Upcoming Queue Button
  const morphBtn = document.getElementById('vibe-morph-queue-btn');
  if (morphBtn) {
    morphBtn.addEventListener('click', async () => {
      const upcoming = (queue || []).slice(currentIndex + 1);
      if (!upcoming.length) {
        notify('⚠️ Upcoming queue is empty. Add songs or click "Play Vibe Mix"!');
        return;
      }

      try {
        const res = await api('/api/vibe/sort-queue', {
          method: 'POST',
          body: JSON.stringify({
            x: _vibeTargetX,
            y: _vibeTargetY,
            tracks: upcoming
          })
        });

        if (res && res.status === 'success' && res.tracks) {
          queue = [...queue.slice(0, currentIndex + 1), ...res.tracks];
          renderQueue();
          renderDashboardUpNext();
          notify(`🧭 Upcoming queue morphed to ${_activeVibeTitle}!`);
        } else {
          notify('⚠️ Could not sort queue by vibe.');
        }
      } catch (err) {
        console.error('Error morphing queue by vibe:', err);
      }
    });
  }

  // Instant Vibe Mix Button
  const mixBtn = document.getElementById('vibe-instant-mix-btn');
  if (mixBtn) {
    mixBtn.addEventListener('click', async () => {
      mixBtn.disabled = true;
      mixBtn.innerHTML = '<i class="ph ph-spinner-gap spinning"></i> <span>Curating...</span>';
      try {
        const res = await api(`/api/vibe/tracks?x=${_vibeTargetX}&y=${_vibeTargetY}&limit=15`);
        if (res && res.status === 'success' && res.tracks && res.tracks.length > 0) {
          queue = [...res.tracks];
          currentIndex = 0;
          renderQueue();
          renderDashboardUpNext();
          playById(res.tracks[0].id);
          notify(`▶ Streaming 15-Track Vibe Mix: ${_activeVibeTitle}!`);
        } else {
          notify('⚠️ No tracks found for this mood.');
        }
      } catch (err) {
        console.error('Error fetching vibe tracks:', err);
        notify('⚠️ Error generating vibe mix.');
      } finally {
        mixBtn.disabled = false;
        mixBtn.innerHTML = '<i class="ph-fill ph-play"></i> <span>Play Vibe Mix</span>';
      }
    });
  }

  // Initial Coordinates
  setVibeCoordinates(0.0, 0.0, false);
}

/** Handles interactive Mood Filter Chips */
function initMoodFilterChips() {
  const chips = document.querySelectorAll('.mood-chip');
  if (!chips.length) return;

  chips.forEach(chip => {
    if (chip._moodBound) return;
    chip._moodBound = true;

    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');

      const selectedMood = chip.dataset.mood || 'all';

      // Filter all recommendation shelves
      document.querySelectorAll('.rec-shelf').forEach(shelf => {
        // Strict guard: never display a shelf that has no rendered cards/content
        const scrollContainer = shelf.querySelector('.rec-shelf-scroll, .rec-capsules-grid, .sonic-dna-card, .streak-heatmap-card');
        const hasContent = scrollContainer && scrollContainer.children.length > 0;
        if (!hasContent) {
          shelf.style.display = 'none';
          return;
        }

        const shelfMoods = (shelf.dataset.moods || 'all').split(',');
        if (selectedMood === 'all' || shelfMoods.includes(selectedMood)) {
          shelf.style.display = 'block';
          shelf.style.opacity = '0';
          shelf.style.transform = 'translateY(8px)';
          setTimeout(() => {
            shelf.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
            shelf.style.opacity = '1';
            shelf.style.transform = 'translateY(0)';
          }, 20);
        } else {
          shelf.style.display = 'none';
        }
      });

      notify(`Filtering: ${chip.textContent.trim()}`);
    });
  });
}

/**
 * Main dashboard loader. Fetches /api/recommend/dashboard and renders all shelves.
 * @param {boolean} forceRefresh — bypasses the 5-minute server-side cache
 */
async function loadDashboardRecommendations(forceRefresh = false) {
  if (_recDashboardLoading) return;
  _recDashboardLoading = true;

  // Update greeting
  const greetingEl = document.getElementById('rec-greeting');
  if (greetingEl) greetingEl.textContent = getRecGreeting();

  // Show skeleton only if dashboard hasn't been loaded yet
  const skeleton = document.getElementById('rec-skeleton');
  const emptyState = document.getElementById('rec-empty');
  if (!_recDashboardLoaded) {
    if (skeleton) skeleton.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';
    document.querySelectorAll('.rec-shelf').forEach(s => s.style.display = 'none');
  }

  // Spinner on refresh button
  const refreshBtn = document.getElementById('rec-refresh-btn');
  if (refreshBtn) refreshBtn.classList.add('spinning');

  try {
    const url = forceRefresh
      ? '/api/recommend/dashboard?force_refresh=1'
      : '/api/recommend/dashboard?fast=1';
    const data = await api(url);

    if (skeleton) skeleton.style.display = 'none';

    // Render Quick Launch Grid & Daily Capsules
    if (data.quick_grid && data.quick_grid.length > 0) {
      if (typeof renderQuickLaunchGrid === 'function') renderQuickLaunchGrid(data.quick_grid);
      else if (typeof window.renderQuickLaunchGrid === 'function') window.renderQuickLaunchGrid(data.quick_grid);
    }
    if (data.daily_capsules && data.daily_capsules.length > 0) {
      if (typeof renderDailyCapsules === 'function') renderDailyCapsules(data.daily_capsules);
      else if (typeof window.renderDailyCapsules === 'function') window.renderDailyCapsules(data.daily_capsules);
    }

    // Update taste profile banner & Sonic DNA
    if (data && data.taste_summary) {
      const greetingSub = document.getElementById('rec-greeting-sub');
      const mood = data.taste_summary.mood_vibe || 'Personalized';
      const topArt = data.top_artist;
      if (greetingSub) {
        if (topArt) {
          greetingSub.innerHTML = `Vibe: <strong>${escapeHtml(mood)}</strong> · Top artist: <strong>${escapeHtml(topArt)}</strong> · Inspired by your listening habits`;
        } else {
          greetingSub.textContent = `Vibe: ${mood} · Curated for you`;
        }
      }

      if (typeof renderSonicDnaCard === 'function') renderSonicDnaCard(data.taste_summary, data.top_artist);
      else if (typeof window.renderSonicDnaCard === 'function') window.renderSonicDnaCard(data.taste_summary, data.top_artist);
      loadStreakHeatmap();
    }

    let renderedAnyShelf = false;

    // Render each section
    if (data.sections && data.sections.length > 0) {
      data.sections.forEach(section => {
        if (section.id === 'capsules') return;
        if (typeof renderRecShelf === 'function') {
          renderRecShelf(section);
        } else if (typeof window.renderRecShelf === 'function') {
          window.renderRecShelf(section);
        }
        if (section.tracks && section.tracks.length > 0) {
          renderedAnyShelf = true;
        }

        // Update dynamic titles
        if (section.id === 'because' && section.title) {
          const titleEl = document.getElementById('shelf-because-title');
          if (titleEl) titleEl.textContent = section.title;
        }
        if (section.id === 'mood' && section.title) {
          const titleEl = document.getElementById('shelf-mood-title');
          if (titleEl) titleEl.textContent = section.title;
        }
        if (section.id === 'rediscover' && section.title) {
          const titleEl = document.getElementById('shelf-rediscover-title');
          if (titleEl) titleEl.textContent = section.title;
        }
        if (section.id === 'markov_next' && section.title) {
          const titleEl = document.getElementById('shelf-markov-title');
          if (titleEl) titleEl.textContent = section.title;
        }
      });
    }

    const hasContent = renderedAnyShelf ||
      (data.quick_grid && data.quick_grid.length > 0) ||
      (data.daily_capsules && data.daily_capsules.length > 0) ||
      (data.taste_summary && ((data.taste_summary.total_listen_hours || 0) > 0 || (data.taste_summary.listening_streak_days || 0) > 0));

    if (!hasContent) {
      if (emptyState) emptyState.style.display = 'flex';
    } else {
      if (emptyState) emptyState.style.display = 'none';
      _recDashboardLoaded = true;
    }

    renderDashboardUpNext();
    initMoodFilterChips();

    // Background enrichment: if any YouTube shelf is missing or empty, fetch full online tier
    const onlineShelves = ['because', 'mood', 'trending', 'rediscover'];
    const presentOnline = (data.sections || [])
      .filter(s => s.source === 'youtube' && s.tracks && s.tracks.length > 0)
      .map(s => s.id);
    const hasMissingOnline = onlineShelves.some(id => !presentOnline.includes(id));

    if (!forceRefresh && hasMissingOnline) {
      setTimeout(() => {
        api('/api/recommend/dashboard').then(fullData => {
          if (fullData && fullData.sections) {
            if (fullData.quick_grid && fullData.quick_grid.length > 0) {
              if (typeof renderQuickLaunchGrid === 'function') renderQuickLaunchGrid(fullData.quick_grid);
              else if (typeof window.renderQuickLaunchGrid === 'function') window.renderQuickLaunchGrid(fullData.quick_grid);
            }
            if (fullData.daily_capsules && fullData.daily_capsules.length > 0) {
              if (typeof renderDailyCapsules === 'function') renderDailyCapsules(fullData.daily_capsules);
              else if (typeof window.renderDailyCapsules === 'function') window.renderDailyCapsules(fullData.daily_capsules);
            }
            if (fullData.taste_summary) {
              if (typeof renderSonicDnaCard === 'function') renderSonicDnaCard(fullData.taste_summary, fullData.top_artist);
              else if (typeof window.renderSonicDnaCard === 'function') window.renderSonicDnaCard(fullData.taste_summary, fullData.top_artist);
            }

            fullData.sections.forEach(sec => {
              if (sec.id === 'capsules') return;
              if (typeof renderRecShelf === 'function') {
                renderRecShelf(sec);
              } else if (typeof window.renderRecShelf === 'function') {
                window.renderRecShelf(sec);
              }
              if (sec.id === 'because' && sec.title) {
                const titleEl = document.getElementById('shelf-because-title');
                if (titleEl) titleEl.textContent = sec.title;
              }
              if (sec.id === 'mood' && sec.title) {
                const titleEl = document.getElementById('shelf-mood-title');
                if (titleEl) titleEl.textContent = sec.title;
              }
              if (sec.id === 'rediscover' && sec.title) {
                const titleEl = document.getElementById('shelf-rediscover-title');
                if (titleEl) titleEl.textContent = sec.title;
              }
              if (sec.id === 'markov_next' && sec.title) {
                const titleEl = document.getElementById('shelf-markov-title');
                if (titleEl) titleEl.textContent = sec.title;
              }
            });

            if (emptyState) emptyState.style.display = 'none';
            _recDashboardLoaded = true;
          }
        }).catch(() => {});
      }, 1500);
    }

  } catch (err) {
    console.error('[RecDashboard] Load error:', err);
    if (skeleton) skeleton.style.display = 'none';
    if (!_recDashboardLoaded && emptyState) emptyState.style.display = 'flex';
  } finally {
    _recDashboardLoading = false;
    if (refreshBtn) refreshBtn.classList.remove('spinning');
  }
}

// Refresh button click handler
document.getElementById('rec-refresh-btn')?.addEventListener('click', () => {
  loadDashboardRecommendations(true);
});

// Update "now playing" highlight on rec cards when track changes
function updateRecDashboardPlayingState(trackId) {
  _recCurrentlyPlayingId = trackId;
  document.querySelectorAll('.rec-card').forEach(card => {
    if (card.dataset.id === trackId) {
      card.classList.add('now-playing');
    } else {
      card.classList.remove('now-playing');
    }
  });
}

// ── Dashboard "Up Next" Mini Queue Widget ──
function renderDashboardUpNext() {
  const container = document.getElementById('hero-up-next-list');
  if (!container) return;

  // Next 3 tracks after current track from queue
  let nextTracks = (queue || []).slice(currentIndex + 1, currentIndex + 4);
  if (!nextTracks.length && state && state.tracks) {
    const curId = queue[currentIndex]?.id;
    nextTracks = state.tracks.filter(t => t.id !== curId && t.media_type !== 'video').slice(0, 3);
  }

  if (!nextTracks.length) {
    container.innerHTML = `
      <div class="up-next-empty">
        <i class="ph ph-music-note"></i>
        <span>Queue is empty</span>
      </div>
    `;
    return;
  }

  container.innerHTML = nextTracks.map((t, idx) => {
    const isYT = !!(t.is_online || (t.id && t.id.startsWith('yt:')));
    const vid = t.video_id || (t.id || '').replace('yt:', '');
    const thumb = t.artwork_url || (isYT && vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : '');
    const thumbHtml = thumb
      ? `<img src="${escapeHtml(thumb)}" alt="Art" loading="lazy" onerror="this.parentNode.innerHTML='<i class=\\'ph-fill ph-music-note\\'></i>'">`
      : `<i class="ph-fill ph-music-note"></i>`;

    return `
      <div class="up-next-item" data-id="${escapeHtml(t.id)}" data-is-yt="${isYT ? '1' : '0'}" data-vid="${escapeHtml(vid)}" data-title="${escapeHtml(t.title || '')}" data-artist="${escapeHtml(t.artist || '')}" data-thumb="${escapeHtml(thumb || '')}" data-dur="${t.duration || 0}">
        <div class="up-next-art">
          ${thumbHtml}
        </div>
        <div class="up-next-info">
          <span class="up-next-title" title="${escapeHtml(t.title || '')}">${escapeHtml(t.title || 'Unknown')}</span>
          <span class="up-next-artist">${escapeHtml(t.artist || '')}</span>
        </div>
        <div class="up-next-more">
          <i class="ph-fill ph-play-circle"></i>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.up-next-item').forEach(item => {
    item.addEventListener('click', () => {
      if (item.dataset.isYt === '1' && item.dataset.vid) {
        streamYouTubeAudio(item.dataset.vid, item.dataset.title, item.dataset.artist, item.dataset.thumb, parseFloat(item.dataset.dur) || 0);
      } else if (item.dataset.id) {
        playById(item.dataset.id);
      }
    });
  });
}



  // Expose Recommendation & Intelligence APIs to global window
  window.loadDashboardRecommendations = typeof loadDashboardRecommendations !== 'undefined' ? loadDashboardRecommendations : function() {};
  window.renderDashboardUpNext = typeof renderDashboardUpNext !== 'undefined' ? renderDashboardUpNext : function() {};
  window.loadStreakHeatmap = typeof loadStreakHeatmap !== 'undefined' ? loadStreakHeatmap : function() {};
  window.updateRecDashboardPlayingState = typeof updateRecDashboardPlayingState !== 'undefined' ? updateRecDashboardPlayingState : function() {};
  window.initMoodFilterChips = typeof initMoodFilterChips !== 'undefined' ? initMoodFilterChips : function() {};
  window.openWeeklyRewindModal = typeof openWeeklyRewindModal !== 'undefined' ? openWeeklyRewindModal : function() {};
  window.closeWeeklyRewindModal = typeof closeWeeklyRewindModal !== 'undefined' ? closeWeeklyRewindModal : function() {};
  window.initWeeklyRewind = typeof initWeeklyRewind !== 'undefined' ? initWeeklyRewind : function() {};
  window.initStreakHeatmap = typeof initStreakHeatmap !== 'undefined' ? initStreakHeatmap : function() {};
  window.openVibeCompassModal = typeof openVibeCompassModal !== 'undefined' ? openVibeCompassModal : function() {};
  window.initVibeCompass = typeof initVibeCompass !== 'undefined' ? initVibeCompass : function() {};

  // Auto-initialize recommendation dashboard & Up Next deck
  try {
    if (typeof _recDashboardLoaded !== 'undefined' && !_recDashboardLoaded) {
      loadDashboardRecommendations();
    }
    renderDashboardUpNext();
    if (typeof initVibeCompass === 'function') {
      initVibeCompass();
    }
  } catch (e) {
    console.warn('[RecDashboard] Auto-init deferred:', e);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (typeof initVibeCompass === 'function') initVibeCompass();
    });
  } else {
    setTimeout(() => {
      if (typeof initVibeCompass === 'function') initVibeCompass();
    }, 10);
  }

})();
