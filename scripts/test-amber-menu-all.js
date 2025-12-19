// scripts/test-amber-menu-all.js
// Testuje losowe pozycje dla WSZYSTKICH restauracji, które mają wpisy w menu_items_v2

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function pickRandom(array, count) {
  const copy = [...array];
  const picked = [];
  while (copy.length && picked.length < count) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

async function callAmber(text, sessionId) {
  const res = await fetch(`${API_URL}/api/brain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sessionId }),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function loadMenuGroups() {
  // Pobierz wszystkie pozycje (limit bezpieczny)
  const { data: items, error } = await supabase
    .from('menu_items_v2')
    .select('id,name,restaurant_id,price_pln,available')
    .limit(5000);
  if (error) throw error;

  const byRestaurant = new Map();
  for (const it of items || []) {
    if (!it?.restaurant_id || !it?.name) continue;
    if (!byRestaurant.has(it.restaurant_id)) byRestaurant.set(it.restaurant_id, []);
    byRestaurant.get(it.restaurant_id).push(it);
  }

  const restaurantIds = Array.from(byRestaurant.keys());
  if (restaurantIds.length === 0) return { groups: [], restaurants: {} };

  const { data: restaurants, error: rErr } = await supabase
    .from('restaurants')
    .select('id,name')
    .in('id', restaurantIds);
  if (rErr) throw rErr;

  const restMap = Object.fromEntries((restaurants || []).map(r => [r.id, r.name]));
  const groups = restaurantIds
    .map(id => ({ id, name: restMap[id] || id, items: byRestaurant.get(id) }))
    .filter(g => (g.items?.length || 0) > 0);
  return { groups, restaurants: restMap };
}

async function testGroup(group) {
  const sessionId = `test-all-${group.id}-${Date.now()}`;
  console.log(`\n=== 🏪 ${group.name} (${group.id}) — items: ${group.items.length} ===`);

  // Ustaw kontekst sesji
  await callAmber(`Pokaż menu ${group.name}`, sessionId);

  const sample = pickRandom(group.items, Math.min(6, group.items.length));
  let hits = 0;
  const results = [];
  for (const it of sample) {
    const text = `Zamów ${it.name} w ${group.name}`;
    const resp = await callAmber(text, sessionId);
    const ok = resp.json?.ok === true;
    const intent = resp.json?.intent;
    const matched = ok && (intent === 'create_order' || intent === 'clarify_order' || intent === 'confirm_order');
    if (matched) hits += 1;
    results.push({ name: it.name, intent, matched });
    console.log(`${matched ? '✅' : '❌'} ${it.name} → intent=${intent || 'n/a'}`);
  }

  return { name: group.name, id: group.id, tested: sample.length, hits, misses: sample.length - hits };
}

async function main() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w env');
    }
    const { groups } = await loadMenuGroups();
    if (!groups.length) {
      console.log('⚠️  Brak restauracji z pozycjami w menu_items_v2');
      process.exit(0);
    }

    // Testuj tylko te z liczbą pozycji > 0
    const summaries = [];
    for (const g of groups) {
      summaries.push(await testGroup(g));
    }

    console.log('\n=== 📊 PODSUMOWANIE ===');
    for (const s of summaries) {
      console.log(`- ${s.name}: przetestowano ${s.tested}, trafienia ${s.hits}, pomyłki ${s.misses}`);
    }

    const allOk = summaries.every(s => s.hits > 0);
    process.exit(allOk ? 0 : 1);
  } catch (e) {
    console.error('❌ Błąd testu:', e.message);
    process.exit(1);
  }
}

main();



