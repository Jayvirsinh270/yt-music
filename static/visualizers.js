// ============================================================
// Linus — Visualizers & Procedural Live Motion Subsystem (static/visualizers.js)
// Celestial Halo Sound Ring, Winamp Spectrum / Oscilloscope, Horizon Waveform,
// Living Aura Canvas, and Procedural Motion Engine (Starfield, Aurora, Rain, Embers)
// ============================================================

(function() {
  'use strict';

  const $ = window.$ || (sel => document.querySelector(sel));
  const $$ = window.$$ || (sel => document.querySelectorAll(sel));

// ---- Celestial Halo Visualizer Engine (Translucent Sound Ring) ----
let haloCanvas = null;
let haloCtx = null;
let haloAngle = 0;
let haloParticles = [];

function initCelestialHaloEngine() {
  haloCanvas = document.getElementById('fs-halo-canvas');
  if (!haloCanvas) return;
  haloCtx = haloCanvas.getContext('2d');
  const size = Math.min(640, window.innerWidth * 0.8, window.innerHeight * 0.7);
  haloCanvas.width = size;
  haloCanvas.height = size;

  haloParticles = [];
  for (let i = 0; i < 48; i++) {
    haloParticles.push({
      angle: (i / 48) * Math.PI * 2,
      radiusOffset: (Math.random() - 0.5) * 24,
      size: Math.random() * 2.5 + 1.2,
      speed: (Math.random() * 0.008 + 0.003) * (i % 2 === 0 ? 1 : -1),
      alpha: Math.random() * 0.6 + 0.3
    });
  }
}

function renderCelestialHaloFrame(bass, mid, treble, audioData) {
  if (!haloCtx || !haloCanvas) {
    initCelestialHaloEngine();
    if (!haloCtx || !haloCanvas) return;
  }
  const w = haloCanvas.width;
  const h = haloCanvas.height;
  const cx = w / 2;
  const cy = h / 2;
  const baseR = Math.min(cx, cy) * 0.62;

  haloAngle += 0.008 + mid * 0.015;

  // Clear transparently - NEVER obscure background wallpaper!
  haloCtx.clearRect(0, 0, w, h);

  haloCtx.save();
  haloCtx.translate(cx, cy);

  // 1. Ethereal Inner Breathing Harmonic Circle
  const pulseR = baseR + bass * 24;
  haloCtx.beginPath();
  haloCtx.arc(0, 0, pulseR, 0, Math.PI * 2);
  haloCtx.strokeStyle = `rgba(255, 255, 255, ${0.15 + bass * 0.25})`;
  haloCtx.lineWidth = 1.5;
  haloCtx.stroke();

  // 2. Radial Frequency Soundwave Rays
  if (audioData && audioData.length) {
    const numPoints = 64;
    const step = (Math.PI * 2) / numPoints;
    haloCtx.beginPath();

    for (let i = 0; i < numPoints; i++) {
      const binIdx = Math.floor((i / numPoints) * (audioData.length / 2));
      const val = (audioData[binIdx] || 0) / 255;
      const angle = i * step + haloAngle;
      const len = Math.max(2, val * (32 + bass * 30));

      const x1 = Math.cos(angle) * (pulseR - 4);
      const y1 = Math.sin(angle) * (pulseR - 4);
      const x2 = Math.cos(angle) * (pulseR + len);
      const y2 = Math.sin(angle) * (pulseR + len);

      haloCtx.moveTo(x1, y1);
      haloCtx.lineTo(x2, y2);
    }
    haloCtx.strokeStyle = `rgba(229, 169, 93, ${0.5 + treble * 0.4})`;
    haloCtx.lineWidth = 2;
    haloCtx.lineCap = 'round';
    haloCtx.stroke();
  }

  // 3. Orbiting Celestial Dust Motes
  haloParticles.forEach(p => {
    p.angle += p.speed + mid * 0.01;
    const r = pulseR + p.radiusOffset + (bass * 15);
    const px = Math.cos(p.angle) * r;
    const py = Math.sin(p.angle) * r;

    haloCtx.fillStyle = `rgba(255, 255, 255, ${Math.min(1, p.alpha + treble * 0.35)})`;
    haloCtx.beginPath();
    haloCtx.arc(px, py, p.size * (1 + treble * 0.4), 0, Math.PI * 2);
    haloCtx.fill();
  });

  haloCtx.restore();
}

// ---- Winamp 2.x Audio Engine (16-Band LED Spectrum & Green Phosphor Oscilloscope) ----
let winampCanvas = null;
let winampCtx = null;
let winampMode = 'spectrum'; // 'spectrum' | 'osc'
const WINAMP_BANDS_COUNT = 16;
const winampBandHeights = new Float32Array(WINAMP_BANDS_COUNT);
const winampPeakCaps = new Float32Array(WINAMP_BANDS_COUNT);
const winampPeakVelocities = new Float32Array(WINAMP_BANDS_COUNT);
const winampPeakHolds = new Int32Array(WINAMP_BANDS_COUNT);

function initWinampEngine() {
  winampCanvas = document.getElementById('winamp-canvas');
  if (!winampCanvas) return;
  winampCtx = winampCanvas.getContext('2d');
  
  if (winampCanvas.clientWidth > 0) {
    winampCanvas.width = winampCanvas.clientWidth;
  } else if (winampCanvas.width !== 560) {
    winampCanvas.width = 560;
  }
  if (winampCanvas.height !== 200) {
    winampCanvas.height = 200;
  }

  const btnSpec = document.getElementById('winamp-mode-spec');
  const btnOsc = document.getElementById('winamp-mode-osc');

  if (btnSpec && !btnSpec._bound) {
    btnSpec._bound = true;
    btnSpec.addEventListener('click', (e) => {
      e.stopPropagation();
      winampMode = 'spectrum';
      btnSpec.classList.add('active');
      btnOsc?.classList.remove('active');
    });
  }

  if (btnOsc && !btnOsc._bound) {
    btnOsc._bound = true;
    btnOsc.addEventListener('click', (e) => {
      e.stopPropagation();
      winampMode = 'osc';
      btnOsc.classList.add('active');
      btnSpec?.classList.remove('active');
    });
  }
}

function renderWinampFrame(bass, mid, treble, audioData) {
  if (!winampCtx || !winampCanvas) {
    initWinampEngine();
    if (!winampCtx || !winampCanvas) return;
  }

  const w = winampCanvas.width;
  const h = winampCanvas.height;

  if (winampMode === 'osc') {
    // Oscilloscope: Phosphor fade trail
    winampCtx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    winampCtx.fillRect(0, 0, w, h);

    // CRT grid line in center
    winampCtx.strokeStyle = 'rgba(0, 55, 0, 0.4)';
    winampCtx.lineWidth = 1;
    winampCtx.beginPath();
    winampCtx.moveTo(0, h / 2);
    winampCtx.lineTo(w, h / 2);
    winampCtx.stroke();

    // Waveform line
    winampCtx.strokeStyle = '#00ff41';
    winampCtx.shadowColor = '#00ff41';
    winampCtx.shadowBlur = 8;
    winampCtx.lineWidth = 2.2;
    winampCtx.beginPath();

    const sliceWidth = w / (audioData ? audioData.length : 64);
    let x = 0;
    for (let i = 0; i < (audioData ? audioData.length : 64); i++) {
      const v = (audioData ? audioData[i] : 128) / 128.0;
      const y = (v * (h / 2.6)) + (h * 0.22);
      if (i === 0) {
        winampCtx.moveTo(x, y);
      } else {
        winampCtx.lineTo(x, y);
      }
      x += sliceWidth;
    }
    winampCtx.stroke();
    winampCtx.shadowBlur = 0;
  } else {
    // Spectrum Analyzer Mode
    winampCtx.fillStyle = '#000000';
    winampCtx.fillRect(0, 0, w, h);

    // Subtle green background grid lines
    winampCtx.strokeStyle = 'rgba(0, 60, 0, 0.35)';
    winampCtx.lineWidth = 1;
    for (let y = 10; y < h; y += 20) {
      winampCtx.beginPath();
      winampCtx.moveTo(0, y);
      winampCtx.lineTo(w, y);
      winampCtx.stroke();
    }

    const padLeft = 14;
    const padRight = 14;
    const availW = w - padLeft - padRight;
    const bandGap = 6;
    const bandW = Math.max(8, Math.floor((availW - (bandGap * (WINAMP_BANDS_COUNT - 1))) / WINAMP_BANDS_COUNT));
    const maxBarH = h - 22;

    const segH = 3;
    const segGap = 1;
    const totalSegH = segH + segGap;

    for (let i = 0; i < WINAMP_BANDS_COUNT; i++) {
      // Exponential bin mapping for authentic EQ sensitivity
      const binIdx = Math.min(
        (audioData ? audioData.length : 32) - 1,
        Math.floor(Math.pow(i / WINAMP_BANDS_COUNT, 1.8) * ((audioData ? audioData.length : 32) - 1))
      );
      const rawVal = audioData ? (audioData[binIdx] || 0) : 0;
      const targetNorm = rawVal / 255.0;

      // Smooth bar rise and decay
      if (targetNorm > winampBandHeights[i]) {
        winampBandHeights[i] = targetNorm;
      } else {
        winampBandHeights[i] = Math.max(0, winampBandHeights[i] - 0.045);
      }

      const barH = Math.floor(winampBandHeights[i] * maxBarH);
      const bx = padLeft + i * (bandW + bandGap);
      const byBottom = h - 10;

      // Draw discrete LED Segments
      const numSegs = Math.floor(barH / totalSegH);
      for (let s = 0; s < numSegs; s++) {
        const sy = byBottom - ((s + 1) * totalSegH);
        const segPct = s / (maxBarH / totalSegH);

        if (segPct > 0.82) {
          winampCtx.fillStyle = '#ff1a40'; // Peak red
        } else if (segPct > 0.58) {
          winampCtx.fillStyle = '#ffb300'; // Amber yellow
        } else {
          winampCtx.fillStyle = '#00ff41'; // Green phosphor
        }
        winampCtx.fillRect(bx, sy, bandW, segH);
      }

      // Physics-driven White Peak Caps (Falling with gravity)
      const currentBarTopY = byBottom - barH;
      if (currentBarTopY < winampPeakCaps[i] || winampPeakCaps[i] === 0) {
        winampPeakCaps[i] = currentBarTopY;
        winampPeakHolds[i] = 10; // Hold for 10 frames (~160ms)
        winampPeakVelocities[i] = 0;
      } else {
        if (winampPeakHolds[i] > 0) {
          winampPeakHolds[i]--;
        } else {
          winampPeakVelocities[i] += 0.45; // Gravity
          winampPeakCaps[i] += winampPeakVelocities[i];
          if (winampPeakCaps[i] > byBottom) {
            winampPeakCaps[i] = byBottom;
            winampPeakVelocities[i] = 0;
          }
        }
      }

      // Draw peak cap
      if (winampPeakCaps[i] < byBottom - 2) {
        winampCtx.fillStyle = '#ffffff';
        winampCtx.shadowColor = '#ffffff';
        winampCtx.shadowBlur = 4;
        winampCtx.fillRect(bx, winampPeakCaps[i], bandW, 2);
        winampCtx.shadowBlur = 0;
      }
    }
  }
}

// ---- Cyberpunk Neon Wave Visualizer Engine (Liquid Harmonic Perspective Ribbons) ----
let cyberCanvas = null;
let cyberCtx = null;
let cyberPhase = 0;
let cyberParticles = [];

function initCyberEngine() {
  cyberCanvas = document.getElementById('fs-cyber-canvas');
  if (!cyberCanvas) return;
  cyberCtx = cyberCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = cyberCanvas.getBoundingClientRect();
  const w = rect.width > 0 ? rect.width : Math.min(760, window.innerWidth * 0.85);
  const h = rect.height > 0 ? rect.height : Math.min(480, window.innerHeight * 0.65);
  cyberCanvas.width = Math.round(w * dpr);
  cyberCanvas.height = Math.round(h * dpr);

  cyberParticles = [];
  for (let i = 0; i < 40; i++) {
    cyberParticles.push({
      x: Math.random() * cyberCanvas.width,
      y: Math.random() * cyberCanvas.height,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -Math.random() * 2 - 0.5,
      size: Math.random() * 2.5 + 1,
      alpha: Math.random() * 0.7 + 0.3
    });
  }
}

function renderCyberFrame(bass, mid, treble, audioData) {
  if (!cyberCtx || !cyberCanvas) {
    initCyberEngine();
    if (!cyberCtx || !cyberCanvas) return;
  }
  const w = cyberCanvas.width;
  const h = cyberCanvas.height;
  cyberCtx.clearRect(0, 0, w, h);

  cyberPhase += 0.035 + bass * 0.06;

  // 1. Perspective Grid Floor
  const horizonY = h * 0.62;
  cyberCtx.save();
  cyberCtx.strokeStyle = 'rgba(212, 176, 122, 0.12)';
  cyberCtx.lineWidth = 1;
  
  // Vanishing perspective lines
  const numGridLines = 14;
  for (let i = 0; i <= numGridLines; i++) {
    const bottomX = (w / numGridLines) * i;
    cyberCtx.beginPath();
    cyberCtx.moveTo(w / 2, horizonY);
    cyberCtx.lineTo(bottomX, h);
    cyberCtx.stroke();
  }

  // Horizontal moving grid lines
  const gridSpeed = (cyberPhase * 25) % 28;
  for (let y = horizonY; y < h; y += 18) {
    const adjustedY = y + gridSpeed * ((y - horizonY) / (h - horizonY));
    if (adjustedY <= h) {
      cyberCtx.beginPath();
      cyberCtx.moveTo(0, adjustedY);
      cyberCtx.lineTo(w, adjustedY);
      cyberCtx.stroke();
    }
  }
  cyberCtx.restore();

  // 2. Triple Neon Audio-Reactive Wave Ribbons
  const docStyle = typeof getComputedStyle !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const accentColor = (docStyle && docStyle.getPropertyValue('--accent').trim()) || '#e5a95d';

  const ribbons = [
    { color: accentColor, amplitude: 50 + bass * 80, freq: 0.012, offset: 0, alpha: 0.85, width: 3 },
    { color: '#00e5ff', amplitude: 35 + mid * 60, freq: 0.016, offset: 1.8, alpha: 0.65, width: 2 },
    { color: '#ff007f', amplitude: 24 + treble * 45, freq: 0.022, offset: 3.4, alpha: 0.5, width: 1.5 }
  ];

  ribbons.forEach(r => {
    cyberCtx.save();
    cyberCtx.beginPath();
    const points = 70;
    const stepX = w / (points - 1);

    for (let i = 0; i < points; i++) {
      const x = i * stepX;
      let binVal = 0;
      if (audioData && audioData.length) {
        const bin = Math.min(Math.floor((i / points) * (audioData.length / 2)), audioData.length - 1);
        binVal = (audioData[bin] || 0) / 255;
      }
      const wave = Math.sin(x * r.freq + cyberPhase + r.offset) * r.amplitude;
      const audioBump = -binVal * (40 + bass * 55);
      const y = horizonY + wave + audioBump;

      if (i === 0) cyberCtx.moveTo(x, y);
      else cyberCtx.lineTo(x, y);
    }

    cyberCtx.strokeStyle = r.color;
    cyberCtx.lineWidth = r.width;
    cyberCtx.shadowColor = r.color;
    cyberCtx.shadowBlur = 14 + bass * 12;
    cyberCtx.stroke();
    cyberCtx.restore();
  });

  // 3. Neon Sparks (shoot upwards on treble peaks)
  if (treble > 0.35 && cyberParticles.length < 60) {
    cyberParticles.push({
      x: Math.random() * w,
      y: horizonY,
      vx: (Math.random() - 0.5) * 3,
      vy: -Math.random() * 4 - 2,
      size: Math.random() * 2 + 1,
      alpha: 1.0
    });
  }

  for (let i = cyberParticles.length - 1; i >= 0; i--) {
    const p = cyberParticles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.alpha -= 0.018;

    if (p.alpha <= 0 || p.y < 0) {
      cyberParticles.splice(i, 1);
      continue;
    }

    cyberCtx.beginPath();
    cyberCtx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
    cyberCtx.fillStyle = `rgba(0, 229, 255, ${p.alpha})`;
    cyberCtx.shadowColor = '#00e5ff';
    cyberCtx.shadowBlur = 6;
    cyberCtx.fill();
  }
}

function resizeVisualizerCanvases() {
  const haloC = haloCanvas || document.getElementById('fs-halo-canvas');
  if (haloC && haloC.clientWidth > 0) {
    const size = Math.min(640, Math.max(300, haloC.clientWidth));
    if (haloC.width !== size || haloC.height !== size) {
      haloC.width = size;
      haloC.height = size;
    }
  }
  const winampC = winampCanvas || document.getElementById('winamp-canvas');
  if (winampC && winampC.clientWidth > 0) {
    const targetW = winampC.clientWidth;
    if (winampC.width !== targetW) {
      winampC.width = targetW;
    }
  }
  const galaxyC = document.getElementById('fs-galaxy-canvas');
  if (galaxyC && galaxyC.clientWidth > 0) {
    const size = Math.min(680, Math.max(320, galaxyC.clientWidth));
    if (galaxyC.width !== size || galaxyC.height !== size) {
      galaxyC.width = size;
      galaxyC.height = size;
    }
  }
  const cyberC = cyberCanvas || document.getElementById('fs-cyber-canvas');
  if (cyberC && cyberC.clientWidth > 0) {
    const dpr = window.devicePixelRatio || 1;
    const targetW = Math.round(cyberC.clientWidth * dpr);
    const targetH = Math.round(cyberC.clientHeight * dpr);
    if (cyberC.width !== targetW || cyberC.height !== targetH) {
      cyberC.width = targetW;
      cyberC.height = targetH;
    }
  }
}

initCelestialHaloEngine();
initWinampEngine();
initCyberEngine();
window.addEventListener('resize', resizeVisualizerCanvases);

let visualizerRaf = null;

function startAudioVisualizer() {
  if (typeof initAudioContext === 'function') initAudioContext();
  else if (window.initAudioContext) window.initAudioContext();

  const audioCtx = window.audioCtx;
  const analyser = window.analyser;
  const audioDataArray = window.audioDataArray;
  const audio = window.audio || document.getElementById('audio');
  const fsPlayer = window.fsPlayer || document.getElementById('fs-player');

  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  if (visualizerRaf) cancelAnimationFrame(visualizerRaf);

  const waveBars = document.querySelectorAll('#mode-wave .wave-bar');
  const auraCore = $('#fs-aura-core');
  const auraWaves = document.querySelectorAll('.aura-wave-circle');
  const modernArt = $('#fs-modern-art');

  function renderFrame() {
    if (document.hidden || audio.paused || !analyser) {
      waveBars.forEach(b => { b.style.height = '16px'; b.style.opacity = '0.35'; b.style.boxShadow = 'none'; });
      if (auraCore) auraCore.style.transform = 'scale(1)';
      if (haloCtx && haloCanvas) {
        haloCtx.clearRect(0, 0, haloCanvas.width, haloCanvas.height);
      }
      if (winampCtx && winampCanvas) {
        winampCtx.clearRect(0, 0, winampCanvas.width, winampCanvas.height);
      }
      const gCanvas = document.getElementById('fs-galaxy-canvas');
      if (gCanvas) {
        const gCtx = gCanvas.getContext('2d');
        if (gCtx) gCtx.clearRect(0, 0, gCanvas.width, gCanvas.height);
      }
      if (cyberCtx && cyberCanvas) {
        cyberCtx.clearRect(0, 0, cyberCanvas.width, cyberCanvas.height);
      }
      visualizerRaf = null;
      return;
    }

    visualizerRaf = requestAnimationFrame(renderFrame);
    analyser.getByteFrequencyData(audioDataArray);

    const mode = fsPlayer.getAttribute('data-mode') || 'stage';

    // 1. Frequency Band Extraction
    const bass = ((audioDataArray[0] + audioDataArray[1] + audioDataArray[2] + audioDataArray[3]) / 4) / 255;
    const mid = ((audioDataArray[8] + audioDataArray[10] + audioDataArray[12]) / 3) / 255;
    const treble = ((audioDataArray[20] + audioDataArray[24] + audioDataArray[28]) / 3) / 255;

    // 2. Celestial Halo Mode (Orbital Translucent Soundring)
    if (mode === 'halo') {
      renderCelestialHaloFrame(bass, mid, treble, audioDataArray);
    }

    // 3. 90s Retro Mode (Winamp 2.x Spectrum / CRT Phosphor Oscilloscope)
    if (mode === 'retro90s') {
      renderWinampFrame(bass, mid, treble, audioDataArray);
    }

    // 4. Cosmic Galaxy 3D Particle Mode
    if (mode === 'galaxy' && typeof renderGalaxyFrame === 'function') {
      renderGalaxyFrame(bass, mid, treble);
    }

    // 5. Cyberpunk Neon Wave Ribbon Mode
    if (mode === 'cyber') {
      renderCyberFrame(bass, mid, treble, audioDataArray);
    }

    // 7. Equalizer Wave Bars Mode
    if (mode === 'wave' && waveBars.length > 0) {
      const step = Math.max(1, Math.floor(audioDataArray.length / waveBars.length));
      waveBars.forEach((bar, idx) => {
        const bin = Math.min(idx * step, audioDataArray.length - 1);
        const val = audioDataArray[bin] || 0;
        const norm = val / 255;
        const h = Math.max(16, norm * 135);
        bar.style.height = `${h}px`;
        bar.style.opacity = `${Math.max(0.35, norm * 1.15)}`;
        bar.style.boxShadow = norm > 0.55 ? `0 0 ${norm * 22}px var(--accent, #d4b07a)` : 'none';
      });
    }

    // 8. Aura Mode Reactive Beat
    if (mode === 'aura' && auraCore) {
      const scale = 1 + bass * 0.32;
      auraCore.style.transform = `scale(${scale})`;
      auraCore.style.boxShadow = `0 0 ${35 + bass * 55}px var(--accent-glow, var(--accent, #d4b07a)), inset 0 0 ${15 + bass * 20}px rgba(255,255,255,0.9)`;
      auraWaves.forEach(ring => {
        ring.style.borderColor = `rgba(var(--chameleon-primary-rgb, 212, 176, 122), ${Math.min(0.85, 0.2 + bass * 0.65)})`;
      });
    }

    // 9. Modern Card Reactive Shadow
    if (mode === 'modern' && modernArt) {
      modernArt.style.boxShadow = `0 ${20 + bass * 28}px ${50 + bass * 40}px rgba(0,0,0,0.8), 0 0 ${bass * 35}px var(--chameleon-glow, rgba(212, 176, 122, 0.35))`;
    }
  }

  visualizerRaf = requestAnimationFrame(renderFrame);
}



// Procedural Live Motion Canvas Engine (100% Reliable Client-Side Rendering)
// ============================================================
let motionCanvas = null;
let motionCtx = null;
let fsMotionCanvas = null;
let fsMotionCtx = null;
let motionAnimId = null;
let motionParticles = [];
let motionPreset = 'aura';
let motionTime = 0;

function resizeMotionCanvases() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (motionCanvas) { motionCanvas.width = w; motionCanvas.height = h; }
  if (fsMotionCanvas) { fsMotionCanvas.width = w; fsMotionCanvas.height = h; }
  spawnParticlesForPreset(motionPreset);
}

function initProceduralLiveMotion() {
  motionCanvas = $('#live-motion-canvas');
  if (motionCanvas) motionCtx = motionCanvas.getContext('2d');
  fsMotionCanvas = $('#fs-live-motion-canvas');
  if (fsMotionCanvas) fsMotionCtx = fsMotionCanvas.getContext('2d');

  window.addEventListener('resize', resizeMotionCanvases);
  resizeMotionCanvases();
  startMotionAnimationLoop();
}

function spawnParticlesForPreset(preset) {
  motionPreset = preset;
  motionParticles = [];
  const w = window.innerWidth;
  const h = window.innerHeight;

  if (preset === 'lofi' || preset === 'tokyo_night') {
    // Raindrops on dark window pane
    for (let i = 0; i < 140; i++) {
      motionParticles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        length: Math.random() * 26 + 14,
        speed: Math.random() * 14 + 10,
        opacity: Math.random() * 0.45 + 0.25,
        wind: -2.5 + Math.random() * 1.0,
        width: Math.random() * 1.5 + 0.8
      });
    }
  } else if (preset === 'fireplace') {
    // Rising warm fiery embers & sparks
    for (let i = 0; i < 110; i++) {
      motionParticles.push({
        x: w * 0.5 + (Math.random() - 0.5) * (w * 0.6),
        y: h + Math.random() * 100,
        size: Math.random() * 5 + 2,
        speedY: Math.random() * 3.5 + 1.8,
        speedX: (Math.random() - 0.5) * 2.2,
        life: Math.random() * 1,
        maxLife: Math.random() * 0.8 + 0.4,
        hue: 15 + Math.random() * 35 // Yellow/Orange/Red fire colors
      });
    }
  } else if (preset === 'cyber' || preset === 'sunset_drive' || preset === 'neon_tunnel') {
    // Neon Cyber Grid & Speed Streaks
    for (let i = 0; i < 90; i++) {
      motionParticles.push({
        x: (Math.random() - 0.5) * w * 2,
        y: (Math.random() - 0.5) * h * 2,
        z: Math.random() * 1000 + 10,
        color: i % 2 === 0 ? '#d946ef' : '#38bdf8'
      });
    }
  } else if (preset === 'space') {
    // Infinite twinkling space stars & cosmic dust
    for (let i = 0; i < 180; i++) {
      motionParticles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        radius: Math.random() * 2.2 + 0.5,
        alpha: Math.random() * 0.9 + 0.1,
        twinkleSpeed: Math.random() * 0.04 + 0.01,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        color: ['#ffffff', '#a5b4fc', '#e0e7ff', '#fbcfe8'][Math.floor(Math.random() * 4)]
      });
    }
  } else if (preset === 'ocean') {
    // Ambient oceanic sine waves
    for (let i = 0; i < 6; i++) {
      motionParticles.push({
        yOffset: h * 0.5 + i * 45,
        amplitude: 24 + i * 8,
        frequency: 0.003 + i * 0.0008,
        speed: 0.015 + i * 0.006,
        alpha: 0.18 + i * 0.07,
        color: i % 2 === 0 ? 'rgba(56, 189, 248,' : 'rgba(14, 165, 233,'
      });
    }
  } else if (preset === 'aurora_borealis') {
    // Flowing emerald and violet aurora ribbons
    for (let i = 0; i < 5; i++) {
      motionParticles.push({
        phase: Math.random() * Math.PI * 2,
        speed: 0.008 + i * 0.004,
        color: i % 2 === 0 ? '#34d399' : '#818cf8',
        y: h * (0.2 + i * 0.12)
      });
    }
  } else if (preset === 'mountain_clouds' || preset === 'cozy_coffee') {
    // Drifting atmospheric clouds & steam
    for (let i = 0; i < 28; i++) {
      motionParticles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        radius: Math.random() * 180 + 80,
        vx: Math.random() * 0.6 + 0.2,
        alpha: Math.random() * 0.18 + 0.06
      });
    }
  }
}

