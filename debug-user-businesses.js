// Debug user businesses access
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function debugUserBusinesses() {
  console.log('🔍 Debugging user businesses access...');
  
  try {
    const userId = '66051f90-6486-4ce3-b771-f51d3d39a8e9';
    
    console.log('👤 Checking user ID:', userId);
    
    // 1. Check businesses for this user
    console.log('\n🏪 Checking businesses...');
    const { data: businesses, error: businessesError } = await supabase
      .from('businesses')
      .select('id, name, city, owner_id, is_active')
      .eq('owner_id', userId);
    
    if (businessesError) {
      console.error('❌ Businesses error:', businessesError);
    } else {
      console.log('✅ Found businesses:', businesses);
    }
    
    // 2. Check restaurants with matching names
    if (businesses && businesses.length > 0) {
      console.log('\n🍽️ Checking corresponding restaurants...');
      const businessNames = businesses.map(b => b.name);
      const { data: restaurants, error: restaurantsError } = await supabase
        .from('restaurants')
        .select('id, name, city')
        .in('name', businessNames);
      
      if (restaurantsError) {
        console.error('❌ Restaurants error:', restaurantsError);
      } else {
        console.log('✅ Found restaurants:', restaurants);
      }
    }
    
    // 3. Test the exact query that BusinessPanel uses
    console.log('\n🔧 Testing BusinessPanel query...');
    const { data: testBusinesses, error: testError } = await supabase
      .from('businesses')
      .select('id,name')
      .eq('owner_id', userId)
      .order('name');
    
    if (testError) {
      console.error('❌ Test query error:', testError);
    } else {
      console.log('✅ Test query result:', testBusinesses);
    }
    
    // 4. Check if there are any RLS policies blocking access
    console.log('\n🔒 Checking RLS policies...');
    const { data: policies, error: policiesError } = await supabase
      .from('information_schema.policies')
      .select('*')
      .eq('table_name', 'businesses');
    
    if (policiesError) {
      console.error('❌ Policies error:', policiesError);
    } else {
      console.log('✅ RLS policies for businesses:', policies);
    }
    
  } catch (error) {
    console.error('❌ Debug error:', error);
  }
}

debugUserBusinesses();
