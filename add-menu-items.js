// Add menu items to the created restaurants
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function addMenuItems() {
  console.log('🍽️ Adding menu items to restaurants...');
  
  try {
    const userId = '66051f90-6486-4ce3-b771-f51d3d39a8e9';
    
    // Get user's businesses
    const { data: businesses, error: businessesError } = await supabase
      .from('businesses')
      .select('id, name, city')
      .eq('owner_id', userId);
    
    if (businessesError) {
      console.error('❌ Businesses error:', businessesError);
      return;
    }
    
    console.log('📋 Found businesses:', businesses);
    
    // For each business, we need to find or create corresponding restaurant
    for (const business of businesses) {
      console.log(`\n🏪 Processing ${business.name}...`);
      
      // Check if restaurant exists with this name
      const { data: existingRestaurant, error: restaurantError } = await supabase
        .from('restaurants')
        .select('id, name')
        .eq('name', business.name)
        .single();
      
      let restaurantId;
      
      if (restaurantError || !existingRestaurant) {
        // Create restaurant entry
        console.log(`  Creating restaurant entry for ${business.name}...`);
        const { data: newRestaurant, error: createError } = await supabase
          .from('restaurants')
          .insert({
            name: business.name,
            city: business.city,
            address: `${business.name} Address`,
            phone: '+48 32 123 45 67'
          })
          .select()
          .single();
        
        if (createError) {
          console.error(`  ❌ Failed to create restaurant:`, createError);
          continue;
        }
        
        restaurantId = newRestaurant.id;
        console.log(`  ✅ Created restaurant with ID: ${restaurantId}`);
      } else {
        restaurantId = existingRestaurant.id;
        console.log(`  ✅ Found existing restaurant with ID: ${restaurantId}`);
      }
      
      // Add menu items based on restaurant type
      let menuItems = [];
      
      if (business.name.includes('Burger')) {
        menuItems = [
          { name: 'Classic Burger', price_cents: 3900, category: 'burger', prep_min: 15 },
          { name: 'BBQ Bacon Burger', price_cents: 4600, category: 'burger', prep_min: 18 },
          { name: 'Frytki belgijskie', price_cents: 1500, category: 'dodatki', prep_min: 8 },
          { name: 'Krążki cebulowe', price_cents: 1800, category: 'dodatki', prep_min: 10 },
          { name: 'Cola', price_cents: 800, category: 'napoje', prep_min: 2 }
        ];
      } else if (business.name.includes('Pizza') || business.name.includes('Napoli')) {
        menuItems = [
          { name: 'Pizza Margherita', price_cents: 3200, category: 'pizza', prep_min: 20 },
          { name: 'Pizza Pepperoni', price_cents: 3800, category: 'pizza', prep_min: 22 },
          { name: 'Pizza Capricciosa', price_cents: 4200, category: 'pizza', prep_min: 25 },
          { name: 'Frytki', price_cents: 1200, category: 'dodatki', prep_min: 8 },
          { name: 'Cola', price_cents: 800, category: 'napoje', prep_min: 2 }
        ];
      } else if (business.name.includes('Sushi')) {
        menuItems = [
          { name: 'Sushi Set 8 szt.', price_cents: 4500, category: 'sushi', prep_min: 15 },
          { name: 'Sushi Set 12 szt.', price_cents: 6500, category: 'sushi', prep_min: 20 },
          { name: 'Maki California', price_cents: 2800, category: 'sushi', prep_min: 12 },
          { name: 'Sake', price_cents: 1200, category: 'napoje', prep_min: 5 }
        ];
      } else {
        // Default menu for other restaurants
        menuItems = [
          { name: 'Schabowy z ziemniakami', price_cents: 3500, category: 'danie', prep_min: 25 },
          { name: 'Pierogi ruskie 10 szt.', price_cents: 2600, category: 'danie', prep_min: 15 },
          { name: 'Barszcz czerwony', price_cents: 1200, category: 'zupa', prep_min: 8 },
          { name: 'Herbata', price_cents: 600, category: 'napoje', prep_min: 3 }
        ];
      }
      
      // Add menu items
      for (const item of menuItems) {
        const { error: menuError } = await supabase
          .from('menu_items')
          .insert({
            restaurant_id: restaurantId,
            name: item.name,
            price_cents: item.price_cents,
            category: item.category,
            prep_min: item.prep_min,
            available: true
          });
        
        if (menuError) {
          console.error(`  ❌ Failed to add menu item ${item.name}:`, menuError);
        } else {
          console.log(`  ✅ Added: ${item.name} - ${item.price_cents/100} zł`);
        }
      }
    }
    
    console.log('\n🎉 Menu items setup completed!');
    
  } catch (error) {
    console.error('❌ Menu setup error:', error);
  }
}

addMenuItems();
