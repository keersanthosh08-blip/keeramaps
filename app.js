/* ============================================================
   KeeraMaps – app.js
   Full interactive logic: map, search, routing, panels, etc.
   ============================================================ */

'use strict';

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
const State = {
  map: null,
  userLat: null,
  userLng: null,
  userMarker: null,
  routeControl: null,
  activePanel: null,         // 'directions' | 'saved' | 'profile'
  currentLayer: 'dark',
  darkMode: true,
  savedPlaces: JSON.parse(localStorage.getItem('km_saved') || '[]'),
  routesTaken: parseInt(localStorage.getItem('km_routes') || '0'),
  searchTimeout: null,
  selectedPlace: null,
  navActive: false,
  navInterval: null,
  muted: false,
  poiMarkers: [],
  speechRecognition: null,
};

// ─────────────────────────────────────────────
// Tile Layer URLs
// ─────────────────────────────────────────────
const LAYERS = {
  default: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: '© OpenStreetMap contributors © CARTO'
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri, © OpenStreetMap contributors'
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '© OpenTopoMap contributors'
  },
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '© OpenStreetMap contributors © CARTO'
  }
};

// ─────────────────────────────────────────────
// POI categories with icons & colors
// ─────────────────────────────────────────────
const POI_CONFIG = {
  restaurant: { icon: 'fa-utensils', color: '#f75c8e', overpass: 'amenity=restaurant' },
  hotel:      { icon: 'fa-hotel',    color: '#f7c948', overpass: 'tourism=hotel' },
  hospital:   { icon: 'fa-hospital', color: '#22d9a4', overpass: 'amenity=hospital' },
  fuel:       { icon: 'fa-gas-pump', color: '#ff7c43', overpass: 'amenity=fuel' },
  atm:        { icon: 'fa-building-columns', color: '#a78bfa', overpass: 'amenity=atm' },
};

// ─────────────────────────────────────────────
// DOM helpers
// ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const show = id => $s(id) && ($s(id).classList.remove('hidden'));
const hide = id => $s(id) && ($s(id).classList.add('hidden'));
const $s = id => $(id);

function showEl(el) { el && el.classList.remove('hidden'); }
function hideEl(el) { el && el.classList.add('hidden'); }
function toggleClass(el, cls) { el && el.classList.toggle(cls); }

// ─────────────────────────────────────────────
// Toast
// ─────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 2500) {
  const t = $('toast');
  t.textContent = msg;
  showEl(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hideEl(t), duration);
}

// ─────────────────────────────────────────────
// SPLASH → APP
// ─────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    const splash = $('splash-screen');
    splash.classList.add('fade-out');
    setTimeout(() => {
      splash.classList.add('hidden');
      showEl($('app'));
      initMap();
    }, 600);
  }, 2600);
});

