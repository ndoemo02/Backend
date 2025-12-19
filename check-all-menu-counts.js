// check-all-menu-counts.js - Sprawdza ile pozycji menu ma każda restauracja
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAllMenuCounts() {
  console.log('🍽️  Sprawdzam liczbę pozycji menu dla wszystkich restauracji...\n');
  
  try {
    // Pobierz wszystkie restauracje
    const { data: restaurants, error: restError } = await supabase
      .from('restaurants')
      .select('id, name, city')
      .order('name');

    if (restError) {
      console.error('❌ Error:', restError);
      return;
    }

    console.log(`📊 Sprawdzam ${restaurants.length} restauracji...\n`);
    console.log('─'.repeat(80));

    for (const restaurant of restaurants) {
      // Policz pozycje menu dla każdej restauracji
      const { data: menu, error: menuError, count } = await supabase
        .from('menu_items')
        .select('id', { count: 'exact' })
        .eq('restaurant_id', restaurant.id);

      if (menuError) {
        console.log(`❌ ${restaurant.name} (${restaurant.city}): Error - ${menuError.message}`);
      } else {
        const menuCount = menu?.length || 0;
        const icon = menuCount >= 20 ? '🎯' : menuCount >= 10 ? '📋' : menuCount > 0 ? '📝' : '⚠️';
        console.log(`${icon} ${restaurant.name.padEnd(30)} (${restaurant.city.padEnd(20)}) - ${menuCount} pozycji`);
      }
    }

    console.log('─'.repeat(80));

    // Pokaż restauracje z największą liczbą pozycji
    const menuCounts = await Promise.all(
      restaurants.map(async (r) => {
        const { data } = await supabase
          .from('menu_items')
          .select('id')
          .eq('restaurant_id', r.id);
        return { ...r, menuCount: data?.length || 0 };
      })
    );

    menuCounts.sort((a, b) => b.menuCount - a.menuCount);

    console.log('\n🏆 TOP 5 RESTAURACJI Z NAJWIĘKSZĄ LICZBĄ POZYCJI:');
    menuCounts.slice(0, 5).forEach((r, i) => {
      console.log(`  ${i+1}. ${r.name} - ${r.menuCount} pozycji`);
    });

    console.log('\n⚠️  RESTAURACJE BEZ MENU:');
    const noMenu = menuCounts.filter(r => r.menuCount === 0);
    if (noMenu.length > 0) {
      noMenu.forEach(r => {
        console.log(`  ❌ ${r.name} (${r.city})`);
      });
    } else {
      console.log('  ✅ Wszystkie restauracje mają menu!');
    }

  } catch (error) {
    console.error('❌ Błąd:', error.message);
  }
}

checkAllMenuCounts();

