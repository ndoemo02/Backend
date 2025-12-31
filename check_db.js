import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { count, data, error } = await supabase
        .from('menu_items_v2')
        .select('name, available', { count: 'exact' })
        .eq('restaurant_id', '83566974-1017-4408-90ee-2571ccc06978');

    console.log({ count, error, first: data?.[0] });
}

check();
