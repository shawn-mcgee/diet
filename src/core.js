export const uid = () => crypto.randomUUID();
export function dateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function shiftDate(key, days) {
  const date = new Date(`${key}T12:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}
export function amountInBase(item, amount, unit = item.unit) {
  if (!Number.isFinite(amount) || amount <= 0) throw Error('Enter an amount greater than zero.');
  if (unit === item.unit) return amount;
  if (item.unit === 'g' && unit === 'oz') return amount * 28.349523125;
  throw Error('Incompatible unit.');
}
export function nutrition(state, id, seen = new Set()) {
  const food = state.foods.find(f => f.id === id);
  if (food) return { calories: food.calories, protein: food.protein, quantity: food.quantity, unit: food.unit };
  const recipe = state.recipes.find(r => r.id === id);
  if (!recipe) throw Error('A referenced item no longer exists.');
  if (seen.has(id)) throw Error('A recipe cannot contain itself, even through another recipe.');
  const path = new Set([...seen, id]);
  const total = recipe.ingredients.reduce((sum, ingredient) => {
    const value = nutrition(state, ingredient.itemId, path);
    const factor = amountInBase(value, ingredient.amount, ingredient.unit) / value.quantity;
    return { calories: sum.calories + value.calories * factor, protein: sum.protein + value.protein * factor };
  }, { calories: 0, protein: 0 });
  return { calories: total.calories / recipe.portions, protein: total.protein / recipe.portions, quantity: 1, unit: 'portion' };
}
export function mealNutrition(state, meal) {
  if (!meal.itemId) return { calories: meal.calories, protein: meal.protein };
  const value = nutrition(state, meal.itemId);
  const factor = amountInBase(value, meal.amount, meal.unit) / value.quantity;
  return { calories: value.calories * factor, protein: value.protein * factor };
}
export function dailyTotals(state, day) {
  return state.meals.filter(m => m.date === day).reduce((sum, meal) => {
    const n = mealNutrition(state, meal);
    return { calories: sum.calories + n.calories, protein: sum.protein + n.protein };
  }, { calories: 0, protein: 0 });
}
export function references(state, id) {
  return state.recipes.some(r => r.ingredients.some(i => i.itemId === id)) || state.meals.some(m => m.itemId === id);
}
export function validateState(state) {
  const fail = message => { throw Error(message); };
  if (!state || state.schema !== 1 || !['foods', 'recipes', 'meals', 'weights'].every(k => Array.isArray(state[k]))) fail('Invalid backup format.');
  const num = (n, positive = false) => typeof n === 'number' && Number.isFinite(n) && (positive ? n > 0 : n >= 0) && n <= 1e7;
  const str = s => typeof s === 'string' && s.length > 0 && s.length <= 500;
  if (!num(state.settings?.calorieLimit, true) || !num(state.settings?.proteinGoal, true)) fail('Goals must be greater than zero.');
  const ids = new Set();
  for (const row of [...state.foods, ...state.recipes, ...state.meals, ...state.weights]) {
    if (!str(row.id) || ids.has(row.id)) fail('Invalid or duplicate ID.');
    ids.add(row.id);
  }
  for (const f of state.foods) {
    // Migrate existing libraries without discarding their saved entries.
    if (f.portionSize === undefined) f.portionSize = `${f.quantity} ${f.unit}`;
    if (!str(f.name) || !str(f.category) || !str(f.portionSize) || !str(f.unit) || !num(f.quantity, true) || !num(f.calories) || !num(f.protein)) fail('Invalid food.');
  }
  for (const r of state.recipes) {
    if (r.portionSize === undefined) r.portionSize = '1 portion';
    if (!str(r.name) || !str(r.portionSize) || !num(r.portions, true) || !Array.isArray(r.ingredients) || !r.ingredients.length) fail('Recipes need a name, portion label, yield, and ingredients.');
    for (const i of r.ingredients) if (!str(i.itemId) || !num(i.amount, true) || !str(i.unit)) fail('Invalid ingredient.');
    nutrition(state, r.id);
  }
  for (const m of state.meals) {
    if (!str(m.description) || !/^\d{4}-\d{2}-\d{2}$/.test(m.date) || dateKey(new Date(m.date + 'T12:00:00')) !== m.date || !Number.isFinite(Date.parse(m.timestamp))) fail('Invalid meal.');
    if (!m.itemId && (!num(m.calories) || !num(m.protein))) fail('Invalid meal nutrition.');
    if (m.itemId && (!num(m.amount, true) || !str(m.unit))) fail('Invalid meal amount.');
    mealNutrition(state, m);
  }
  for (const w of state.weights) if (!num(w.lbs, true) || !Number.isFinite(Date.parse(w.timestamp))) fail('Invalid weight.');
  return state;
}
