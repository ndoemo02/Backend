// scripts/inspect-menu-v2.js
// Prosty inspektor pozycji w menu_items_v2 dla nazw zawierających słowo-klucz

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function main() {
  const keyword = process.argv[2] || 'stara';
  console.log(`🔎 Szukam pozycji menu powiązanych z restauracjami zawierającymi: "${keyword}"`);

  const { data: restaurants, error: restErr } = await supabase
    .from('restaurants')
    .select('id,name')
    .ilike('name', `%${keyword}%`)
    .order('name', { ascending: true });

  if (restErr) throw restErr;
  if (!restaurants || restaurants.length === 0) {
    console.log('⚠️  Nie znaleziono restauracji');
    process.exit(0);
  }

  console.log(`🏪 Znaleziono ${restaurants.length} restauracji:`);
  restaurants.forEach(r => console.log(`- ${r.name} (${r.id})`));

  const ids = restaurants.map(r => r.id);
  const { data: items, error: itemsErr } = await supabase
    .from('menu_items_v2')
    .select('id,name,price_pln,restaurant_id,available')
    .in('restaurant_id', ids)
    .order('name', { ascending: true });

  if (itemsErr) throw itemsErr;
  console.log(`\n🍽️  Pozycji łącznie: ${items?.length || 0}`);

  for (const r of restaurants) {
    const group = items.filter(i => i.restaurant_id === r.id);
    console.log(`\n— ${r.name} (${r.id}) → ${group.length} pozycji`);
    group.slice(0, 10).forEach(i => {
      const price = i.price_pln ? `${Number(i.price_pln).toFixed(2)} zł` : 'brak ceny';
      const flag = i.available !== false ? '✅' : '❌';
      console.log(`  ${flag} ${i.name} - ${price}`);
    });
  }
}

main().catch(e => {
  console.error('❌ Błąd:', e.message);
  process.exit(1);
});



