// scripts/test-amber-menu-matches.js
// Sprawdza losowe pozycje z menu_items_v2 dla wybranych restauracji
// i wysyła zapytania do Ambera: "Zamów [danie] w [restauracja]"

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const API_URL = process.env.API_URL || 'http://localhost:3000';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const RESTAURANTS = [
  { name: 'Stara kamienica' },
  { name: 'Callzone' },
];

function pickRandom(array, count) {
  const copy = [...array];
  const picked = [];
  while (copy.length && picked.length < count) {
    const idx = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(idx, 1)[0]);
  }
  return picked;
}

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  a = a || '';
  b = b || '';
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) m[i][j] = m[i - 1][j - 1];
      else m[i][j] = Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

async function getRestaurantByName(name) {
  const pattern = `%${name}%`;
  const { data, error } = await supabase
    .from('restaurants')
    .select('id, name')
    .ilike('name', pattern);
  if (error) throw error;

  if (data && data.length > 0) {
    const exact = data.find(r => r.name.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    // best includes or smallest distance
    const normTarget = normalize(name);
    const scored = data.map(r => ({
      r,
      score: normalize(r.name).includes(normTarget) ? 0 : levenshtein(normalize(r.name), normTarget)
    })).sort((a, b) => a.score - b.score);
    return scored[0].r;
  }

  // Fallback: pobierz wszystkie i zrób fuzzy
  const { data: all } = await supabase
    .from('restaurants')
    .select('id, name')
    .limit(5000);
  if (!all || all.length === 0) throw new Error('Brak restauracji w bazie');
  const normTarget = normalize(name);
  const scored = all.map(r => ({
    r,
    score: normalize(r.name).includes(normTarget) ? 0 : levenshtein(normalize(r.name), normTarget)
  })).sort((a, b) => a.score - b.score);
  const best = scored[0];
  if (!best) throw new Error(`Nie znaleziono restauracji: ${name}`);
  return best.r;
}

async function getMenuItems(restaurantId) {
  const { data, error } = await supabase
    .from('menu_items_v2')
    .select('id, name, price_pln, available')
    .eq('restaurant_id', restaurantId)
    .order('name', { ascending: true });
  if (error) throw error;
  return data || [];
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

async function testRestaurant(restaurantName) {
  const sessionId = `test-menu-${restaurantName.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;
  console.log(`\n=== 🏪 ${restaurantName} — session: ${sessionId} ===`);

  const restaurant = await getRestaurantByName(restaurantName);
  const items = await getMenuItems(restaurant.id);
  if (!items.length) {
    console.log(`⚠️  Brak pozycji w menu dla ${restaurantName}`);
    return { restaurant: restaurantName, total: 0, tested: 0, hits: 0, misses: 0, samples: [] };
  }

  const sample = pickRandom(items.filter(i => i?.name), Math.min(6, items.length));
  const results = [];

  // Ustaw kontekst sesji restauracji (żeby Amber znała ją w pamięci)
  const setCtx = await callAmber(`Pokaż menu ${restaurant.name}`, sessionId);
  if (!setCtx.json?.ok) {
    console.log('⚠️  Nie udało się ustawić kontekstu sesji:', setCtx);
  }

  for (const item of sample) {
    const text = `Zamów ${item.name} w ${restaurant.name}`;
    const resp = await callAmber(text, sessionId);
    const ok = resp.json?.ok === true;
    const intent = resp.json?.intent;
    const matched = ok && (intent === 'create_order' || intent === 'clarify_order' || intent === 'confirm_order');
    results.push({
      name: item.name,
      price: item.price_pln,
      available: item.available !== false,
      status: resp.status,
      intent,
      matched,
      reply: resp.json?.reply,
    });
    console.log(`${matched ? '✅' : '❌'} ${item.name} → intent=${intent || 'n/a'}`);
  }

  const hits = results.filter(r => r.matched).length;
  const misses = results.length - hits;
  return { restaurant: restaurant.name, total: items.length, tested: results.length, hits, misses, samples: results };
}

async function main() {
  try {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY w env');
    }
    const summaries = [];
    for (const r of RESTAURANTS) {
      summaries.push(await testRestaurant(r.name));
    }
    console.log('\n=== 📊 PODSUMOWANIE ===');
    for (const s of summaries) {
      console.log(`- ${s.restaurant}: przetestowano ${s.tested}/${s.total}, trafienia ${s.hits}, pomyłki ${s.misses}`);
    }
    const fail = summaries.some(s => s.hits === 0);
    process.exit(fail ? 1 : 0);
  } catch (e) {
    console.error('❌ Błąd testu:', e.message);
    process.exit(1);
  }
}

main();