// ─────────────────────────────────────────────
// MAP INIT
// ─────────────────────────────────────────────
function initMap() {
  const defaultCenter = [20.5937, 78.9629]; // India center
  State.map = L.map('map', {
    center: defaultCenter,
    zoom: 5,
    zoomControl: false,
    attributionControl: true,
  });

  State.tileLayer = L.tileLayer(LAYERS.dark.url, {
    attribution: LAYERS.dark.attr,
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(State.map);

  State.map.on('click', onMapClick);
  State.map.on('zoomend moveend', updateScaleBar);

  updateScaleBar();
  updateSavedList();
  updateStats();

  // Try geolocation
  setTimeout(locateUser, 800);
}

// ─────────────────────────────────────────────
// MAP CLICK
// ─────────────────────────────────────────────
function onMapClick(e) {
  const { lat, lng } = e.latlng;
  reverseGeocode(lat, lng, (name, addr) => {
    State.selectedPlace = { lat, lng, name, addr };
    showPlaceCard(name, addr, lat, lng);
  });
}

function showPlaceCard(name, addr, lat, lng) {
  closeAllPanels();
  $('place-name').textContent = name || 'Unknown Place';
  $('place-type').querySelector('span').textContent = guessType(name);
  $('place-addr').textContent = addr || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
  $('place-stars').textContent = randomStars();
  $('place-reviews').textContent = `(${Math.floor(Math.random()*500)+10} reviews)`;
  showEl($('place-card'));

  // Drop a temp marker
  dropTempMarker(lat, lng, name);
}

function guessType(name) {
  if (!name) return 'Location';
  const n = name.toLowerCase();
  if (n.includes('hotel') || n.includes('inn') || n.includes('resort')) return 'Hotel';
  if (n.includes('hospital') || n.includes('clinic') || n.includes('health')) return 'Hospital';
  if (n.includes('restaurant') || n.includes('food') || n.includes('cafe') || n.includes('diner')) return 'Restaurant';
  if (n.includes('petrol') || n.includes('fuel') || n.includes('gas')) return 'Fuel Station';
  if (n.includes('bank') || n.includes('atm')) return 'ATM / Bank';
  if (n.includes('park') || n.includes('garden')) return 'Park';
  return 'Place';
}

function randomStars() {
  const r = Math.random();
  if (r > 0.8) return '★★★★★';
  if (r > 0.5) return '★★★★☆';
  if (r > 0.2) return '★★★☆☆';
  return '★★☆☆☆';
}

let tempMarker = null;
function dropTempMarker(lat, lng, name) {
  if (tempMarker) State.map.removeLayer(tempMarker);
  const icon = createKMIcon('#f75c8e', 'fa-location-dot');
  tempMarker = L.marker([lat, lng], { icon }).addTo(State.map);
  tempMarker.bindPopup(`<b style="color:#f0f3ff">${name || 'Location'}</b>`);
}

function createKMIcon(color, faClass) {
  return L.divIcon({
    html: `<div class="km-marker-wrap">
      <div class="km-marker" style="background:${color}">
        <i class="fa-solid ${faClass}"></i>
      </div>
      <div class="km-pulse" style="background:${color}44"></div>
    </div>`,
    className: '',
    iconSize: [36, 50],
    iconAnchor: [18, 46],
    popupAnchor: [0, -46]
  });
}

// ─────────────────────────────────────────────
// GEOLOCATION
// ─────────────────────────────────────────────
function locateUser() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported on your device.');
    return;
  }
  const btn = $('locate-btn');
  btn.classList.add('locating');

  navigator.geolocation.getCurrentPosition(
    pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      State.userLat = lat;
      State.userLng = lng;
      btn.classList.remove('locating');

      if (State.userMarker) State.map.removeLayer(State.userMarker);

      const userIcon = L.divIcon({
        html: `<div style="position:relative;width:60px;height:60px;display:flex;align-items:center;justify-content:center;">
          <div class="user-accuracy"></div>
          <div class="user-dot"></div>
        </div>`,
        className: '',
        iconSize: [60, 60],
        iconAnchor: [30, 30]
      });

      State.userMarker = L.marker([lat, lng], { icon: userIcon })
        .addTo(State.map)
        .bindPopup('<b style="color:#f0f3ff">You are here</b>');

      State.map.flyTo([lat, lng], 15, { duration: 1.5 });
      showToast('📍 Location found');
    },
    err => {
      btn.classList.remove('locating');
      showToast('Could not get your location. Please enable GPS.');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

$('locate-btn').addEventListener('click', locateUser);

// ─────────────────────────────────────────────
// SEARCH
// ─────────────────────────────────────────────
$('search-input').addEventListener('input', e => {
  clearTimeout(State.searchTimeout);
  const q = e.target.value.trim();
  if (!q) { hideEl($('search-results')); return; }
  State.searchTimeout = setTimeout(() => performSearch(q), 400);
});

$('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = $('search-input').value.trim();
    if (q) performSearch(q, true);
  }
});

document.addEventListener('click', e => {
  if (!$('search-box').contains(e.target) && !$('search-results').contains(e.target)) {
    hideEl($('search-results'));
  }
});

