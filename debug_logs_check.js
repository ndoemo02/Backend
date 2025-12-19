
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Fallback if env not loaded (assume local dev usually has these set in system or .env)
const S_URL = process.env.SUPABASE_URL || 'PLEASE_CHECK_ENV';
const S_KEY = process.env.SUPABASE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'PLEASE_CHECK_ENV';

console.log(`Connecting to ${S_URL}...`);

const supabase = createClient(S_URL, S_KEY);

async function check() {
    console.log("\n--- LATEST CONVERSATIONS (Top 3) ---");
    // Sort by created_at descending (fixing the sorting issue I corrected in API earlier)
    const { data: convs, error: cErr } = await supabase
        .from('conversations')
        .select('*')
        .order('created_at', { ascending: false }) // or started_at if exists
        .limit(3);

    if (cErr) {
        console.error("❌ Error fetching conversations:", cErr.message);
        // Try fallback sort if created_at fails
        if (cErr.message.includes('created_at')) {
            console.log("Retrying with 'started_at'...");
            const { data: convs2 } = await supabase.from('conversations').select('*').order('started_at', { ascending: false }).limit(3);
            console.log(convs2);
        }
    } else {
        console.table(convs);
    }

    console.log("\n--- LATEST EVENTS (Top 5) ---");
    const { data: events, error: eErr } = await supabase
        .from('conversation_events')
        .select('event_type, payload, created_at')
        .order('created_at', { ascending: false })
        .limit(5);

    if (eErr) console.error("❌ Error fetching events:", eErr.message);
    else {
        events.forEach(e => {
            console.log(`[${e.created_at}] ${e.event_type}`);
            console.log(JSON.stringify(e.payload).substring(0, 150) + "...");
        });
    }
}

check();
