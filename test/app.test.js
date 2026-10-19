import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('food portion editing, recipe creation, meal logging, weight and trends work through the DOM', async () => {
  const dom = new JSDOM('<div id="app"></div><dialog id="editor"></dialog><div id="notice"></div>', { url: 'http://localhost:5173' });
  const win = dom.window;
  Object.assign(globalThis, { window: win, document: win.document, localStorage: win.localStorage, FormData: win.FormData, confirm: () => true });
  win.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  win.HTMLDialogElement.prototype.close = function() { this.open = false; };
  await import('../src/app.js?dom-test');
  const $ = s => document.querySelector(s);
  const click = s => { assert.ok($(s), s); $(s).click(); };
  const set = (s, value, event = 'input') => {
    assert.ok($(s), s); $(s).value = value;
    $(s).dispatchEvent(new win.Event(event, { bubbles: true }));
  };
  const save = () => click('#dialog-form button[type="submit"]');
  const stored = () => JSON.parse(localStorage.getItem('daily:local:v1')).state;

  click('[data-tab="library"]');
  click('[data-action="edit-item"][data-id="food-1"]');
  set('[name="portionSize"]', '1 breast');
  set('[name="quantity"]', '200'); set('[name="calories"]', '330'); set('[name="protein"]', '62');
  save();
  assert.equal($('#editor').open, false);
  const foodRow = $('[data-action="edit-item"][data-id="food-1"]').closest('tr');
  assert.match(foodRow.textContent, /1 breast/);
  assert.match(foodRow.textContent, /200 g/);
  assert.equal(stored().foods.find(f => f.id === 'food-1').portionSize, '1 breast');

  click('[data-action="add-recipe"]');
  set('[name="name"]', 'Chicken bowl'); set('[name="portions"]', '4');
  set('[name="portionSize"]', '1 bowl');
  click('#add-ingredient');
  set('[data-index="0"] [data-field="itemId"]', 'food-1', 'change');
  set('[data-index="0"] [data-field="amount"]', '400', 'change');
  click('#add-ingredient');
  set('[data-index="1"] [data-field="itemId"]', 'food-25', 'change');
  set('[data-index="1"] [data-field="amount"]', '200', 'change');
  assert.match($('#recipe-total').textContent, /230 kcal/);
  save();
  assert.equal($('#editor').open, false);
  const recipe = stored().recipes[0];
  assert.equal(recipe.portionSize, '1 bowl');
  click(`[data-action="log-item"][data-id="${recipe.id}"]`);
  set('[name="amount"]', '2');
  assert.match($('#meal-preview').textContent, /460 kcal/);
  save();
  assert.equal(stored().meals[0].itemId, recipe.id);
  click('[data-tab="day"]');
  assert.match(document.querySelector('.metric-number').textContent, /460/);

  click('[data-action="add-meal"]');
  set('[name="calories"]', '300'); set('[name="protein"]', '20'); set('[name="description"]', 'Snack');
  save();
  assert.match(document.querySelector('.metric-number').textContent, /760/);
  click('[data-action="add-weight"]');
  const before = Date.now();
  set('[name="lbs"]', '180.2'); save();
  assert.equal(stored().weights[0].lbs, 180.2);
  assert.ok(Date.parse(stored().weights[0].timestamp) >= before);
  click('[data-tab="trends"]');
  assert.equal(document.querySelectorAll('svg').length, 3);
  assert.match(document.querySelector('.data-details').textContent, /180.2/);

  // Editing a food updates already-logged recipe portions.
  click('[data-tab="library"]'); click('[data-action="edit-item"][data-id="food-1"]');
  set('[name="calories"]', '400'); save();
  click('[data-tab="day"]');
  assert.match(document.querySelector('.metric-number').textContent, /830/);
  dom.window.close();
});

test('a sync conflict preserves the old revision across sign-ins until the Sheet is explicitly loaded', async () => {
  const { newState } = await import('../src/seed.js');
  const cloudState = newState(), pendingState = newState();
  pendingState.foods[0].portionSize = '1 breast';
  const dom = new JSDOM('<div id="app"></div><dialog id="editor"></dialog><div id="notice"></div>', { url: 'http://localhost:5173' });
  const win = dom.window;
  win.DIET_CONFIG = { googleClientId: 'client', appsScriptUrl: 'https://example.test/exec' };
  let callback;
  const sdk = { accounts: { id: {
    initialize: options => { callback = options.callback; },
    renderButton: () => {}, disableAutoSelect: () => {},
  } } };
  Object.assign(globalThis, { window: win, document: win.document, localStorage: win.localStorage, FormData: win.FormData, confirm: () => true, google: sdk });
  win.google = sdk;
  const key = 'daily:google:owner';
  localStorage.setItem(key, JSON.stringify({ state: pendingState, dirty: true, revision: 'old' }));
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_, options) => {
    requests++;
    assert.equal(JSON.parse(options.body).action, 'load');
    return { ok: true, json: async () => ({ ok: true, user: { sub: 'owner', email: 'owner@example.com' }, state: cloudState, revision: 'new' }) };
  };
  try {
    await import('../src/app.js?sync-test');
    document.querySelector('[data-tab="settings"]').click();
    const finishSignIn = async () => {
      callback({ credential: 'test-token' });
      await new Promise(resolve => setImmediate(resolve));
    };
    await finishSignIn();
    assert.equal(document.querySelector('#sync-status').textContent, 'Sync conflict');
    assert.equal(JSON.parse(localStorage.getItem(key)).revision, 'old');
    assert.equal(JSON.parse(localStorage.getItem(key)).state.foods[0].portionSize, '1 breast');
    document.querySelector('[data-action="logout"]').click();
    await finishSignIn();
    assert.equal(document.querySelector('#sync-status').textContent, 'Sync conflict');
    assert.equal(requests, 2);
    document.querySelector('[data-action="refresh"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(document.querySelector('#sync-status').textContent, 'Saved to Sheets');
    assert.equal(JSON.parse(localStorage.getItem(key)).revision, 'new');
    assert.equal(JSON.parse(localStorage.getItem(key)).dirty, false);
    assert.equal(JSON.parse(localStorage.getItem(key)).state.foods[0].portionSize, '100 g');
  } finally { globalThis.fetch = originalFetch; dom.window.close(); }
});

