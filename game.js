(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('world-map');
  const ctx = canvas.getContext('2d');
  const mapFrame = $('map-frame');
  const STORE_KEY = 'worldcraft-save-v1';
  const seasons = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
  const units = [
    { id: 'infantry', name: 'Infantry brigade', icon: '♟', cost: 0.8, power: 2, description: 'Versatile ground presence', qty: 1000 },
    { id: 'armor', name: 'Armored group', icon: '▰', cost: 2.4, power: 7, description: 'Heavy ground formation', qty: 120 },
    { id: 'air', name: 'Air wing', icon: '✈', cost: 3.2, power: 8, description: 'Rapid-response air support', qty: 24 },
    { id: 'artillery', name: 'Artillery group', icon: '◉', cost: 1.6, power: 5, description: 'Long-range support unit', qty: 36 }
  ];
  const fallbackUSA = {
    type: 'Feature', properties: { name: 'United States', iso: 'US', pop: 331002651, gdp: 20936600, lon: -98.58, lat: 39.83, continent: 'North America' },
    geometry: { type: 'Polygon', coordinates: [[[-124.7,48.4],[-122.8,48.2],[-123.1,46.2],[-124.2,42.0],[-122.9,41.0],[-123.0,39.0],[-121.5,37.5],[-119.5,36.0],[-117.1,33.0],[-114.7,32.7],[-111.0,31.3],[-108.2,31.3],[-106.5,31.8],[-104.5,29.6],[-102.8,29.0],[-101.4,29.8],[-100.0,29.3],[-97.1,25.9],[-96.0,28.0],[-93.8,29.8],[-90.0,29.2],[-88.0,30.3],[-85.0,30.2],[-82.0,IY],[-81.0,25.2],[-80.0,28.5],[-80.5,30.7],[-81.0,32.3],[-79.0,34.8],[-77.0,35.5],[-75.5,38.0],[-74.0,40.0],[-72.0,41.5],[-69.9,43.0],[-70.7,45.0],[-73.3,45.0],[-75.0,44.8],[-77.0,43.6],[-79.8,43.0],[-82.7,41.7],[-84.8,41.7],[-86.8,42.0],[-88.0,46.0],[-90.5,46.7],[-92.0,46.7],[-94.8,49.0],[-97.2,49.0],[-101.4,49.0],[-104.0,49.0],[-107.0,49.0],[-110.0,49.0],[-114.0,49.0],[-117.0,49.0],[-120.0,49.0],[-122.8,49.0],[-124.7,48.4]]] }
  };
  let features = [];
  let countries = [];
  let pathEntries = [];
  let hovered = null;
  let selected = null;
  let player = null;
  let state = null;
  let scale = 1;
  let offset = { x: 0, y: 0 };
  let drag = null;
  let feedIndex = 0;
  let saveTimer;
  const flagEmoji = (iso) => {
    if (!iso || iso.length !== 2) return iso === 'CN-TW' ? '🇹🇼' : '🏳️';
    return [...iso.toUpperCase()].map(c => String.fromCodePoint(c.charCodeAt(0) + 127397)).join('');
  };
  const number = (n) => new Intl.NumberFormat('en-US').format(Math.round(n));
  const money = (n) => '$' + (n >= 1000 ? (n / 1000).toFixed(1) + 'T' : n.toFixed(1) + 'B');
  const short = (n) => n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : number(n);
  const cleanName = (name) => ({ 'United Republic of Tanzania': 'Tanzania', 'Democratic Republic of the Congo': 'DR Congo', 'Republic of the Congo': 'Congo', 'Czechia': 'Czechia' }[name] || name);
  function blankState() {
    return { playerIso: 'US', treasury: 200, turn: 1, units: {}, relations: {}, readiness: {}, claims: {}, feed: ['Your government has received an opening treasury of $200 billion.'], selectedIso: 'CA' };
  }
  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && saved.playerIso && Number.isFinite(saved.treasury)) return { ...blankState(), ...saved };
    } catch (e) { console.warn('Could not load save:', e); }
    return blankState();
  }
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { console.warn('Save unavailable:', e); }
    }, 80);
  }
  function coordsOf(feature) {
    const g = feature.geometry;
    if (!g) return [];
    return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  }
  function estimateArea(feature) {
    const known = { US: 9834000, CA: 9985000, CN: 9597000, IN: 3287000, RU: 17098200, BR: 8516000, AU: 7692000 };
    if (known[feature.properties.iso]) return known[feature.properties.iso];
    let area = 0;
    const R = 6371;
    for (const polygon of coordsOf(feature)) for (let r = 0; r < polygon.length; r++) {
      const ring = polygon[r]; let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        sum += (b[0] - a[0]) * Math.PI / 180 * (2 + Math.sin(a[1] * Math.PI / 180) + Math.sin(b[1] * Math.PI / 180));
      }
      const ringArea = Math.abs(sum * R * R / 2);
      area += r === 0 ? ringArea : -ringArea;
    }
    return Math.max(100, Math.round(area));
  }
  function prepareCountries(geo) {
    features = geo.features || [];
    if (!features.some(f => f.properties.iso === 'US')) features.push(fallbackUSA);
    const gdpMax = Math.max(...features.map(f => +f.properties.gdp || 0));
    const popMax = Math.max(...features.map(f => +f.properties.pop || 0));
    countries = features.map(f => {
      const p = f.properties;
      const gdp = Math.max(1, +p.gdp || 1), pop = Math.max(1, +p.pop || 1);
      const power = Math.round((0.62 * Math.sqrt(gdp / gdpMax) + 0.38 * Math.sqrt(pop / popMax)) * 100);
      return { feature: f, iso: p.iso || p.name.slice(0, 2).toUpperCase(), name: cleanName(p.name), continent: p.continent || 'World', pop, gdp, power, area: estimateArea(f) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    const rank = [...countries].sort((a, b) => b.power - a.power);
    countries.forEach(c => c.rank = rank.indexOf(c) + 1);
    $('country-count').textContent = countries.length;
    player = countries.find(c => c.iso === state.playerIso) || countries.find(c => c.iso === 'US') || countries[0];
    if (!countries.some(c => c.iso === state.playerIso)) state.playerIso = player.iso;
    selected = countries.find(c => c.iso === state.selectedIso) || countries.find(c => c.iso !== player.iso) || player;
  }
  function pathFor(feature) {
    const path = new Path2D();
    const project = (point) => {
      const [lon, lat] = point;
      return [(lon + 180) / 360 * canvas.width, (85 - lat) / 170 * canvas.height];
    };
    for (const polygon of coordsOf(feature)) for (const ring of polygon) {
      if (!ring.length) continue;
      const first = project(ring[0]); path.moveTo(first[0], first[1]);
      for (let i = 1; i < ring.length; i++) { const p = project(ring[i]); path.lineTo(p[0], p[1]); }
      path.closePath();
    }
    return path;
  }
