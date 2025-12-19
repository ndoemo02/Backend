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
    const { data, error } = await supabase
        .from('conversation_events')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching conversation_events:', error);
    } else {
        console.log('Success fetching conversation_events. Sample:', data);
    }
}

test();
