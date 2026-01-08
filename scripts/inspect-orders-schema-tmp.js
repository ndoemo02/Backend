
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
    console.log('🔍 Inspecting Supabase Schema for ORDERS...');

    const { data: oData, error: oError } = await supabase
        .from('orders')
        .select('*')
        .limit(1);

    if (oError) {
        console.error('Error fetching orders:', oError.message);
    } else if (oData && oData.length > 0) {
        console.log('--- TABLE: orders ---');
        console.log('Columns:', Object.keys(oData[0]).join(', '));
        console.log('Sample Row:', JSON.stringify(oData[0], null, 2));
    } else {
        // Try to get columns even if empty
        const { data: d2, error: e2 } = await supabase.from('orders').select().limit(0);
        console.log('Table empty, columns (via empty select):', d2?.[0] ? Object.keys(d2[0]) : 'unknown');
    }
}

inspectSchema();
