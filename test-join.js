import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve(process.cwd(), '.env');
const envLocalPath = path.resolve(process.cwd(), '.env.local');

if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
}
if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
}

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(url, key);

async function test() {
    console.log('Testing simple select from conversations...');
    const { data: d1, error: e1 } = await supabase.from('conversations').select('*').limit(1);
    console.log('d1:', d1 ? 'Success' : 'Fail', e1?.message);

    console.log('Testing join select...');
    const { data: d2, error: e2 } = await supabase
        .from('conversations')
        .select(`
            *,
            conversation_events (
                created_at
            )
        `)
        .limit(1);
    console.log('d2:', d2 ? 'Success' : 'Fail', e2?.message);
}

test();
