// ============================================================
// Linus — Personalization Studio, Fullscreen Customizer &
// 50+ Wallpaper Gallery Subsystem (static/theme_studio.js)
// Real-Time Color Tuning, CSS Variables, IndexedDB Wallpaper Store,
// Live Video Wallpapers, and Atmospheric Curated Gallery
// ============================================================

(function() {
  'use strict';

  const $ = window.$ || (sel => document.querySelector(sel));
  const $$ = window.$$ || (sel => document.querySelectorAll(sel));

// Hoisted theme state to prevent TDZ across scopes
var fsTheme = null;

// ============================================================
// Personalization Studio & Live Atmosphere Engine
// ============================================================

const DEFAULT_USER_THEME = {
  accent: '#e5a95d',
  bg: '#0d0a08',
  surface: '#17120e',
  text: '#fdf6ec',
  fontFamily: 'serif',
  wallpaperType: 'aura',
  customImageSrc: '',
  customVideoSrc: '',
  wallpaperDim: 40,
  wallpaperBlur: 0,
  glassOpacity: 75,
  glowIntensity: 40,
  beatPulse: true,
  customVinylSticker: '',
  welcomeQuote: true,
  welcomeQuoteFrequency: 'always'
};

const VIDEO_WALLPAPER_URLS = {
  lofi: 'https://assets.mixkit.co/videos/preview/mixkit-rain-drops-on-a-window-at-night-42218-large.mp4',
  fireplace: 'https://assets.mixkit.co/videos/preview/mixkit-wood-burning-in-a-campfire-43050-large.mp4',
  cyber: 'https://assets.mixkit.co/videos/preview/mixkit-aerial-view-of-city-traffic-at-night-42095-large.mp4',
  space: 'https://assets.mixkit.co/videos/preview/mixkit-starry-sky-and-stars-moving-at-night-42358-large.mp4',
  ocean: 'https://assets.mixkit.co/videos/preview/mixkit-calm-waves-on-a-rocky-beach-at-sunset-41712-large.mp4',
  sunset_drive: 'https://assets.mixkit.co/videos/preview/mixkit-driving-down-a-highway-at-sunset-41743-large.mp4',
  tokyo_night: 'https://assets.mixkit.co/videos/preview/mixkit-crowded-street-in-tokyo-at-night-41584-large.mp4',
  mountain_clouds: 'https://assets.mixkit.co/videos/preview/mixkit-mountain-landscape-with-fog-and-clouds-42220-large.mp4',
  aurora_borealis: 'https://assets.mixkit.co/videos/preview/mixkit-northern-lights-over-the-ocean-at-night-42360-large.mp4',
  cozy_coffee: 'https://assets.mixkit.co/videos/preview/mixkit-steam-rising-from-a-cup-of-coffee-43048-large.mp4',
  neon_tunnel: 'https://assets.mixkit.co/videos/preview/mixkit-tunnel-of-futuristic-neon-lights-42999-large.mp4'
};

const STATIC_WALLPAPERS_CATALOG = [
  // --- Category: Anime & Cyberpunk ---
  { id: 'art_anime_sunset', title: 'Anime Twilight Sky', desc: 'Pastel sunset clouds & stars', cat: 'anime', url: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=400&q=80', featured: true },
  { id: 'art_cyberpunk_alley', title: 'Cyberpunk Neon Alley', desc: 'Dystopian futuristic city glow', cat: 'anime', url: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=400&q=80', featured: true },
  { id: 'art_tokyo_street', title: 'Shinjuku Cyber Street', desc: 'Neon rain Tokyo alleyway', cat: 'anime', url: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?w=400&q=80', featured: true },
  { id: 'art_neon_synth', title: 'Synthwave Horizon', desc: 'Retro grid sunset aesthetic', cat: 'anime', url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&q=80', featured: true },
  { id: 'art_cyber_car', title: 'Midnight Cyber Cruise', desc: 'Sleek supercar night lights', cat: 'anime', url: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?w=400&q=80', featured: true },
  { id: 'art_cyber_skyline', title: 'Neo Tokyo Skyline', desc: 'Futuristic metropolis skyscrapers', cat: 'anime', url: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1514565131-fce0801e5785?w=400&q=80' },
  { id: 'art_anime_cherry_train', title: 'Sakura Train Crossing', desc: 'Spring anime railroad blossom', cat: 'anime', url: 'https://images.unsplash.com/photo-1528164344705-475426879c0d?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1528164344705-475426879c0d?w=400&q=80' },
  { id: 'art_neon_arcade', title: 'Akihabara Arcade Glow', desc: 'Retro arcade neon game signs', cat: 'anime', url: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1511512578047-dfb367046420?w=400&q=80' },
  { id: 'art_cyber_matrix', title: 'Digital Matrix Rain', desc: 'Glowing green cyberspace code', cat: 'anime', url: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1526374965328-7f61d4dc18c5?w=400&q=80' },
  { id: 'art_anime_rooftop', title: 'Anime Sunset Rooftop', desc: 'Overlooking golden hour cityscape', cat: 'anime', url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?w=400&q=80' },

  // --- Category: Nature & Scenic ---
  { id: 'art_misty_forest', title: 'Misty Pine Forest', desc: 'Deep cinematic foggy evergreens', cat: 'nature', url: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1448375240586-882707db888b?w=400&q=80', featured: true },
  { id: 'art_fuji_sakura', title: 'Mount Fuji & Sakura', desc: 'Japanese cherry blossom spring', cat: 'nature', url: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=400&q=80', featured: true },
  { id: 'art_autumn_lake', title: 'Golden Autumn Forest', desc: 'Warm autumn morning sunlight', cat: 'nature', url: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1441974231531-c6227db76b6e?w=400&q=80', featured: true },
  { id: 'art_desert_dunes', title: 'Sunset Desert Dunes', desc: 'Warm minimalist desert sand', cat: 'nature', url: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=400&q=80', featured: true },
  { id: 'art_nordic_aurora', title: 'Nordic Emerald Aurora', desc: 'Vibrant polar night sky', cat: 'nature', url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=400&q=80', featured: true },
  { id: 'art_alpine_peaks', title: 'Swiss Alpine Peaks', desc: 'Snowy summit sun reflection', cat: 'nature', url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&q=80' },
  { id: 'art_tropical_coast', title: 'Emerald Tropical Coast', desc: 'Crystal turquoise ocean cove', cat: 'nature', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=80' },
  { id: 'art_bamboo_grove', title: 'Kyoto Bamboo Grove', desc: 'Serene sunlit green stalks', cat: 'nature', url: 'https://images.unsplash.com/photo-1476820865390-c52aeebb9891?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1476820865390-c52aeebb9891?w=400&q=80' },
  { id: 'art_iceland_waterfall', title: 'Icelandic Canyon Fall', desc: 'Misty glacial river cascades', cat: 'nature', url: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1433086966358-54859d0ed716?w=400&q=80' },
  { id: 'art_lavender_field', title: 'Provence Lavender Fields', desc: 'Purple bloom sunset horizon', cat: 'nature', url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?w=400&q=80' },
  { id: 'art_redwood_rays', title: 'Sunlit Redwood Canopy', desc: 'Golden rays piercing ancient trees', cat: 'nature', url: 'https://images.unsplash.com/photo-1511497584788-87676104235f?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1511497584788-87676104235f?w=400&q=80' },

  // --- Category: Space & Sci-Fi ---
  { id: 'art_cosmic_space', title: 'Celestial Galaxy Dust', desc: 'Deep space nebula & starlight', cat: 'space', url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&q=80', featured: true },
  { id: 'art_deep_nebula', title: 'Deep Violet Nebula', desc: 'Cosmic purple interstellar cloud', cat: 'space', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=400&q=80' },
  { id: 'art_saturn_rings', title: 'Orbital Planet Horizon', desc: 'Celestial ring world perspective', cat: 'space', url: 'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=400&q=80' },
  { id: 'art_milky_way_dunes', title: 'Milky Way Over Desert', desc: 'Glittering starry galactic core', cat: 'space', url: 'https://images.unsplash.com/photo-1509773896068-7fd415d91e2e?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1509773896068-7fd415d91e2e?w=400&q=80' },
  { id: 'art_moon_eclipse', title: 'Blood Moon Total Eclipse', desc: 'Dramatic cosmic lunar alignment', cat: 'space', url: 'https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1532693322450-2cb5c511067d?w=400&q=80' },
  { id: 'art_space_station', title: 'Earth from Space Orbit', desc: 'Atmospheric blue glow from ISS', cat: 'space', url: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1446776811953-b23d57bd21aa?w=400&q=80' },
  { id: 'art_james_webb', title: 'Stellar Deep Field Nursery', desc: 'Infrared star cluster nursery', cat: 'space', url: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=400&q=80' },
  { id: 'art_supernova_burst', title: 'Supernova Cosmic Shock', desc: 'Blazing explosion of cosmic light', cat: 'space', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&q=80' },

  // --- Category: Minimalist & Abstract ---
  { id: 'art_minimal_waves', title: 'The Great Wave', desc: 'Minimalist classic Great Wave', cat: 'minimal', url: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1518837695005-2083093ee35b?w=400&q=80', featured: true },
  { id: 'art_dreamy_cloudscape', title: 'Dreamy Cotton Clouds', desc: 'Serene blue daylight skies', cat: 'minimal', url: 'https://images.unsplash.com/photo-1513002749550-c59d786b8e6c?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1513002749550-c59d786b8e6c?w=400&q=80', featured: true },
  { id: 'art_dark_glass', title: 'Obsidian Liquid Glass', desc: 'Smooth black iridescent curvature', cat: 'minimal', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&q=80' },
  { id: 'art_pastel_gradient', title: 'Ethereal Sunset Gradient', desc: 'Gentle peach & violet blur', cat: 'minimal', url: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=400&q=80' },
  { id: 'art_geometric_arch', title: 'Minimalist Bauhaus Arch', desc: 'Clean architectural geometry', cat: 'minimal', url: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=400&q=80' },
  { id: 'art_smoke_waves', title: 'Silk Ribbon Motion', desc: 'Monochrome flowing satin waves', cat: 'minimal', url: 'https://images.unsplash.com/photo-1507908708918-778587c9e563?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1507908708918-778587c9e563?w=400&q=80' },
  { id: 'art_sand_ripples', title: 'Zen Sand Ripples', desc: 'Textured golden wave pattern', cat: 'minimal', url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=400&q=80' },
  { id: 'art_monochrome_fog', title: 'Monochrome Lake Fog', desc: 'Minimalist misty lake reflection', cat: 'minimal', url: 'https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1483728642387-6c3bdd6c93e5?w=400&q=80' },

  // --- Category: Cozy & Aesthetic ---
  { id: 'art_cozy_night_library', title: 'Midnight Cozy Library', desc: 'Warm vintage study books', cat: 'cozy', url: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1524995997946-a1c2e315a42f?w=400&q=80', featured: true },
  { id: 'art_rainy_cafe_window', title: 'Rainy Cafe Window', desc: 'Steaming espresso & streetlights', cat: 'cozy', url: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=400&q=80' },
  { id: 'art_vinyl_turntable', title: 'Vintage Record Player', desc: 'Analog vinyl turntable warm glow', cat: 'cozy', url: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1539185441755-769473a23570?w=400&q=80' },
  { id: 'art_candle_hearth', title: 'Candlelight Warmth', desc: 'Warm candle flames and books', cat: 'cozy', url: 'https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1517411032315-54ef2cb783bb?w=400&q=80' },
  { id: 'art_plant_sunroom', title: 'Botanical Plant Sunroom', desc: 'Lush potted greenery sunlit room', cat: 'cozy', url: 'https://images.unsplash.com/photo-1463936575829-25148e1db1b8?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1463936575829-25148e1db1b8?w=400&q=80' },
  { id: 'art_tea_ceramics', title: 'Japanese Tea Ceremony', desc: 'Artisanal matcha and ceramic bowl', cat: 'cozy', url: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1576092768241-dec231879fc3?w=400&q=80' },
  { id: 'art_fairy_lights', title: 'Golden Fairy Lights', desc: 'Warm twinkling bedroom bokeh', cat: 'cozy', url: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1513151233558-d860c5398176?w=400&q=80' },
  { id: 'art_fireplace_blanket', title: 'Rustic Cabin Fireplace', desc: 'Cozy wool knit and crackling fire', cat: 'cozy', url: 'https://images.unsplash.com/photo-1542332213-31f87348057f?w=1920&q=85', thumb: 'https://images.unsplash.com/photo-1542332213-31f87348057f?w=400&q=80' }
];

// Quick lookup map for fast rendering
const STATIC_WALLPAPER_URLS = {};
STATIC_WALLPAPERS_CATALOG.forEach(item => {
  STATIC_WALLPAPER_URLS[item.id] = item.url;
});

// Wallpaper Usage Frequency Tracker (LocalStorage)
let wallpaperUsageHistory = JSON.parse(localStorage.getItem('linus_wallpaper_history') || '{}');

function recordWallpaperUsage(wallpaperId) {
  if (!wallpaperId || !STATIC_WALLPAPER_URLS[wallpaperId]) return;
  wallpaperUsageHistory[wallpaperId] = (wallpaperUsageHistory[wallpaperId] || 0) + 1;
  localStorage.setItem('linus_wallpaper_history', JSON.stringify(wallpaperUsageHistory));
  renderFeaturedWallpapersTray();
}

function getSortedWallpapersByUsage() {
  return [...STATIC_WALLPAPERS_CATALOG].sort((a, b) => {
    const scoreA = (wallpaperUsageHistory[a.id] || 0) * 10 + (a.featured ? 5 : 0);
    const scoreB = (wallpaperUsageHistory[b.id] || 0) * 10 + (b.featured ? 5 : 0);
    return scoreB - scoreA;
  });
}

let userTheme = JSON.parse(localStorage.getItem('linus_custom_theme') || 'null') || { ...DEFAULT_USER_THEME };
if (userTheme.customImageSrc && userTheme.customImageSrc.startsWith('blob:')) {
  userTheme.customImageSrc = userTheme.sourceUrl || '';
}
if (userTheme.customVideoSrc && userTheme.customVideoSrc.startsWith('blob:')) {
  userTheme.customVideoSrc = userTheme.sourceUrl || '';
}
window.userTheme = userTheme;
window.DEFAULT_USER_THEME = DEFAULT_USER_THEME;

function hexToRgba(hex, alpha = 1) {
  if (!hex || hex[0] !== '#') return `rgba(229, 169, 93, ${alpha})`;
  let c = hex.substring(1);
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  const num = parseInt(c, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function adjustHexBrightness(hex, percent) {
  try {
    let num = parseInt(hex.replace('#', ''), 16);
    let amt = Math.round(2.55 * percent);
    let r = (num >> 16) + amt;
    let g = (num >> 8 & 0x00FF) + amt;
    let b = (num & 0x0000FF) + amt;
    return '#' + (0x1000000 + (r < 255 ? r < 0 ? 0 : r : 255) * 0x10000 +
      (g < 255 ? g < 0 ? 0 : g : 255) * 0x100 +
      (b < 255 ? b < 0 ? 0 : b : 255)).toString(16).slice(1);
  } catch(e) {
    return hex;
  }
}

function applyUserTheme(theme, save = true) {
  const merged = { ...DEFAULT_USER_THEME, ...(theme || userTheme) };
  if (merged.wallpaperType === 'custom-image') {
    if (window.activeWallpaperBlobUrl && (!merged.customImageSrc || merged.customImageSrc.startsWith('blob:'))) {
      merged.customImageSrc = window.activeWallpaperBlobUrl;
    } else if (merged.customImageSrc && merged.customImageSrc.startsWith('blob:') && merged.customImageSrc !== window.activeWallpaperBlobUrl) {
      merged.customImageSrc = window.activeWallpaperBlobUrl || merged.sourceUrl || (window.userTheme && window.userTheme.sourceUrl) || '';
    }
  }
  userTheme = merged;
  window.userTheme = userTheme;
  const root = document.documentElement;

  // Colors
  root.style.setProperty('--accent', userTheme.accent);
  root.style.setProperty('--accent-glow', hexToRgba(userTheme.accent, (userTheme.glowIntensity / 100) * 0.7));
  root.style.setProperty('--bg', userTheme.bg);
  root.style.setProperty('--surface', userTheme.surface);
  root.style.setProperty('--surface-hover', adjustHexBrightness(userTheme.surface, 15));
  root.style.setProperty('--surface-glass', hexToRgba(userTheme.surface, userTheme.glassOpacity / 100));
  root.style.setProperty('--text', userTheme.text);
  root.style.setProperty('--text-muted', hexToRgba(userTheme.text, 0.6));
  root.style.setProperty('--wallpaper-dim', `${userTheme.wallpaperDim / 100}`);
  root.style.setProperty('--wallpaper-blur', `${userTheme.wallpaperBlur}px`);

  // Typography
  if (userTheme.fontFamily === 'serif') {
    root.style.setProperty('--font-serif', "'Instrument Serif', serif");
    root.style.setProperty('--font-sans', "'Outfit', sans-serif");
  } else if (userTheme.fontFamily === 'sans') {
    root.style.setProperty('--font-serif', "'Outfit', sans-serif");
    root.style.setProperty('--font-sans', "'Outfit', sans-serif");
  } else if (userTheme.fontFamily === 'mono') {
    root.style.setProperty('--font-serif', "monospace");
    root.style.setProperty('--font-sans', "monospace");
  } else if (userTheme.fontFamily === 'cursive') {
    root.style.setProperty('--font-serif', "'Playfair Display', Georgia, serif");
    root.style.setProperty('--font-sans', "'Outfit', sans-serif");
  }

  // Live Wallpapers & Video Engine
  const auraCanvas = $('#living-aura-canvas');
  const motionCanvasEl = $('#live-motion-canvas');
  const videoEl = $('#live-wallpaper-video');
  const customImgBg = $('#custom-wallpaper-bg');
  const fsMotionCanvasEl = $('#fs-live-motion-canvas');
  const fsVideoEl = $('#fs-live-wallpaper-video');
  const fsCustomImgBg = $('#fs-custom-wallpaper-bg');

  // Hide all backdrops initially
  auraCanvas?.classList.add('hidden');
  motionCanvasEl?.classList.add('hidden');
  fsMotionCanvasEl?.classList.add('hidden');
  videoEl?.classList.add('hidden');
  fsVideoEl?.classList.add('hidden');
  customImgBg?.classList.add('hidden');
  fsCustomImgBg?.classList.add('hidden');

  // Dynamic Dimming & Blur Overlay (Main Player)
  const dimVal = (userTheme.wallpaperDim ?? 40) / 100;
  const dimOverlay = $('#wallpaper-dim-overlay');
  if (dimOverlay) dimOverlay.style.backgroundColor = `rgba(0, 0, 0, ${dimVal})`;

  const blurVal = userTheme.wallpaperBlur ?? 0;
  const blurFilter = blurVal > 0 ? `blur(${blurVal}px)` : 'none';
  [customImgBg, videoEl].forEach(el => {
    if (el) el.style.filter = blurFilter;
  });

  if (userTheme.wallpaperType === 'aura') {
    auraCanvas?.classList.remove('hidden');
    resumeLivingAura();
  } else if (STATIC_WALLPAPER_URLS[userTheme.wallpaperType]) {
    const imgUrl = STATIC_WALLPAPER_URLS[userTheme.wallpaperType];
    if (customImgBg) {
      customImgBg.style.backgroundImage = `url('${imgUrl}')`;
      customImgBg.classList.remove('hidden');
    }
    if (fsCustomImgBg) {
      fsCustomImgBg.style.backgroundImage = `url('${imgUrl}')`;
      fsCustomImgBg.classList.remove('hidden');
    }
  } else if (userTheme.wallpaperType === 'custom-image') {
    if (customImgBg && userTheme.customImageSrc) {
      customImgBg.style.backgroundImage = `url('${userTheme.customImageSrc}')`;
      customImgBg.classList.remove('hidden');
    }
    if (fsCustomImgBg && userTheme.customImageSrc) {
      fsCustomImgBg.style.backgroundImage = `url('${userTheme.customImageSrc}')`;
      fsCustomImgBg.classList.remove('hidden');
    }
  } else if (userTheme.wallpaperType === 'custom-video') {
    if (userTheme.customVideoSrc) {
      if (videoEl) {
        if (videoEl.src !== userTheme.customVideoSrc) {
          videoEl.src = userTheme.customVideoSrc;
          videoEl.load();
        }
        videoEl.play().catch(() => {});
        videoEl.classList.remove('hidden');
      }
      if (fsVideoEl) {
        if (fsVideoEl.src !== userTheme.customVideoSrc) {
          fsVideoEl.src = userTheme.customVideoSrc;
          fsVideoEl.load();
        }
        fsVideoEl.play().catch(() => {});
        fsVideoEl.classList.remove('hidden');
      }
    }
  } else if (VIDEO_WALLPAPER_URLS[userTheme.wallpaperType]) {
    const videoUrl = VIDEO_WALLPAPER_URLS[userTheme.wallpaperType];

    if (videoEl) {
      if (videoEl.src !== videoUrl) {
        videoEl.src = videoUrl;
        videoEl.load();
      }
      videoEl.play().catch(() => {
        // Fallback gracefully on network / autoplay issue
        videoEl.classList.add('hidden');
        spawnParticlesForPreset(userTheme.wallpaperType);
        motionCanvasEl?.classList.remove('hidden');
      });
      videoEl.classList.remove('hidden');
    }

    if (fsVideoEl) {
      if (fsVideoEl.src !== videoUrl) {
        fsVideoEl.src = videoUrl;
        fsVideoEl.load();
      }
      fsVideoEl.play().catch(() => {});
      fsVideoEl.classList.remove('hidden');
    }

    // Layer atmospheric particles on top of video for rich ambient depth
    spawnParticlesForPreset(userTheme.wallpaperType);
    motionCanvasEl?.classList.remove('hidden');
    fsMotionCanvasEl?.classList.remove('hidden');
    startMotionAnimationLoop();
  } else {
    // Curated Procedural Live Atmosphere
    spawnParticlesForPreset(userTheme.wallpaperType);
    motionCanvasEl?.classList.remove('hidden');
    fsMotionCanvasEl?.classList.remove('hidden');
    startMotionAnimationLoop();
  }

  // Custom Vinyl Sticker
  if (userTheme.customVinylSticker) {
    const fsArt = $('#fs-disk-art');
    if (fsArt) {
      fsArt.style.backgroundImage = `url('${userTheme.customVinylSticker}')`;
      fsArt.style.backgroundSize = 'cover';
      fsArt.style.backgroundPosition = 'center';
    }
    const fsLetter = $('#fs-disk-letter');
    if (fsLetter) fsLetter.textContent = '';
  }

  // Sync Studio UI Controls
  syncStudioUI();

  // If fullscreen is set to match-main, keep it dynamically updated
  if (typeof fsTheme !== 'undefined' && fsTheme && fsTheme.wallpaperType === 'match-main' && typeof applyFullscreenTheme === 'function') {
    applyFullscreenTheme(fsTheme, false);
  }

  if (save) {
    const toSave = { ...userTheme };
    if (toSave.customImageSrc && toSave.customImageSrc.startsWith('blob:')) {
      toSave.customImageSrc = toSave.sourceUrl || '';
    }
    if (toSave.customVideoSrc && toSave.customVideoSrc.startsWith('blob:')) {
      toSave.customVideoSrc = toSave.sourceUrl || '';
    }
    try { localStorage.setItem('linus_custom_theme', JSON.stringify(toSave)); } catch (e) {}
    state.custom_theme = toSave;
    if (typeof syncUserSettingsToDB === 'function') {
      syncUserSettingsToDB({ custom_theme: toSave });
    }
    saveState();
  }
}

function syncStudioUI() {
  if (!$('#picker-accent')) return;
  $('#picker-accent').value = userTheme.accent;
  $('#val-accent').textContent = userTheme.accent;
  $('#picker-bg').value = userTheme.bg;
  $('#val-bg').textContent = userTheme.bg;
  $('#picker-surface').value = userTheme.surface;
  $('#val-surface').textContent = userTheme.surface;
  $('#picker-text').value = userTheme.text;
  $('#val-text').textContent = userTheme.text;

  $('#slider-wallpaper-dim').value = userTheme.wallpaperDim;
  $('#val-wallpaper-dim').textContent = `${userTheme.wallpaperDim}%`;
  $('#slider-wallpaper-blur').value = userTheme.wallpaperBlur;
  $('#val-wallpaper-blur').textContent = `${userTheme.wallpaperBlur}px`;
  $('#slider-glass-opacity').value = userTheme.glassOpacity;
  $('#val-glass-opacity').textContent = `${userTheme.glassOpacity}%`;
  $('#slider-glow-intensity').value = userTheme.glowIntensity;
  $('#val-glow-intensity').textContent = `${userTheme.glowIntensity}%`;
  $('#toggle-beat-pulse').checked = userTheme.beatPulse;
  if ($('#toggle-welcome-quote')) {
    $('#toggle-welcome-quote').checked = userTheme.welcomeQuote !== false;
  }
  if ($('#welcome-quote-frequency')) {
    $('#welcome-quote-frequency').value = userTheme.welcomeQuoteFrequency || 'always';
  }

  // Font presets
  document.querySelectorAll('.font-preset-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.font === userTheme.fontFamily);
  });

  // Wallpaper cards
  document.querySelectorAll('.wallpaper-card').forEach(card => {
    card.classList.toggle('active', card.dataset.wp === userTheme.wallpaperType);
  });

  // Custom media boxes
  const mediaBox = $('#custom-media-box');
  const imgGroup = $('#custom-img-group');
  const vidGroup = $('#custom-vid-group');
  if (userTheme.wallpaperType === 'custom-image') {
    mediaBox?.classList.remove('hidden');
    imgGroup?.classList.remove('hidden');
    vidGroup?.classList.add('hidden');
  } else if (userTheme.wallpaperType === 'custom-video') {
    mediaBox?.classList.remove('hidden');
    imgGroup?.classList.add('hidden');
    vidGroup?.classList.remove('hidden');
  } else {
    mediaBox?.classList.add('hidden');
  }
}

// Studio Modal Triggers
function openStudioCustomizer() {
  syncStudioUI();
  $('#theme-studio-sheet')?.showModal();
}

$('#open-studio-customizer-btn')?.addEventListener('click', () => {
  $('#vibe-popover')?.classList.remove('show');
  openStudioCustomizer();
});

$('#sidebar-studio-btn')?.addEventListener('click', () => {
  closeMobileSidebar();
  openStudioCustomizer();
});

$('#theme-studio-close')?.addEventListener('click', () => $('#theme-studio-sheet').close());
$('#studio-done-btn')?.addEventListener('click', () => {
  $('#theme-studio-sheet').close();
  notify('✨ Personalization and atmosphere applied!');
});

// Studio Tab Switching
document.querySelectorAll('.studio-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.studio-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.studio-tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    $(`#tab-${btn.dataset.tab}`)?.classList.remove('hidden');
  });
});

// Real-time Color Pickers
$('#picker-accent')?.addEventListener('input', (e) => {
  userTheme.accent = e.target.value;
  $('#val-accent').textContent = e.target.value;
  applyUserTheme(userTheme);
});
$('#picker-bg')?.addEventListener('input', (e) => {
  userTheme.bg = e.target.value;
  $('#val-bg').textContent = e.target.value;
  applyUserTheme(userTheme);
});
$('#picker-surface')?.addEventListener('input', (e) => {
  userTheme.surface = e.target.value;
  $('#val-surface').textContent = e.target.value;
  applyUserTheme(userTheme);
});
$('#picker-text')?.addEventListener('input', (e) => {
  userTheme.text = e.target.value;
  $('#val-text').textContent = e.target.value;
  applyUserTheme(userTheme);
});

// Reset Colors
$('#reset-colors-btn')?.addEventListener('click', () => {
  userTheme.accent = DEFAULT_USER_THEME.accent;
  userTheme.bg = DEFAULT_USER_THEME.bg;
  userTheme.surface = DEFAULT_USER_THEME.surface;
  userTheme.text = DEFAULT_USER_THEME.text;
  applyUserTheme(userTheme);
  notify('Reset colors to default.');
});

// Font Presets
document.querySelectorAll('.font-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    userTheme.fontFamily = btn.dataset.font;
    applyUserTheme(userTheme);
  });
});

// Wallpaper Card Selection
// Subfolder Pill Switching for Dashboard Theme Studio
document.querySelectorAll('.subfolder-pill-btn:not(.fs-subfolder-pill-btn)').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subfolder-pill-btn:not(.fs-subfolder-pill-btn)').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.subfolder-view:not(.fs-subfolder-view)').forEach(v => v.classList.add('hidden'));
    btn.classList.add('active');
    $(`#subfolder-${btn.dataset.subfolder}`)?.classList.remove('hidden');
  });
});

// Subfolder Pill Switching for Fullscreen Studio
document.querySelectorAll('.fs-subfolder-pill-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fs-subfolder-pill-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.fs-subfolder-view').forEach(v => v.classList.add('hidden'));
    btn.classList.add('active');
    $(`#fs-subfolder-${btn.dataset.fssubfolder}`)?.classList.remove('hidden');
  });
});

document.querySelectorAll('.wallpaper-card').forEach(card => {
  card.addEventListener('click', () => {
    userTheme.wallpaperType = card.dataset.wp;
    applyUserTheme(userTheme);
    notify(`🎥 Background: ${card.querySelector('strong').textContent}`);
  });
});

async function uploadWallpaperFileToServer(file) {
  try {
    const formData = new FormData();
    formData.append('wallpaper', file);
    const resp = await fetch('/api/wallpaper/upload', {
      method: 'POST',
      body: formData
    });
    if (resp.ok) {
      const data = await resp.json();
      if (data && data.url) {
        userTheme.sourceUrl = data.url;
        fsTheme.sourceUrl = data.url;
        if (!userTheme.customImageSrc || userTheme.customImageSrc.startsWith('blob:')) {
          if (!window.activeWallpaperBlobUrl) userTheme.customImageSrc = data.url;
        }
        if (!fsTheme.customImageSrc || fsTheme.customImageSrc.startsWith('blob:')) {
          if (!window.activeWallpaperBlobUrl) fsTheme.customImageSrc = data.url;
        }
        try { localStorage.setItem('linus_custom_theme', JSON.stringify(userTheme)); } catch (e) {}
        try { localStorage.setItem('linus_fs_theme', JSON.stringify(fsTheme)); } catch (e) {}
        if (typeof syncUserSettingsToDB === 'function') {
          syncUserSettingsToDB({
            custom_theme: { ...userTheme, customImageSrc: data.url },
            fs_theme: { ...fsTheme, customImageSrc: data.url }
          });
        }
      }
    }
  } catch (err) {
    console.warn('Background server wallpaper backup failed, continuing with IndexedDB:', err);
  }
}

// Custom Wallpaper Uploads
$('#custom-wallpaper-file')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await storeWallpaperBlob('fs_custom_image', file);
  const blobUrl = URL.createObjectURL(file);
  window.activeWallpaperBlobUrl = blobUrl;
  userTheme.customImageSrc = blobUrl;
  userTheme.wallpaperType = 'custom-image';
  applyUserTheme(userTheme);

  fsTheme.customImageSrc = blobUrl;
  fsTheme.wallpaperType = 'custom-image';
  if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
  fsTheme.wallpaperVignette = 0;
  applyFullscreenTheme(fsTheme);
  notify('🖼️ Custom wallpaper photo applied in uncompressed high resolution!');
  uploadWallpaperFileToServer(file);
});

$('#custom-wallpaper-url')?.addEventListener('change', async (e) => {
  const url = e.target.value.trim();
  if (!url) return;
  await ingestWallpaperUrl(url);
});

$('#custom-video-file')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const blobUrl = URL.createObjectURL(file);
  userTheme.customVideoSrc = blobUrl;
  userTheme.wallpaperType = 'custom-video';
  applyUserTheme(userTheme);
  notify('🎬 Custom live video wallpaper applied!');
  uploadWallpaperFileToServer(file);
});

$('#custom-video-url')?.addEventListener('change', (e) => {
  const url = e.target.value.trim();
  if (!url) return;
  userTheme.customVideoSrc = url;
  userTheme.wallpaperType = 'custom-video';
  applyUserTheme(userTheme);
  notify('🎬 Custom live video wallpaper applied from URL!');
});

// Sliders
$('#slider-wallpaper-dim')?.addEventListener('input', (e) => {
  userTheme.wallpaperDim = parseInt(e.target.value);
  $('#val-wallpaper-dim').textContent = `${userTheme.wallpaperDim}%`;
  applyUserTheme(userTheme);
});

$('#slider-wallpaper-blur')?.addEventListener('input', (e) => {
  userTheme.wallpaperBlur = parseInt(e.target.value);
  $('#val-wallpaper-blur').textContent = `${userTheme.wallpaperBlur}px`;
  applyUserTheme(userTheme);
});

$('#slider-glass-opacity')?.addEventListener('input', (e) => {
  userTheme.glassOpacity = parseInt(e.target.value);
  $('#val-glass-opacity').textContent = `${userTheme.glassOpacity}%`;
  applyUserTheme(userTheme);
});

$('#slider-glow-intensity')?.addEventListener('input', (e) => {
  userTheme.glowIntensity = parseInt(e.target.value);
  $('#val-glow-intensity').textContent = `${userTheme.glowIntensity}%`;
  applyUserTheme(userTheme);
});

$('#toggle-beat-pulse')?.addEventListener('change', (e) => {
  userTheme.beatPulse = e.target.checked;
  applyUserTheme(userTheme);
});

// Custom Vinyl Disc Sticker
$('#upload-disc-sticker-btn')?.addEventListener('click', () => {
  $('#custom-disc-sticker-file').click();
});

$('#custom-disc-sticker-file')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    userTheme.customVinylSticker = ev.target.result;
    applyUserTheme(userTheme);
    notify('🏷️ Custom vinyl disc center photo applied!');
  };
  reader.readAsDataURL(file);
});

$('#reset-disc-sticker-btn')?.addEventListener('click', () => {
  userTheme.customVinylSticker = '';
  const fsArt = $('#fs-disk-art');
  if (fsArt) fsArt.style.backgroundImage = 'none';
  applyUserTheme(userTheme);
  notify('Reset vinyl center label to default.');
});

$('#toggle-welcome-quote')?.addEventListener('change', (e) => {
  userTheme.welcomeQuote = e.target.checked;
  localStorage.setItem('linus_welcome_quote', e.target.checked ? 'true' : 'false');
  applyUserTheme(userTheme);
  notify(e.target.checked ? '💬 Welcome Quote Splash enabled.' : '💬 Welcome Quote Splash disabled.');
});

$('#welcome-quote-frequency')?.addEventListener('change', (e) => {
  userTheme.welcomeQuoteFrequency = e.target.value;
  localStorage.setItem('linus_welcome_quote_freq', e.target.value);
  applyUserTheme(userTheme);
  notify(`⏱️ Quote frequency set to: ${e.target.value === 'daily' ? 'Once a Day' : 'Every Launch'}`);
});

$('#studio-reset-all-btn')?.addEventListener('click', () => {
  if (!confirm('Reset all custom colors, wallpapers and effects to default?')) return;
  userTheme = { ...DEFAULT_USER_THEME };
  applyUserTheme(userTheme);
  notify('✨ Reset all customizations to default.');
});

// Apply custom user theme on boot
applyUserTheme(userTheme, false);

// ============================================================
// Full-Screen Dedicated Customizer & Lyrics Atmosphere Engine
// ============================================================

// IndexedDB High-Capacity Wallpaper Store (Supports 4K/8K uncompressed uploads)
const WP_DB_NAME = 'LinusWallpaperDB';
const WP_STORE_NAME = 'wallpapers';

function openWallpaperDB() {
  return new Promise((resolve) => {
    if (!window.indexedDB) return resolve(null);
    const req = indexedDB.open(WP_DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(WP_STORE_NAME)) {
        db.createObjectStore(WP_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function storeWallpaperBlob(key, blob) {
  const db = await openWallpaperDB();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(WP_STORE_NAME, 'readwrite');
      tx.objectStore(WP_STORE_NAME).put(blob, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

async function loadWallpaperBlob(key) {
  const db = await openWallpaperDB();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(WP_STORE_NAME, 'readonly');
      const req = tx.objectStore(WP_STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// Smart URL Master-Resolution Cleaner (Strips thumbnail downscales & extracts full-res original)
function cleanMasterImageUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  let url = rawUrl.trim();

  try {
    // 1. Twitter / X Images: replace name=small/medium/900x900/large with name=orig
    if (url.includes('pbs.twimg.com/media/')) {
      const u = new URL(url);
      u.searchParams.set('name', 'orig');
      return u.toString();
    }

    // 2. Pinterest: replace /236x/, /474x/, /564x/, /736x/ with /originals/
    if (url.includes('pinimg.com/')) {
      return url.replace(/\/(236x|474x|564x|736x)\//, '/originals/');
    }

    // 3. Discord CDN: strip resizing/compressing query parameters and proxy domain
    if (url.includes('cdn.discordapp.com/attachments/') || url.includes('media.discordapp.net/attachments/')) {
      url = url.replace('media.discordapp.net', 'cdn.discordapp.com');
      const u = new URL(url);
      u.searchParams.delete('width');
      u.searchParams.delete('height');
      u.searchParams.delete('format');
      return u.toString();
    }

    // 4. Imgur thumbnails: remove s, m, l, t, h suffix before extension (e.g. abcd123m.jpg -> abcd123.jpg)
    const imgurMatch = url.match(/^(https?:\/\/i\.imgur\.com\/[a-zA-Z0-9]{5,8})[smlth](\.(jpg|jpeg|png|webp|gif))$/i);
    if (imgurMatch) {
      return imgurMatch[1] + imgurMatch[2];
    }

    // 5. Unsplash: maximize quality and remove width restrictions
    if (url.includes('images.unsplash.com/')) {
      const u = new URL(url);
      u.searchParams.set('q', '100');
      u.searchParams.delete('w');
      u.searchParams.delete('fit');
      return u.toString();
    }

    // 6. Reddit: replace preview.redd.it with i.redd.it and strip auto=webp query
    if (url.includes('preview.redd.it/')) {
      const u = new URL(url);
      return `https://i.redd.it${u.pathname}`;
    }

    // 7. Zerochan / Image boards: convert preview paths to full
    if (url.includes('zerochan.net') && (url.includes('s1.') || url.includes('s2.') || url.includes('static.'))) {
      return url.replace(/\/240\//, '/full/').replace(/\/600\//, '/full/');
    }
  } catch {
    // If URL parsing fails, return unmodified URL
  }

  return url;
}

// Background Ingestion: Fetches raw uncompressed binary with backend proxy fallback
async function fetchWallpaperBlob(rawUrl) {
  const cleanUrl = cleanMasterImageUrl(rawUrl);

  // 1. Direct fetch with no-referrer
  try {
    const directResp = await fetch(cleanUrl, {
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      headers: {
        'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.9'
      }
    });
    if (directResp.ok) {
      const blob = await directResp.blob();
      if (blob && blob.size > 1000 && blob.type.startsWith('image/')) {
        return blob;
      }
    }
  } catch (e) {
    // Direct CORS blocked, proceed to backend fallback
  }

  // 2. Local Python Server proxy fallback (bypasses CORS and anti-hotlinking)
  try {
    const proxyUrl = `/api/wallpaper/fetch-url?url=${encodeURIComponent(cleanUrl)}`;
    const proxyResp = await fetch(proxyUrl);
    if (proxyResp.ok) {
      const blob = await proxyResp.blob();
      if (blob && blob.size > 1000) {
        return blob;
      }
    }
  } catch (err) {
    console.warn('Backend proxy fetch failed:', err);
  }

  return null;
}

// Unified Ingest Engine: Ingests URL, saves uncompressed blob to IndexedDB, applies to players
async function ingestWallpaperUrl(rawUrl) {
  const url = rawUrl.trim();
  if (!url) return false;

  notify('⏳ Ingesting uncompressed master image from link...');
  const blob = await fetchWallpaperBlob(url);

  if (blob) {
    // Store in IndexedDB for uncompressed persistence
    await storeWallpaperBlob('fs_custom_image', blob);
    const blobUrl = URL.createObjectURL(blob);

    // Verify natural dimensions and notify
    const probe = new Image();
    probe.src = blobUrl;
    probe.onload = () => {
      const w = probe.naturalWidth || 0;
      const h = probe.naturalHeight || 0;
      if (w > 0 && w < 1280) {
        notify(`⚠️ Image is ${w}×${h} (thumbnail). For 4K clarity, paste a direct link to the original master.`, 6000);
      } else {
        notify(`✨ Master-quality artwork loaded in uncompressed clarity! (${w}×${h})`);
      }
    };

    // Apply to Fullscreen Theme
    fsTheme.sourceUrl = cleanMasterImageUrl(url);
    fsTheme.customImageSrc = blobUrl;
    fsTheme.wallpaperType = 'custom-image';
    if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
    fsTheme.wallpaperVignette = 0;
    applyFullscreenTheme(fsTheme);

    // Also sync to Main Player Theme
    userTheme.sourceUrl = cleanMasterImageUrl(url);
    userTheme.customImageSrc = blobUrl;
    userTheme.wallpaperType = 'custom-image';
    applyUserTheme(userTheme);
    return true;
  } else {
    // Fallback if network blocked
    fsTheme.sourceUrl = cleanMasterImageUrl(url);
    fsTheme.customImageSrc = url;
    fsTheme.wallpaperType = 'custom-image';
    if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
    fsTheme.wallpaperVignette = 0;
    applyFullscreenTheme(fsTheme);

    userTheme.sourceUrl = cleanMasterImageUrl(url);
    userTheme.customImageSrc = url;
    userTheme.wallpaperType = 'custom-image';
    applyUserTheme(userTheme);
    notify('🖼️ Custom wallpaper URL applied!');
    return false;
  }
}

const DEFAULT_FS_THEME = {
  wallpaperType: 'match-main', // 'match-main', 'lofi', 'fireplace', 'cyber', 'space', 'ocean', 'custom-image', 'custom-video'
  customImageSrc: '',
  sourceUrl: '',
  customVideoSrc: '',
  wallpaperDim: 0,
  wallpaperBlur: 0,
  wallpaperVignette: 0,
  wallpaperBrightness: 100,
  wallpaperContrast: 100,
  wallpaperSaturation: 100,
  wallpaperFit: 'cover', // 'cover' or 'contain'
  wallpaperPos: 15, // vertical focus percentage (15% keeps halo and head visible)
  autoNativeFullscreen: true, // True monitor fullscreen (hides browser tabs & address bar)
  lyricsActiveColor: '#ffffff',
  lyricsActiveGlow: '#e5a95d',
  lyricsInactiveColor: '#ffffff',
  lyricsShadowColor: '#000000',
  lyricsPillOpacity: 15,
  lyricsGlowStrength: 60
};

fsTheme = JSON.parse(localStorage.getItem('linus_fs_theme') || 'null') || { ...DEFAULT_FS_THEME };
if (fsTheme.customImageSrc && fsTheme.customImageSrc.startsWith('blob:')) {
  fsTheme.customImageSrc = fsTheme.sourceUrl || '';
}
if (fsTheme.customVideoSrc && fsTheme.customVideoSrc.startsWith('blob:')) {
  fsTheme.customVideoSrc = fsTheme.sourceUrl || '';
}
window.fsTheme = fsTheme;
// Migrate legacy 45% default dimming and ensure all quality properties exist
if (fsTheme && fsTheme.wallpaperDim === 45 && !localStorage.getItem('linus_fs_dim_customized')) {
  fsTheme.wallpaperDim = 0;
}
if (fsTheme && fsTheme.wallpaperVignette === undefined) {
  fsTheme.wallpaperVignette = (fsTheme.wallpaperType === 'match-main' ? 70 : 0);
}
if (fsTheme && fsTheme.wallpaperBrightness === undefined) fsTheme.wallpaperBrightness = 100;
if (fsTheme && fsTheme.wallpaperContrast === undefined) fsTheme.wallpaperContrast = 100;
if (fsTheme && fsTheme.wallpaperSaturation === undefined) fsTheme.wallpaperSaturation = 100;
if (fsTheme && fsTheme.wallpaperFit === undefined) fsTheme.wallpaperFit = 'cover';
if (fsTheme && fsTheme.wallpaperPos === undefined) fsTheme.wallpaperPos = 15;
if (fsTheme && fsTheme.autoNativeFullscreen === undefined) fsTheme.autoNativeFullscreen = true;

function applyFullscreenTheme(theme, save = true) {
  const merged = { ...DEFAULT_FS_THEME, ...(theme || fsTheme) };
  if (merged.wallpaperType === 'custom-image' || merged.wallpaperType === 'match-main') {
    if (window.activeWallpaperBlobUrl && (!merged.customImageSrc || merged.customImageSrc.startsWith('blob:'))) {
      merged.customImageSrc = window.activeWallpaperBlobUrl;
    } else if (merged.customImageSrc && merged.customImageSrc.startsWith('blob:') && merged.customImageSrc !== window.activeWallpaperBlobUrl) {
      merged.customImageSrc = window.activeWallpaperBlobUrl || merged.sourceUrl || (window.fsTheme && window.fsTheme.sourceUrl) || '';
    }
  }
  fsTheme = merged;
  window.fsTheme = fsTheme;
  const root = document.documentElement;

  // Full Screen Lyrics & Glow Variables
  root.style.setProperty('--fs-lyrics-active', fsTheme.lyricsActiveColor);
  root.style.setProperty('--fs-lyrics-glow', hexToRgba(fsTheme.lyricsActiveGlow, (fsTheme.lyricsGlowStrength / 100)));
  root.style.setProperty('--fs-lyrics-inactive', hexToRgba(fsTheme.lyricsInactiveColor, 0.45));
  root.style.setProperty('--fs-lyrics-shadow', hexToRgba(fsTheme.lyricsShadowColor, 0.85));
  root.style.setProperty('--fs-lyrics-pill-opacity', `${fsTheme.lyricsPillOpacity / 100}`);

  // Clear any conflicting inline background-color on dim overlay
  const fsDimOverlay = $('#fs-wallpaper-dim-overlay');
  if (fsDimOverlay) fsDimOverlay.style.backgroundColor = '';

  // Full Screen Dimming & Blur
  const dimVal = (fsTheme.wallpaperDim ?? 0) / 100;
  const blurPx = fsTheme.wallpaperBlur ?? 0;
  root.style.setProperty('--fs-wallpaper-dim', `${dimVal}`);
  root.style.setProperty('--fs-wallpaper-blur', `${blurPx}px`);

  // Zero-overhead layer optimization: If dim and blur are 0, completely disable dim overlay
  if (dimVal === 0 && blurPx === 0) {
    fsDimOverlay?.classList.add('dim-disabled');
  } else {
    fsDimOverlay?.classList.remove('dim-disabled');
  }

  // Full Screen Dynamic Vignette (Edge Darkness)
  let vignetteVal = 0;
  if (fsTheme.wallpaperType === 'match-main') {
    vignetteVal = (fsTheme.wallpaperVignette !== undefined ? fsTheme.wallpaperVignette : 70) / 100;
  } else {
    vignetteVal = (fsTheme.wallpaperVignette ?? 0) / 100;
  }
  root.style.setProperty('--fs-wallpaper-vignette', `${vignetteVal}`);

  // Zero-overhead layer optimization: If vignette is 0, completely disable vignette overlay
  const fsBgOverlayEl = $('.fs-bg-overlay');
  if (vignetteVal === 0 && fsTheme.wallpaperType !== 'match-main') {
    fsBgOverlayEl?.classList.add('vignette-disabled');
  } else {
    fsBgOverlayEl?.classList.remove('vignette-disabled');
  }

  // Full Screen Live Video & Custom Wallpaper Elements
  const fsMotionCanvasEl = $('#fs-live-motion-canvas');
  const fsVideoEl = $('#fs-live-wallpaper-video');
  const fsWallpaperWrap = $('#fs-wallpaper-wrap');
  const fsAmbientBlur = $('#fs-wallpaper-ambient-blur');
  const fsCustomImg = $('#fs-custom-wallpaper-img');
  const fsCustomImgBg = $('#fs-custom-wallpaper-bg');
  const fsBg1 = $('#fs-bg-1');
  const fsBg2 = $('#fs-bg-2');

  // Fullscreen Wallpaper Image Filters (Blur, Brightness, Contrast, Saturation)
  const brightnessVal = (fsTheme.wallpaperBrightness ?? 100) / 100;
  const contrastVal = (fsTheme.wallpaperContrast ?? 100) / 100;
  const saturationVal = (fsTheme.wallpaperSaturation ?? 100) / 100;

  const filters = [];
  if (blurPx > 0) filters.push(`blur(${blurPx}px)`);
  if (brightnessVal !== 1) filters.push(`brightness(${brightnessVal})`);
  if (contrastVal !== 1) filters.push(`contrast(${contrastVal})`);
  if (saturationVal !== 1) filters.push(`saturate(${saturationVal})`);
  const filterStr = filters.length > 0 ? filters.join(' ') : 'none';

  if (fsCustomImg) fsCustomImg.style.filter = filterStr;
  if (fsCustomImgBg) fsCustomImgBg.style.filter = filterStr;
  if (fsVideoEl) fsVideoEl.style.filter = filterStr;

  // Framing & Scaling Properties
  const fitMode = fsTheme.wallpaperFit || 'cover';
  const posVal = fsTheme.wallpaperPos ?? 15;
  root.style.setProperty('--fs-wallpaper-fit', fitMode);
  root.style.setProperty('--fs-wallpaper-pos', `center ${posVal}%`);

  // Hide all full-screen layers first
  fsMotionCanvasEl?.classList.add('hidden');
  fsVideoEl?.classList.add('hidden');
  if (fsVideoEl && fsTheme.wallpaperType !== 'custom-video' && !STATIC_WALLPAPER_URLS[fsTheme.wallpaperType]) fsVideoEl.src = '';
  fsWallpaperWrap?.classList.add('hidden');
  fsCustomImgBg?.classList.add('hidden');
  if (fsBg1) { fsBg1.style.display = 'none'; fsBg1.style.opacity = '0'; }
  if (fsBg2) { fsBg2.style.display = 'none'; fsBg2.style.opacity = '0'; }

  // Resolve effective wallpaper mode: 'match-main' mirrors the main dashboard's userTheme
  const currentMainType = (typeof userTheme !== 'undefined' && userTheme && userTheme.wallpaperType) ? userTheme.wallpaperType : 'aura';
  const isMatchMain = fsTheme.wallpaperType === 'match-main';
  const effectiveWpType = isMatchMain ? currentMainType : fsTheme.wallpaperType;

  if (effectiveWpType === 'custom-image') {
    const imgUrl = fsTheme.customImageSrc || (typeof userTheme !== 'undefined' && userTheme ? userTheme.customImageSrc : '') || fsTheme.sourceUrl || (typeof userTheme !== 'undefined' && userTheme ? userTheme.sourceUrl : '');
    if (imgUrl) {
      if (fsCustomImg && fsCustomImg.src !== imgUrl) fsCustomImg.src = imgUrl;
      if (fsCustomImgBg) {
        fsCustomImgBg.style.backgroundImage = `url('${imgUrl}')`;
        fsCustomImgBg.classList.remove('hidden');
      }
      if (fsAmbientBlur) {
        if (fitMode === 'contain') {
          fsAmbientBlur.style.backgroundImage = `url('${imgUrl}')`;
          fsAmbientBlur.classList.remove('hidden');
        } else {
          fsAmbientBlur.classList.add('hidden');
        }
      }
      fsWallpaperWrap?.classList.remove('hidden');
    } else {
      // Image still resolving from IndexedDB on boot: fallback gracefully to ambient aura
      if (fsBg1) { fsBg1.style.display = 'block'; fsBg1.style.opacity = '1'; }
      if (fsBg2) { fsBg2.style.display = 'block'; }
    }
  } else if (STATIC_WALLPAPER_URLS[effectiveWpType]) {
    const imgUrl = STATIC_WALLPAPER_URLS[effectiveWpType];
    if (fsCustomImg && fsCustomImg.src !== imgUrl) fsCustomImg.src = imgUrl;
    if (fsCustomImgBg) {
      fsCustomImgBg.style.backgroundImage = `url('${imgUrl}')`;
      fsCustomImgBg.classList.remove('hidden');
    }
    if (fsAmbientBlur) {
      if (fitMode === 'contain') {
        fsAmbientBlur.style.backgroundImage = `url('${imgUrl}')`;
        fsAmbientBlur.classList.remove('hidden');
      } else {
        fsAmbientBlur.classList.add('hidden');
      }
    }
    fsWallpaperWrap?.classList.remove('hidden');
  } else if (effectiveWpType === 'custom-video' || (typeof VIDEO_WALLPAPER_URLS !== 'undefined' && VIDEO_WALLPAPER_URLS[effectiveWpType])) {
    const vidUrl = effectiveWpType === 'custom-video'
      ? (fsTheme.customVideoSrc || (typeof userTheme !== 'undefined' && userTheme ? userTheme.customVideoSrc : ''))
      : (typeof VIDEO_WALLPAPER_URLS !== 'undefined' ? VIDEO_WALLPAPER_URLS[effectiveWpType] : '');
    if (fsVideoEl && vidUrl) {
      if (fsVideoEl.src !== vidUrl) {
        fsVideoEl.src = vidUrl;
        fsVideoEl.load();
        fsVideoEl.play().catch(() => {});
      }
      fsVideoEl.classList.remove('hidden');
    }
  } else if (effectiveWpType === 'aura' || effectiveWpType === 'match-main') {
    if (fsBg1) { fsBg1.style.display = 'block'; fsBg1.style.opacity = '1'; }
    if (fsBg2) { fsBg2.style.display = 'block'; }
  } else {
    // Procedural Live Atmosphere in Fullscreen
    if (typeof spawnParticlesForPreset === 'function') spawnParticlesForPreset(effectiveWpType);
    fsMotionCanvasEl?.classList.remove('hidden');
  }

  syncFullscreenStudioUI();

  if (save) {
    const toSave = { ...fsTheme };
    if (toSave.customImageSrc && toSave.customImageSrc.startsWith('blob:')) {
      toSave.customImageSrc = toSave.sourceUrl || '';
    }
    if (toSave.customVideoSrc && toSave.customVideoSrc.startsWith('blob:')) {
      toSave.customVideoSrc = toSave.sourceUrl || '';
    }
    try {
      localStorage.setItem('linus_fs_theme', JSON.stringify(toSave));
    } catch (e) {
      console.warn('Could not save fsTheme to localStorage:', e);
    }
    state.fs_theme = toSave;
    if (typeof syncUserSettingsToDB === 'function') {
      syncUserSettingsToDB({ fs_theme: toSave });
    }
    saveState();
  }
}

function syncFullscreenStudioUI() {
  if (!$('#picker-fs-lyrics-active')) return;
  $('#picker-fs-lyrics-active').value = fsTheme.lyricsActiveColor;
  $('#val-fs-lyrics-active').textContent = fsTheme.lyricsActiveColor;
  $('#picker-fs-lyrics-glow').value = fsTheme.lyricsActiveGlow;
  $('#val-fs-lyrics-glow').textContent = fsTheme.lyricsActiveGlow;
  $('#picker-fs-lyrics-inactive').value = fsTheme.lyricsInactiveColor;
  $('#val-fs-lyrics-inactive').textContent = fsTheme.lyricsInactiveColor;
  $('#picker-fs-lyrics-shadow').value = fsTheme.lyricsShadowColor;
  $('#val-fs-lyrics-shadow').textContent = fsTheme.lyricsShadowColor;

  $('#slider-fs-lyrics-pill-opacity').value = fsTheme.lyricsPillOpacity;
  $('#val-fs-lyrics-pill-opacity').textContent = `${fsTheme.lyricsPillOpacity}%`;
  $('#slider-fs-lyrics-glow-strength').value = fsTheme.lyricsGlowStrength;
  $('#val-fs-lyrics-glow-strength').textContent = `${fsTheme.lyricsGlowStrength}%`;

  $('#slider-fs-wallpaper-dim').value = fsTheme.wallpaperDim ?? 0;
  $('#val-fs-wallpaper-dim').textContent = `${fsTheme.wallpaperDim ?? 0}%`;
  $('#slider-fs-wallpaper-blur').value = fsTheme.wallpaperBlur ?? 0;
  $('#val-fs-wallpaper-blur').textContent = `${fsTheme.wallpaperBlur ?? 0}px`;

  const vigSlider = $('#slider-fs-wallpaper-vignette');
  const vigVal = fsTheme.wallpaperType === 'match-main' && fsTheme.wallpaperVignette === undefined ? 70 : (fsTheme.wallpaperVignette ?? 0);
  if (vigSlider) vigSlider.value = vigVal;
  const vigLabel = $('#val-fs-wallpaper-vignette');
  if (vigLabel) vigLabel.textContent = `${vigVal}%`;

  const brightSlider = $('#slider-fs-wallpaper-brightness');
  const brightVal = fsTheme.wallpaperBrightness ?? 100;
  if (brightSlider) brightSlider.value = brightVal;
  const brightLabel = $('#val-fs-wallpaper-brightness');
  if (brightLabel) brightLabel.textContent = `${brightVal}%`;

  const contrastSlider = $('#slider-fs-wallpaper-contrast');
  const contrastVal = fsTheme.wallpaperContrast ?? 100;
  if (contrastSlider) contrastSlider.value = contrastVal;
  const contrastLabel = $('#val-fs-wallpaper-contrast');
  if (contrastLabel) contrastLabel.textContent = `${contrastVal}%`;

  const satSlider = $('#slider-fs-wallpaper-saturation');
  const satVal = fsTheme.wallpaperSaturation ?? 100;
  if (satSlider) satSlider.value = satVal;
  const satLabel = $('#val-fs-wallpaper-saturation');
  if (satLabel) satLabel.textContent = `${satVal}%`;

  const posSlider = $('#slider-fs-wallpaper-pos');
  const posVal = fsTheme.wallpaperPos ?? 15;
  if (posSlider) posSlider.value = posVal;
  const posLabel = $('#val-fs-wallpaper-pos');
  if (posLabel) {
    if (posVal <= 20) posLabel.textContent = `Top (${posVal}%)`;
    else if (posVal >= 80) posLabel.textContent = `Bottom (${posVal}%)`;
    else posLabel.textContent = `Center (${posVal}%)`;
  }

  // Framing button active states
  const fitMode = fsTheme.wallpaperFit || 'cover';
  document.querySelectorAll('.fs-fit-btn').forEach(btn => {
    const bFit = btn.dataset.fit;
    if (fitMode === 'contain' && bFit === 'contain') btn.classList.add('active');
    else if (fitMode === 'cover' && bFit === 'cover-top' && posVal <= 25) btn.classList.add('active');
    else if (fitMode === 'cover' && bFit === 'cover-center' && posVal > 25) btn.classList.add('active');
    else btn.classList.remove('active');
  });

  // Sync wallpaper cards
  document.querySelectorAll('.fs-wallpaper-card').forEach(card => {
    card.classList.toggle('active', card.dataset.fswp === fsTheme.wallpaperType);
  });

  // Custom media input container visibility
  const mediaBox = $('#fs-custom-media-box');
  const imgGroup = $('#fs-custom-img-group');
  const vidGroup = $('#fs-custom-vid-group');
  if (fsTheme.wallpaperType === 'custom-image') {
    mediaBox?.classList.remove('hidden');
    imgGroup?.classList.remove('hidden');
    vidGroup?.classList.add('hidden');
  } else if (fsTheme.wallpaperType === 'custom-video') {
    mediaBox?.classList.remove('hidden');
    imgGroup?.classList.add('hidden');
    vidGroup?.classList.remove('hidden');
  } else {
    mediaBox?.classList.add('hidden');
  }

  const autoFsCheck = $('#check-fs-auto-native-fullscreen');
  if (autoFsCheck) {
    autoFsCheck.checked = fsTheme.autoNativeFullscreen !== false;
  }
  updateTrueFullscreenUI();
}

// Fullscreen Studio Dialog Open/Close
$('#fs-studio-btn')?.addEventListener('click', (e) => {
  e.stopPropagation();
  syncFullscreenStudioUI();
  $('#fs-theme-studio-sheet')?.showModal();
});

$('#fs-theme-studio-close')?.addEventListener('click', () => $('#fs-theme-studio-sheet')?.close());
$('#fs-studio-done-btn')?.addEventListener('click', () => {
  $('#fs-theme-studio-sheet')?.close();
  notify('✨ Full Screen atmosphere applied!');
});

// Fullscreen Studio Tab Switching
document.querySelectorAll('.fs-studio-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fs-studio-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.fs-tab-content').forEach(c => c.classList.add('hidden'));
    btn.classList.add('active');
    $(`#fs-tab-${btn.dataset.fstab}`)?.classList.remove('hidden');
  });
});

// Fullscreen Wallpaper Selection
document.querySelectorAll('.fs-wallpaper-card').forEach(card => {
  card.addEventListener('click', () => {
    fsTheme.wallpaperType = card.dataset.fswp;
    if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
    if (fsTheme.wallpaperVignette === undefined) fsTheme.wallpaperVignette = 0;
    applyFullscreenTheme(fsTheme);
    notify(`🎥 Full Screen: ${card.querySelector('strong').textContent}`);
  });
});

// Fullscreen Custom Photo / Video Uploads (with IndexedDB for uncompressed quality)
$('#fs-custom-wallpaper-file')?.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  // Store full uncompressed blob in IndexedDB (bypasses 5MB localStorage limit)
  await storeWallpaperBlob('fs_custom_image', file);
  const blobUrl = URL.createObjectURL(file);
  window.activeWallpaperBlobUrl = blobUrl;
  fsTheme.customImageSrc = blobUrl;
  fsTheme.wallpaperType = 'custom-image';
  if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
  fsTheme.wallpaperVignette = 0;
  applyFullscreenTheme(fsTheme);

  userTheme.customImageSrc = blobUrl;
  userTheme.wallpaperType = 'custom-image';
  applyUserTheme(userTheme);
  notify('🖼️ Full Screen custom photo loaded in uncompressed high resolution!');
  uploadWallpaperFileToServer(file);
});

$('#fs-custom-wallpaper-url')?.addEventListener('change', async (e) => {
  const url = e.target.value.trim();
  if (!url) return;
  await ingestWallpaperUrl(url);
});

$('#fs-custom-video-file')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const blobUrl = URL.createObjectURL(file);
  fsTheme.customVideoSrc = blobUrl;
  fsTheme.wallpaperType = 'custom-video';
  if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
  fsTheme.wallpaperVignette = 0;
  applyFullscreenTheme(fsTheme);
  notify('🎬 Full Screen live video applied!');
  uploadWallpaperFileToServer(file);
});

$('#fs-custom-video-url')?.addEventListener('change', (e) => {
  const url = e.target.value.trim();
  if (!url) return;
  fsTheme.customVideoSrc = url;
  fsTheme.wallpaperType = 'custom-video';
  if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
  fsTheme.wallpaperVignette = 0;
  applyFullscreenTheme(fsTheme);
  notify('🎬 Full Screen live video applied from URL!');
});

// Initial apply on boot so fullscreen wallpaper and atmosphere are always active on refresh
applyFullscreenTheme(fsTheme, false);

// Restore uncompressed custom image from IndexedDB on boot (with sourceUrl fallback)
loadWallpaperBlob('fs_custom_image').then(blob => {
  if (blob) {
    const liveBlobUrl = URL.createObjectURL(blob);
    window.activeWallpaperBlobUrl = liveBlobUrl;
    let needUserThemeUpdate = false;
    let needFsThemeUpdate = false;

    if (userTheme.wallpaperType === 'custom-image') {
      userTheme.customImageSrc = liveBlobUrl;
      needUserThemeUpdate = true;
    }
    if (fsTheme.wallpaperType === 'custom-image' || fsTheme.wallpaperType === 'match-main') {
      fsTheme.customImageSrc = liveBlobUrl;
      needFsThemeUpdate = true;
    }

    if (needUserThemeUpdate) applyUserTheme(userTheme, false);
    if (needFsThemeUpdate) applyFullscreenTheme(fsTheme, false);
  } else {
    let needUserThemeUpdate = false;
    let needFsThemeUpdate = false;
    const fallbackUrl = userTheme.sourceUrl || fsTheme.sourceUrl;

    if (fallbackUrl && userTheme.wallpaperType === 'custom-image') {
      userTheme.customImageSrc = fallbackUrl;
      needUserThemeUpdate = true;
    }
    if (fallbackUrl && (fsTheme.wallpaperType === 'custom-image' || fsTheme.wallpaperType === 'match-main')) {
      fsTheme.customImageSrc = fallbackUrl;
      needFsThemeUpdate = true;
    }

    if (needUserThemeUpdate) applyUserTheme(userTheme, false);
    if (needFsThemeUpdate) applyFullscreenTheme(fsTheme, false);
  }
}).catch((err) => {
  console.warn('Could not restore wallpaper blob on boot:', err);
  const fallbackUrl = userTheme.sourceUrl || fsTheme.sourceUrl;
  if (fallbackUrl && userTheme.wallpaperType === 'custom-image') {
    userTheme.customImageSrc = fallbackUrl;
    applyUserTheme(userTheme, false);
  }
  if (fallbackUrl && (fsTheme.wallpaperType === 'custom-image' || fsTheme.wallpaperType === 'match-main')) {
    fsTheme.customImageSrc = fallbackUrl;
    applyFullscreenTheme(fsTheme, false);
  }
});

// Framing & Fit Buttons
$('#fs-fit-cover-top')?.addEventListener('click', () => {
  fsTheme.wallpaperFit = 'cover';
  fsTheme.wallpaperPos = 15;
  applyFullscreenTheme(fsTheme);
  notify('🖼️ Top Focus applied — Head and Halo fully preserved!');
});

$('#fs-fit-cover-center')?.addEventListener('click', () => {
  fsTheme.wallpaperFit = 'cover';
  fsTheme.wallpaperPos = 50;
  applyFullscreenTheme(fsTheme);
  notify('🖼️ Center Focus applied!');
});

$('#fs-fit-contain')?.addEventListener('click', () => {
  fsTheme.wallpaperFit = 'contain';
  fsTheme.wallpaperPos = 50;
  applyFullscreenTheme(fsTheme);
  notify('🖼️ Fit Full Artwork applied — 100% of original image visible with ambient sides!');
});

// Vertical Framing / Camera Pan Slider
$('#slider-fs-wallpaper-pos')?.addEventListener('input', (e) => {
  fsTheme.wallpaperPos = parseInt(e.target.value);
  applyFullscreenTheme(fsTheme);
});

// Contrast Slider
$('#slider-fs-wallpaper-contrast')?.addEventListener('input', (e) => {
  fsTheme.wallpaperContrast = parseInt(e.target.value);
  $('#val-fs-wallpaper-contrast').textContent = `${fsTheme.wallpaperContrast}%`;
  applyFullscreenTheme(fsTheme);
});

// Vivid Art Boost Preset Button
$('#fs-vivid-boost-btn')?.addEventListener('click', () => {
  fsTheme.wallpaperContrast = 108;
  fsTheme.wallpaperSaturation = 115;
  fsTheme.wallpaperBrightness = 100;
  fsTheme.wallpaperDim = 0;
  fsTheme.wallpaperVignette = 0;
  applyFullscreenTheme(fsTheme);
  notify('🎨 Vivid Art Boost applied! Rich contrast & deep color saturation.');
});

// Pure Original Quality Mode Preset Button
$('#fs-pure-quality-btn')?.addEventListener('click', () => {
  fsTheme.wallpaperDim = 0;
  fsTheme.wallpaperVignette = 0;
  fsTheme.wallpaperBlur = 0;
  fsTheme.wallpaperBrightness = 100;
  fsTheme.wallpaperContrast = 100;
  fsTheme.wallpaperSaturation = 100;
  localStorage.setItem('linus_fs_dim_customized', 'true');
  applyFullscreenTheme(fsTheme);
  notify('✨ Pure 1:1 Passthrough applied! (Raw uncompressed quality)');
});

// Fullscreen Lyrics Color Pickers
$('#picker-fs-lyrics-active')?.addEventListener('input', (e) => {
  fsTheme.lyricsActiveColor = e.target.value;
  $('#val-fs-lyrics-active').textContent = e.target.value;
  applyFullscreenTheme(fsTheme);
});

$('#picker-fs-lyrics-glow')?.addEventListener('input', (e) => {
  fsTheme.lyricsActiveGlow = e.target.value;
  $('#val-fs-lyrics-glow').textContent = e.target.value;
  applyFullscreenTheme(fsTheme);
});

$('#picker-fs-lyrics-inactive')?.addEventListener('input', (e) => {
  fsTheme.lyricsInactiveColor = e.target.value;
  $('#val-fs-lyrics-inactive').textContent = e.target.value;
  applyFullscreenTheme(fsTheme);
});

$('#picker-fs-lyrics-shadow')?.addEventListener('input', (e) => {
  fsTheme.lyricsShadowColor = e.target.value;
  $('#val-fs-lyrics-shadow').textContent = e.target.value;
  applyFullscreenTheme(fsTheme);
});

$('#slider-fs-lyrics-pill-opacity')?.addEventListener('input', (e) => {
  fsTheme.lyricsPillOpacity = parseInt(e.target.value);
  $('#val-fs-lyrics-pill-opacity').textContent = `${fsTheme.lyricsPillOpacity}%`;
  applyFullscreenTheme(fsTheme);
});

$('#slider-fs-lyrics-glow-strength')?.addEventListener('input', (e) => {
  fsTheme.lyricsGlowStrength = parseInt(e.target.value);
  $('#val-fs-lyrics-glow-strength').textContent = `${fsTheme.lyricsGlowStrength}%`;
  applyFullscreenTheme(fsTheme);
});

// Fullscreen Atmosphere Sliders
$('#slider-fs-wallpaper-dim')?.addEventListener('input', (e) => {
  fsTheme.wallpaperDim = parseInt(e.target.value);
  $('#val-fs-wallpaper-dim').textContent = `${fsTheme.wallpaperDim}%`;
  localStorage.setItem('linus_fs_dim_customized', 'true');
  applyFullscreenTheme(fsTheme);
});

$('#slider-fs-wallpaper-vignette')?.addEventListener('input', (e) => {
  fsTheme.wallpaperVignette = parseInt(e.target.value);
  $('#val-fs-wallpaper-vignette').textContent = `${fsTheme.wallpaperVignette}%`;
  applyFullscreenTheme(fsTheme);
});

$('#slider-fs-wallpaper-brightness')?.addEventListener('input', (e) => {
  fsTheme.wallpaperBrightness = parseInt(e.target.value);
  $('#val-fs-wallpaper-brightness').textContent = `${fsTheme.wallpaperBrightness}%`;
  applyFullscreenTheme(fsTheme);
});

$('#slider-fs-wallpaper-saturation')?.addEventListener('input', (e) => {
  fsTheme.wallpaperSaturation = parseInt(e.target.value);
  $('#val-fs-wallpaper-saturation').textContent = `${fsTheme.wallpaperSaturation}%`;
  applyFullscreenTheme(fsTheme);
});

$('#slider-fs-wallpaper-blur')?.addEventListener('input', (e) => {
  fsTheme.wallpaperBlur = parseInt(e.target.value);
  $('#val-fs-wallpaper-blur').textContent = `${fsTheme.wallpaperBlur}px`;
  applyFullscreenTheme(fsTheme);
});

// Auto-enter true fullscreen preference
$('#check-fs-auto-native-fullscreen')?.addEventListener('change', (e) => {
  fsTheme.autoNativeFullscreen = e.target.checked;
  applyFullscreenTheme(fsTheme);
  notify(e.target.checked ? '🖥️ Auto True Fullscreen enabled (Tabs & URL bar will hide)' : '🖥️ Auto True Fullscreen disabled');
});

// Toggle Native Fullscreen Button in Studio
$('#fs-native-toggle-btn')?.addEventListener('click', () => {
  toggleTrueFullscreen();
});

// Fullscreen Lyrics Reset
$('#fs-reset-lyrics-colors-btn')?.addEventListener('click', () => {
  fsTheme.lyricsActiveColor = DEFAULT_FS_THEME.lyricsActiveColor;
  fsTheme.lyricsActiveGlow = DEFAULT_FS_THEME.lyricsActiveGlow;
  fsTheme.lyricsInactiveColor = DEFAULT_FS_THEME.lyricsInactiveColor;
  fsTheme.lyricsShadowColor = DEFAULT_FS_THEME.lyricsShadowColor;
  fsTheme.lyricsPillOpacity = DEFAULT_FS_THEME.lyricsPillOpacity;
  fsTheme.lyricsGlowStrength = DEFAULT_FS_THEME.lyricsGlowStrength;
  applyFullscreenTheme(fsTheme);
  notify('Reset Full Screen lyrics styling to default.');
});

// Fullscreen Reset All Defaults
$('#fs-studio-reset-all-btn')?.addEventListener('click', () => {
  fsTheme = { ...DEFAULT_FS_THEME };
  localStorage.removeItem('linus_fs_dim_customized');
  applyFullscreenTheme(fsTheme);
  notify('Reset Full Screen visual atmosphere to original defaults.');
});

// ============================================================
// 50+ Wallpaper Gallery Explorer & Most Used Tray Engine
// ============================================================

let currentGalleryTarget = 'main'; // 'main' or 'fullscreen'
let selectedGalleryCategory = 'all';

function renderFeaturedWallpapersTray() {
  const mainGrid = $('#featured-wallpapers-grid');
  const fsGrid = $('#fs-featured-wallpapers-grid');
  const sorted = getSortedWallpapersByUsage();
  const topFeatured = sorted.slice(0, 8); // Top 8 most used / popular on front page

  if (mainGrid) {
    mainGrid.innerHTML = topFeatured.map(wp => `
      <button class="wallpaper-card ${userTheme.wallpaperType === wp.id ? 'active' : ''}" data-wp="${wp.id}">
        <div class="wp-card-header">
          <div class="wallpaper-thumb-preview" style="background-image:url('${wp.thumb}')"></div>
          ${wallpaperUsageHistory[wp.id] ? `<span class="wp-card-badge"><i class="ph-fill ph-fire"></i> Most Used</span>` : ''}
        </div>
        <strong>${wp.title}</strong>
        <span>${wp.desc}</span>
      </button>
    `).join('');

    mainGrid.querySelectorAll('.wallpaper-card').forEach(card => {
      card.addEventListener('click', () => {
        userTheme.wallpaperType = card.dataset.wp;
        recordWallpaperUsage(card.dataset.wp);
        applyUserTheme(userTheme);
        notify(`🖼️ Wallpaper: ${card.querySelector('strong').textContent}`);
      });
    });
  }

  if (fsGrid) {
    fsGrid.innerHTML = topFeatured.map(wp => `
      <div class="wallpaper-card fs-wallpaper-card ${fsTheme.wallpaperType === wp.id ? 'active' : ''}" data-fswp="${wp.id}">
        <div class="wp-card-header">
          <div class="wallpaper-thumb-preview" style="background-image:url('${wp.thumb}')"></div>
          ${wallpaperUsageHistory[wp.id] ? `<span class="wp-card-badge"><i class="ph-fill ph-fire"></i> Most Used</span>` : ''}
        </div>
        <strong>${wp.title}</strong>
        <span>${wp.desc}</span>
      </div>
    `).join('');

    fsGrid.querySelectorAll('.fs-wallpaper-card').forEach(card => {
      card.addEventListener('click', () => {
        fsTheme.wallpaperType = card.dataset.fswp;
        recordWallpaperUsage(card.dataset.fswp);
        if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
        if (fsTheme.wallpaperVignette === undefined) fsTheme.wallpaperVignette = 0;
        applyFullscreenTheme(fsTheme);
        notify(`🖼️ Fullscreen Wallpaper: ${card.querySelector('strong').textContent}`);
      });
    });
  }
}

function renderFullWallpaperGallery(category = 'all') {
  selectedGalleryCategory = category;
  const grid = $('#full-gallery-grid');
  if (!grid) return;

  const filtered = category === 'all' 
    ? STATIC_WALLPAPERS_CATALOG 
    : STATIC_WALLPAPERS_CATALOG.filter(w => w.cat === category);

  grid.innerHTML = filtered.map(wp => {
    const isSelected = currentGalleryTarget === 'fullscreen' 
      ? fsTheme.wallpaperType === wp.id 
      : userTheme.wallpaperType === wp.id;

    return `
      <button class="wallpaper-card ${isSelected ? 'active' : ''}" data-gallery-id="${wp.id}">
        <div class="wp-card-header">
          <div class="wallpaper-thumb-preview" style="background-image:url('${wp.thumb}')"></div>
          ${wallpaperUsageHistory[wp.id] ? `<span class="wp-card-badge"><i class="ph-fill ph-star"></i> Top Pick</span>` : ''}
        </div>
        <strong>${wp.title}</strong>
        <span>${wp.desc}</span>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('.wallpaper-card').forEach(card => {
    card.addEventListener('click', () => {
      const wpId = card.dataset.galleryId;
      recordWallpaperUsage(wpId);
      if (currentGalleryTarget === 'fullscreen') {
        fsTheme.wallpaperType = wpId;
        if (fsTheme.wallpaperDim === 45) fsTheme.wallpaperDim = 0;
        if (fsTheme.wallpaperVignette === undefined) fsTheme.wallpaperVignette = 0;
        applyFullscreenTheme(fsTheme);
        notify(`🖼️ Fullscreen: ${card.querySelector('strong').textContent}`);
      } else {
        userTheme.wallpaperType = wpId;
        applyUserTheme(userTheme);
        notify(`🖼️ Background: ${card.querySelector('strong').textContent}`);
      }
      renderFullWallpaperGallery(selectedGalleryCategory);
      $('#wallpaper-gallery-sheet')?.close();
    });
  });
}

function openWallpaperGallery(target = 'main') {
  currentGalleryTarget = target;
  renderFullWallpaperGallery(selectedGalleryCategory);
  $('#wallpaper-gallery-sheet')?.showModal();
}

// Category filter chip event listeners
document.querySelectorAll('#gallery-category-chips .cat-chip-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#gallery-category-chips .cat-chip-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderFullWallpaperGallery(btn.dataset.cat);
  });
});

// Open Gallery Triggers
$('#open-wallpaper-gallery-btn')?.addEventListener('click', () => openWallpaperGallery('main'));
$('#see-more-banner-btn')?.addEventListener('click', () => openWallpaperGallery('main'));
$('#fs-open-wallpaper-gallery-btn')?.addEventListener('click', () => openWallpaperGallery('fullscreen'));
$('#fs-see-more-banner-btn')?.addEventListener('click', () => openWallpaperGallery('fullscreen'));

$('#wallpaper-gallery-close')?.addEventListener('click', () => $('#wallpaper-gallery-sheet')?.close());
$('#wallpaper-gallery-done-btn')?.addEventListener('click', () => $('#wallpaper-gallery-sheet')?.close());



  // Expose Theme Studio APIs to global window
  window.DEFAULT_USER_THEME = DEFAULT_USER_THEME;
  window.DEFAULT_FS_THEME = DEFAULT_FS_THEME;
  window.applyUserTheme = applyUserTheme;
  window.applyFullscreenTheme = applyFullscreenTheme;
  window.openWallpaperGallery = openWallpaperGallery;
  window.userTheme = typeof userTheme !== 'undefined' ? userTheme : DEFAULT_USER_THEME;
  window.fsTheme = typeof fsTheme !== 'undefined' ? fsTheme : DEFAULT_FS_THEME;

})();
