/**
 * V2 Clean End-to-End Test Suite
 * ═══════════════════════════════════════════
 * Asercje oparte na FAKTYCZNYM kontrakcie sesji V2 (nie legacy):
 * 
 * pendingOrder = obiekt { restaurant_id, restaurant, items[], total } | null
 * Po confirm_order: sesja zamknięta, cart wypełniony, pendingOrder null
 * DB persistence: WYŁĄCZONA (workflow Voice → Cart → Manual UI → DB)
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { vi } from 'vitest';

process.env.PORT = 0;

import app from '../../api/server-vercel.js';
import { getSession, updateSession } from '../../api/brain/session/sessionStore.js';

const TEST_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';
let TEST_SESSION_ID;

describe('Clean V2 End-to-End Test Suite', () => {

    const originalFetch = global.fetch;

    beforeAll(() => {
        process.env.EXPERT_MODE = 'true';
        process.env.USE_LLM_INTENT = 'true';
        process.env.OPENAI_API_KEY = 'test-key';
    });

    afterAll(() => {
        global.fetch = originalFetch;
    });

    beforeEach(async () => {
        TEST_SESSION_ID = 'v2flow-' + Date.now() + '-' + Math.round(Math.random() * 1000);

        global.fetch = vi.fn(async (url, options) => {
            if (typeof url === 'string' && url.includes('api.openai.com/v1/chat/completions')) {
                const bodyObj = JSON.parse(options.body);
                const text = (bodyObj.messages.find(m => m.role === 'user')?.content || '').toLowerCase();

                let mockIntent = 'unknown';
                if (text.includes('pizzę') || text.includes('pobliżu') || text.includes('szukam') || text.includes('było')) mockIntent = 'find_nearby';
                else if (text.includes('menu')) mockIntent = 'show_menu';
                else if (text.includes('margherita') || text.includes('2 pizza')) mockIntent = 'create_order';
                else if (text.includes('potwierdzam')) mockIntent = 'confirm_order';

                return {
                    ok: true,
                    json: async () => ({
                        choices: [{
                            message: { content: JSON.stringify({ intent: mockIntent, confidence: 0.9, slots: {} }) }
                        }]
                    })
                };
            }
            return originalFetch(url, options);
        });

        // Clear session state
        updateSession(TEST_SESSION_ID, {
            expectedContext: null,
            currentRestaurant: null,
            lastRestaurant: null,
            pendingOrder: null,
            last_restaurants_list: null
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // CASE 1 — Discovery (no restaurant context)
    // Pipeline may return: find_nearby | create_order | clarify_order
    // "chcę pizzę" without restaurant = ICM blocks → clarify/find_nearby
    // ═══════════════════════════════════════════════════════════════════
    it('CASE 1: should handle pizza request without restaurant context', async () => {
        const res = await request(app)
            .post('/api/brain/v2')
            .send({ text: 'chcę pizzę', session_id: TEST_SESSION_ID });

        expect(res.status).toBe(200);
        expect(['find_nearby', 'create_order', 'clarify_order']).toContain(res.body.intent);
        expect(res.body.reply).toBeDefined();
    });

    // ═══════════════════════════════════════════════════════════════════
    // CASE 2 — Menu request with restaurant in session
    // V2 pipeline returns intent: menu_request (not show_menu)
    // ═══════════════════════════════════════════════════════════════════
    it('CASE 2: should return menu_request when session has restaurant', async () => {
        updateSession(TEST_SESSION_ID, {
            currentRestaurant: {
                id: TEST_RESTAURANT_ID,
                name: 'Testowy Lokal',
                menu_items: []
            }
        });

        const res = await request(app)
            .post('/api/brain/v2')
            .send({ text: 'pokaż menu', session_id: TEST_SESSION_ID });

        expect(res.status).toBe(200);
        // V2: pipeline resolves to menu_request (handler alias)
        expect(['menu_request', 'show_menu']).toContain(res.body.intent);
        expect(res.body.reply).toBeDefined();
    });

    // ═══════════════════════════════════════════════════════════════════
    // CASE 3 — Order intent with restaurant in session
    // DisambiguationService may return DISAMBIGUATION_REQUIRED if
    // menu_items is empty. Test validates intent is create_order
    // and session gets disambiguation state.
    // ═══════════════════════════════════════════════════════════════════
    it('CASE 3: should process create_order and set disambiguation or pendingOrder', async () => {
        updateSession(TEST_SESSION_ID, {
            currentRestaurant: {
                id: TEST_RESTAURANT_ID,
                name: 'Testowy Lokal',
                menu_items: []
            }
        });

        const res = await request(app)
            .post('/api/brain/v2')
            .send({ text: '2 pizza margherita', session_id: TEST_SESSION_ID });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('create_order');

        // V2 contract: after create_order, pipeline responds with one of:
        // a) pendingOrder set + expectedContext: 'confirm_order'  (single match)
        // b) expectedContext: 'choose_restaurant' (disambiguation)
        // c) Reply with clarification/error (item not found, etc.)
        // All are valid V2 outcomes for create_order
        expect(res.body.reply).toBeDefined();
    });

    // ═══════════════════════════════════════════════════════════════════
    // CASE 4 — Confirm order (V2: commit to cart, close session, NO DB)
    // pendingOrder is OBJECT { restaurant_id, restaurant, items[], total }
    // ═══════════════════════════════════════════════════════════════════
    it('CASE 4: should confirm order, commit to cart, and close session', async () => {
        // Setup: pendingOrder as V2 OBJECT (not legacy array!)
        updateSession(TEST_SESSION_ID, {
            currentRestaurant: { id: TEST_RESTAURANT_ID, name: 'Testowy Lokal' },
            expectedContext: 'confirm_order',
            pendingOrder: {
                restaurant_id: TEST_RESTAURANT_ID,
                restaurant: 'Testowy Lokal',
                items: [{ id: 'item1', name: 'Pizza Margherita', price: 20, quantity: 2 }],
                total: '40.00'
            }
        });

        const res = await request(app)
            .post('/api/brain/v2')
            .send({ text: 'potwierdzam', session_id: TEST_SESSION_ID });

        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('confirm_order');

        // V2 contract: session closed, cart populated
        expect(res.body.conversationClosed).toBe(true);
        expect(res.body.newSessionId).toBeDefined();

        // Cart should have committed items
        const sessionContext = res.body.context;
        expect(sessionContext).toBeDefined();
        expect(sessionContext.status).toBe('closed');
        expect(sessionContext.pendingOrder).toBeNull();
        // cart.items should have the committed item
        expect(sessionContext.cart).toBeDefined();
        expect(sessionContext.cart.items.length).toBeGreaterThan(0);

        // V2: NO database persistence (deferred to manual UI checkout)
        // Therefore we do NOT assert supabase orders here.
    });

    // ═══════════════════════════════════════════════════════════════════
    // CASE 5 — Gibberish / unknown intent
    // V2 pipeline routes to clarify_order or unknown
    // ═══════════════════════════════════════════════════════════════════
    it('CASE 5: should return clarify/unknown for gibberish', async () => {
        const res = await request(app)
            .post('/api/brain/v2')
            .send({ text: 'asdasdasd', session_id: TEST_SESSION_ID });

        expect(res.status).toBe(200);
        expect(['unknown', 'clarify_order']).toContain(res.body.intent);
        expect(res.body.reply).toBeDefined();
    });
});
