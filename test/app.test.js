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
