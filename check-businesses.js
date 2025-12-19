// Sprawdzenie jakie restauracje są w bazie
import { supabase } from './lib/supabase.js';

async function checkBusinesses() {
  console.log('🔍 Checking businesses in database...');
  
  try {
    const { data, error } = await supabase
      .from('businesses')
      .select('id, name, is_active, is_verified')
      .limit(10);

    if (error) {
      console.error('❌ Database error:', error);
      return;
    }

    console.log('✅ Found businesses:', data);
    
    if (data && data.length > 0) {
      console.log('\n📋 Available business IDs:');
      data.forEach(business => {
        console.log(`- ${business.id} (${business.name}) - Active: ${business.is_active}, Verified: ${business.is_verified}`);
      });
    } else {
      console.log('❌ No businesses found in database');
    }

  } catch (error) {
    console.error('❌ Error:', error);
  }
}

checkBusinesses();