test('configured app requires prominent sign-in, preserves local records, and shows failed and successful saves', async () => {
  const { newState } = await import('../src/seed.js');
  const local = newState(), cloud = newState();
  const stamp = new Date().toISOString();
  local.meals.push({ id: 'local-meal', description: 'Existing local lunch', date: stamp.slice(0, 10), timestamp: stamp, calories: 400, protein: 30 });
  cloud.recipes.push({ id: 'r', name: 'Chicken', portionSize: '1 portion', portions: 2, ingredients: [{ itemId: 'food-1', amount: 100, unit: 'g' }] });
  cloud.weights.push({ id: 'w', lbs: 180, timestamp: stamp });
  const dom = new JSDOM('<div id="app"></div><dialog id="editor"></dialog><div id="notice"></div>', { url: 'http://localhost:5173' });
  const win = dom.window;
  win.DIET_CONFIG = { googleClientId: 'client', appsScriptUrl: 'https://example.test/exec' };
  let callback, savePayload, finishSave;
  const sdk = { accounts: { id: {
    initialize: options => { callback = options.callback; },
    renderButton: element => { element.innerHTML = '<button>Sign in with Google</button>'; },
    disableAutoSelect: () => {},
  } } };
  Object.assign(globalThis, { window: win, document: win.document, localStorage: win.localStorage, FormData: win.FormData, confirm: () => true, google: sdk });
  win.google = sdk;
  win.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  win.HTMLDialogElement.prototype.close = function() { this.open = false; };
  localStorage.setItem('daily:local:v1', JSON.stringify({ state: local, dirty: true, revision: null }));
  const originalFetch = globalThis.fetch;
  let failLogin = true;
  globalThis.fetch = async (_, options) => {
    const request = JSON.parse(options.body);
    if (request.action === 'load') return { ok: true, json: async () => failLogin ? { ok: false, error: 'Account not authorized.' } : { ok: true, user: { sub: 'owner', email: 'owner@example.com' }, state: cloud, revision: 'a' } };
    savePayload = request.state;
    return new Promise(resolve => { finishSave = resolve; });
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  try {
    await import('../src/app.js?login-gate-test');
    assert.equal(document.querySelector('h1').textContent, 'Sign in to sync');
    assert.ok(document.querySelector('#google-button button'));
    assert.equal(document.querySelector('#sync-status').textContent, 'Sign in required');
    assert.equal(document.querySelector('[data-action="add-meal"]'), null);
    assert.ok(document.querySelector('[data-action="export"]'));
    assert.match(document.querySelector('.local-recovery').textContent, /preserved/);
    callback({ credential: 'test' }); await settle();
    assert.match(document.querySelector('#sync-detail').textContent, /Account not authorized/);
    assert.equal(document.querySelector('h1').textContent, 'Sign in to sync');
    failLogin = false;
    callback({ credential: 'test' }); await settle();
    assert.equal(document.querySelector('#sync-status').textContent, 'Saved to Sheets');
    assert.equal(JSON.parse(localStorage.getItem('daily:local:v1')).state.meals.length, 1);
    document.querySelector('[data-action="add-meal"]').click();
    const form = document.querySelector('#dialog-form');
    form.elements.calories.value = '500'; form.elements.protein.value = '40'; form.elements.description.value = 'Dinner';
    form.querySelector('button[type="submit"]').click();
    assert.equal(document.querySelector('#sync-warning').hidden, false);
    assert.equal(savePayload.recipes[0].id, 'r');
    assert.equal(savePayload.weights[0].lbs, 180);
    assert.equal(savePayload.meals[0].description, 'Dinner');
    assert.equal(savePayload.foods.length, 33);
    assert.deepEqual(savePayload.settings, cloud.settings);
    finishSave({ ok: false }); await settle();
    assert.equal(document.querySelector('#sync-status').textContent, 'Not saved to Sheets');
    assert.equal(document.querySelector('#sync-warning').hidden, false);
    assert.equal(JSON.parse(localStorage.getItem('daily:google:owner')).dirty, true);
    document.querySelector('#sync-warning [data-action="sync"]').click();
    finishSave({ ok: true, json: async () => ({ ok: true, revision: 'b' }) }); await settle();
    assert.equal(document.querySelector('#sync-status').textContent, 'Saved to Sheets');
    assert.equal(document.querySelector('#sync-warning').hidden, true);
    assert.equal(JSON.parse(localStorage.getItem('daily:google:owner')).dirty, false);
  } finally { globalThis.fetch = originalFetch; dom.window.close(); }
});
