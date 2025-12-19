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

if (!url || !key) {
    console.error('Missing Supabase envs');
    process.exit(1);
}

const supabase = createClient(url, key);

async function test() {
    console.log('Fetching conversations...');
    const { data, error } = await supabase
        .from('conversations')
        .select('*')
        .limit(5);

    if (error) {
        console.error('Error fetching conversations:', error);
    } else {
        console.log('Conversations count:', data.length);
        console.log('First 5 conversations:', JSON.stringify(data, null, 2));
    }

    console.log('Fetching events...');
    const { data: events, error: eventsError } = await supabase
        .from('conversation_events')
        .select('*')
        .limit(5);

    if (eventsError) {
        console.error('Error fetching events:', eventsError);
    } else {
        console.log('Events count:', events.length);
        console.log('First 5 events:', JSON.stringify(events, null, 2));
    }
}

test();
