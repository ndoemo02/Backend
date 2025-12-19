// Setup script to connect ndoemo02@gmail.com to restaurants
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function setupUserRestaurants() {
  console.log('🔧 Setting up restaurant access for ndoemo02@gmail.com...');
  
  try {
    // 1. Find user by email
    console.log('👤 Looking for user ndoemo02@gmail.com...');
    const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) {
      console.error('❌ Auth error:', authError);
      return;
    }
    
    const user = authUsers.users.find(u => u.email === 'ndoemo02@gmail.com');
    
    if (!user) {
      console.error('❌ User ndoemo02@gmail.com not found in auth.users');
      console.log('Available users:', authUsers.users.map(u => u.email));
      return;
    }
    
    console.log('✅ Found user:', user.id, user.email);
    
    // 2. Check existing restaurants
    console.log('🏪 Checking existing restaurants...');
    const { data: restaurants, error: restaurantsError } = await supabase
      .from('restaurants')
      .select('id, name, city, owner_id')
      .order('name');
    
    if (restaurantsError) {
      console.error('❌ Restaurants error:', restaurantsError);
      return;
    }
    
    console.log('📋 Found restaurants:', restaurants);
    
    // 3. Update restaurants to be owned by ndoemo02@gmail.com
    if (restaurants && restaurants.length > 0) {
      console.log('🔗 Connecting restaurants to user...');
      
      for (const restaurant of restaurants) {
        const { error: updateError } = await supabase
          .from('restaurants')
          .update({ 
            owner_id: user.id,
            owner: user.id  // Update both fields for compatibility
          })
          .eq('id', restaurant.id);
        
        if (updateError) {
          console.error(`❌ Failed to update restaurant ${restaurant.name}:`, updateError);
        } else {
          console.log(`✅ Connected ${restaurant.name} to ${user.email}`);
        }
      }
    } else {
      console.log('⚠️ No restaurants found. Creating sample restaurants...');
      
      // Create sample restaurants
      const sampleRestaurants = [
        { name: 'Burger House', city: 'Piekary Śląskie' },
        { name: 'Restauracja Rezydencja', city: 'Piekary Śląskie' },
        { name: 'Pizzeria Napoli', city: 'Piekary Śląskie' },
        { name: 'Sushi Bar Tokyo', city: 'Piekary Śląskie' }
      ];
      
      for (const restaurantData of sampleRestaurants) {
        const { data: newRestaurant, error: createError } = await supabase
          .from('restaurants')
          .insert({
            name: restaurantData.name,
            city: restaurantData.city,
            owner_id: user.id,
            owner: user.id
          })
          .select()
          .single();
        
        if (createError) {
          console.error(`❌ Failed to create restaurant ${restaurantData.name}:`, createError);
        } else {
          console.log(`✅ Created restaurant: ${newRestaurant.name}`);
          
          // Add sample menu items
          const sampleMenuItems = [
            { name: 'Classic Burger', price: 39.00 },
            { name: 'BBQ Bacon Burger', price: 46.00 },
            { name: 'Frytki belgijskie', price: 15.00 },
            { name: 'Krążki cebulowe', price: 18.00 }
          ];
          
          for (const item of sampleMenuItems) {
            const { error: menuError } = await supabase
              .from('menu_items')
              .insert({
                restaurant_id: newRestaurant.id,
                name: item.name,
                price: item.price
              });
            
            if (menuError) {
              console.error(`❌ Failed to add menu item ${item.name}:`, menuError);
            } else {
              console.log(`  ✅ Added menu item: ${item.name} - ${item.price} zł`);
            }
          }
        }
      }
    }
    
    // 4. Verify the setup
    console.log('\n🔍 Verifying setup...');
    const { data: userRestaurants, error: verifyError } = await supabase
      .from('restaurants')
      .select('id, name, city, owner_id')
      .eq('owner_id', user.id);
    
    if (verifyError) {
      console.error('❌ Verification error:', verifyError);
    } else {
      console.log('✅ User now owns these restaurants:');
      userRestaurants.forEach(restaurant => {
        console.log(`  - ${restaurant.name} (${restaurant.city})`);
      });
    }
    
    console.log('\n🎉 Setup completed! You can now access the business panel.');
    
  } catch (error) {
    console.error('❌ Setup error:', error);
  }
}

setupUserRestaurants();
