
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log('🔍 Inspecting Supabase Schema...');

    // 1. Restaurants
    console.log('\n--- TABLE: restaurants ---');
    const { data: rData, error: rError } = await supabase
        .from('restaurants')
        .select('*')
        .limit(1);

    if (rError) console.error('Error:', rError.message);
    else if (rData.length) {
        console.log('Columns:', Object.keys(rData[0]).join(', '));
        console.log('Sample Row:', JSON.stringify(rData[0], null, 2));
    } else {
        console.log('Table empty or generic select failed.');
    }

    // 2. Menu Items
    console.log('\n--- TABLE: menu_items_v2 ---');
    const { data: mData, error: mError } = await supabase
        .from('menu_items_v2')
        .select('*')
        .limit(1);

    if (mError) console.error('Error:', mError.message);
    else if (mData.length) {
        console.log('Columns:', Object.keys(mData[0]).join(', '));
        console.log('Sample Row:', JSON.stringify(mData[0], null, 2));
    }

    // 3. Dump all restaurant names for Catalog
    console.log('\n--- CATALOG: All Restaurant Names ---');
    const { data: allR, error: allError } = await supabase
        .from('restaurants')
        .select('id, name, city, cuisine_type');

    if (allError) console.error('Error:', allError.message);
    else {
        console.log(JSON.stringify(allR, null, 2));
    }
}

inspectSchema();
