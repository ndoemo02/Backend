
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load envs
const envPath = path.resolve(process.cwd(), '.env');
const envLocalPath = path.resolve(process.cwd(), '.env.local');

if (fs.existsSync(envPath)) dotenv.config({ path: envPath });
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function checkSupabase() {
    console.log('--- Supabase Connection Status ---');
    console.log('URL:', url || 'MISSING');
    console.log('KEY:', key ? 'PRESENT' : 'MISSING');

    if (!url || !key) {
        console.error('❌ Error: Missing configuration.');
        return;
    }

    const supabase = createClient(url, key);

    try {
        const t0 = Date.now();
        // Sprawdzamy tabelę 'restaurants' lub 'conversations'
        const { data, error } = await supabase.from('restaurants').select('id').limit(1);
        const t1 = Date.now();

        if (error) {
            console.error('❌ Connection failed:', error.message);
        } else {
            console.log('✅ Connection successful!');
            console.log('Latency:', t1 - t0, 'ms');
            console.log('Data check (restaurants):', data.length > 0 ? 'Data exists' : 'Table empty');

            // Sprawdźmy też conversations
            const { data: convs } = await supabase.from('conversations').select('id').limit(1);
            console.log('Data check (conversations):', convs && convs.length > 0 ? 'Data exists' : 'Table empty');
        }
    } catch (err) {
        console.error('❌ Unexpected error:', err.message);
    }
}

checkSupabase();
