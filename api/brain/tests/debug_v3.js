
import { pipeline } from '../brainV2.js';
import dotenv from 'dotenv';
dotenv.config();

async function runDebug() {
    console.log('--- TEST START ---');
    // Mock context from previous step
    // Force inject session state logic? 
    // Since we use in-memory store in `sessionStore.js`, consecutive calls share state if ID matches.

    const id = 'sess_' + Date.now();
    await pipeline.process(id, "Pokaż menu w Hubertusie"); // Prime the session

    // Test Target
    const result = await pipeline.process(id, "Zamawiam roladę śląską");

    console.log('INTENT:', result.intent);
    console.log('RESTAURANTS_ARRAY:', JSON.stringify(result.restaurants));
    console.log('REPLY_START:', result.reply.substring(0, 20));
    console.log('--- TEST END ---');
}
runDebug();
