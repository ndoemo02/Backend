// Setup business access for ndoemo02@gmail.com
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://xdhlztmjktminrwmzcpl.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhkaGx6dG1qa3RtaW5yd216Y3BsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTY3MjgwMTEsImV4cCI6MjA3MjMwNDAxMX0.EmvBqbygr4VLD3PXFaPjbChakRi5YtSrxp8e_K7ZyGY'
);

async function setupBusinessAccess() {
  console.log('🔧 Setting up business access for ndoemo02@gmail.com...');
  
  try {
    // Use the user ID that already has a business
    const userId = '66051f90-6486-4ce3-b771-f51d3d39a8e9';
    
    console.log('👤 Using user ID:', userId);
    
    // 1. Check existing businesses for this user
    console.log('🏪 Checking existing businesses...');
    const { data: existingBusinesses, error: existingError } = await supabase
      .from('businesses')
      .select('id, name, city, owner_id, is_active')
      .eq('owner_id', userId);
    
    if (existingError) {
      console.error('❌ Existing businesses error:', existingError);
      return;
    }
    
    console.log('📋 Found existing businesses:', existingBusinesses);
    
    // 2. Create additional restaurants for this user
    console.log('🍽️ Creating additional restaurants...');
    
    const newRestaurants = [
      {
        name: 'Burger House',
        city: 'Piekary Śląskie',
        address: 'ul. Główna 15, Piekary Śląskie',
        phone: '+48 32 123 45 67',
        email: 'burger@house.pl',
        description: 'Najlepsze burgery w mieście',
        category_id: '7308b142-d103-4634-84db-fbe5b09ca8ef', // restaurant category
        nip: '1234567891'
      },
      {
        name: 'Restauracja Rezydencja',
        city: 'Piekary Śląskie',
        address: 'ul. Zamkowa 8, Piekary Śląskie',
        phone: '+48 32 234 56 78',
        email: 'info@rezydencja.pl',
        description: 'Elegancka restauracja z tradycyjną kuchnią',
        category_id: '7308b142-d103-4634-84db-fbe5b09ca8ef',
        nip: '1234567892'
      },
      {
        name: 'Pizzeria Napoli',
        city: 'Piekary Śląskie',
        address: 'ul. Włoska 22, Piekary Śląskie',
        phone: '+48 32 345 67 89',
        email: 'napoli@pizza.pl',
        description: 'Autentyczna pizza włoska',
        category_id: '7308b142-d103-4634-84db-fbe5b09ca8ef',
        nip: '1234567893'
      },
      {
        name: 'Sushi Bar Tokyo',
        city: 'Piekary Śląskie',
        address: 'ul. Japońska 5, Piekary Śląskie',
        phone: '+48 32 456 78 90',
        email: 'tokyo@sushi.pl',
        description: 'Świeże sushi i japońska kuchnia',
        category_id: '7308b142-d103-4634-84db-fbe5b09ca8ef',
        nip: '1234567894'
      }
    ];
    
    for (const restaurantData of newRestaurants) {
      // Check if restaurant already exists
      const existing = existingBusinesses?.find(b => b.name === restaurantData.name);
      if (existing) {
        console.log(`⚠️ Restaurant ${restaurantData.name} already exists, skipping...`);
        continue;
      }
      
      const { data: newBusiness, error: createError } = await supabase
        .from('businesses')
        .insert({
          ...restaurantData,
          owner_id: userId,
          is_verified: true,
          is_active: true
        })
        .select()
        .single();
      
      if (createError) {
        console.error(`❌ Failed to create restaurant ${restaurantData.name}:`, createError);
      } else {
        console.log(`✅ Created restaurant: ${newBusiness.name}`);
        
        // Add sample menu items to restaurants table
        const sampleMenuItems = [
          { name: 'Classic Burger', price: 39.00 },
          { name: 'BBQ Bacon Burger', price: 46.00 },
          { name: 'Frytki belgijskie', price: 15.00 },
          { name: 'Krążki cebulowe', price: 18.00 },
          { name: 'Cola', price: 8.00 }
        ];
        
        for (const item of sampleMenuItems) {
          const { error: menuError } = await supabase
            .from('menu_items')
            .insert({
              business_id: newBusiness.id,
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
    
    // 3. Verify the setup
    console.log('\n🔍 Verifying setup...');
    const { data: userBusinesses, error: verifyError } = await supabase
      .from('businesses')
      .select('id, name, city, owner_id, is_active')
      .eq('owner_id', userId);
    
    if (verifyError) {
      console.error('❌ Verification error:', verifyError);
    } else {
      console.log('✅ User now owns these businesses:');
      userBusinesses.forEach(business => {
        console.log(`  - ${business.name} (${business.city}) - Active: ${business.is_active}`);
      });
    }
    
    console.log('\n🎉 Setup completed!');
    console.log('📝 You can now:');
    console.log('  1. Log in to the frontend as ndoemo02@gmail.com');
    console.log('  2. Go to the Business Panel');
    console.log('  3. Select a restaurant to manage orders');
    console.log('  4. View and process incoming orders');
    
  } catch (error) {
    console.error('❌ Setup error:', error);
  }
}

setupBusinessAccess();