function renderMotionToContext(ctx, w, h, isFullscreen = false) {
  if (!ctx) return;
  motionTime += 0.018;

  // Background clear with dark aesthetic backdrop
  if (motionPreset === 'fireplace') {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0c0705');
    bgGrad.addColorStop(1, '#240d04');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Render embers
    motionParticles.forEach(p => {
      p.y -= p.speedY;
      p.x += Math.sin(motionTime * 2 + p.speedX) * 1.5 + p.speedX * 0.4;
      p.life += 0.012;
      if (p.y < 0 || p.life > p.maxLife) {
        p.y = h + Math.random() * 40;
        p.x = w * 0.5 + (Math.random() - 0.5) * (w * 0.7);
        p.life = 0;
      }
      const alpha = Math.max(0, 1 - (p.life / p.maxLife));
      ctx.fillStyle = `hsla(${p.hue}, 100%, 65%, ${alpha})`;
      ctx.shadowColor = `hsl(${p.hue}, 100%, 50%)`;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.shadowBlur = 0;

  } else if (motionPreset === 'lofi' || motionPreset === 'tokyo_night') {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, motionPreset === 'tokyo_night' ? '#090514' : '#080c14');
    bgGrad.addColorStop(1, motionPreset === 'tokyo_night' ? '#1c0a2a' : '#101726');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Neon blur reflection lights
    ctx.fillStyle = motionPreset === 'tokyo_night' ? 'rgba(217, 70, 239, 0.15)' : 'rgba(56, 189, 248, 0.12)';
    ctx.beginPath();
    ctx.arc(w * 0.75, h * 0.3, 200, 0, Math.PI * 2);
    ctx.fill();

    // Render Rain
    ctx.strokeStyle = 'rgba(200, 225, 255, 0.6)';
    ctx.lineWidth = 1.2;
    motionParticles.forEach(p => {
      p.y += p.speed;
      p.x += p.wind;
      if (p.y > h) { p.y = -p.length; p.x = Math.random() * w; }
      ctx.strokeStyle = `rgba(180, 215, 255, ${p.opacity})`;
      ctx.lineWidth = p.width;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.wind * 2, p.y + p.length);
      ctx.stroke();
    });

  } else if (motionPreset === 'cyber' || motionPreset === 'sunset_drive' || motionPreset === 'neon_tunnel') {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#0a0212');
    bgGrad.addColorStop(0.65, '#20072b');
    bgGrad.addColorStop(1, '#05010a');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Synthwave Sun in center
    const sunGrad = ctx.createLinearGradient(w * 0.5, h * 0.2, w * 0.5, h * 0.65);
    sunGrad.addColorStop(0, '#ffed4a');
    sunGrad.addColorStop(0.5, '#f43f5e');
    sunGrad.addColorStop(1, '#a855f7');
    ctx.fillStyle = sunGrad;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.45, Math.min(w, h) * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // 3D Warp streaks
    const cx = w * 0.5;
    const cy = h * 0.5;
    motionParticles.forEach(p => {
      p.z -= 8;
      if (p.z <= 0) p.z = 1000;
      const k = 280 / p.z;
      const px = p.x * k + cx;
      const py = p.y * k + cy;
      if (px >= 0 && px <= w && py >= 0 && py <= h) {
        const size = Math.max(1.2, (1 - p.z / 1000) * 4);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });

  } else if (motionPreset === 'space') {
    ctx.fillStyle = '#05050c';
    ctx.fillRect(0, 0, w, h);

    // Cosmic Nebula Glow
    const nebGrad = ctx.createRadialGradient(w * 0.4, h * 0.5, 50, w * 0.4, h * 0.5, 380);
    nebGrad.addColorStop(0, 'rgba(147, 51, 234, 0.18)');
    nebGrad.addColorStop(0.5, 'rgba(59, 130, 246, 0.1)');
    nebGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = nebGrad;
    ctx.fillRect(0, 0, w, h);

    // Stars
    motionParticles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0) p.x = w; if (p.x > w) p.x = 0;
      if (p.y < 0) p.y = h; if (p.y > h) p.y = 0;
      const twinkle = p.alpha * (0.6 + 0.4 * Math.sin(motionTime * 10 * p.twinkleSpeed));
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0.1, Math.min(1, twinkle));
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

  } else if (motionPreset === 'ocean') {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#040d1a');
    bgGrad.addColorStop(0.5, '#071d33');
    bgGrad.addColorStop(1, '#020912');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    // Golden Sunset Glow on water
    const sunGrad = ctx.createRadialGradient(w * 0.5, h * 0.35, 10, w * 0.5, h * 0.35, 240);
    sunGrad.addColorStop(0, 'rgba(251, 146, 60, 0.35)');
    sunGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, w, h);

    // Sine Waves
    motionParticles.forEach(wave => {
      ctx.fillStyle = `${wave.color} ${wave.alpha})`;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 15) {
        const y = wave.yOffset + Math.sin(x * wave.frequency + motionTime * 2 * wave.speed) * wave.amplitude;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    });

  } else if (motionPreset === 'aurora_borealis') {
    ctx.fillStyle = '#03080e';
    ctx.fillRect(0, 0, w, h);

    motionParticles.forEach(aurora => {
      const grad = ctx.createLinearGradient(0, aurora.y - 120, 0, aurora.y + 120);
      grad.addColorStop(0, 'transparent');
      grad.addColorStop(0.5, aurora.color);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.22;

      ctx.beginPath();
      ctx.moveTo(0, aurora.y);
      for (let x = 0; x <= w; x += 20) {
        const y = aurora.y + Math.sin(x * 0.004 + motionTime * aurora.speed + aurora.phase) * 60 +
                           Math.cos(x * 0.008 + motionTime * 0.5) * 30;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.closePath();
      ctx.fill();
    });
    ctx.globalAlpha = 1.0;

  } else if (motionPreset === 'mountain_clouds' || motionPreset === 'cozy_coffee') {
    const bgGrad = ctx.createLinearGradient(0, 0, 0, h);
    bgGrad.addColorStop(0, '#10111a');
    bgGrad.addColorStop(1, '#08080d');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);

    motionParticles.forEach(p => {
      p.x += p.vx;
      if (p.x - p.radius > w) p.x = -p.radius;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
      grad.addColorStop(0, `rgba(210, 220, 240, ${p.alpha})`);
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fill();
    });
  }
}

