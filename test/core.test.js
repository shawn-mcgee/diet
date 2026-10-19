import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newState } from '../src/seed.js';
import { nutrition, mealNutrition, validateState, references, dailyTotals, dateKey, shiftDate, amountInBase } from '../src/core.js';

function fixture() {
  const state = newState();
  state.recipes.push({ id: 'recipe', name: 'Chicken and rice', portionSize: '1 bowl', portions: 4, ingredients: [
    { itemId: 'food-1', amount: 400, unit: 'g' },
    { itemId: 'food-25', amount: 200, unit: 'g' },
  ] });
  return state;
}
test('starter library has editable text portion sizes and valid data', () => {
  const state = validateState(newState());
  assert.equal(state.foods.length, 33);
  assert.ok(state.foods.every(f => typeof f.portionSize === 'string'));
  state.foods[0].portionSize = '1 breast';
  assert.equal(validateState(state).foods[0].portionSize, '1 breast');
});
test('recipes calculate from ingredient amounts and yield; edits propagate through logs', () => {
  const state = fixture();
  const n = nutrition(state, 'recipe');
  assert.equal(n.calories, 230);
  assert.equal(n.protein, 32.35);
  const meal = { id: 'meal', itemId: 'recipe', amount: 1.5, unit: 'portion', date: '2026-10-18', timestamp: '2026-10-18T18:00:00Z', description: 'Lunch' };
  state.meals.push(meal);
  assert.equal(mealNutrition(state, meal).calories, 345);
  state.foods[0].calories = 200;
  assert.equal(mealNutrition(state, meal).calories, 397.5);
  assert.equal(dailyTotals(state, '2026-10-18').calories, 397.5);
  assert.equal(references(state, 'food-1'), true);
  assert.equal(references(state, 'recipe'), true);
});
test('portion labels do not change numeric calculations', () => {
  const state = fixture();
  const before = nutrition(state, 'recipe');
  state.foods[0].portionSize = '16oz';
  state.recipes[0].portionSize = '3 tbsp';
  validateState(state);
  assert.deepEqual(nutrition(state, 'recipe'), before);
});
test('legacy backups migrate portion labels without losing records', () => {
  const state = fixture();
  for (const f of state.foods) delete f.portionSize;
  delete state.recipes[0].portionSize;
  validateState(state);
  assert.equal(state.foods[0].portionSize, '100 g');
  assert.equal(state.recipes[0].portionSize, '1 portion');
});
test('nested recipes work, cycles and missing links are rejected', () => {
  const state = fixture();
  state.recipes.push({ id: 'nested', name: 'Double', portionSize: '1 plate', portions: 1, ingredients: [{ itemId: 'recipe', amount: 2, unit: 'portion' }] });
  assert.equal(nutrition(state, 'nested').calories, 460);
  state.recipes[0].ingredients.push({ itemId: 'nested', amount: 1, unit: 'portion' });
  assert.throws(() => validateState(state), /itself/);
  state.recipes[0].ingredients.pop();
  state.foods = state.foods.filter(f => f.id !== 'food-1');
  assert.throws(() => validateState(state), /no longer exists/);
});
test('ounces convert to grams, incompatible units fail', () => {
  assert.ok(Math.abs(amountInBase({ unit: 'g' }, 1, 'oz') - 28.349523125) < 1e-9);
  assert.throws(() => amountInBase({ unit: 'g' }, 1, 'cup'), /Incompatible/);
  assert.throws(() => amountInBase({ unit: 'g' }, -1, 'g'), /greater/);
});
test('invalid imports cannot add negative nutrition, invalid dates, or duplicate IDs', () => {
  const s = newState();
  s.foods[0].calories = -1;
  assert.throws(() => validateState(s), /Invalid food/);
  s.foods[0].calories = 165;
  s.meals.push({ id: 'm', description: 'Lunch', calories: 10, protein: 1, date: '2026-02-30', timestamp: new Date().toISOString() });
  assert.throws(() => validateState(s), /Invalid meal/);
  s.meals = [];
  s.foods.push({ ...s.foods[0] });
  assert.throws(() => validateState(s), /duplicate/);
});
test('local dates cross month boundaries without UTC conversion', () => {
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28');
  assert.equal(dateKey(new Date(2026, 9, 18, 23, 59)), '2026-10-18');
});
test('Apps Script validation matches the browser calculation source', () => {
  const core = readFileSync('src/core.js', 'utf8').replace(/^export const uid = .*\r?\n/m, '').replace(/^export /gm, '');
  assert.equal(readFileSync('apps-script/Validation.gs', 'utf8'), '// Generated from src/core.js by npm run sync:validation. Do not edit directly.\n' + core);
});
