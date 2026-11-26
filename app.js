/* ============================================================
   Station Log — a small real-time weather lookup app
   Data sources: Open-Meteo Forecast, Geocoding & Air Quality APIs
   https://open-meteo.com/  (no API key required)
   ============================================================ */

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';

const FORECAST_DAYS = 10;

// WMO weather codes -> { icon, label }
// https://open-meteo.com/en/docs (see "WMO Weather interpretation codes")
const WEATHER_CODES = {
  0: { icon: '☀️', label: 'Clear sky' },
  1: { icon: '🌤️', label: 'Mostly clear' },
  2: { icon: '⛅', label: 'Partly cloudy' },
  3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫️', label: 'Fog' },
  48: { icon: '🌫️', label: 'Depositing rime fog' },
  51: { icon: '🌦️', label: 'Light drizzle' },
  53: { icon: '🌦️', label: 'Moderate drizzle' },
  55: { icon: '🌦️', label: 'Dense drizzle' },
  56: { icon: '🌧️', label: 'Light freezing drizzle' },
  57: { icon: '🌧️', label: 'Dense freezing drizzle' },
  61: { icon: '🌧️', label: 'Slight rain' },
  63: { icon: '🌧️', label: 'Moderate rain' },
  65: { icon: '🌧️', label: 'Heavy rain' },
  66: { icon: '🌧️', label: 'Light freezing rain' },
  67: { icon: '🌧️', label: 'Heavy freezing rain' },
  71: { icon: '🌨️', label: 'Slight snow' },
  73: { icon: '🌨️', label: 'Moderate snow' },
  75: { icon: '❄️', label: 'Heavy snow' },
  77: { icon: '❄️', label: 'Snow grains' },
  80: { icon: '🌦️', label: 'Slight rain showers' },
  81: { icon: '🌧️', label: 'Moderate rain showers' },
  82: { icon: '⛈️', label: 'Violent rain showers' },
  85: { icon: '🌨️', label: 'Slight snow showers' },
  86: { icon: '❄️', label: 'Heavy snow showers' },
  95: { icon: '⛈️', label: 'Thunderstorm' },
  96: { icon: '⛈️', label: 'Thunderstorm, slight hail' },
  99: { icon: '⛈️', label: 'Thunderstorm, heavy hail' },
};

function weatherInfo(code) {
  return WEATHER_CODES[code] || { icon: '🌡️', label: 'Unknown' };
}

