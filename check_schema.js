
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function migrate() {
    console.log("Running migration via RPC (if sql_exec available) or skipping if manual...");

    // Niestety przez JS Client nie można robić DDL (alter table) bez specjalnej funkcji RPC.
    // Zakładam, że User MA TE KOLUMNY (napisał "Wykonałem następujące modyfikacje").
    // Sprawdzę tylko czy są, próbując selecta.

    try {
        const { data, error } = await supabase.from('conversations').select('status, ended_at').limit(1);
        if (error) {
            console.error("❌ Columns missing in conversations:", error.message);
            console.log("Please run the SQL manually in Supabase Dashboard SQL Editor.");
        } else {
            console.log("✅ Columns in 'conversations' confirm existence.");
        }

        const { data: d2, error: e2 } = await supabase.from('conversation_events').select('workflow_step, event_status').limit(1);
        if (e2) {
            console.error("❌ Columns missing in conversation_events:", e2.message);
        } else {
            console.log("✅ Columns in 'conversation_events' confirm existence.");
        }

    } catch (e) {
        console.error(e);
    }
}

migrate();
