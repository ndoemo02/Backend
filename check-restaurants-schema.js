// Check restaurants table schema
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function checkSchema() {
  console.log('🔍 Checking restaurants table schema...');
  
  try {
    // Try to get one record to see the structure
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .limit(1);
    
    if (error) {
      console.error('❌ Error:', error);
      
      // If table doesn't exist, let's check what tables do exist
      console.log('🔍 Checking available tables...');
      const { data: tables, error: tablesError } = await supabase
        .from('information_schema.tables')
        .select('table_name')
        .eq('table_schema', 'public');
      
      if (tablesError) {
        console.error('❌ Tables error:', tablesError);
      } else {
        console.log('📋 Available tables:', tables);
      }
      return;
    }
    
    console.log('✅ Restaurants table structure:');
    if (data && data.length > 0) {
      console.log('Columns:', Object.keys(data[0]));
      console.log('Sample record:', data[0]);
    } else {
      console.log('Table exists but is empty');
    }
    
  } catch (error) {
    console.error('❌ Schema check error:', error);
  }
}

checkSchema();
