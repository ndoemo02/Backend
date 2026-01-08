
import { pipeline } from '../brainV2.js';

async function test() {
    const sessionId = 'test-manual-' + Date.now();

    console.log("--- SCENARIO A ---");
    const resA = await pipeline.process(sessionId, "Gdzie zjem pizzę w Piekarach?");
    console.log("A Intent:", resA.intent);
    console.log("A Restaurants Length:", resA.restaurants?.length);

    console.log("\n--- SCENARIO B ---");
    const resB = await pipeline.process(sessionId, "Pokaż menu w Hubertusie");
    console.log("B Intent:", resB.intent);
    console.log("B Menu Length:", resB.menu?.length);

    console.log("\n--- SCENARIO C ---");
    const resC = await pipeline.process(sessionId, "Poproszę roladę wołową");
    console.log("C Intent:", resC.intent);
    console.log("C Restaurants Length:", resC.restaurants?.length);
    console.log("C Reply:", resC.reply);

    console.log("\n--- SCENARIO D ---");
    const resD = await pipeline.process(sessionId, "Tak");
    console.log("D Intent:", resD.intent);
    console.log("D Meta:", JSON.stringify(resD.meta, null, 2));
}

test().catch(console.error);
