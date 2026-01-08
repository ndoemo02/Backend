
import { pipeline } from '../brainV2.js';

async function test() {
    const sessionId = 'test-manual-' + Date.now();
    console.log("--- SCENARIO A ---");
    const resA = await pipeline.process(sessionId, "Gdzie zjem pizzę w Piekarach?");
    console.log("A Intent:", resA.intent);
    console.log("A Context expectedContext:", resA.context?.expectedContext);

    console.log("\n--- SCENARIO B ---");
    const resB = await pipeline.process(sessionId, "Pokaż menu w Hubertusie");
    console.log("B Intent:", resB.intent);
    console.log("B Context expectedContext:", resB.context?.expectedContext);

    console.log("\n--- SCENARIO C (EXACT) ---");
    const input = "Zamawiam dwie rolady wołowe";
    const result = await pipeline.process(sessionId, input);
    console.log("C Intent:", result.intent);
    console.log("C Source:", result.meta?.source);
    console.log("C Context expectedContext:", result.context?.expectedContext);
    console.log("C Reply:", result.reply);

}

test().catch(console.error);