async function performSearch(query, flyTo = false) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();

    const container = $('search-results-inner');
    container.innerHTML = '';

    if (!data.length) {
      container.innerHTML = `<div class="search-result-item"><div class="result-text"><strong style="color:var(--text-muted)">No results found</strong></div></div>`;
      showEl($('search-results'));
      return;
    }

    data.forEach(item => {
      const el = document.createElement('div');
      el.className = 'search-result-item';
      el.setAttribute('role', 'option');
      const icon = placeIcon(item.type || item.class);
      el.innerHTML = `
        <div class="result-icon"><i class="fa-solid ${icon}"></i></div>
        <div class="result-text">
          <strong>${item.display_name.split(',')[0]}</strong>
          <small>${item.display_name.split(',').slice(1, 3).join(',').trim()}</small>
        </div>`;
      el.addEventListener('click', () => {
        const lat = parseFloat(item.lat);
        const lng = parseFloat(item.lon);
        const name = item.display_name.split(',')[0];
        const addr = item.display_name;
        $('search-input').value = name;
        hideEl($('search-results'));
        State.map.flyTo([lat, lng], 16, { duration: 1.2 });
        State.selectedPlace = { lat, lng, name, addr };
        showPlaceCard(name, addr, lat, lng);
      });
      container.appendChild(el);
    });

    showEl($('search-results'));

    if (flyTo && data.length > 0) {
      const first = data[0];
      State.map.flyTo([parseFloat(first.lat), parseFloat(first.lon)], 14, { duration: 1.2 });
    }
  } catch (err) {
    showToast('Search failed. Check your connection.');
  }
}

function placeIcon(type) {
  const t = (type || '').toLowerCase();
  if (t.includes('restaurant') || t.includes('food') || t.includes('cafe')) return 'fa-utensils';
  if (t.includes('hotel') || t.includes('tourism')) return 'fa-hotel';
  if (t.includes('hospital') || t.includes('health')) return 'fa-hospital';
  if (t.includes('bank') || t.includes('atm')) return 'fa-building-columns';
  if (t.includes('fuel') || t.includes('petrol')) return 'fa-gas-pump';
  if (t.includes('park') || t.includes('forest')) return 'fa-tree';
  if (t.includes('airport')) return 'fa-plane';
  if (t.includes('train') || t.includes('railway')) return 'fa-train';
  return 'fa-location-dot';
}

// ─────────────────────────────────────────────
// REVERSE GEOCODING
// ─────────────────────────────────────────────
async function reverseGeocode(lat, lng, callback) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    const name = data.name || data.display_name?.split(',')[0] || 'Unknown Location';
    const addr = data.display_name || '';
    callback(name, addr);
  } catch {
    callback('Unknown Location', `${lat.toFixed(4)}, ${lng.toFixed(4)}`);
  }
}

// ─────────────────────────────────────────────
// FILTER CHIPS – POI
// ─────────────────────────────────────────────
document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const type = chip.dataset.type;
    clearPOIMarkers();
    if (type !== 'all') fetchPOI(type);
  });
});

function clearPOIMarkers() {
  State.poiMarkers.forEach(m => State.map.removeLayer(m));
  State.poiMarkers = [];
}

