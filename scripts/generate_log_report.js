
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const S_URL = process.env.SUPABASE_URL;
const S_KEY = process.env.SUPABASE_KEY;
const supabase = createClient(S_URL, S_KEY);

async function dumpLogs() {
    console.log("### RAPORT Z OSTATNICH ROZMÓW ###\n");

    // 1. Pobierz sesje
    const { data: convs } = await supabase.from('conversations').select('*').limit(5); // bez order bo może nie działać
    if (!convs || convs.length === 0) {
        console.log("Brak zarejestrowanych rozmów.");
        return;
    }

    // 2. Pobierz zdarzenia dla w/w sesji
    // Pobieramy po prostu ostatnie 20 zdarzeń globalnie, bo chcemy widzieć co się działo przed chwilą.
    const { data: events } = await supabase
        .from('conversation_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

    if (!events) {
        console.log("Brak zdarzeń.");
        return;
    }

    console.log(`Znaleziono ${events.length} ostatnich zdarzeń (od najnowszych):\n`);

    events.forEach(e => {
        const time = new Date(e.created_at).toLocaleTimeString();
        let details = "";

        if (e.event_type === 'request_received') {
            details = `🗣️ User: "${e.payload.text}"`;
        } else if (e.event_type === 'intent_processed') {
            details = `🧠 Brain: Intent=${e.payload.intent} (Conf: ${e.payload.confidence})\n   Reply: "${e.payload.reply}"`;
        } else if (e.event_type === 'tool_execution') {
            details = `🛠️ Tool: ${e.payload.tool} -> ${JSON.stringify(e.payload.result).substring(0, 50)}...`;
        } else if (e.event_type === 'error_logged') {
            details = `❌ ERROR: ${e.payload.error}`;
        } else {
            details = JSON.stringify(e.payload).substring(0, 100);
        }

        console.log(`[${time}] ${e.event_type}`);
        console.log(`   ${details}`);
        console.log("-".repeat(40));
    });
}

dumpLogs();
