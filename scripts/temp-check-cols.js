
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
    'https://xdhlztmjktminrwmzcpl.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function check() {
    const { data, error } = await supabase.from('orders').select('*').limit(1);
    if (error) {
        console.error('ERROR:', error);
    } else if (data && data.length > 0) {
        console.log('COLUMNS:', Object.keys(data[0]));
    } else {
        // If table is empty, try to get column names via another method if possible
        console.log('TABLE EMPTY, fetching columns via RPC or metadata...');
        const { data: cols, error: err2 } = await supabase.rpc('inspect_columns', { table_name: 'orders' });
        if (err2) {
            console.log('RPC failed, trying empty select...');
            const { data: d2 } = await supabase.from('orders').select().limit(0);
            console.log('Keys of empty select:', Object.keys(d2?.[0] || {}));
        } else {
            console.log('COLS:', cols);
        }
    }
}
check();