async function fetchPOI(type) {
  const cfg = POI_CONFIG[type];
  if (!cfg) return;
  const center = State.map.getCenter();
  const radius = 3000;
  const query = `[out:json][timeout:8];node[${cfg.overpass}](around:${radius},${center.lat},${center.lng});out 20;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  showToast(`🔍 Fetching ${type} nearby...`);
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.elements?.length) { showToast(`No ${type} found nearby`); return; }

    data.elements.slice(0, 15).forEach(el => {
      const icon = createKMIcon(cfg.color, cfg.icon);
      const name = el.tags?.name || type.charAt(0).toUpperCase() + type.slice(1);
      const marker = L.marker([el.lat, el.lon], { icon })
        .addTo(State.map)
        .bindPopup(`<b style="color:#f0f3ff">${name}</b>`);
      marker.on('click', () => {
        reverseGeocode(el.lat, el.lon, (n, addr) => {
          State.selectedPlace = { lat: el.lat, lng: el.lon, name: name || n, addr };
          showPlaceCard(name || n, addr, el.lat, el.lon);
        });
      });
      State.poiMarkers.push(marker);
    });
    showToast(`✅ ${data.elements.length} ${type}(s) found`);
  } catch {
    showToast(`Could not fetch ${type} data`);
  }
}

// ─────────────────────────────────────────────
// MAP CONTROLS
// ─────────────────────────────────────────────
$('btn-zoom-in').addEventListener('click', () => State.map.zoomIn());
$('btn-zoom-out').addEventListener('click', () => State.map.zoomOut());

$('btn-layers').addEventListener('click', () => {
  const panel = $('layers-panel');
  if (panel.classList.contains('hidden')) showEl(panel);
  else hideEl(panel);
});

$('btn-satellite').addEventListener('click', () => {
  switchLayer('satellite');
  $('btn-satellite').classList.toggle('active');
});

$('btn-traffic').addEventListener('click', () => {
  $('btn-traffic').classList.toggle('active');
  showToast('Traffic overlay coming soon!');
});

// Layer panel options
document.querySelectorAll('.layer-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.layer-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    switchLayer(opt.dataset.layer);
    hideEl($('layers-panel'));
  });
});

function switchLayer(name) {
  const cfg = LAYERS[name];
  if (!cfg || !State.tileLayer) return;
  State.tileLayer.setUrl(cfg.url);
  State.currentLayer = name;
  showToast(`🗺 ${name.charAt(0).toUpperCase() + name.slice(1)} view`);
}

// ─────────────────────────────────────────────
// BOTTOM NAV
// ─────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    item.classList.add('active');
    handleTabSwitch(tab);
  });
});

function handleTabSwitch(tab) {
  closeAllPanels();
  if (tab === 'directions') {
    showEl($('directions-panel'));
    State.activePanel = 'directions';
  } else if (tab === 'saved') {
    updateSavedList();
    showEl($('saved-panel'));
    State.activePanel = 'saved';
  } else if (tab === 'profile') {
    updateStats();
    showEl($('profile-panel'));
    State.activePanel = 'profile';
  } else if (tab === 'contribute') {
    showToast('📷 Contribute mode — tap to add a place!');
  } else {
    State.activePanel = null;
  }
}

function closeAllPanels() {
  hideEl($('directions-panel'));
  hideEl($('saved-panel'));
  hideEl($('profile-panel'));
  hideEl($('place-card'));
  hideEl($('layers-panel'));
  State.activePanel = null;
}

// ─────────────────────────────────────────────
// DIRECTIONS PANEL
// ─────────────────────────────────────────────
$('dir-close').addEventListener('click', () => {
  hideEl($('directions-panel'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  $('nav-explore').classList.add('active');
});

$('dir-locate-btn').addEventListener('click', () => {
  if (State.userLat) {
    $('dir-from').value = `${State.userLat.toFixed(5)}, ${State.userLng.toFixed(5)}`;
    showToast('📍 Current location set as start');
  } else {
    showToast('Enable location first');
  }
});

$('swap-btn').addEventListener('click', () => {
  const from = $('dir-from').value;
  const to   = $('dir-to').value;
  $('dir-from').value = to;
  $('dir-to').value   = from;
});

document.querySelectorAll('.transport-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.transport-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

$('get-route-btn').addEventListener('click', async () => {
  const fromVal = $('dir-from').value.trim();
  const toVal   = $('dir-to').value.trim();
  if (!fromVal || !toVal) { showToast('Please enter start and destination'); return; }

  showToast('🔍 Calculating route...');

  const [fromCoords, toCoords] = await Promise.all([
    geocode(fromVal),
    geocode(toVal)
  ]);

  if (!fromCoords || !toCoords) { showToast('Could not find locations. Try different names.'); return; }

  drawRoute(fromCoords, toCoords);
});

async function geocode(query) {
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await res.json();
    if (!data.length) return null;
    return L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon));
  } catch { return null; }
}

function drawRoute(from, to) {
  if (State.routeControl) {
    State.map.removeControl(State.routeControl);
    State.routeControl = null;
  }

  State.routeControl = L.Routing.control({
    waypoints: [from, to],
    routeWhileDragging: false,
    showAlternatives: false,
    createMarker: (i, wp) => {
      const color = i === 0 ? '#4f8ef7' : '#ff5e6d';
      const icon = createKMIcon(color, i === 0 ? 'fa-circle-dot' : 'fa-flag');
      return L.marker(wp.latLng, { icon });
    },
    lineOptions: {
      styles: [
        { color: '#1a1f2e', weight: 8, opacity: 0.8 },
        { color: '#4f8ef7', weight: 5, opacity: 1 }
      ]
    },
    router: L.Routing.osrmv1({ serviceUrl: 'https://router.project-osrm.org/route/v1' })
  }).addTo(State.map);

  State.routeControl.on('routesfound', e => {
    const route = e.routes[0];
    const dist = (route.summary.totalDistance / 1000).toFixed(1) + ' km';
    const time = Math.ceil(route.summary.totalTime / 60) + ' min';
    $('route-dist').textContent = dist;
    $('route-time').textContent = time;
    showEl($('route-info'));
    State.map.fitBounds(State.routeControl.getPlan().getWaypoints()
      .filter(wp => wp.latLng)
      .map(wp => wp.latLng), { padding: [60, 60] });
    showToast(`🛣 Route: ${dist} · ${time}`);
    State.routesTaken++;
    localStorage.setItem('km_routes', State.routesTaken);
    updateStats();
  });

  State.routeControl.on('routingerror', () => {
    showToast('Could not calculate route. Try again.');
  });
}

$('start-nav-btn').addEventListener('click', () => {
  hideEl($('directions-panel'));
  showEl($('nav-overlay'));
  State.navActive = true;
  startFakeNavigation();
});

// ─────────────────────────────────────────────
// FAKE NAVIGATION (demo)
// ─────────────────────────────────────────────
const NAV_INSTRUCTIONS = [
  { arrow: 'fa-arrow-up', text: 'Continue straight', km: '1.2 km' },
  { arrow: 'fa-arrow-turn-right', text: 'Turn right ahead', km: '0.8 km' },
  { arrow: 'fa-arrow-turn-left', text: 'Turn left in 500m', km: '0.5 km' },
  { arrow: 'fa-arrow-up', text: 'Head towards highway', km: '0.3 km' },
  { arrow: 'fa-arrow-right', text: 'Keep right', km: '0.2 km' },
  { arrow: 'fa-flag-checkered', text: 'You have arrived!', km: '0 m' },
];

let navStep = 0;
function startFakeNavigation() {
  navStep = 0;
  updateNavStep();
  let eta = 12;
  let dist = 2.4;
  State.navInterval = setInterval(() => {
    navStep++;
    if (navStep >= NAV_INSTRUCTIONS.length) {
      clearInterval(State.navInterval);
      showToast('🏁 You have arrived at your destination!');
      setTimeout(() => {
        hideEl($('nav-overlay'));
        State.navActive = false;
      }, 3000);
      return;
    }
    updateNavStep();
    eta = Math.max(0, eta - 2);
    dist = Math.max(0, dist - 0.4).toFixed(1);
    $('nav-eta').textContent = eta + ' min';
    $('nav-remain').textContent = dist + ' km';
  }, 4000);
}

function updateNavStep() {
  const step = NAV_INSTRUCTIONS[navStep];
  $('nav-arrow').innerHTML = `<i class="fa-solid ${step.arrow}"></i>`;
  $('nav-distance').textContent = step.km;
  $('nav-street').textContent = step.text;
}

$('nav-exit-btn').addEventListener('click', () => {
  clearInterval(State.navInterval);
  hideEl($('nav-overlay'));
  State.navActive = false;
  showToast('Navigation ended');
});

$('nav-mute-btn').addEventListener('click', () => {
  State.muted = !State.muted;
  $('nav-mute-btn').innerHTML = State.muted
    ? '<i class="fa-solid fa-volume-xmark"></i>'
    : '<i class="fa-solid fa-volume-high"></i>';
  showToast(State.muted ? '🔇 Muted' : '🔊 Unmuted');
});

// ─────────────────────────────────────────────
// PLACE CARD ACTIONS
// ─────────────────────────────────────────────
$('place-dir-btn').addEventListener('click', () => {
  if (!State.selectedPlace) return;
  hideEl($('place-card'));
  showEl($('directions-panel'));
  $('dir-to').value = State.selectedPlace.name;
  if (State.userLat) $('dir-from').value = `${State.userLat.toFixed(5)}, ${State.userLng.toFixed(5)}`;
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  $('nav-directions').classList.add('active');
});

$('place-save-btn').addEventListener('click', () => {
  if (!State.selectedPlace) return;
  const p = State.selectedPlace;
  const already = State.savedPlaces.find(s => s.name === p.name);
  if (already) {
    showToast('Already saved!');
    return;
  }
  State.savedPlaces.push({ ...p, savedAt: Date.now() });
  localStorage.setItem('km_saved', JSON.stringify(State.savedPlaces));
  $('place-save-btn').classList.add('saved');
  $('place-save-btn').innerHTML = '<i class="fa-solid fa-bookmark"></i>';
  showToast('📌 Place saved!');
  updateStats();
});

$('place-share-btn').addEventListener('click', () => {
  if (State.selectedPlace) {
    const url = `https://www.openstreetmap.org/#map=15/${State.selectedPlace.lat}/${State.selectedPlace.lng}`;
    if (navigator.share) {
      navigator.share({ title: State.selectedPlace.name, url });
    } else {
      navigator.clipboard.writeText(url);
      showToast('🔗 Link copied to clipboard');
    }
  }
});

