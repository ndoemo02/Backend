// Check menu_items table schema
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function checkMenuItemsSchema() {
  console.log('🔍 Checking menu_items table schema...');
  
  try {
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .limit(3);
    
    if (error) {
      console.error('❌ Menu items error:', error);
      return;
    }
    
    console.log('✅ Menu items table structure:');
    if (data && data.length > 0) {
      console.log('Columns:', Object.keys(data[0]));
      console.log('Sample records:', data);
    } else {
      console.log('Menu items table exists but is empty');
    }
    
  } catch (error) {
    console.error('❌ Schema check error:', error);
  }
}

checkMenuItemsSchema();
