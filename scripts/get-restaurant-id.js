
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getRestaurant() {
    const { data, error } = await supabase.from('restaurants').select('id, name').limit(1);
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Result:', JSON.stringify(data));
    }
}

getRestaurant();
