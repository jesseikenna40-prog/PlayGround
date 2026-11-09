  function setSelected(country) {
    if (!country) return;
    selected = country; state.selectedIso = country.iso;
    document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.tab === 'country'));
    document.querySelectorAll('.tab-content').forEach(panel => panel.classList.toggle('active', panel.id === 'tab-country'));
    render(); persist();
  }
  function mapPoint(event) {
    const rect = canvas.getBoundingClientRect();
    const x = (event.clientX - rect.left) * canvas.width / rect.width;
    const y = (event.clientY - rect.top) * canvas.height / rect.height;
    return { x, y, worldX: (x - canvas.width / 2 - offset.x) / scale + canvas.width / 2, worldY: (y - canvas.height / 2 - offset.y) / scale + canvas.height / 2 };
  }
  function countryAt(x, y) {
    for (let i = countries.length - 1; i >= 0; i--) if (countries[i].path && ctx.isPointInPath(countries[i].path, x, y, 'evenodd')) return countries[i];
    return null;
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
    scale = Math.max(1, Math.min(5, scale * factor));
    if (scale === 1) offset = { x: 0, y: 0 };
    drawMap();
  }
  function focusCountry(country) {
    if (!country) return;
    scale = Math.max(scale, 2.2);
    const w = canvas.width, h = canvas.height;
    const px = (+country.feature.properties.lon + 180) / 360 * w;
    const py = (85 - (+country.feature.properties.lat || 0)) / 170 * h;
    offset = { x: -scale * (px - w / 2), y: -scale * (py - h / 2) };
    drawMap();
  }
  function openCountryChooser() {
    let dialog = $('nation-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog'); dialog.id = 'nation-dialog';
      dialog.innerHTML = '<button class="dialog-close" type="button" aria-label="Close">×</button><div class="eyebrow">CHOOSE YOUR NATION</div><h2>Where will you lead?</h2><p>Your new government starts with $200 billion.</p><label class="field-label" for="nation-search">FIND A COUNTRY</label><input id="nation-search" type="search" placeholder="Search countries…" autocomplete="off"><div class="nation-options" id="nation-options"></div>';
      document.body.appendChild(dialog);
      dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
      dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    }
    const options = $('nation-options');
    const populate = (query = '') => {
      const q = query.trim().toLowerCase(); options.innerHTML = '';
      countries.filter(c => c.name.toLowerCase().includes(q) || c.iso.toLowerCase().includes(q)).slice(0, 100).forEach(country => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'nation-option';
        button.innerHTML = `<span>${flagEmoji(country.iso)}</span><strong>${escapeHtml(country.name)}</strong><small>POWER ${country.power}</small>`;
        button.addEventListener('click', () => {
          if (!window.confirm(`Start a new game as ${country.name}? Your current save will be replaced.`)) return;
          state = blankState(); state.playerIso = country.iso;
          player = country; selected = countries.find(c => c.iso !== player.iso) || player; state.selectedIso = selected.iso;
          scale = 1; offset = { x: 0, y: 0 }; dialog.close(); render(); persist(); showToast(`Commanding ${country.name}.`);
        });
        options.appendChild(button);
      });
    };
    populate(); $('nation-search').value = '';
    $('nation-search').oninput = event => populate(event.target.value);
    dialog.showModal(); $('nation-search').focus();
  }
