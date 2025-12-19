// check-callzone-menu.js - Sprawdza menu Callzone w bazie
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CALLZONE_ID = 'bd9f2244-7618-4071-aa96-52616a7b4c70';

async function checkCallzoneMenu() {
  console.log('🍽️  Sprawdzam menu Callzone...\n');
  
  try {
    // Pobierz wszystkie pozycje menu dla Callzone z menu_items_v2
    const { data: menu, error } = await supabase
      .from('menu_items_v2')
      .select('*')
      .eq('restaurant_id', CALLZONE_ID)
      .order('name', { ascending: true });

    if (error) {
      console.error('❌ Error:', error);
      return;
    }

    if (!menu || menu.length === 0) {
      console.log('⚠️  Brak pozycji menu dla Callzone');
      return;
    }

    console.log(`✅ Znaleziono ${menu.length} pozycji menu dla Callzone\n`);
    
    // Pokaż pierwsze 5 pozycji aby sprawdzić strukturę
    if (menu.length > 0) {
      console.log('📋 Przykładowa pozycja (struktura):');
      console.log(JSON.stringify(menu[0], null, 2));
      console.log('\n');
    }

    // Wyświetl wszystkie pozycje
    console.log('📋 WSZYSTKIE POZYCJE MENU:');
    console.log('─'.repeat(60));
    menu.forEach((item, i) => {
      const price = item.price_pln ? `${Number(item.price_pln).toFixed(2)} zł` : 'brak ceny';
      const available = item.available !== false ? '✅' : '❌';
      console.log(`  ${i+1}. ${available} ${item.name} - ${price}`);
    });

    console.log('\n' + '='.repeat(60));
    console.log(`📊 PODSUMOWANIE:`);
    console.log(`   Wszystkich pozycji: ${menu.length}`);
    console.log(`   Dostępnych: ${menu.filter(m => m.available !== false).length}`);
    console.log(`   Niedostępnych: ${menu.filter(m => m.available === false).length}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Błąd:', error.message);
  }
}

checkCallzoneMenu();

