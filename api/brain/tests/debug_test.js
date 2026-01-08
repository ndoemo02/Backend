
import { pipeline } from '../brainV2.js';
import { RESTAURANT_CATALOG } from '../data/restaurantCatalog.js';

async function test() {
    const sessionId = 'test-manual-' + Date.now();

    console.log("--- SCENARIO A ---");
    const resA = await pipeline.process(sessionId, "Gdzie zjem pizzę w Piekarach?");
    console.log("Intent A:", resA.intent);
    console.log("Restaurants:", resA.restaurants?.length);

    console.log("\n--- SCENARIO B ---");
    const resB = await pipeline.process(sessionId, "Pokaż menu w Hubertusie");
    console.log("Intent B:", resB.intent);
    console.log("Menu defined:", !!resB.menu);
    console.log("Menu items:", resB.menu?.length);
    if (!resB.menu) console.log("Full Result B:", JSON.stringify(resB, null, 2));

    console.log("\n--- SCENARIO C ---");
    const resC = await pipeline.process(sessionId, "Poproszę roladę wołową");
    console.log("Intent C:", resC.intent);
    console.log("Reply C:", resC.reply);
}

test().catch(console.error);
