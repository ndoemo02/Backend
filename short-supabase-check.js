
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const envLocalPath = path.resolve(process.cwd(), '.env.local');
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envLocalPath)) dotenv.config({ path: envLocalPath });
else if (fs.existsSync(envPath)) dotenv.config({ path: envPath });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

const supabase = createClient(url, key);
supabase.from('restaurants').select('id', { count: 'exact', head: true }).then(({ error, count }) => {
    if (error) {
        console.log('SUPABASE_STATUS: ERROR');
        console.log('MSG:', error.message);
    } else {
        console.log('SUPABASE_STATUS: OK');
        console.log('RESTAURANTS_COUNT:', count);
    }
    process.exit(0);
});
