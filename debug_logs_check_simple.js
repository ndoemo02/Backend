
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const S_URL = process.env.SUPABASE_URL;
const S_KEY = process.env.SUPABASE_KEY;

if (!S_URL || !S_KEY) {
    console.log("MISSING ENV VARS");
    process.exit(1);
}

const supabase = createClient(S_URL, S_KEY);

async function check() {
    console.log("Checking DB Structure...");

    // Check conversations columns
    const { data: convs, error: cErr } = await supabase.from('conversations').select('*').limit(1);
    if (cErr) {
        console.log("Error reading conversations:", cErr.message);
    } else if (convs.length > 0) {
        console.log("Conversations Columns:", Object.keys(convs[0]));
        console.log("Sample Row:", JSON.stringify(convs[0]));
    } else {
        console.log("Conversations table is empty.");
        // Try to insert one to test
    }

    // Check events
    const { data: events, error: eErr } = await supabase.from('conversation_events').select('*').limit(1);
    if (eErr) {
        console.log("Error reading events:", eErr.message);
    } else if (events.length > 0) {
        console.log("Events Columns:", Object.keys(events[0]));
    } else {
        console.log("Events table is empty.");
    }
}

check();