function compassDirection(deg) {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

// US AQI breakpoints -> { label, cls }
// https://www.airnow.gov/aqi/aqi-basics/
function aqiCategory(v) {
  if (v == null || Number.isNaN(v)) return { label: '—', cls: 'unknown' };
  if (v <= 50) return { label: 'Good', cls: 'good' };
  if (v <= 100) return { label: 'Moderate', cls: 'moderate' };
  if (v <= 150) return { label: 'Unhealthy (sensitive)', cls: 'sensitive' };
  if (v <= 200) return { label: 'Unhealthy', cls: 'unhealthy' };
  if (v <= 300) return { label: 'Very unhealthy', cls: 'very-unhealthy' };
  return { label: 'Hazardous', cls: 'hazardous' };
}

function formatClockTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ------------------------------------------------------------
// State
// ------------------------------------------------------------
let currentUnit = 'c'; // 'c' | 'f'
let lastData = null;   // last successful fetch, so unit toggle can re-render without refetching
let suggestions = [];  // current geocoding suggestion list
let activeSuggestionIndex = -1;
let geocodeAbortController = null;

// ------------------------------------------------------------
// DOM refs
// ------------------------------------------------------------
const el = {
  form: document.getElementById('search-form'),
  input: document.getElementById('search-input'),
  suggestionsList: document.getElementById('suggestions'),
  geoBtn: document.getElementById('geo-btn'),
  unitBtns: document.querySelectorAll('.unit-btn'),
  statusLine: document.getElementById('status-line'),

  emptyState: document.getElementById('empty-state'),
  loadingState: document.getElementById('loading-state'),
  errorState: document.getElementById('error-state'),
  errorMessage: document.getElementById('error-message'),
  reading: document.getElementById('reading'),

  placeEyebrow: document.getElementById('place-eyebrow'),
  placeName: document.getElementById('place-name'),
  placeMeta: document.getElementById('place-meta'),
  readingUpdated: document.getElementById('reading-updated'),

  tempValue: document.getElementById('temp-value'),
  tempUnit: document.getElementById('temp-unit'),
  conditionIcon: document.getElementById('condition-icon'),
  conditionLabel: document.getElementById('condition-label'),
  feelsLike: document.getElementById('feels-like'),

  windSpeed: document.getElementById('wind-speed'),
  windDir: document.getElementById('wind-dir'),
  humidity: document.getElementById('humidity'),
  humiditySub: document.getElementById('humidity-sub'),
  pressure: document.getElementById('pressure'),
  pressureSub: document.getElementById('pressure-sub'),
  visibility: document.getElementById('visibility'),
  visibilitySub: document.getElementById('visibility-sub'),
  aqiValue: document.getElementById('aqi-value'),
  aqiSub: document.getElementById('aqi-sub'),
  sunrise: document.getElementById('sunrise-time'),
  sunset: document.getElementById('sunset-time'),

  hourlyScroll: document.getElementById('hourly-scroll'),
  dailyRows: document.getElementById('daily-rows'),

  barographPath: document.getElementById('barograph-path'),
  weatherFxCanvas: document.getElementById('weather-fx'),
};

// ------------------------------------------------------------
// Weather FX — ambient canvas animation inside the hero card,
// driven by the current WMO weather code + day/night.
// ------------------------------------------------------------
const fx = {
  canvas: el.weatherFxCanvas,
  ctx: el.weatherFxCanvas ? el.weatherFxCanvas.getContext('2d') : null,
  raf: null,
  particles: [],
  mode: null,
  isDay: true,
  width: 0,
  height: 0,
};

function fxResize() {
  if (!fx.canvas) return;
  const rect = fx.canvas.parentElement.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return; // hidden — skip, will resize once visible
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  fx.width = rect.width;
  fx.height = rect.height;
  fx.canvas.width = rect.width * dpr;
  fx.canvas.height = rect.height * dpr;
  fx.canvas.style.width = rect.width + 'px';
  fx.canvas.style.height = rect.height + 'px';
  fx.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function rand(a, b) { return a + Math.random() * (b - a); }

function weatherEffectFor(code, isDay) {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if ([95, 96, 99].includes(code)) return 'thunder';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'rain';
  return 'clear';
}

function rainIntensity(code) {
  if ([51, 56, 61, 66, 80].includes(code)) return 0.5;   // light
  if ([53, 63, 81].includes(code)) return 1;              // moderate
  return 1.6;                                              // heavy: 55,57,65,67,82
}

function buildParticles(mode, intensity) {
  const w = fx.width, h = fx.height;
  const arr = [];
  if (mode === 'rain') {
    const count = Math.round(36 * intensity);
    for (let i = 0; i < count; i++) {
      arr.push({ x: rand(0, w), y: rand(-h, h), len: rand(10, 20), speed: rand(5, 9) * intensity, drift: rand(-0.4, -0.1) });
    }
  } else if (mode === 'snow') {
    const count = 34;
    for (let i = 0; i < count; i++) {
      arr.push({ x: rand(0, w), y: rand(-h, h), r: rand(1.4, 3.2), speed: rand(0.5, 1.4), sway: rand(0.6, 1.6), phase: rand(0, Math.PI * 2) });
    }
  } else if (mode === 'cloudy' || mode === 'overcast') {
    const count = mode === 'overcast' ? 5 : 3;
    for (let i = 0; i < count; i++) {
      arr.push({ x: rand(0, w), y: rand(h * 0.1, h * 0.55), scale: rand(0.7, 1.3), speed: rand(4, 9), opacity: rand(0.08, 0.16) });
    }
  } else if (mode === 'fog') {
    const count = 4;
    for (let i = 0; i < count; i++) {
      arr.push({ y: (i / count) * h + rand(-10, 10), speed: rand(5, 10), phase: rand(0, Math.PI * 2), dir: i % 2 === 0 ? 1 : -1 });
    }
  } else if (mode === 'clear' && fx.isDay) {
    for (let i = 0; i < 10; i++) {
      arr.push({ x: rand(0, w), y: rand(0, h), r: rand(0.6, 1.6), speed: rand(3, 7), phase: rand(0, Math.PI * 2) });
    }
  } else if (mode === 'clear' && !fx.isDay) {
    for (let i = 0; i < 40; i++) {
      arr.push({ x: rand(0, w), y: rand(0, h * 0.8), r: rand(0.5, 1.4), phase: rand(0, Math.PI * 2), speed: rand(0.8, 2) });
    }
  }
  return arr;
}

function setWeatherEffect(code, isDayFlag) {
  if (!fx.ctx) return;
  fxResize();
  const isDay = isDayFlag === 1 || isDayFlag === true;
  const mode = weatherEffectFor(code, isDay);
  const intensity = mode === 'rain' ? rainIntensity(code) : 1;

  fx.mode = mode;
  fx.isDay = isDay;
  fx.intensity = intensity;
  fx.particles = buildParticles(mode, intensity);
  fx.flashUntil = 0;
  fx.nextFlash = performance.now() + rand(2500, 6000);

  if (!fx.raf) fx.raf = requestAnimationFrame(fxTick);
}

function fxDrawSun() {
  const ctx = fx.ctx, w = fx.width, h = fx.height;
  const cx = w * 0.86, cy = h * 0.2, r = Math.min(w, h) * 0.16;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.6);
  grad.addColorStop(0, 'rgba(242,169,59,0.28)');
  grad.addColorStop(1, 'rgba(242,169,59,0)');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(242,169,59,0.55)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
}

function fxDrawCloud(p, mode) {
  const ctx = fx.ctx;
  const baseColor = mode === 'overcast' ? '140,160,190' : '233,237,243';
  ctx.fillStyle = `rgba(${baseColor},${p.opacity})`;
  const puffs = [[0, 0, 1], [0.6, -0.15, 0.8], [1.15, 0.05, 0.7], [-0.55, 0.1, 0.7]];
  puffs.forEach(([dx, dy, s]) => {
    ctx.beginPath();
    ctx.arc(p.x + dx * 46 * p.scale, p.y + dy * 46 * p.scale, 26 * p.scale * s, 0, Math.PI * 2);
    ctx.fill();
  });
}

function fxTick(now) {
  const ctx = fx.ctx;
  if (!ctx || !fx.width || !fx.height) { fx.raf = requestAnimationFrame(fxTick); return; }
  ctx.clearRect(0, 0, fx.width, fx.height);
  const w = fx.width, h = fx.height;

  if (fx.mode === 'clear' && fx.isDay) {
    fxDrawSun();
    ctx.fillStyle = 'rgba(233,237,243,0.5)';
    fx.particles.forEach((p) => {
      p.y -= p.speed / 60;
      if (p.y < -5) p.y = h + 5;
      const flicker = 0.4 + Math.sin(now / 500 + p.phase) * 0.3;
      ctx.globalAlpha = flicker;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  } else if (fx.mode === 'clear' && !fx.isDay) {
    ctx.fillStyle = 'rgba(233,237,243,0.9)';
    fx.particles.forEach((p) => {
      const twinkle = 0.25 + Math.abs(Math.sin(now / 900 + p.phase)) * 0.6;
      ctx.globalAlpha = twinkle;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  } else if (fx.mode === 'cloudy' || fx.mode === 'overcast') {
    fx.particles.forEach((p) => {
      p.x += p.speed / 60;
      if (p.x - 70 > w) p.x = -70;
      fxDrawCloud(p, fx.mode);
    });
  } else if (fx.mode === 'fog') {
    fx.particles.forEach((p) => {
      const offset = Math.sin(now / 1400 + p.phase) * 30 * p.dir;
      const grad = ctx.createLinearGradient(0, p.y, w, p.y);
      grad.addColorStop(0, 'rgba(140,160,190,0)');
      grad.addColorStop(0.5 + offset / 400, 'rgba(140,160,190,0.14)');
      grad.addColorStop(1, 'rgba(140,160,190,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, p.y - 14, w, 28);
    });
  } else if (fx.mode === 'rain' || fx.mode === 'thunder') {
    ctx.strokeStyle = 'rgba(63,167,150,0.5)';
    ctx.lineWidth = 1.3;
    fx.particles.forEach((p) => {
      p.y += p.speed;
      p.x += p.drift;
      if (p.y > h) { p.y = -p.len; p.x = rand(0, w); }
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.drift * 3, p.y + p.len);
      ctx.stroke();
    });
    if (fx.mode === 'thunder') {
      if (now > fx.nextFlash) {
        fx.flashUntil = now + rand(70, 140);
        fx.nextFlash = now + rand(3000, 7000);
      }
      if (now < fx.flashUntil) {
        ctx.fillStyle = 'rgba(233,237,243,0.18)';
        ctx.fillRect(0, 0, w, h);
      }
    }
  } else if (fx.mode === 'snow') {
    ctx.fillStyle = 'rgba(233,237,243,0.85)';
    fx.particles.forEach((p) => {
      p.y += p.speed;
      const x = p.x + Math.sin(now / 700 * p.sway + p.phase) * 10;
      if (p.y > h) { p.y = -5; p.x = rand(0, w); }
      ctx.beginPath();
      ctx.arc(x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  fx.raf = requestAnimationFrame(fxTick);
}

window.addEventListener('resize', debounce(fxResize, 150));


function showState(state) {
  el.emptyState.hidden = state !== 'empty';
  el.loadingState.hidden = state !== 'loading';
  el.errorState.hidden = state !== 'error';
  el.reading.hidden = state !== 'reading';
}

function setStatus(text) {
  el.statusLine.textContent = text;
}

// ------------------------------------------------------------
// Unit conversion
// ------------------------------------------------------------
function cToF(c) { return (c * 9) / 5 + 32; }
function formatTemp(celsius) {
  const v = currentUnit === 'c' ? celsius : cToF(celsius);
  return Math.round(v);
}

// ------------------------------------------------------------
// Fetching
// ------------------------------------------------------------
async function geocode(query) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=1&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding request failed.');
  const data = await res.json();
  if (!data.results || data.results.length === 0) {
    throw new Error(`No location found for "${query}". Check the spelling and try again.`);
  }
  return data.results[0];
}

async function geocodeSuggestions(query, signal) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=6&language=en&format=json`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Geocoding request failed.');
  const data = await res.json();
  return data.results || [];
}

async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: [
      'temperature_2m', 'relative_humidity_2m', 'apparent_temperature',
      'weather_code', 'wind_speed_10m', 'wind_direction_10m',
      'surface_pressure', 'is_day'
    ].join(','),
    hourly: ['temperature_2m', 'weather_code', 'visibility'].join(','),
    daily: [
      'weather_code', 'temperature_2m_max', 'temperature_2m_min',
      'uv_index_max', 'sunrise', 'sunset'
    ].join(','),
    timezone: 'auto',
    forecast_days: FORECAST_DAYS,
  });
  const res = await fetch(`${FORECAST_URL}?${params.toString()}`);
  if (!res.ok) throw new Error('Weather request failed.');
  return res.json();
}

async function fetchAirQuality(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: 'us_aqi',
    timezone: 'auto',
  });
  try {
    const res = await fetch(`${AIR_QUALITY_URL}?${params.toString()}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    // AQI is a bonus reading — never fail the whole lookup if it's unavailable
    return null;
  }
}

async function fetchAll(lat, lon) {
  const [weather, airQuality] = await Promise.all([
    fetchForecast(lat, lon),
    fetchAirQuality(lat, lon),
  ]);
  return { weather, airQuality };
}

async function runLookup(place) {
  showState('loading');
  setStatus(`Taking a reading for ${place.name}…`);
  try {
    const { weather, airQuality } = await fetchAll(place.latitude, place.longitude);
    lastData = { place, weather, airQuality };
    showState('reading');
    render(lastData);
    const bits = [place.admin1, place.country].filter(Boolean);
    setStatus(`Logged ${place.name}${bits.length ? ', ' + bits.join(', ') : ''}.`);
  } catch (err) {
    showState('error');
    el.errorMessage.textContent = err.message || 'Something went wrong. Try again.';
    setStatus('Reading failed.');
  }
}

async function lookup(query) {
  showState('loading');
  setStatus(`Searching for "${query}"…`);
  try {
    const place = await geocode(query);
    await runLookup(place);
  } catch (err) {
    showState('error');
    el.errorMessage.textContent = err.message || 'Something went wrong. Try again.';
    setStatus('Reading failed.');
  }
}

async function reverseGeocode(lat, lon) {
  const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=en`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    return {
      name: data.city || data.locality || 'Current location',
      admin1: data.principalSubdivision || '',
      country: data.countryName || '',
      country_code: data.countryCode || '',
    };
  } catch {
    return null; // reverse lookup is a nice-to-have — never block the weather reading on it
  }
}

async function lookupByCoords(lat, lon) {
  showState('loading');
  setStatus('Reading your location…');
  try {
    const [{ weather, airQuality }, resolvedPlace] = await Promise.all([
      fetchAll(lat, lon),
      reverseGeocode(lat, lon),
    ]);
    const place = resolvedPlace || { name: 'Current location', admin1: '', country: '' };
    lastData = { place, weather, airQuality };
    showState('reading');
    render(lastData);
    const bits = [place.admin1, place.country].filter(Boolean);
    setStatus(`Logged ${place.name}${bits.length ? ', ' + bits.join(', ') : ''}.`);
  } catch (err) {
    showState('error');
    el.errorMessage.textContent = err.message || 'Could not read weather for your location.';
    setStatus('Reading failed.');
  }
}

// ------------------------------------------------------------
// Search suggestions (autocomplete)
// ------------------------------------------------------------
function placeSubtitle(place) {
  return [place.admin1, place.country].filter(Boolean).join(', ');
}

function renderSuggestions(list) {
  suggestions = list;
  activeSuggestionIndex = -1;
  el.suggestionsList.innerHTML = '';

  if (!list.length) {
    el.suggestionsList.hidden = true;
    return;
  }

  list.forEach((place, i) => {
    const li = document.createElement('li');
    li.className = 'suggestion';
    li.setAttribute('role', 'option');
    li.dataset.index = i;
    li.innerHTML = `
      <span class="suggestion__name">${place.name}</span>
      <span class="suggestion__meta">${placeSubtitle(place) || '—'}</span>
    `;
    li.addEventListener('mousedown', (e) => {
      // mousedown (not click) so it fires before the input's blur event closes the list
      e.preventDefault();
      selectSuggestion(place);
    });
    el.suggestionsList.appendChild(li);
  });

  el.suggestionsList.hidden = false;
}

function closeSuggestions() {
  el.suggestionsList.hidden = true;
  suggestions = [];
  activeSuggestionIndex = -1;
}

function selectSuggestion(place) {
  el.input.value = `${place.name}${place.admin1 ? ', ' + place.admin1 : ''}, ${place.country || ''}`.replace(/,\s*$/, '');
  closeSuggestions();
  runLookup(place);
}

function highlightSuggestion(index) {
  const items = el.suggestionsList.querySelectorAll('.suggestion');
  items.forEach((item, i) => item.classList.toggle('is-active', i === index));
  activeSuggestionIndex = index;
}

const debouncedSuggest = debounce(async (query) => {
  if (geocodeAbortController) geocodeAbortController.abort();
  geocodeAbortController = new AbortController();
  try {
    const results = await geocodeSuggestions(query, geocodeAbortController.signal);
    renderSuggestions(results);
  } catch (err) {
    if (err.name !== 'AbortError') closeSuggestions();
  }
}, 300);

// ------------------------------------------------------------
// Rendering
// ------------------------------------------------------------
function render(data) {
  const { place, weather, airQuality } = data;
  const cur = weather.current;
  const info = weatherInfo(cur.weather_code);
  const todayIdx = 0;

  // Header
  el.placeEyebrow.textContent = `STN // ${(place.country_code || '').toUpperCase() || '—'}`;
  el.placeName.textContent = place.name;
  const metaBits = [place.admin1, place.country].filter(Boolean);
  el.placeMeta.textContent = metaBits.length ? metaBits.join(', ') : '—';

  const now = new Date();
  el.readingUpdated.textContent = `Updated ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // Hero
  el.tempValue.textContent = formatTemp(cur.temperature_2m);
  el.tempUnit.textContent = currentUnit === 'c' ? '°C' : '°F';
  el.conditionIcon.textContent = info.icon;
  el.conditionLabel.textContent = info.label;
  el.feelsLike.textContent = `${formatTemp(cur.apparent_temperature)}°${currentUnit.toUpperCase()}`;

  // Instruments — wind / humidity / pressure / visibility
  el.windSpeed.textContent = Math.round(cur.wind_speed_10m);
  el.windDir.textContent = `from ${compassDirection(cur.wind_direction_10m)}`;
  el.humidity.textContent = Math.round(cur.relative_humidity_2m);
  el.humiditySub.textContent = cur.relative_humidity_2m > 70 ? 'Humid' : cur.relative_humidity_2m < 30 ? 'Dry' : 'Comfortable';
  el.pressure.textContent = Math.round(cur.surface_pressure);
  el.pressureSub.textContent = cur.surface_pressure >= 1013 ? 'High pressure' : 'Low pressure';

  const visKm = weather.hourly.visibility ? (weather.hourly.visibility[currentHourIndex(weather)] / 1000) : null;
  el.visibility.textContent = visKm != null ? visKm.toFixed(1) : '—';
  el.visibilitySub.textContent = visKm == null ? '—' : visKm >= 10 ? 'Clear' : visKm >= 4 ? 'Moderate' : 'Poor';

  // Air quality
  const aqi = airQuality && airQuality.current ? airQuality.current.us_aqi : null;
  const cat = aqiCategory(aqi);
  el.aqiValue.textContent = aqi != null ? Math.round(aqi) : '—';
  el.aqiValue.parentElement.dataset.aqi = cat.cls;
  el.aqiSub.textContent = aqi != null ? cat.label : 'Unavailable';

  // Sunrise / sunset
  el.sunrise.textContent = formatClockTime(weather.daily.sunrise ? weather.daily.sunrise[todayIdx] : null);
  el.sunset.textContent = formatClockTime(weather.daily.sunset ? weather.daily.sunset[todayIdx] : null);

  // Hourly strip (next 24h from now)
  renderHourly(weather);

  // Daily rows
  renderDaily(weather);

  // Barograph trace, driven by next ~24h temps
  renderBarograph(weather);

  // Ambient animation matching the current weather condition
  setWeatherEffect(cur.weather_code, cur.is_day);
}

function currentHourIndex(weather) {
  const nowISO = weather.current.time;
  let idx = weather.hourly.time.indexOf(nowISO);
  if (idx === -1) idx = 0;
  return idx;
}

function renderHourly(weather) {
  const startIdx = currentHourIndex(weather);
  const slice = 24;
  el.hourlyScroll.innerHTML = '';
  for (let i = startIdx; i < Math.min(startIdx + slice, weather.hourly.time.length); i++) {
    const t = new Date(weather.hourly.time[i]);
    const info = weatherInfo(weather.hourly.weather_code[i]);
    const card = document.createElement('div');
    card.className = 'hour-card';
    card.innerHTML = `
      <p class="hour-card__time">${i === startIdx ? 'Now' : t.toLocaleTimeString([], { hour: 'numeric' })}</p>
      <p class="hour-card__icon">${info.icon}</p>
      <p class="hour-card__temp">${formatTemp(weather.hourly.temperature_2m[i])}°</p>
    `;
    el.hourlyScroll.appendChild(card);
  }
}

function renderDaily(weather) {
  el.dailyRows.innerHTML = '';
  const days = weather.daily.time;
  days.forEach((d, i) => {
    const date = new Date(d + 'T00:00:00');
    const label = i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short' });
    const info = weatherInfo(weather.daily.weather_code[i]);
    const row = document.createElement('div');
    row.className = 'day-row';
    row.innerHTML = `
      <span class="day-row__name">${label}</span>
      <span class="day-row__icon">${info.icon}</span>
      <span class="day-row__cond">${info.label}</span>
      <span class="day-row__range"><span class="hi">${formatTemp(weather.daily.temperature_2m_max[i])}°</span> / <span class="lo">${formatTemp(weather.daily.temperature_2m_min[i])}°</span></span>
    `;
    el.dailyRows.appendChild(row);
  });
}

function renderBarograph(weather) {
  const startIdx = currentHourIndex(weather);
  const temps = weather.hourly.temperature_2m.slice(startIdx, startIdx + 24);
  if (temps.length < 2) return;

  const w = 600, h = 220, pad = 20;
  const min = Math.min(...temps);
  const max = Math.max(...temps);
  const range = max - min || 1;

  const points = temps.map((t, i) => {
    const x = (i / (temps.length - 1)) * w;
    const y = h - pad - ((t - min) / range) * (h - pad * 2);
    return [x, y];
  });

  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length; i++) {
    const [px, py] = points[i - 1];
    const [cx, cy] = points[i];
    const mx = (px + cx) / 2;
    d += ` Q ${px} ${py} ${mx} ${(py + cy) / 2}`;
  }
  d += ` T ${points[points.length - 1][0]} ${points[points.length - 1][1]}`;

  el.barographPath.setAttribute('d', d);
  // restart draw animation
  el.barographPath.style.animation = 'none';
  void el.barographPath.offsetWidth;
  el.barographPath.style.animation = '';
}

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------
el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (activeSuggestionIndex >= 0 && suggestions[activeSuggestionIndex]) {
    selectSuggestion(suggestions[activeSuggestionIndex]);
    return;
  }
  const q = el.input.value.trim();
  if (q) {
    closeSuggestions();
    lookup(q);
  }
});

el.input.addEventListener('input', () => {
  const q = el.input.value.trim();
  if (q.length < 2) {
    closeSuggestions();
    return;
  }
  debouncedSuggest(q);
});

el.input.addEventListener('keydown', (e) => {
  if (el.suggestionsList.hidden || !suggestions.length) return;
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    highlightSuggestion(Math.min(activeSuggestionIndex + 1, suggestions.length - 1));
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    highlightSuggestion(Math.max(activeSuggestionIndex - 1, 0));
  } else if (e.key === 'Escape') {
    closeSuggestions();
  }
});

el.input.addEventListener('blur', () => {
  // slight delay so a mousedown-selected suggestion still registers
  setTimeout(closeSuggestions, 100);
});

document.querySelectorAll('[data-quick]').forEach((btn) => {
  btn.addEventListener('click', () => {
    el.input.value = btn.dataset.quick;
    closeSuggestions();
    lookup(btn.dataset.quick);
  });
});

el.geoBtn.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showState('error');
    el.errorMessage.textContent = 'Geolocation is not supported in this browser.';
    return;
  }
  showState('loading');
  setStatus('Requesting location permission…');
  navigator.geolocation.getCurrentPosition(
    (pos) => lookupByCoords(pos.coords.latitude, pos.coords.longitude),
    () => {
      showState('error');
      el.errorMessage.textContent = 'Location permission denied. Try searching for a city instead.';
      setStatus('Reading failed.');
    }
  );
});

el.unitBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    currentUnit = btn.dataset.unit;
    el.unitBtns.forEach((b) => b.classList.toggle('is-active', b === btn));
    if (lastData) render(lastData);
  });
});

// ------------------------------------------------------------
// Auto-load: try the visitor's location on open, so the page
// isn't sitting on an empty state by default. Falls back to
// the empty state quietly (no error banner) if permission is
// denied, unavailable, or the browser doesn't respond in time.
// ------------------------------------------------------------
function initialLoad() {
  if (!navigator.geolocation) {
    showState('empty');
    return;
  }
  showState('loading');
  setStatus('Getting a reading for your location…');

  let settled = false;
  const fallback = setTimeout(() => {
    if (settled) return;
    settled = true;
    showState('empty');
    setStatus('No station selected — search a city, or use your location, to begin logging.');
  }, 9000);

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      lookupByCoords(pos.coords.latitude, pos.coords.longitude);
    },
    () => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      showState('empty');
      setStatus('No station selected — search a city, or use your location, to begin logging.');
    },
    { timeout: 8000, maximumAge: 10 * 60 * 1000 }
  );
}

initialLoad();
