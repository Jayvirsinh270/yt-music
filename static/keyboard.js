// ---- Global Keyboard Shortcuts (Unified & Conflict-Free) -----
document.addEventListener('keydown', (e) => {
  // Ignore when user is typing in input fields, textareas, selects, or editable areas
  const activeEl = document.activeElement;
  const activeTag = activeEl ? activeEl.tagName.toLowerCase() : '';
  const isTyping = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select' || (activeEl && activeEl.isContentEditable);

  if (isTyping) {
    if (e.key === 'Escape') activeEl.blur();
    return;
  }

  // If a native dialog is open, let Escape close it and bypass media shortcuts
  const openDialog = document.querySelector('dialog[open]');
  if (openDialog && e.key !== 'Escape') return;

  // If quote splash overlay is active, intercept Space / Esc / Enter to dismiss it and block media shortcuts
  const quoteSplash = document.querySelector('#quote-splash-overlay');
  if (quoteSplash && !quoteSplash.classList.contains('hidden') && quoteSplash.style.display !== 'none' && !quoteSplash.classList.contains('dissolve')) {
    if (e.key === ' ' || e.code === 'Space' || e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
      if (typeof dismissQuoteSplash === 'function') dismissQuoteSplash();
      else if (window.dismissQuoteSplash) window.dismissQuoteSplash();
    }
    return;
  }

  const key = e.key;
  const code = e.code;
  const lowerKey = key ? key.toLowerCase() : '';

  // 0. Cinema HUD Lock / Unlock (Ctrl + Shift + Y)
  if (e.ctrlKey && e.shiftKey && (lowerKey === 'y' || code === 'KeyY')) {
    e.preventDefault();
    if (typeof fsPlayer !== 'undefined' && fsPlayer && fsPlayer.classList.contains('open')) {
      toggleFsHudLock();
    }
    return;
  }

  // 1. Play / Pause (Space)
  if (key === ' ' || code === 'Space') {
    e.preventDefault();
    if (!audio.src) {
      const first = (queue && queue[0]) || (state.tracks && state.tracks.find(t => t.media_type !== 'video'));
      if (first) playById(first.id);
      return;
    }
    togglePlayGlobal();
    return;
  }

  // 2. Mute / Unmute (M)
  if (lowerKey === 'm' || code === 'KeyM') {
    e.preventDefault();
    toggleMuteGlobal();
    return;
  }

  // 3. Navigation: Previous / Seek Backward
  if (code === 'ArrowLeft' || key === 'ArrowLeft') {
    e.preventDefault();
    if (e.shiftKey) {
      $('#previous')?.click();
    } else {
      if (audio.duration) {
        audio.currentTime = Math.max(0, audio.currentTime - 5);
        notify(`-5s (${formatTime(audio.currentTime)})`);
      }
    }
    return;
  }

  // 4. Navigation: Next / Seek Forward
  if (code === 'ArrowRight' || key === 'ArrowRight') {
    e.preventDefault();
    if (e.shiftKey) {
      $('#next')?.click();
    } else {
      if (audio.duration) {
        audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
        notify(`+5s (${formatTime(audio.currentTime)})`);
      }
    }
    return;
  }

  // 5. Volume Up (ArrowUp)
  if (code === 'ArrowUp' || key === 'ArrowUp') {
    e.preventDefault();
    const newVol = Math.min(1, Math.round((audio.volume + 0.05) * 100) / 100);
    audio.volume = newVol;
    audio.muted = false;
    lastUnmutedVolume = newVol;
    updateVolumeUI(newVol);
    notify(`Volume: ${Math.round(newVol * 100)}%`);
    return;
  }

  // 6. Volume Down (ArrowDown)
  if (code === 'ArrowDown' || key === 'ArrowDown') {
    e.preventDefault();
    const newVol = Math.max(0, Math.round((audio.volume - 0.05) * 100) / 100);
    audio.volume = newVol;
    audio.muted = (newVol === 0);
    if (newVol > 0) lastUnmutedVolume = newVol;
    updateVolumeUI(newVol);
    notify(`Volume: ${Math.round(newVol * 100)}%`);
    return;
  }

  // 7. Track Navigation Keys (N for Next, P for Prev)
  if ((lowerKey === 'n' && !e.ctrlKey && !e.metaKey) || (lowerKey === 'k' && e.shiftKey)) {
    e.preventDefault();
    $('#next')?.click();
    return;
  }
  if ((lowerKey === 'p' && !e.ctrlKey && !e.metaKey && !e.shiftKey) || (lowerKey === 'j' && e.shiftKey)) {
    e.preventDefault();
    $('#previous')?.click();
    return;
  }

  // 8. Shuffle Toggle (S)
  if (lowerKey === 's' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    $('#shuffle-btn')?.click();
    return;
  }

  // 9. Repeat Mode Toggle (R)
  if (lowerKey === 'r' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    $('#repeat-btn')?.click();
    return;
  }

  // 10. Lyrics Toggle (L)
  if (lowerKey === 'l' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    $('#hero-lyrics')?.click();
    return;
  }

  // 11. Favorite Current Track (F) or Toggle True Fullscreen when Fullscreen player is open
  if (lowerKey === 'f' && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    if (typeof fsPlayer !== 'undefined' && fsPlayer && fsPlayer.classList.contains('open')) {
      toggleTrueFullscreen();
      return;
    }
    const activeTrack = getActivePlaybackTrack() || (queue && queue[currentIndex]);
    if (activeTrack) {
      toggleFavorite(activeTrack.id);
    }
    return;
  }

  // 12. Karaoke Mode Toggle (K)
  if (lowerKey === 'k' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleKaraokeMode();
    return;
  }

  // 13. Auto-DJ Beat-Matched Crossfader Toggle (D)
  if (lowerKey === 'd' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleAutoDJQuick();
    return;
  }

  // 14. Visualizer Mode Cycle (V)
  if (lowerKey === 'v' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    cycleFullscreenMode(1);
    const modeObj = FS_MODES.find(m => m.id === currentFsMode);
    if (modeObj) notify(`Visualizer: ${modeObj.name}`);
    return;
  }

  // 15. Quick Mode Direct Jump (1-5) when Fullscreen Player is open
  if (typeof fsPlayer !== 'undefined' && fsPlayer && fsPlayer.classList.contains('open') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    const quickModeMap = { '1': 'stage', '2': 'vinyl', '3': 'retro90s', '4': 'halo', '5': 'clean' };
    if (quickModeMap[key]) {
      e.preventDefault();
      setFullscreenMode(quickModeMap[key]);
      const modeObj = FS_MODES.find(m => m.id === quickModeMap[key]);
      if (modeObj) notify(`Mode: ${modeObj.name}`);
      return;
    }
  }

  // 16. Escape: Dismiss Modals, Fullscreen Player, or Sidebar
  if (key === 'Escape') {
    if (openDialog) {
      openDialog.close();
      return;
    }
    const videoModal = $('#video-modal');
    if (videoModal && !videoModal.classList.contains('hidden')) {
      $('#video-modal-close')?.click();
      return;
    }
    const vizPanel = $('#fs-visualizer-panel');
    if (vizPanel && !vizPanel.classList.contains('hidden')) {
      closeVisualizerPanel();
      return;
    }
    if (typeof fsPlayer !== 'undefined' && fsPlayer && fsPlayer.classList.contains('open')) {
      if (isFsHudLocked) {
        toggleFsHudLock(false);
        return;
      }
      $('#fs-close')?.click() || fsPlayer.classList.remove('open');
      return;
    }
    if (typeof closeSidebar === 'function') {
      const isSidebarOpen = $('#sidebar')?.classList.contains('sidebar-open') || $('#sidebar')?.classList.contains('mobile-open');
      if (isSidebarOpen && !isSidebarPinned) {
        closeSidebar();
      }
    }
    return;
  }
});
