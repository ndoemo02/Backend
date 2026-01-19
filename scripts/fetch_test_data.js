import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchData() {
    const output = { restaurants: [], menuSamples: {} };

    // 1. Fetch all restaurants
    const { data: restaurants, error: rErr } = await supabase
        .from('restaurants')
        .select('id, name, city, cuisine_type, address')
        .order('name');

    if (rErr) {
        console.error('Restaurant fetch error:', rErr);
        return;
    }

    output.restaurants = restaurants;

    // 2. Fetch menu items for each restaurant
    for (const r of restaurants) {
        const { data: menu } = await supabase
            .from('menu_items_v2')
            .select('id, name, price_pln, category, available')
            .eq('restaurant_id', r.id)
            .eq('available', true)
            .limit(10);

        if (menu && menu.length > 0) {
            output.menuSamples[r.id] = {
                restaurantName: r.name,
                items: menu
            };
        }
    }

    // Save to file
    fs.writeFileSync('test_data_dump.json', JSON.stringify(output, null, 2));
    console.log('Data saved to test_data_dump.json');
    console.log(`Found ${restaurants.length} restaurants`);
    console.log(`Found menu for ${Object.keys(output.menuSamples).length} restaurants`);
}

fetchData();
