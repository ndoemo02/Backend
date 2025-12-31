
import { pipeline } from '../brainV2.js';
import dotenv from 'dotenv';
dotenv.config();

async function runDebug() {
    try {
        console.log('--- DEBUG ORDER ---');
        // Krok 1: Ustawienie kontekstu (wybrana restauracja)
        // Symuluję sesję z wybranym Dworem Hubertus
        const sessionId = 'debug_order_sess';

        // Muszę ręcznie wymusić stan w sesji, ale pipeline V2 w tym setupie (debug) 
        // używa prawdziwego sessionStore, który jest in-memory.
        // Zatem muszę go "rozgrzać" pierwszym zapytaniem.

        console.log('1. Wybieram Hubertusa...');
        await pipeline.process(sessionId, "Pokaż menu w Hubertusie");

        console.log('2. Zamawiam roladę...');
        const result = await pipeline.process(sessionId, "Zamawiam roladę śląską");

        console.log('--- ORDER RESULT ---');
        console.log('Reply:', result.reply);
        console.log('Intent:', result.intent);
        console.log('Restaurants List Length (Should be 0):', result.restaurants ? result.restaurants.length : 'undefined');
        console.log('Pending Order:', JSON.stringify(result.mockContextUpdates?.pendingOrder || 'Check Real Session Store if not mocked'));

    } catch (e) {
        console.error('--- DEBUG ERROR ---');
        console.error(e);
    }
}

runDebug();
