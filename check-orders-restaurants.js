// Check orders and their restaurant connections
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function checkOrdersRestaurants() {
  console.log('🔍 Checking orders and restaurant connections...');
  
  try {
    const userId = '66051f90-6486-4ce3-b771-f51d3d39a8e9';
    
    // Get user's businesses
    const { data: businesses, error: businessesError } = await supabase
      .from('businesses')
      .select('id, name')
      .eq('owner_id', userId);
    
    if (businessesError) {
      console.error('❌ Businesses error:', businessesError);
      return;
    }
    
    console.log('📋 User businesses:', businesses);
    
    // Get corresponding restaurants
    const businessNames = businesses.map(b => b.name);
    const { data: restaurants, error: restaurantsError } = await supabase
      .from('restaurants')
      .select('id, name')
      .in('name', businessNames);
    
    if (restaurantsError) {
      console.error('❌ Restaurants error:', restaurantsError);
      return;
    }
    
    console.log('🏪 Corresponding restaurants:', restaurants);
    
    // Get orders for these restaurants
    const restaurantIds = restaurants.map(r => r.id);
    if (restaurantIds.length > 0) {
      const { data: orders, error: ordersError } = await supabase
        .from('orders')
        .select('id, restaurant_id, status, total_cents, created_at')
        .in('restaurant_id', restaurantIds)
        .order('created_at', { ascending: false })
        .limit(10);
      
      if (ordersError) {
        console.error('❌ Orders error:', ordersError);
      } else {
        console.log('📦 Orders for user restaurants:', orders);
      }
    }
    
    // Create a test order for one of the restaurants
    if (restaurants.length > 0) {
      console.log('\n🧪 Creating a test order...');
      const testRestaurantId = restaurants[0].id;
      
      const { data: testOrder, error: testOrderError } = await supabase
        .from('orders')
        .insert({
          restaurant_id: testRestaurantId,
          user_id: userId,
          subtotal_cents: 3900,
          total_cents: 3900,
          status: 'pending',
          delivery: true,
          eta: '15-20 min'
        })
        .select()
        .single();
      
      if (testOrderError) {
        console.error('❌ Test order error:', testOrderError);
      } else {
        console.log('✅ Created test order:', testOrder);
      }
    }
    
  } catch (error) {
    console.error('❌ Check error:', error);
  }
}

checkOrdersRestaurants();
