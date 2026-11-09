(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const canvas = $('world-map');
  const ctx = canvas.getContext('2d');
  const mapFrame = $('map-frame');
  const STORE_KEY = 'worldcraft-save-v1';
  const UNIT_TYPES = [
    { id: 'guard', name: 'Peacekeepers', icon: '⬡', cost: 8, strength: 8, upkeep: 1.2, desc: 'Stability & defense' },
    { id: 'fleet', name: 'Relief fleet', icon: '◈', cost: 18, strength: 16, upkeep: 2.4, desc: 'Long-range presence' },
    { id: 'wing', name: 'Air wing', icon: '✦', cost: 24, strength: 22, upkeep: 3.2, desc: 'Rapid response' },
    { id: 'corps', name: 'Field corps', icon: '⬟', cost: 32, strength: 30, upkeep: 4.5, desc: 'Ground operations' }
  ];
  const SEASONS = ['SPRING', 'SUMMER', 'AUTUMN', 'WINTER'];
  let countries = [];
  let state;
  let player;
  let selected;
  let scale = 1;
  let offset = { x: 0, y: 0 };
  let mapWidth = 0;
  let mapHeight = 0;
  let drag = null;
  let toastTimer;
  let dispatchIndex = 0;

  const blankState = () => ({
    playerIso: 'US', selectedIso: 'CA', turn: 1, treasury: 200, influence: 1240,
    units: {}, allies: [], wars: {}, occupied: {}, relations: {}, customDesigns: [],
    feed: ['Your government has received an opening treasury of $200 billion.'],
    lastIncome: 0
  });
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = (value) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  const money = (value) => `$${Number(value).toFixed(1)}B`;
  const flagEmoji = (iso) => {
    if (!iso || iso.length !== 2) return '🏳️';
    return String.fromCodePoint(...iso.toUpperCase().split('').map((letter) => 127397 + letter.charCodeAt(0)));
  };
  const keyOf = (iso) => String(iso || '').toUpperCase();
  const getRelation = (iso) => state.relations[keyOf(iso)] || 0;
  const addFeed = (message) => {
    state.feed.unshift(message);
    state.feed = state.feed.slice(0, 12);
    renderFeed();
  };
  const showToast = (message) => {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  };
  const persist = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (_) { /* storage may be unavailable */ }
  };
  const validState = (saved) => saved && countries.some((country) => country.iso === saved.playerIso);
  const loadState = () => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (validState(saved)) return { ...blankState(), ...saved, wars: saved.wars || {}, units: saved.units || {}, allies: saved.allies || [], occupied: saved.occupied || {}, relations: saved.relations || {}, customDesigns: saved.customDesigns || [], feed: saved.feed || [] };
    } catch (_) { /* start a clean game if the save is unreadable */ }
    return blankState();
  };
  const countryPower = (country) => {
    const gdp = Math.max(1, country.gdp);
    const population = Math.max(1, country.pop);
    return Math.max(8, Math.min(100, Math.round(4 + Math.log10(gdp + 1) * 8 + Math.sqrt(population / 1e6) * 1.6)));
  };
  function approximateArea(geometry) {
    const radius = 6371;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    let area = 0;
    polygons.forEach((polygon) => polygon.forEach((ring, ringIndex) => {
      let sum = 0;
      for (let i = 0; i < ring.length; i++) {
        const [lon1, lat1] = ring[i];
        const [lon2, lat2] = ring[(i + 1) % ring.length];
        sum += (lon2 - lon1) * Math.PI / 180 * (2 + Math.sin(lat1 * Math.PI / 180) + Math.sin(lat2 * Math.PI / 180));
      }
      const ringArea = Math.abs(sum * radius * radius / 2);
      area += ringIndex === 0 ? ringArea : -ringArea;
    }));
    return Math.max(0, area);
  }
  const formatPopulation = (value) => value >= 1e9 ? `${(value / 1e9).toFixed(2)}B` : value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : `${number(value)}`;
  const formatGDP = (value) => value >= 1e6 ? `$${(value / 1e6).toFixed(1)}T` : `$${(value / 1e3).toFixed(1)}B`;
  const formatArea = (country) => country.area ? `${(country.area / 1e6).toFixed(2)}M` : '—';

  function project(lon, lat) {
    const unit = Math.min(mapWidth / 360, mapHeight / 170);
    return { x: mapWidth / 2 + lon * unit, y: mapHeight / 2 - Math.max(-85, Math.min(85, lat)) * unit };
  }
  function pathForGeometry(geometry) {
    const path = new Path2D();
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    polygons.forEach((polygon) => polygon.forEach((ring) => {
      ring.forEach(([lon, lat], index) => {
        const point = project(lon, lat);
        if (index === 0) path.moveTo(point.x, point.y); else path.lineTo(point.x, point.y);
      });
      path.closePath();
    }));
    return path;
  }
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    mapWidth = rect.width;
    mapHeight = rect.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    countries.forEach((country) => { country.path = pathForGeometry(country.feature.geometry); });
    drawMap();
  }
  function drawMap() {
    if (!mapWidth || !mapHeight) return;
    const dpr = canvas.width / mapWidth;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, mapWidth, mapHeight);
    ctx.fillStyle = '#eaf0e8';
    ctx.fillRect(0, 0, mapWidth, mapHeight);
    ctx.save();
    ctx.translate(mapWidth / 2 + offset.x, mapHeight / 2 + offset.y);
    ctx.scale(scale, scale);
    ctx.translate(-mapWidth / 2, -mapHeight / 2);
    ctx.strokeStyle = '#d7e1d5';
    ctx.lineWidth = .65;
    for (let lon = -150; lon <= 150; lon += 30) {
      const a = project(lon, -80), b = project(lon, 80);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      const a = project(-180, lat), b = project(180, lat);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    countries.forEach((country) => {
      if (!country.path) return;
      const iso = country.iso;
      let fill = '#cad6c9';
      if (iso === player.iso) fill = '#a9ce79';
      else if (state.wars[iso]) fill = '#df9589';
      else if (state.allies.includes(iso)) fill = '#81b8a7';
      else if (state.occupied[iso]) fill = '#c9ab70';
      ctx.fillStyle = fill;
      ctx.strokeStyle = '#f5f7f3';
      ctx.lineWidth = .7;
      ctx.fill(country.path, 'evenodd');
      ctx.stroke(country.path);
      if (iso === selected?.iso) {
        ctx.strokeStyle = '#315f3d'; ctx.lineWidth = 1.6; ctx.stroke(country.path);
      }
    });
    ctx.restore();
  }
  function mapPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, worldX: (x - mapWidth / 2 - offset.x) / scale + mapWidth / 2, worldY: (y - mapHeight / 2 - offset.y) / scale + mapHeight / 2 };
  }
  function countryAt(x, y) {
    for (let i = countries.length - 1; i >= 0; i--) if (countries[i].path && ctx.isPointInPath(countries[i].path, x, y, 'evenodd')) return countries[i];
    return null;
  }
  function setSelected(country) {
    if (!country) return;
    selected = country;
    state.selectedIso = country.iso;
    document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === 'country'));
    document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.toggle('active', panel.id === 'tab-country'));
    render(); persist();
  }
  function showTooltip(country, event) {
    const tip = $('map-tooltip');
    if (!country) { tip.classList.remove('visible'); return; }
    tip.innerHTML = `<b>${flagEmoji(country.iso)} ${escapeHtml(country.name)}</b><span>${escapeHtml(country.continent)} · Power ${country.power}/100</span>`;
    const rect = mapFrame.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(rect.width - 190, event.clientX - rect.left + 13))}px`;
    tip.style.top = `${Math.max(8, Math.min(rect.height - 60, event.clientY - rect.top + 13))}px`;
    tip.classList.add('visible');
  }
  function zoomBy(factor) {
    const old = scale;
    scale = Math.max(1, Math.min(5, scale * factor));
    if (scale === 1) offset = { x: 0, y: 0 };
    else if (old !== scale) { offset.x *= scale / old; offset.y *= scale / old; }
    drawMap();
  }
  function focusCountry(country) {
    if (!country) return;
    scale = Math.max(scale, 2.2);
    const point = project(+country.feature.properties.lon || 0, +country.feature.properties.lat || 0);
    offset = { x: -scale * (point.x - mapWidth / 2), y: -scale * (point.y - mapHeight / 2) };
    drawMap();
  }

  function renderFeed() {
    $('feed').innerHTML = (state.feed.length ? state.feed : ['Your government is ready to shape the world.']).slice(0, 4).map((item, index) => `<span class="dispatch"><b>${String(Math.max(1, state.turn - index)).padStart(2, '0')}</b> ${escapeHtml(item)}</span>`).join('');
  }
  function unitCount() { return Object.values(state.units).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0); }
  function unitStrength() {
    return UNIT_TYPES.reduce((sum, type) => sum + (Number(state.units[type.id]) || 0) * type.strength, 0) + state.customDesigns.reduce((sum, design) => sum + design.strength, 0);
  }
  function totalUpkeep() { return UNIT_TYPES.reduce((sum, type) => sum + (Number(state.units[type.id]) || 0) * type.upkeep, 0); }
  function renderUnits() {
    $('unit-list').innerHTML = UNIT_TYPES.map((type) => `<article class="unit-card"><span class="unit-icon">${type.icon}</span><div class="unit-info"><strong>${type.name}</strong><small>${type.desc} · ${type.strength} strength</small></div><button class="unit-buy" data-unit="${type.id}" type="button">RECRUIT <b>${money(type.cost)}</b></button></article>`).join('') + state.customDesigns.map((design, index) => `<article class="unit-card"><span class="unit-icon">✳</span><div class="unit-info"><strong>${escapeHtml(design.name)}</strong><small>Custom vehicle · ${design.strength} strength</small></div><span class="tag">BUILT ${index + 1}</span></article>`).join('');
    $('force-count').textContent = String(unitCount());
    $('army-total').textContent = `${number(unitCount())} units`;
  }
  function renderCountry() {
    if (!selected) return;
    const country = selected;
    const isPlayer = country.iso === player.iso;
    const isAlly = state.allies.includes(country.iso);
    const isWar = !!state.wars[country.iso];
    const isOccupied = !!state.occupied[country.iso];
    $('nation-flag').textContent = flagEmoji(country.iso);
    $('nation-name').textContent = country.name;
    $('nation-region').textContent = country.continent.toUpperCase();
    const tags = [];
    if (isPlayer) tags.push('<span class="tag player">YOUR NATION</span>');
    else if (isWar) tags.push('<span class="tag war">AT WAR</span>');
    else if (isAlly) tags.push('<span class="tag ally">ALLY</span>');
    else if (isOccupied) tags.push('<span class="tag neutral">UNDER ADMINISTRATION</span>');
    else tags.push('<span class="tag neutral">NEUTRAL</span>');
    tags.push(`<span class="tag">${countryPower(country)} POWER</span>`);
    $('nation-tags').innerHTML = tags.join('');
    const rank = countries.filter((item) => item.power > country.power).length + 1;
    $('power-label').innerHTML = `#${String(rank).padStart(2, '0')} <small>GLOBAL RANK</small>`;
    $('power-bar').style.width = `${country.power}%`;
    $('power-value').textContent = `${country.power} / 100`;
    $('area-value').innerHTML = `${formatArea(country)} <em>km²</em>`;
    $('population-value').textContent = formatPopulation(country.pop);
    $('gdp-value').textContent = formatGDP(country.gdp);
    const readiness = isWar ? Math.max(35, 100 - state.turn * 2) : isPlayer ? Math.max(70, 100 - totalUpkeep()) : 100;
    $('readiness-value').innerHTML = `${Math.round(readiness)}<span>%</span>`;
    const locked = isPlayer;
    $('ally-btn').disabled = locked || isAlly || isWar || isOccupied;
    $('war-btn').disabled = locked || isWar || isAlly || isOccupied;
    $('demand-btn').disabled = locked || isWar || isAlly || isOccupied;
    $('ally-btn').innerHTML = isAlly ? '<span>✓</span> Alliance active' : '<span>✦</span> Propose alliance';
    $('war-btn').innerHTML = isWar ? '<span>⚑</span> War in progress' : '<span>⚑</span> Declare war';
    $('demand-btn').innerHTML = isOccupied ? '<span>✓</span> Territory administered' : '<span>⇥</span> Demand land';
    let notice = isPlayer ? 'This is your nation. Choose a country on the atlas to review diplomacy options.' : isWar ? `Conflict with ${country.name} is ongoing. Advance turns to resolve it; your force and readiness matter.` : isAlly ? `${country.name} is your ally. Alliances improve influence and provide a peaceful route to victory.` : isOccupied ? `${country.name} is under your game administration following a fictional settlement.` : `${country.name} is currently neutral. Diplomatic choices are fictional game actions.`;
    if (state.relations[country.iso] < 0 && !isPlayer && !isWar && !isOccupied && !isAlly) notice = `${country.name} rejected your last diplomatic offer. Relations may improve over time.`;
    $('diplomacy-notice').textContent = notice;
    drawMap();
  }
  function render() {
    player = countries.find((country) => country.iso === state.playerIso) || countries.find((country) => country.iso === 'US') || countries[0];
    selected = countries.find((country) => country.iso === state.selectedIso) || countries.find((country) => country.iso !== player.iso) || player;
    $('player-flag').textContent = flagEmoji(player.iso);
    $('player-name').textContent = player.name;
    $('treasury').textContent = money(state.treasury);
    $('influence').textContent = number(state.influence);
    $('turn-number').textContent = String(state.turn).padStart(2, '0');
    $('season').textContent = `${SEASONS[(state.turn - 1) % 4]} · ${2026 + Math.floor((state.turn - 1) / 4)}`;
    $('country-count').textContent = String(countries.length);
    renderUnits();
    renderCountry();
    renderFeed();
    updatePrototypeCost();
  }
  function startFresh(iso = 'US') {
    state = blankState();
    state.playerIso = iso;
    state.selectedIso = countries.some((country) => country.iso === state.selectedIso && country.iso !== iso) ? state.selectedIso : countries.find((country) => country.iso !== iso)?.iso || iso;
    scale = 1; offset = { x: 0, y: 0 };
    render(); persist();
  }
  function transact(cost, description, success) {
    if (state.treasury < cost) { showToast(`Not enough treasury. Need ${money(cost)}.`); return false; }
    state.treasury -= cost;
    success();
    addFeed(description);
    render(); persist();
    return true;
  }
  function proposeAlliance() {
    if (!selected || selected.iso === player.iso || state.allies.includes(selected.iso) || state.wars[selected.iso]) return;
    const target = selected;
    const cost = Math.max(2, Math.round(target.power / 12));
    if (!transact(cost, `Diplomats opened talks with ${target.name}.`, () => {
      const chance = Math.max(.25, Math.min(.9, .8 - target.power / 180 + getRelation(target.iso) / 100));
      if (Math.random() < chance) {
        state.allies.push(target.iso); state.influence += Math.round(35 + target.power * .7); state.relations[target.iso] = 15;
        state.feed[0] = `${target.name} accepted your alliance proposal.`;
      } else {
        state.relations[target.iso] = Math.max(-40, getRelation(target.iso) - 12);
        state.feed[0] = `${target.name} declined your alliance proposal.`;
      }
    })) return;
    showToast(state.allies.includes(target.iso) ? `${target.name} joined your alliance.` : `${target.name} declined the proposal.`);
  }
  function declareWar() {
    if (!selected || selected.iso === player.iso || state.wars[selected.iso] || state.allies.includes(selected.iso)) return;
    const target = selected;
    const cost = Math.max(5, Math.round(target.power / 4));
    if (!transact(cost, `A fictional conflict began with ${target.name}.`, () => {
      state.wars[target.iso] = { turns: 0, strength: target.power, commitment: unitStrength() };
      state.relations[target.iso] = -30;
      state.influence = Math.max(0, state.influence - 20);
    })) return;
    showToast(`Conflict started with ${target.name}. Advance turns to resolve it.`);
  }
  function demandLand() {
    if (!selected || selected.iso === player.iso || state.wars[selected.iso] || state.allies.includes(selected.iso) || state.occupied[selected.iso]) return;
    const target = selected;
    const cost = Math.max(3, Math.round(target.power / 7));
    if (!transact(cost, `A peaceful territorial settlement was proposed to ${target.name}.`, () => {
      const chance = Math.max(.08, Math.min(.72, .46 - target.power / 200 + unitStrength() / 500 + getRelation(target.iso) / 120));
      if (Math.random() < chance) {
        state.occupied[target.iso] = true;
        state.influence += Math.round(target.power * .45);
        state.feed[0] = `${target.name} accepted a peaceful land settlement. Territory is under game administration.`;
      } else {
        state.relations[target.iso] = Math.max(-40, getRelation(target.iso) - 10);
        state.feed[0] = `${target.name} rejected your land demand; relations cooled.`;
      }
    })) return;
    showToast(state.occupied[target.iso] ? 'Peaceful settlement accepted.' : 'Demand declined; relations cooled.');
  }
  function advanceTurn() {
    const income = Math.max(2, Math.min(20, player.gdp / 1000));
    const upkeep = totalUpkeep();
    state.treasury = Math.max(0, state.treasury + income - upkeep);
    state.influence += Math.max(2, Math.round(4 + state.allies.length * 2 + Object.keys(state.occupied).length * 2 - Object.keys(state.wars).length));
    state.lastIncome = income;
    Object.keys(state.wars).forEach((iso) => {
      const war = state.wars[iso];
      war.turns += 1;
      war.commitment = unitStrength();
      const target = countries.find((country) => country.iso === iso);
      const advantage = unitStrength() + Math.round(player.power * .45) - (target?.power || war.strength);
      if (advantage >= 0 || war.turns >= 6) {
        delete state.wars[iso];
        if (advantage > 0) {
          state.occupied[iso] = true;
          state.influence += Math.round((target?.power || 10) * .5);
          addFeed(`Your forces secured a fictional settlement with ${target?.name || 'a rival'}.`);
        } else {
          state.relations[iso] = -15;
          addFeed(`The conflict with ${target?.name || 'a rival'} ended without a settlement.`);
        }
      } else {
        state.treasury = Math.max(0, state.treasury - 2);
      }
    });
    state.turn += 1;
    addFeed(`Turn advanced: ${money(income)} income${upkeep ? `, ${money(upkeep)} force upkeep` : ''}.`);
    render(); persist();
    showToast(`Turn ${state.turn} begins. Net income ${money(income - upkeep)}.`);
  }
  function buyUnit(id) {
    const type = UNIT_TYPES.find((unit) => unit.id === id);
    if (!type) return;
    transact(type.cost, `Recruited one ${type.name.toLowerCase()} unit for ${money(type.cost)}.`, () => { state.units[id] = (Number(state.units[id]) || 0) + 1; });
  }
  function prototypeCost() {
    const barrels = Math.max(1, Math.min(8, Number($('barrels').value) || 1));
    const armor = Math.max(1, Math.min(10, Number($('armor').value) || 1));
    return Math.round((8 + barrels * 2 + armor * 1.4) * 10) / 10;
  }
  function updatePrototypeCost() {
    if (!$('prototype-cost')) return;
    const armor = Math.max(1, Math.min(10, Number($('armor').value) || 1));
    $('barrels').value = Math.max(1, Math.min(8, Number($('barrels').value) || 1));
    $('armor').value = armor;
    $('armor-value').textContent = `${armor} / 10`;
    $('prototype-cost').textContent = money(prototypeCost());
  }
  function buildCustom() {
    const name = $('design-name').value.trim().slice(0, 24) || 'Custom vehicle';
    const barrels = Math.max(1, Math.min(8, Number($('barrels').value) || 1));
    const armor = Math.max(1, Math.min(10, Number($('armor').value) || 1));
    const cost = prototypeCost();
    transact(cost, `Prototype ${name} entered your field command.`, () => {
      state.customDesigns.push({ name, barrels, armor, strength: 8 + barrels * 4 + armor * 2 });
    });
  }
  function openCountryChooser() {
    let dialog = $('nation-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'nation-dialog';
      dialog.innerHTML = '<button class="dialog-close" type="button" aria-label="Close">×</button><div class="eyebrow">CHOOSE YOUR NATION</div><h2>Where will you lead?</h2><p>Your new government starts with $200 billion.</p><label class="field-label" for="nation-search">FIND A COUNTRY</label><input id="nation-search" type="search" placeholder="Search countries…" autocomplete="off"><div class="nation-options" id="nation-options"></div>';
      document.body.appendChild(dialog);
      dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
    }
    const options = $('nation-options');
    const populate = (query = '') => {
      const q = query.trim().toLowerCase(); options.innerHTML = '';
      countries.filter((country) => country.name.toLowerCase().includes(q) || country.iso.toLowerCase().includes(q)).slice(0, 100).forEach((country) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'nation-option';
        button.innerHTML = `<span>${flagEmoji(country.iso)}</span><strong>${escapeHtml(country.name)}</strong><small>POWER ${country.power}</small>`;
        button.addEventListener('click', () => {
          if (!window.confirm(`Start a new game as ${country.name}? Your current save will be replaced.`)) return;
          startFresh(country.iso); scale = 1; offset = { x: 0, y: 0 }; dialog.close(); showToast(`Commanding ${country.name}.`);
        });
        options.appendChild(button);
      });
    };
    populate(); $('nation-search').value = '';
    $('nation-search').oninput = (event) => populate(event.target.value);
    dialog.showModal(); $('nation-search').focus();
  }
  function zoomToPoint(factor, point) {
    const next = Math.max(1, Math.min(5, scale * factor));
    if (next === 1) { scale = 1; offset = { x: 0, y: 0 }; }
    else {
      const wx = (point.x - mapWidth / 2 - offset.x) / scale + mapWidth / 2;
      const wy = (point.y - mapHeight / 2 - offset.y) / scale + mapHeight / 2;
      scale = next;
      offset = { x: point.x - mapWidth / 2 - (wx - mapWidth / 2) * scale, y: point.y - mapHeight / 2 - (wy - mapHeight / 2) * scale };
    }
    drawMap();
  }
  function bindEvents() {
    $('end-turn').addEventListener('click', advanceTurn);
    $('choose-country').addEventListener('click', openCountryChooser);
    $('new-game').addEventListener('click', () => {
      if (window.confirm('Start a new game with a fresh $200 billion treasury? Your current save will be replaced.')) startFresh(player.iso);
    });
    $('ally-btn').addEventListener('click', proposeAlliance);
    $('war-btn').addEventListener('click', declareWar);
    $('demand-btn').addEventListener('click', demandLand);
    $('build-custom').addEventListener('click', buildCustom);
    $('barrels').addEventListener('input', updatePrototypeCost);
    $('armor').addEventListener('input', updatePrototypeCost);
    $('unit-list').addEventListener('click', (event) => {
      const button = event.target.closest('[data-unit]');
      if (button) buyUnit(button.dataset.unit);
    });
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
      document.querySelectorAll('.tab-content').forEach((panel) => panel.classList.toggle('active', panel.id === `tab-${tab.dataset.tab}`));
    }));
    $('zoom-in').addEventListener('click', () => zoomBy(1.25));
    $('zoom-out').addEventListener('click', () => zoomBy(.8));
    $('reset-map').addEventListener('click', () => { scale = 1; offset = { x: 0, y: 0 }; drawMap(); });
    document.querySelector('.bookmark').addEventListener('click', () => focusCountry(selected));
    $('feed-next').addEventListener('click', () => {
      if (!state.feed.length) return;
      dispatchIndex = (dispatchIndex + 1) % state.feed.length;
      $('feed').innerHTML = `<span class="dispatch"><b>${String(state.turn).padStart(2, '0')}</b> ${escapeHtml(state.feed[dispatchIndex])}</span>`;
    });
    $('help-btn').addEventListener('click', () => $('help-dialog').showModal());
    $('close-help').addEventListener('click', () => $('help-dialog').close());
    $('help-dialog').addEventListener('click', (event) => { if (event.target === $('help-dialog')) $('help-dialog').close(); });
    canvas.addEventListener('pointerdown', (event) => {
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y, moved: false };
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      const point = mapPoint(event);
      if (drag && drag.id === event.pointerId) {
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
        if (drag.moved) { offset = { x: drag.offsetX + dx, y: drag.offsetY + dy }; drawMap(); }
      } else showTooltip(countryAt(point.worldX, point.worldY), event);
    });
    canvas.addEventListener('pointerup', (event) => {
      if (!drag || drag.id !== event.pointerId) return;
      if (!drag.moved) {
        const point = mapPoint(event);
        setSelected(countryAt(point.worldX, point.worldY));
      }
      drag = null;
    });
    canvas.addEventListener('pointercancel', () => { drag = null; });
    canvas.addEventListener('pointerleave', () => { if (!drag) $('map-tooltip').classList.remove('visible'); });
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomToPoint(event.deltaY < 0 ? 1.15 : .87, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    }, { passive: false });
    window.addEventListener('resize', resizeCanvas);
    $('brand-home').addEventListener('click', (event) => { event.preventDefault(); scale = 1; offset = { x: 0, y: 0 }; drawMap(); });
  }
  async function init() {
    try {
      const response = await fetch('world.geojson');
      if (!response.ok) throw new Error(`Atlas unavailable (${response.status})`);
      const geojson = await response.json();
      countries = geojson.features.map((feature) => {
        const props = feature.properties;
        return {
          feature, iso: keyOf(props.iso), name: props.name, continent: props.continent || 'Unknown',
          pop: Number(props.pop) || 0, gdp: Number(props.gdp) || 0, area: Number(props.area) || approximateArea(feature.geometry),
          power: 0, path: null
        };
      }).filter((country) => country.iso);
      countries.forEach((country) => { country.power = countryPower(country); });
      state = loadState();
      player = countries.find((country) => country.iso === state.playerIso) || countries.find((country) => country.name === 'United States of America') || countries[0];
      state.playerIso = player.iso;
      if (!countries.some((country) => country.iso === state.selectedIso)) state.selectedIso = countries.find((country) => country.iso !== player.iso)?.iso || player.iso;
      bindEvents();
      render();
      resizeCanvas();
      $('map-loading').classList.add('hidden');
      setTimeout(() => $('map-loading').remove(), 400);
    } catch (error) {
      console.error(error);
      $('map-loading').innerHTML = `<strong>Atlas could not be loaded.</strong><span>Serve this folder over HTTP and refresh.</span>`;
    }
  }

  init();
})();
