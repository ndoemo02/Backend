
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
    console.log("Fetching conversations...");
    const { data: convs, error } = await supabase.from('conversations').select('*');
    if (error) {
        console.error("Error:", error);
    } else {
        console.log("Count:", convs.length);
        console.log("First 3:");
        console.log(JSON.stringify(convs.slice(0, 3), null, 2));
        if (convs.length > 0) {
            console.log("Keys:", Object.keys(convs[0]));
        }
    }
}

check();