function startMotionAnimationLoop() {
  if (motionAnimId) cancelAnimationFrame(motionAnimId);
  motionAnimId = null;

  if (document.hidden) return;

  function frame() {
    if (document.hidden) {
      motionAnimId = null;
      return;
    }

    const w = window.innerWidth;
    const h = window.innerHeight;

    // Render on dashboard motion canvas if visible
    if (motionCanvas && !motionCanvas.classList.contains('hidden')) {
      renderMotionToContext(motionCtx, w, h, false);
    }

    // Render on fullscreen motion canvas if visible
    if (fsMotionCanvas && !fsMotionCanvas.classList.contains('hidden')) {
      renderMotionToContext(fsMotionCtx, w, h, true);
    }

    motionAnimId = requestAnimationFrame(frame);
  }

  motionAnimId = requestAnimationFrame(frame);
}



  // Expose Visualizer APIs to global window
  window.initCelestialHaloEngine = initCelestialHaloEngine;
  window.renderCelestialHaloFrame = renderCelestialHaloFrame;
  window.initWinampEngine = initWinampEngine;
  window.renderWinampFrame = renderWinampFrame;
  window.initCyberEngine = initCyberEngine;
  window.renderCyberFrame = renderCyberFrame;
  window.resizeVisualizerCanvases = resizeVisualizerCanvases;
  window.startAudioVisualizer = startAudioVisualizer;
  window.initProceduralLiveMotion = initProceduralLiveMotion;
  window.resizeMotionCanvases = resizeMotionCanvases;
  window.spawnParticlesForPreset = spawnParticlesForPreset;
  window.renderMotionToContext = renderMotionToContext;
  window.startMotionAnimationLoop = startMotionAnimationLoop;

  // Auto-init visualizer engines when DOM is ready
  document.addEventListener('DOMContentLoaded', () => {
    initCelestialHaloEngine();
    initWinampEngine();
    initCyberEngine();
    initProceduralLiveMotion();
    window.addEventListener('resize', () => {
      resizeVisualizerCanvases();
      resizeMotionCanvases();
    });
  });

})();