$('place-street-btn').addEventListener('click', () => {
  showToast('🚶 Street View coming soon!');
});

$('place-nearby-btn').addEventListener('click', () => {
  if (!State.selectedPlace) return;
  State.map.flyTo([State.selectedPlace.lat, State.selectedPlace.lng], 15);
  hideEl($('place-card'));
  showToast('🔍 Showing nearby places...');
  fetchPOI('restaurant');
});

// ─────────────────────────────────────────────
// SAVED PLACES
// ─────────────────────────────────────────────
function updateSavedList() {
  const list = $('saved-list');
  if (!State.savedPlaces.length) {
    list.innerHTML = `<div class="saved-empty">
      <i class="fa-solid fa-bookmark"></i>
      <p>No saved places yet.<br>Tap a location to save it.</p>
    </div>`;
    return;
  }
  list.innerHTML = '';
  State.savedPlaces.forEach((place, idx) => {
    const el = document.createElement('div');
    el.className = 'saved-place-item';
    el.innerHTML = `
      <div class="saved-place-icon"><i class="fa-solid fa-location-dot"></i></div>
      <div class="saved-place-info">
        <strong>${place.name}</strong>
        <small>${(place.addr || '').split(',').slice(0,2).join(',')}</small>
      </div>
      <button class="saved-place-remove" data-idx="${idx}" aria-label="Remove">
        <i class="fa-solid fa-trash"></i>
      </button>`;
    el.addEventListener('click', e => {
      if (e.target.closest('.saved-place-remove')) return;
      State.map.flyTo([place.lat, place.lng], 16, { duration: 1.2 });
      hideEl($('saved-panel'));
      showPlaceCard(place.name, place.addr, place.lat, place.lng);
    });
    list.appendChild(el);
  });

  list.querySelectorAll('.saved-place-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      const idx = parseInt(btn.dataset.idx);
      State.savedPlaces.splice(idx, 1);
      localStorage.setItem('km_saved', JSON.stringify(State.savedPlaces));
      updateSavedList();
      updateStats();
      showToast('🗑 Place removed');
    });
  });
}

