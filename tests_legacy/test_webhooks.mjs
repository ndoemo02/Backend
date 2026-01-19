import fetch from "node-fetch";

const BASE_URL = "https://freeflow-backend.vercel.app/api/dialogflow-freeflow";

async function testWebhook(tag, sessionParams = {}) {
  console.log(`\n🧩 Testing ${tag}...`);
  
  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fulfillmentInfo: { tag },
      sessionInfo: { parameters: sessionParams },
    }),
  });

  const data = await res.json();
  console.log(JSON.stringify(data, null, 2));
  return data;
}

async function runTests() {
  console.log("🚀 Starting webhook tests...\n");
  
  try {
    // 1️⃣ LIST RESTAURANTS
    console.log("=".repeat(50));
    console.log("1️⃣ Testing recommend_nearby");
    console.log("=".repeat(50));
    const list = await testWebhook("recommend_nearby");
    
    // Sprawdź czy mamy mapę nazwa→ID
    const map = list?.session_info?.parameters?.restaurant_name_to_id || {};
    console.log(`\n📋 Found ${Object.keys(map).length} restaurants in name-to-ID map`);
    
    if (Object.keys(map).length === 0) {
      console.log("❌ No restaurants found in map!");
      return;
    }
    
    const firstName = Object.keys(map)[0];
    const firstId = map[firstName];
    console.log(`🎯 Using first restaurant: "${firstName}" (ID: ${firstId})`);

    // 2️⃣ SELECT RESTAURANT
    console.log("\n" + "=".repeat(50));
    console.log("2️⃣ Testing select_restaurant");
    console.log("=".repeat(50));
    const select = await testWebhook("select_restaurant", {
      RestaurantName: firstName,
      restaurant_name_to_id: map,
    });
    
    // Sprawdź czy restaurant_id zostało zapisane
    const savedRestaurantId = select?.sessionInfo?.parameters?.restaurant_id;
    console.log(`\n💾 Saved restaurant_id: ${savedRestaurantId}`);
    
    if (!savedRestaurantId) {
      console.log("❌ No restaurant_id saved in session!");
      return;
    }

    // 3️⃣ GET MENU
    console.log("\n" + "=".repeat(50));
    console.log("3️⃣ Testing get_menu");
    console.log("=".repeat(50));
    const getMenu = await testWebhook("get_menu", { restaurant_id: savedRestaurantId });
    
    // Sprawdź czy menu zostało zwrócone
    const menuItems = getMenu?.custom_payload?.menu_items || [];
    console.log(`\n🍽️ Found ${menuItems.length} menu items`);
    
    if (menuItems.length === 0) {
      console.log("❌ No menu items found!");
      return;
    }
    
    console.log(`📋 First menu item: "${menuItems[0].name}" - ${menuItems[0].price} zł`);

    // 4️⃣ CREATE ORDER
    console.log("\n" + "=".repeat(50));
    console.log("4️⃣ Testing create_order");
    console.log("=".repeat(50));
    
    // Pobierz items_map z get_menu response
    const itemsMap = getMenu?.session_info?.parameters?.items_map || {};
    console.log(`🗺️ Items map: ${Object.keys(itemsMap).length} items`);
    
    const createOrder = await testWebhook("create_order", {
      restaurant_id: savedRestaurantId,
      item_name: menuItems[0].name,
      items_map: itemsMap,
      qty: 1,
    });
    
    // Sprawdź czy zamówienie zostało utworzone
    const orderId = createOrder?.sessionInfo?.parameters?.order_id;
    const priceTotal = createOrder?.sessionInfo?.parameters?.price_total;
    console.log(`\n🛒 Order created: ${orderId}`);
    console.log(`💰 Total price: ${priceTotal}`);

    console.log("\n" + "=".repeat(50));
    console.log("✅ ALL TESTS COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(50));
    
    // Podsumowanie
    console.log("\n📊 Test Summary:");
    console.log(`   • Restaurants found: ${Object.keys(map).length}`);
    console.log(`   • Selected restaurant: "${firstName}"`);
    console.log(`   • Menu items: ${menuItems.length}`);
    console.log(`   • Order created: ${orderId ? 'Yes' : 'No'}`);
    
  } catch (error) {
    console.error("\n❌ Test failed:", error);
  }
}

runTests().catch(console.error);
