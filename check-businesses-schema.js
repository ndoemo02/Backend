// Check businesses table schema
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function checkBusinessesSchema() {
  console.log('🔍 Checking businesses table schema...');
  
  try {
    // Check businesses table
    const { data: businesses, error: businessesError } = await supabase
      .from('businesses')
      .select('*')
      .limit(3);
    
    if (businessesError) {
      console.error('❌ Businesses error:', businessesError);
    } else {
      console.log('✅ Businesses table structure:');
      if (businesses && businesses.length > 0) {
        console.log('Columns:', Object.keys(businesses[0]));
        console.log('Sample records:', businesses);
      } else {
        console.log('Businesses table exists but is empty');
      }
    }
    
    // Check profiles table
    console.log('\n🔍 Checking profiles table...');
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('*')
      .limit(3);
    
    if (profilesError) {
      console.error('❌ Profiles error:', profilesError);
    } else {
      console.log('✅ Profiles table structure:');
      if (profiles && profiles.length > 0) {
        console.log('Columns:', Object.keys(profiles[0]));
        console.log('Sample records:', profiles);
      } else {
        console.log('Profiles table exists but is empty');
      }
    }
    
  } catch (error) {
    console.error('❌ Schema check error:', error);
  }
}

checkBusinessesSchema();