// ─────────────────────────────────────────────
// PROFILE
// ─────────────────────────────────────────────
function updateStats() {
  $('stat-places').textContent = State.savedPlaces.length;
  $('stat-routes').textContent = State.routesTaken;
}

$('toggle-dark').addEventListener('click', () => {
  State.darkMode = !State.darkMode;
  const thumb = $('dark-toggle').querySelector('.toggle-thumb');
  if (State.darkMode) {
    thumb.classList.add('active');
    switchLayer('dark');
  } else {
    thumb.classList.remove('active');
    switchLayer('default');
  }
});

// ─────────────────────────────────────────────
// VOICE SEARCH (Web Speech API)
// ─────────────────────────────────────────────
$('mic-btn').addEventListener('click', () => {
  if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
    showToast('Voice search not supported on this browser');
    return;
  }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-IN';
  rec.interimResults = false;
  rec.maxAlternatives = 1;

  $('mic-btn').classList.add('listening');
  showToast('🎤 Listening...');

  rec.start();
  rec.onresult = e => {
    const q = e.results[0][0].transcript;
    $('search-input').value = q;
    performSearch(q, true);
    $('mic-btn').classList.remove('listening');
  };
  rec.onerror = () => {
    $('mic-btn').classList.remove('listening');
    showToast('Voice not recognised. Try again.');
  };
  rec.onend = () => {
    $('mic-btn').classList.remove('listening');
  };
});

