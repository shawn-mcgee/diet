import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { newState } from '../src/seed.js';

function backend(overrides = {}) {
  let rows = [['']], calls = 0;
  const sheet = {
    getDataRange: () => ({ getValues: () => structuredClone(rows) }),
    getLastRow: () => rows.length,
    getMaxRows: () => 1000,
    getRange: () => ({ setValues: data => { rows = structuredClone(data); } }),
  };
  const claims = { aud: 'client', iss: 'https://accounts.google.com', exp: Math.floor(Date.now() / 1000) + 3600, sub: 'owner', email_verified: true, email: 'owner@example.com', ...overrides };
  const context = vm.createContext({
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => ({ CLIENT_ID: 'client', ALLOWED_EMAIL: 'owner@example.com', SPREADSHEET_ID: 'sheet' })[key] }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put: () => {} }) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(claims) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, hasLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { openById: () => { calls++; return { getSheetByName: () => sheet }; }, flush: () => {} },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: text => ({ setMimeType: () => JSON.parse(text) }) },
    Utilities: {
      Charset: { UTF_8: 'utf8' }, DigestAlgorithm: { SHA_256: 'sha256' },
      computeDigest: (_, data) => createHash('sha256').update(data).digest(),
      base64EncodeWebSafe: data => Buffer.from(data).toString('base64url'),
      base64DecodeWebSafe: data => Buffer.from(data, 'base64url'),
      newBlob: data => ({ getDataAsString: () => Buffer.from(data).toString('utf8') }),
    },
  });
  vm.runInContext(readFileSync('apps-script/Validation.gs', 'utf8') + '\n' + readFileSync('apps-script/Code.gs', 'utf8'), context);
  const request = data => context.doPost({ postData: { contents: JSON.stringify({ credential: 'id-token', ...data }) } });
  return { request, get rows() { return rows; }, get calls() { return calls; } };
}
test('backend round-trips state, enforces revisions, and detects direct Sheet goal edits', () => {
  const api = backend();
  const initial = api.request({ action: 'load' });
  assert.equal(initial.ok, true); assert.equal(initial.state, null);
  const state = newState(); state.foods[0].portionSize = '1 breast';
  const saved = api.request({ action: 'save', state, revision: initial.revision });
  assert.equal(saved.ok, true);
  const loaded = api.request({ action: 'load' });
  assert.deepEqual(loaded.state, state);
  assert.equal(loaded.revision, saved.revision);
  assert.equal(api.request({ action: 'save', state, revision: initial.revision }).code, 'CONFLICT');
  api.rows[1][1] = 1800;
  const updated = api.request({ action: 'load' });
  assert.equal(updated.state.settings.calorieLimit, 1800);
  assert.notEqual(updated.revision, saved.revision);
  assert.equal(api.request({ action: 'save', state, revision: saved.revision }).code, 'CONFLICT');
  state.settings.proteinGoal = -1;
  assert.equal(api.request({ action: 'save', state, revision: updated.revision }).ok, false);
});
test('backend refuses wrong accounts, audiences, issuers, verification or expiration before accessing Sheets', () => {
  for (const claims of [{ email: 'other@example.com' }, { aud: 'other-client' }, { iss: 'https://evil.test' }, { email_verified: false }, { exp: 1 }]) {
    const api = backend(claims);
    assert.equal(api.request({ action: 'load' }).ok, false);
    assert.equal(api.calls, 0);
  }
});
test('backend chunks long snapshots without interpreting user text as Sheet formulas', () => {
  const api = backend();
  const initial = api.request({ action: 'load' });
  const state = newState();
  state.meals = Array.from({ length: 500 }, (_, i) => ({ id: `m${i}`, description: '=IMPORTDATA("https://example.test") ' + 'x'.repeat(150), calories: 100, protein: 10, timestamp: '2026-10-18T12:00:00Z', date: '2026-10-18' }));
  const saved = api.request({ action: 'save', state, revision: initial.revision });
  assert.equal(saved.ok, true);
  assert.ok(api.rows.length > 4);
  assert.ok(api.rows.slice(3).every(row => row[1].length <= 40000 && !row[1].startsWith('=')));
  assert.deepEqual(api.request({ action: 'load' }).state, state);
});
