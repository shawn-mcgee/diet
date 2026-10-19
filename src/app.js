import { uid, dateKey, shiftDate, nutrition, mealNutrition, dailyTotals, references, validateState } from './core.js';
import { newState } from './seed.js';

const $ = (s, root = document) => root.querySelector(s);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (n, digits = 0) => n.toLocaleString(undefined, { maximumFractionDigits: digits });
const config = window.DIET_CONFIG || {};
const configured = Boolean(config.googleClientId && config.appsScriptUrl);
let tab = 'day', day = dateKey(), range = '30', query = '', category = '';
let token = null, user = null, busy = false, blocked = false, syncError = '', revision = null;
let storageKey = 'daily:local:v1';
let saved = readCache(storageKey);
let state = saved?.state || newState();
let dirty = Boolean(saved?.dirty), generation = 0;
let recipeDraft = null;

function readCache(key) {
  try {
    const cached = JSON.parse(localStorage.getItem(key));
    if (cached) validateState(cached.state);
    return cached;
  } catch { return null; }
}
function cache() {
  try { localStorage.setItem(storageKey, JSON.stringify({ state, revision, dirty })); }
  catch { throw Error('Device storage is full or unavailable. Export a backup before closing.'); }
}
function notice(message) {
  $('#notice').textContent = message;
  $('#notice').classList.add('show');
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => $('#notice').classList.remove('show'), 5500);
}
function commit(next) {
  validateState(next);
  state = next;
  dirty = true;
  generation++;
  cache();
  render();
  if (token && !blocked) void sync();
}
function change(fn) {
  try { const next = structuredClone(state); fn(next); commit(next); return true; }
  catch (error) { notice(error.message); return false; }
}
async function api(action, extra = {}) {
  const response = await fetch(config.appsScriptUrl, {
    method: 'POST', redirect: 'follow', credentials: 'omit',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, credential: token, ...extra }),
  });
  if (!response.ok) throw Error('Google Sheets could not be reached. Your changes remain on this device.');
  let result;
  try { result = await response.json(); } catch { throw Error('Unexpected backend response. Check the Apps Script deployment access and /exec URL.'); }
  if (!result.ok) {
    const error = Error(result.error || 'Sync failed.');
    error.code = result.code;
    throw error;
  }
  return result;
}
async function signIn(credential) {
  if (busy) return;
  const previous = { state, dirty, revision, storageKey };
  busy = true;
  token = credential;
  syncError = '';
  render();
  try {
    const result = await api('load');
    user = result.user;
    storageKey = `daily:google:${user.sub}`;
    const cached = readCache(storageKey);
    revision = result.revision;
    blocked = false;
    if (cached?.dirty) {
      state = cached.state;
      dirty = true;
      if (cached.revision !== revision) {
        revision = cached.revision;
        blocked = true;
        syncError = 'The Sheet changed while this device had unsaved edits. Export this device’s data, then load the Sheet to resolve.';
      }
    } else {
      state = result.state ? validateState(result.state) : newState();
      dirty = !result.state;
    }
    cache();
  } catch (error) {
    token = null;
    user = null;
    ({ state, dirty, revision, storageKey } = previous);
    notice(error.message);
  } finally { busy = false; render(); }
  if (token && dirty && !blocked) void sync();
}
async function sync() {
  if (busy || !token || blocked || !dirty) return;
  const currentGeneration = generation;
  const snapshot = structuredClone(state);
  busy = true; syncError = ''; renderStatus();
  try {
    const result = await api('save', { state: snapshot, revision });
    revision = result.revision;
    dirty = generation !== currentGeneration;
    cache();
  } catch (error) {
    syncError = error.message;
    if (error.code === 'CONFLICT') blocked = true;
  } finally { busy = false; renderStatus(); }
  if (dirty && !syncError && !blocked) void sync();
}
async function refresh() {
  if (busy || !token) return;
  if (dirty && !confirm('Load data from Google Sheets and discard this device’s unsynced edits? Export a backup first if you need them.')) return;
  busy = true; renderStatus();
  try {
    const result = await api('load');
    state = result.state ? validateState(result.state) : newState();
    revision = result.revision; dirty = !result.state; blocked = false; syncError = ''; generation++;
    cache(); render();
  } catch (error) { notice(error.message); }
  finally { busy = false; renderStatus(); }
  if (dirty && !blocked) void sync();
}
function items() { return [...state.foods, ...state.recipes].sort((a, b) => a.name.localeCompare(b.name)); }
function item(id) { return items().find(i => i.id === id); }
function statusText() {
  if (!user) return 'On this device';
  if (busy) return 'Syncing…';
  if (blocked) return 'Sync conflict';
  if (syncError) return 'Not synced';
  return dirty ? 'Changes pending' : 'Saved to Sheets';
}
function renderStatus() {
  if ($('#sync-status')) {
    $('#sync-status').textContent = statusText();
    $('#sync-status').classList.toggle('error-text', Boolean(syncError));
  }
  if ($('#sync-detail')) {
    $('#sync-detail').textContent = syncError;
    $('#sync-detail').hidden = !syncError;
  }
  document.querySelectorAll('[data-action="sync"], [data-action="refresh"], [data-action="logout"]').forEach(b => b.disabled = busy);
}
function render() {
  const labels = { day: 'Daily log', library: 'Foods & recipes', trends: 'Trends', settings: 'Settings' };
  $('#app').innerHTML = `<header class="header"><a class="brand" href="#day" aria-label="Daily home"><span class="brand-mark">d.</span> daily<span class="brand-caption">diet & weight</span></a><span id="sync-status" class="status">${statusText()}</span></header>
    <nav class="nav" aria-label="Main navigation">${Object.entries(labels).map(([id, name]) => `<button data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${name}</button>`).join('')}</nav>
    <main><p id="sync-detail" class="sync-error" ${syncError ? '' : 'hidden'}>${esc(syncError)}</p>${tab === 'day' ? renderDay() : tab === 'library' ? renderLibrary() : tab === 'trends' ? renderTrends() : renderSettings()}</main>
    <footer><span>kcal · protein in g · weight in lbs</span><span>${user ? esc(user.email) : 'Local mode'}</span></footer>`;
  if (tab === 'settings') initGoogleButton();
  renderStatus();
}
function renderDay() {
  const total = dailyTotals(state, day);
  const meals = state.meals.filter(m => m.date === day).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const weights = state.weights.filter(w => dateKey(new Date(w.timestamp)) === day).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const remaining = state.settings.calorieLimit - total.calories;
  return `<section class="page-heading"><div><div class="eyebrow">DAILY LOG</div><h1>${day === dateKey() ? 'Today' : new Date(day + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</h1></div><div class="date-control"><button class="icon-button" data-action="prev" aria-label="Previous day">←</button><input type="date" id="day" aria-label="Log date" value="${day}"><button class="icon-button" data-action="next" aria-label="Next day">→</button></div></section>
    <section class="metrics" aria-label="Daily totals"><article class="metric"><span class="eyebrow">CALORIES</span><div class="metric-number">${fmt(total.calories)} <small>/ ${fmt(state.settings.calorieLimit)}</small></div><progress max="${state.settings.calorieLimit}" value="${total.calories}" aria-label="Calories eaten"></progress><span class="muted">${fmt(Math.abs(remaining))} kcal ${remaining >= 0 ? 'remaining' : 'over limit'}</span></article><article class="metric"><span class="eyebrow">PROTEIN</span><div class="metric-number">${fmt(total.protein, 1)} <small>/ ${fmt(state.settings.proteinGoal)} g</small></div><progress max="${state.settings.proteinGoal}" value="${total.protein}" aria-label="Protein eaten"></progress><span class="muted">${total.protein >= state.settings.proteinGoal ? 'Goal reached' : `${fmt(state.settings.proteinGoal - total.protein, 1)} g to goal`}</span></article></section>
    <section class="panel"><div class="section-heading"><h2>Food log <span class="count">${meals.length}</span></h2><button class="primary" data-action="add-meal">+ Add food</button></div>${meals.length ? `<div class="log-list">${meals.map(m => {
      const n = mealNutrition(state, m);
      return `<div class="log-row"><div><strong>${esc(m.description)}</strong><div class="muted small">${m.itemId ? `${fmt(m.amount, 2)} ${esc(m.unit)} · linked` : 'Quick entry'} · ${new Date(m.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div></div><div class="nutrition-pair"><span>${fmt(n.calories)} <small>kcal</small></span><span>${fmt(n.protein, 1)} <small>g protein</small></span></div><button class="text-button" data-action="edit-meal" data-id="${esc(m.id)}">Edit</button></div>`;
    }).join('')}</div>` : '<div class="empty">No food logged for this day.</div>'}</section>
    <section class="panel"><div class="section-heading"><h2>Weight</h2><button class="secondary" data-action="add-weight">+ Record weight</button></div>${weights.length ? weights.map(w => `<div class="log-row"><strong>${fmt(w.lbs, 1)} <span class="muted">lbs</span></strong><span class="muted">${new Date(w.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span><button class="text-button" data-action="delete-weight" data-id="${esc(w.id)}">Delete</button></div>`).join('') : '<div class="empty compact">No weight recorded for this day.</div>'}${day !== dateKey() ? '<p class="muted small">New weights are recorded with the current date and time.</p>' : ''}</section>`;
}
function filteredItems() {
  const q = query.toLocaleLowerCase();
  return items().filter(i => i.name.toLocaleLowerCase().includes(q) && (!category || (i.ingredients ? 'Recipes' : i.category) === category));
}
function libraryRows() {
  return filteredItems().map(i => {
    const n = nutrition(state, i.id);
    const amount = `${fmt(n.quantity, 2)} ${n.unit}`;
    return `<tr><td><button class="item-name" data-action="edit-item" data-id="${esc(i.id)}">${esc(i.name)}</button><span class="item-category">${esc(i.ingredients ? 'Recipe · linked ingredients' : i.category)}</span></td><td>${esc(i.portionSize)}${i.portionSize !== amount ? `<span class="item-category">${esc(amount)}</span>` : ''}</td><td class="numeric">${fmt(n.calories)}</td><td class="numeric">${fmt(n.protein, 1)}</td><td><button class="small-button" data-action="log-item" data-id="${esc(i.id)}" aria-label="Log ${esc(i.name)}">Log</button></td></tr>`;
  }).join('') || '<tr><td colspan="5" class="empty">No matching items.</td></tr>';
}
function renderLibrary() {
  const categories = [...new Set([...state.foods.map(f => f.category), 'Recipes'])].sort();
  return `<section class="page-heading"><div><div class="eyebrow">QUICK REFERENCE</div><h1>Foods & recipes</h1></div><div class="button-group"><button class="secondary" data-action="add-recipe">+ Recipe</button><button class="primary" data-action="add-food">+ Food</button></div></section>
    <div class="filters"><input type="search" id="library-search" placeholder="Search foods and recipes" aria-label="Search foods and recipes" value="${esc(query)}"><select id="category" aria-label="Category"><option value="">All categories</option>${categories.map(c => `<option ${c === category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
    <section class="panel table-panel"><table><thead><tr><th>Item</th><th>Portion size</th><th class="numeric">kcal</th><th class="numeric">Protein, g</th><th><span class="sr-only">Action</span></th></tr></thead><tbody id="library-rows">${libraryRows()}</tbody></table></section>
    <p class="muted small">Starter values are approximate. Weigh the named raw or cooked food; check brands and preparation. 1 oz = 28.35 g. <a href="https://fdc.nal.usda.gov/" target="_blank" rel="noreferrer">USDA food lookup ↗</a></p>`;
}
function chart(points, title, unit, goal) {
  if (!points.length) return '<div class="empty chart-empty">No data in this period.</div>';
  const W = 800, H = 220, L = 60, R = 20, T = 22, B = 35;
  const values = points.map(p => p.value);
  let low = goal ? 0 : Math.floor(Math.min(...values) - 2);
  let high = Math.max(...values, goal || 0);
  high = high + Math.max((high - low) * 0.15, 2);
  low = Math.max(0, low);
  const first = new Date(points[0].at).getTime();
  const last = new Date(points.at(-1).at).getTime();
  const x = p => last === first ? (L + W - R) / 2 : L + (new Date(p.at).getTime() - first) / (last - first) * (W - L - R);
  const y = v => H - B - (v - low) / (high - low) * (H - T - B);
  const ticks = [low, (low + high) / 2, high];
  let path = '';
  points.forEach((p, i) => { const gap = i && goal && new Date(p.at) - new Date(points[i - 1].at) > 36 * 3600000; path += `${i === 0 || gap ? 'M' : 'L'}${x(p)},${y(p.value)} `; });
  const dateLabel = p => new Date(p.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `<div class="chart-wrap"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} in ${esc(unit)} over time">${ticks.map(t => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" class="grid-line"/><text x="${L - 10}" y="${y(t) + 4}" text-anchor="end">${fmt(t, unit === 'lbs' ? 1 : 0)}</text>`).join('')}${goal ? `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" class="goal-line"/>` : ''}<path d="${path}" class="chart-line"/>${points.map(p => `<circle cx="${x(p)}" cy="${y(p.value)}" r="3.5" class="chart-dot"><title>${esc(p.label)}: ${fmt(p.value, 1)} ${unit}</title></circle>`).join('')}<text x="${L}" y="${H - 7}">${dateLabel(points[0])}</text>${points.length > 1 ? `<text x="${W - R}" y="${H - 7}" text-anchor="end">${dateLabel(points.at(-1))}</text>` : ''}</svg></div>`;
}
function renderTrends() {
  const start = range === 'all' ? '0000-00-00' : shiftDate(dateKey(), -(Number(range) - 1));
  const days = [...new Set(state.meals.map(m => m.date))].filter(d => d >= start && d <= dateKey()).sort();
  const daily = days.map(d => ({ at: d + 'T12:00:00', label: new Date(d + 'T12:00:00').toLocaleDateString(), ...dailyTotals(state, d) }));
  const weights = state.weights.filter(w => dateKey(new Date(w.timestamp)) >= start && dateKey(new Date(w.timestamp)) <= dateKey()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return `<section class="page-heading"><div><div class="eyebrow">OVER TIME</div><h1>Trends</h1></div><select id="range" aria-label="Chart period">${[['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['all', 'All time']].map(([v, label]) => `<option value="${v}" ${range === v ? 'selected' : ''}>${label}</option>`).join('')}</select></section>
    ${[['Calories', 'calories', 'kcal', state.settings.calorieLimit], ['Protein', 'protein', 'g', state.settings.proteinGoal], ['Weight', 'weight', 'lbs', null]].map(([label, key, unit, goal]) => {
      const points = key === 'weight' ? weights.map(w => ({ at: w.timestamp, label: new Date(w.timestamp).toLocaleString(), value: w.lbs })) : daily.map(d => ({ ...d, value: d[key] }));
      const avg = points.length ? points.reduce((s, p) => s + p.value, 0) / points.length : 0;
      return `<section class="panel chart-panel"><div class="section-heading"><h2>${label} <span class="muted small">${unit}</span></h2><span class="muted small">${points.length ? key === 'weight' ? `Latest ${fmt(points.at(-1).value, 1)} lbs` : `Avg ${fmt(avg, 1)} · goal ${fmt(goal)}` : ''}</span></div>${chart(points, label, unit, goal)}</section>`;
    }).join('')}<p class="muted small">Daily totals use linked recipe values. Averages include logged days only. Gaps indicate days without entries. Dashed lines show current goals.</p>
    <details class="panel data-details"><summary>View data table</summary><div class="table-panel"><table><thead><tr><th>Date</th><th class="numeric">kcal</th><th class="numeric">Protein, g</th></tr></thead><tbody>${daily.map(d => `<tr><td>${esc(d.label)}</td><td class="numeric">${fmt(d.calories)}</td><td class="numeric">${fmt(d.protein, 1)}</td></tr>`).join('') || '<tr><td colspan="3">No food entries.</td></tr>'}</tbody></table><table><thead><tr><th>Recorded</th><th class="numeric">Weight, lbs</th><th></th></tr></thead><tbody>${weights.map(w => `<tr><td>${esc(new Date(w.timestamp).toLocaleString())}</td><td class="numeric">${fmt(w.lbs, 1)}</td><td><button class="text-button" data-action="delete-weight" data-id="${esc(w.id)}">Delete</button></td></tr>`).join('') || '<tr><td colspan="3">No weight entries.</td></tr>'}</tbody></table></div></details>`;
}
function renderSettings() {
  return `<section class="page-heading"><div><div class="eyebrow">PREFERENCES</div><h1>Settings</h1></div></section>
    <section class="panel settings-panel"><h2>Daily goals</h2><form id="goals-form"><div class="form-grid"><label>Calorie limit, kcal<input name="calorieLimit" type="number" min="1" max="10000000" step="any" value="${state.settings.calorieLimit}" required></label><label>Protein goal, g<input name="proteinGoal" type="number" min="0.1" max="10000000" step="any" value="${state.settings.proteinGoal}" required></label></div><button class="primary">Save goals</button></form><p class="muted small">You can also edit these values in the Sheet, then load it here.</p></section>
    <section class="panel settings-panel"><h2>Google Sheets</h2>${user ? `<p>${esc(user.email)}</p><div class="button-group"><button class="primary" data-action="sync">Retry sync</button><button class="secondary" data-action="refresh">Load Sheet</button><button class="text-button" data-action="logout">Sign out</button></div>` : configured ? '<p class="muted">Sign in to use your Sheet. Local-mode data stays separate.</p><div id="google-button"></div>' : '<p class="muted">Working locally on this device. Set your Google client ID and Apps Script URL in <code>config.js</code> to connect a Sheet.</p>'}<p class="muted small">${user ? 'Edits save automatically. Load the Sheet to get changes from another device or edits made directly in Google Sheets.' : 'Export a backup to keep a copy of your local data.'}</p></section>
    <section class="panel settings-panel"><h2>Backup</h2><div class="button-group"><button class="secondary" data-action="export">Export JSON</button><label class="secondary file-label">Import JSON<input id="import" type="file" accept="application/json,.json" class="sr-only"></label></div><p class="muted small">Import replaces the current library and logs. Export before replacing data.</p></section>`;
}
function initGoogleButton() {
  if (!configured || user) return;
  if (!window.google?.accounts?.id) {
    $('#google-button').innerHTML = '<button class="secondary" data-action="google-retry">Load Google sign-in</button>';
    return;
  }
  google.accounts.id.initialize({ client_id: config.googleClientId, callback: response => signIn(response.credential), auto_select: false });
  google.accounts.id.renderButton($('#google-button'), { theme: 'outline', size: 'large', text: 'signin_with', width: 250 });
}

function openDialog(title, content, onSubmit, extra = '') {
  const dialog = $('#editor');
  dialog.innerHTML = `<form id="dialog-form"><div class="dialog-heading"><h2>${esc(title)}</h2><button type="button" class="icon-button" data-close aria-label="Close dialog">✕</button></div>${content}<p id="form-error" class="error-text" role="alert"></p><div class="dialog-actions">${extra}<button type="button" class="secondary" data-close>Cancel</button><button class="primary" type="submit">Save</button></div></form>`;
  dialog.querySelectorAll('[data-close]').forEach(b => b.onclick = () => dialog.close());
  $('#dialog-form').onsubmit = event => {
    event.preventDefault();
    try { onSubmit(new FormData(event.currentTarget)); }
    catch (error) { $('#form-error').textContent = error.message; }
  };
  if (!dialog.open) dialog.showModal();
}
function options(selected = '', excluded = '') {
  return `<option value="">Choose an item</option>${items().filter(i => i.id !== excluded).map(i => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}`;
}
function unitOptions(id, selected) {
  if (!id) return '<option>g</option>';
  const n = nutrition(state, id);
  return [n.unit, ...(n.unit === 'g' ? ['oz'] : [])].map(u => `<option ${u === selected ? 'selected' : ''}>${esc(u)}</option>`).join('');
}
function saveDialog(next) {
  validateState(next);
  commit(next);
  $('#editor').close();
}
function editMeal(id, selectedId) {
  const existing = state.meals.find(m => m.id === id);
  let mode = existing ? existing.itemId ? 'library' : 'quick' : selectedId ? 'library' : 'quick';
  const show = () => {
    const chosen = existing?.itemId || selectedId || '';
    const n = chosen ? nutrition(state, chosen) : null;
    openDialog(existing ? 'Edit food entry' : 'Add food', `<div class="segmented"><button type="button" data-mode="quick" aria-pressed="${mode === 'quick'}">Quick entry</button><button type="button" data-mode="library" aria-pressed="${mode === 'library'}">From library</button></div>
      ${mode === 'library' ? `<label>Find an item<input type="search" id="meal-search" placeholder="Filter library" autocomplete="off"></label><label>Food or recipe<select name="itemId" id="meal-item" required>${options(chosen)}</select></label><div class="form-grid"><label>Amount<input type="number" name="amount" min="0.001" max="10000000" step="any" value="${existing?.amount || n?.quantity || 100}" required></label><label>Unit<select name="unit" id="meal-unit">${unitOptions(chosen, existing?.unit)}</select></label></div><p id="meal-preview" class="calculation"></p>` : `<div class="form-grid"><label>Calories, kcal<input name="calories" type="number" min="0" max="10000000" step="any" value="${existing?.calories ?? ''}" required></label><label>Protein, g<input name="protein" type="number" min="0" max="10000000" step="any" value="${existing?.protein ?? ''}" required></label></div>`}
      <label>Description ${mode === 'library' ? '<span class="muted">(optional)</span>' : ''}<input name="description" maxlength="500" value="${esc(existing?.description || '')}" ${mode === 'quick' ? 'required' : ''} placeholder="${mode === 'library' ? 'Uses the item name' : 'e.g. Lunch'}"></label><label>Date<input name="date" type="date" value="${existing?.date || day}" required></label>`, data => {
        const linked = mode === 'library';
        const chosenItem = item(data.get('itemId'));
        const row = { id: existing?.id || uid(), timestamp: existing?.timestamp || new Date().toISOString(), date: data.get('date'), description: data.get('description').trim() || chosenItem?.name || '' };
        if (linked) Object.assign(row, { itemId: data.get('itemId'), amount: Number(data.get('amount')), unit: data.get('unit') });
        else Object.assign(row, { calories: Number(data.get('calories')), protein: Number(data.get('protein')) });
        const next = structuredClone(state);
        next.meals = [...next.meals.filter(m => m.id !== row.id), row];
        saveDialog(next);
      }, existing ? '<button type="button" class="danger" id="delete-meal">Delete</button>' : '');
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; show(); });
    if (existing) $('#delete-meal').onclick = () => { if (confirm('Delete this food entry?')) { change(s => s.meals = s.meals.filter(m => m.id !== id)); $('#editor').close(); } };
    if (mode === 'library') {
      const preview = () => {
        try {
          const f = $('#dialog-form');
          const n = mealNutrition(state, { itemId: f.elements.itemId.value, amount: Number(f.elements.amount.value), unit: f.elements.unit.value });
          $('#meal-preview').textContent = `${fmt(n.calories)} kcal · ${fmt(n.protein, 1)} g protein`;
        } catch { $('#meal-preview').textContent = 'Select an item and amount.'; }
      };
      $('#meal-item').onchange = event => {
        const id = event.target.value;
        $('#meal-unit').innerHTML = unitOptions(id);
        $('#dialog-form').elements.amount.value = id ? nutrition(state, id).quantity : 100;
        preview();
      };
      $('#meal-search').oninput = event => {
        const selected = $('#meal-item').value;
        const matches = items().filter(i => i.name.toLocaleLowerCase().includes(event.target.value.toLocaleLowerCase()));
        $('#meal-item').innerHTML = '<option value="">Choose an item</option>' + matches.map(i => `<option value="${esc(i.id)}" ${i.id === selected ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
        if (!$('#meal-item').value) $('#meal-preview').textContent = 'Select an item and amount.';
      };
      $('#dialog-form').oninput = event => { if (event.target.id !== 'meal-search') preview(); };
      preview();
    }
  };
  show();
}
function editFood(id) {
  const f = state.foods.find(i => i.id === id);
  openDialog(f ? 'Edit food' : 'Add food', `<label>Name<input name="name" maxlength="500" value="${esc(f?.name || '')}" required></label><label>Category<input name="category" maxlength="500" list="categories" value="${esc(f?.category || 'Other')}" required><datalist id="categories">${[...new Set(state.foods.map(f => f.category))].map(c => `<option>${esc(c)}</option>`).join('')}</datalist></label><div class="form-grid"><label>Reference amount<input name="quantity" type="number" min="0.001" max="10000000" step="any" value="${f?.quantity || 100}" required></label><label>Unit<input name="unit" maxlength="30" value="${esc(f?.unit || 'g')}" placeholder="g, ml, egg, cup" required ${f && references(state, f.id) ? 'readonly' : ''}></label></div><div class="form-grid"><label>Calories, kcal<input name="calories" type="number" min="0" max="10000000" step="any" value="${f?.calories ?? ''}" required></label><label>Protein, g<input name="protein" type="number" min="0" max="10000000" step="any" value="${f?.protein ?? ''}" required></label></div><p class="muted small">Nutrition is for the reference amount. Changes update linked recipes and past food entries. Units are locked while an item is in use.</p>`, data => {
    const row = { id: f?.id || uid(), name: data.get('name').trim(), category: data.get('category').trim(), portionSize: data.get('portionSize').trim(), unit: data.get('unit').trim(), quantity: Number(data.get('quantity')), calories: Number(data.get('calories')), protein: Number(data.get('protein')) };
    const next = structuredClone(state);
    next.foods = [...next.foods.filter(i => i.id !== row.id), row];
    saveDialog(next);
  }, f ? '<button type="button" class="danger" id="delete-item">Delete</button>' : '');
  const portionLabel = document.createElement('label');
  portionLabel.innerHTML = `Portion size<input name="portionSize" maxlength="500" value="${esc(f?.portionSize || '100 g')}" placeholder="e.g. 1 breast, 1 lb, 3 tbsp, 16oz" required><span class="muted small">Label for the reference amount below; text is not converted into units.</span>`;
  $('#dialog-form').insertBefore(portionLabel, $('#dialog-form .form-grid'));
  if (f) $('#delete-item').onclick = () => deleteItem(f.id);
}
function deleteItem(id) {
  if (references(state, id)) { $('#form-error').textContent = 'This item is used in a recipe or food log. Remove those links before deleting it.'; return; }
  if (!confirm('Delete this reference item?')) return;
  change(s => { s.foods = s.foods.filter(i => i.id !== id); s.recipes = s.recipes.filter(i => i.id !== id); });
  $('#editor').close();
}
function editRecipe(id) {
  const r = state.recipes.find(i => i.id === id);
  recipeDraft = structuredClone(r || { id: uid(), name: '', portionSize: '1 portion', portions: 1, ingredients: [] });
  openDialog(r ? 'Edit recipe' : 'New recipe', `<label>Recipe name<input name="name" maxlength="500" value="${esc(recipeDraft.name)}" required></label><label>Yield, portions<input name="portions" type="number" min="0.001" max="10000000" step="any" value="${recipeDraft.portions}" required></label><div class="ingredient-heading"><h3>Ingredients</h3><button type="button" class="text-button" id="add-ingredient">+ Add ingredient</button></div><div id="ingredients"></div><p id="recipe-total" class="calculation"></p><p class="muted small">Use the amount going into the whole recipe. Saved recipes appear in the library as portions. Ingredient edits update this recipe and its logged portions.</p>`, data => {
    recipeDraft.name = data.get('name').trim();
    recipeDraft.portionSize = data.get('portionSize').trim();
    recipeDraft.portions = Number(data.get('portions'));
    const next = structuredClone(state);
    next.recipes = [...next.recipes.filter(i => i.id !== recipeDraft.id), recipeDraft];
    saveDialog(next);
  }, r ? '<button type="button" class="danger" id="delete-item">Delete</button>' : '');
  const portionLabel = document.createElement('label');
  portionLabel.innerHTML = `Portion size<input name="portionSize" maxlength="500" value="${esc(recipeDraft.portionSize)}" placeholder="e.g. 1 portion, 1 bowl" required><span class="muted small">Label for one portion of this recipe.</span>`;
  $('#dialog-form').insertBefore(portionLabel, $('#dialog-form .ingredient-heading'));
  if (r) $('#delete-item').onclick = () => deleteItem(r.id);
  const updateTotal = () => {
    recipeDraft.portions = Number($('#dialog-form').elements.portions.value);
    const draftState = { ...state, recipes: [...state.recipes.filter(i => i.id !== recipeDraft.id), recipeDraft] };
    try {
      if (!recipeDraft.ingredients.length || recipeDraft.portions <= 0) throw Error();
      const n = nutrition(draftState, recipeDraft.id);
      $('#recipe-total').textContent = `${fmt(n.calories)} kcal · ${fmt(n.protein, 1)} g protein / portion`;
    } catch { $('#recipe-total').textContent = 'Add ingredients and a yield to calculate.'; }
  };
  const renderIngredients = () => {
    $('#ingredients').innerHTML = recipeDraft.ingredients.map((ing, index) => `<div class="ingredient-row" data-index="${index}"><label>Item<select data-field="itemId" required>${options(ing.itemId, recipeDraft.id)}</select></label><label>Amount<input type="number" data-field="amount" min="0.001" max="10000000" step="any" value="${ing.amount}" required></label><label>Unit<select data-field="unit">${unitOptions(ing.itemId, ing.unit)}</select></label><button type="button" class="icon-button remove-ingredient" aria-label="Remove ingredient ${index + 1}" data-remove="${index}">✕</button></div>`).join('');
    $('#ingredients').querySelectorAll('[data-field]').forEach(input => input.onchange = event => {
      const index = Number(event.target.closest('[data-index]').dataset.index);
      const ingredient = recipeDraft.ingredients[index];
      const field = event.target.dataset.field;
      ingredient[field] = field === 'amount' ? Number(event.target.value) : event.target.value;
      if (field === 'itemId') {
        const n = ingredient.itemId ? nutrition(state, ingredient.itemId) : { quantity: 100, unit: 'g' };
        ingredient.amount = n.quantity; ingredient.unit = n.unit;
        renderIngredients();
      }
      updateTotal();
    });
    $('#ingredients').querySelectorAll('[data-remove]').forEach(b => b.onclick = () => { recipeDraft.ingredients.splice(Number(b.dataset.remove), 1); renderIngredients(); updateTotal(); });
  };
  $('#add-ingredient').onclick = () => { recipeDraft.ingredients.push({ itemId: '', amount: 100, unit: 'g' }); renderIngredients(); updateTotal(); };
  $('#dialog-form').elements.portions.oninput = updateTotal;
  renderIngredients(); updateTotal();
}
function addWeight() {
  openDialog('Record weight', '<label>Weight, lbs<input name="lbs" type="number" min="0.1" max="10000000" step="any" inputmode="decimal" required autofocus></label><p class="muted small">The current date and time are recorded when you save.</p>', data => {
    const next = structuredClone(state);
    next.weights.push({ id: uid(), lbs: Number(data.get('lbs')), timestamp: new Date().toISOString() });
    saveDialog(next);
  });
}
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `daily-${dateKey()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-tab]');
  if (nav) { tab = nav.dataset.tab; render(); return; }
  if (event.target.closest('.brand')) { event.preventDefault(); tab = 'day'; render(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case 'prev': day = shiftDate(day, -1); render(); break;
    case 'next': day = shiftDate(day, 1); render(); break;
    case 'add-meal': editMeal(); break;
    case 'edit-meal': editMeal(id); break;
    case 'log-item': editMeal(null, id); break;
    case 'add-food': editFood(); break;
    case 'add-recipe': editRecipe(); break;
    case 'edit-item': state.foods.some(f => f.id === id) ? editFood(id) : editRecipe(id); break;
    case 'add-weight': addWeight(); break;
    case 'delete-weight': if (confirm('Delete this weight entry?')) change(s => s.weights = s.weights.filter(w => w.id !== id)); break;
    case 'export': exportData(); break;
    case 'sync': void sync(); break;
    case 'refresh': void refresh(); break;
    case 'google-retry': initGoogleButton(); break;
    case 'logout':
      if (dirty && !confirm('Unsynced edits will stay on this device for your next sign-in. Sign out?')) break;
      window.google?.accounts?.id.disableAutoSelect();
      token = null; user = null; storageKey = 'daily:local:v1'; saved = readCache(storageKey);
      state = saved?.state || newState(); dirty = Boolean(saved?.dirty); revision = null; blocked = false; syncError = ''; render(); break;
  }
});
document.addEventListener('change', async event => {
  if (event.target.id === 'day' && event.target.value) { day = event.target.value; render(); }
  if (event.target.id === 'category') { category = event.target.value; $('#library-rows').innerHTML = libraryRows(); }
  if (event.target.id === 'range') { range = event.target.value; render(); }
  if (event.target.id === 'import') {
    try {
      const file = event.target.files[0];
      if (!file) return;
      if (file.size > 4 * 1024 * 1024) throw Error('Backup must be smaller than 4 MB.');
      const imported = validateState(JSON.parse(await file.text()));
      if (confirm('Replace the current library, goals, food logs, and weights with this backup?')) { commit(imported); notice('Backup imported.'); }
    } catch (error) { notice(error.message); }
    event.target.value = '';
  }
});
document.addEventListener('input', event => {
  if (event.target.id === 'library-search') { query = event.target.value; $('#library-rows').innerHTML = libraryRows(); }
});
document.addEventListener('submit', event => {
  if (event.target.id !== 'goals-form') return;
  event.preventDefault();
  const data = new FormData(event.target);
  if (change(s => s.settings = { calorieLimit: Number(data.get('calorieLimit')), proteinGoal: Number(data.get('proteinGoal')) })) notice('Goals saved.');
});
window.addEventListener('online', () => { if (token && dirty) void sync(); });
window.addEventListener('beforeunload', event => { if (user && dirty) { event.preventDefault(); event.returnValue = ''; } });
render();