// ─────────────────────────────────────────────
// SCALE BAR
// ─────────────────────────────────────────────
function updateScaleBar() {
  if (!State.map) return;
  const canvas = $('scale-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const zoom = State.map.getZoom();
  const center = State.map.getCenter();
  const metersPerPixel = 156543.03392 * Math.cos(center.lat * Math.PI / 180) / Math.pow(2, zoom);
  const maxWidth = 80;
  const maxMeters = maxWidth * metersPerPixel;
  let unit, scale;
  if (maxMeters >= 1000) {
    unit = 'km'; scale = Math.round(maxMeters / 1000) + ' km';
  } else {
    unit = 'm'; scale = Math.round(maxMeters) + ' m';
  }
  const barW = maxWidth;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(0, 10, barW, 4);
  ctx.fillStyle = '#4f8ef7';
  ctx.fillRect(0, 10, barW, 4);
  ctx.fillStyle = '#f0f3ff';
  ctx.font = '10px Inter';
  ctx.fillText(scale, 0, 24);
  canvas.setAttribute('title', scale);
}

// ─────────────────────────────────────────────
// MAP LONG PRESS (mobile)
// ─────────────────────────────────────────────
let longPressTimer;
$('map').addEventListener('touchstart', e => {
  longPressTimer = setTimeout(() => {
    const touch = e.touches[0];
    const point = State.map.containerPointToLatLng([touch.clientX, touch.clientY]);
    reverseGeocode(point.lat, point.lng, (name, addr) => {
      State.selectedPlace = { lat: point.lat, lng: point.lng, name, addr };
      showPlaceCard(name, addr, point.lat, point.lng);
      dropTempMarker(point.lat, point.lng, name);
    });
    showToast('📍 Long press detected');
  }, 700);
});
$('map').addEventListener('touchend', () => clearTimeout(longPressTimer));
$('map').addEventListener('touchmove', () => clearTimeout(longPressTimer));

// ─────────────────────────────────────────────
// KEYBOARD shortcut
// ─────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeAllPanels();
    hideEl($('search-results'));
  }
  if ((e.key === '/' || e.key === 's') && document.activeElement.tagName !== 'INPUT') {
    e.preventDefault();
    $('search-input').focus();
  }
});

// ─────────────────────────────────────────────
// MENU BTN (future sidebar)
// ─────────────────────────────────────────────
$('menu-btn').addEventListener('click', () => {
  showToast('🌐 KeeraMaps v1.0 – Navigate your world!');
});

// ─────────────────────────────────────────────
// HOME / WORK address editing
// ─────────────────────────────────────────────
function editAddress(key, el) {
  const val = prompt(`Enter your ${key} address:`);
  if (val !== null && val.trim()) {
    el.textContent = val.trim();
    localStorage.setItem(`km_${key}`, val.trim());
    showToast(`✅ ${key.charAt(0).toUpperCase() + key.slice(1)} address saved`);
  }
}
$('edit-home').addEventListener('click', () => {
  editAddress('home', $('home-addr'));
});
$('edit-work').addEventListener('click', () => {
  editAddress('work', $('work-addr'));
});

// Restore saved addresses on load
window.addEventListener('load', () => {
  const h = localStorage.getItem('km_home');
  const w = localStorage.getItem('km_work');
  if (h) $('home-addr').textContent = h;
  if (w) $('work-addr').textContent = w;
});

// ─────────────────────────────────────────────
// Place card: close on map click
// ─────────────────────────────────────────────
State.map && State.map.on('click', () => {
  // handled in onMapClick
});
