
import { describe, it, expect } from 'vitest';
import { boostIntent } from '../intents/boostIntent.js';
import { updateSession, getSession } from '../context.js';

describe('🧠 Smart Intent System E2E', () => {

    it('Flow: Find Nearby -> Select -> Confirm Menu', () => {
        const sessionId = 'e2e-test-flow';

        // 1. Simulate state after "Poleć coś" -> System returns results
        updateSession(sessionId, {
            lastIntent: 'find_nearby',
            expectedContext: 'select_restaurant',
            last_restaurants_list: [{ name: 'Bar Praha', id: '1' }, { name: 'Other', id: '2' }]
        });

        // 2. Simulate User selecting "1" -> System sets confirm_menu
        updateSession(sessionId, {
            expectedContext: 'confirm_menu',
            lastRestaurant: { name: 'Bar Praha', id: '1' }
        });

        // 3. User says "pokaż menu" or "tak"
        // This should trigger the boostIntent logic
        const session = getSession(sessionId);
        const userText = 'chętnie zobaczę co mają w menu';

        // Logic: boostIntent is called with (det, text, session)
        // Original NLU probably detects 'menu_request' or 'none' depending on phrasing
        // But boost should Force 'show_menu'.

        const boosted = boostIntent({ intent: 'none', confidence: 0.5 }, userText, session);

        const finalIntent = typeof boosted === 'object' ? boosted.intent : boosted;
        const fromExpected = typeof boosted === 'object' ? boosted.boosted : false;

        expect(finalIntent).toBe('show_menu');
        expect(fromExpected).toBe(true);
    });
});
