
import { supabase } from '../../_supabase.js';

// Base Interface (Documentation Only in JS)
// interface RestaurantRepository {
//   searchRestaurants(city: string, cuisine?: string): Promise<Restaurant[]>;
//   getMenu(restaurantId: string): Promise<MenuItem[]>;
// }

export class SupabaseRestaurantRepository {
    async searchRestaurants(city, cuisine) {
        let query = supabase
            .from('restaurants')
            .select('id, name, address, city, cuisine_type, lat, lng')
            .ilike('city', `%${city}%`);

        if (cuisine) {
            query = query.ilike('cuisine_type', `%${cuisine}%`);
        }

        const { data, error } = await query.limit(10);
        if (error) throw error;
        return data || [];
    }

    async getMenu(restaurantId) {
        const { data, error } = await supabase
            .from('menu_items_v2')
            .select('id, name, price_pln, description, category, available')
            .eq('restaurant_id', restaurantId);

        if (error) throw error;
        return data || [];
    }
}

export class InMemoryRestaurantRepository {
    constructor(data) {
        this.restaurants = data.restaurants || [];
        this.menuSamples = data.menuSamples || {};
    }

    async searchRestaurants(city, cuisine) {
        // console.log(`[InMemory] Search: city="${city}", cuisine="${cuisine}" (Total: ${this.restaurants.length})`);
        if (!city) return [];

        const cityNorm = city.toLowerCase();

        const matches = this.restaurants.filter(r => {
            const rCity = (r.city || "").toLowerCase();
            if (!rCity.includes(cityNorm)) return false;

            // Cuisine check (ilike)
            if (cuisine) {
                const cType = (r.cuisine_type || "").toLowerCase();
                if (!cType.includes(cuisine.toLowerCase())) return false;
            }
            return true;
        });

        return matches.slice(0, 10);
    }

    async getMenu(restaurantId) {
        const sample = this.menuSamples[restaurantId];
        return sample ? sample.items : [];
    }
}
