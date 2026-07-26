import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

process.env.PORT = 0;
process.env.EXPERT_MODE = 'true';
process.env.USE_LLM_INTENT = 'true';
process.env.OPENAI_API_KEY = 'test-key';

import app from '../../api/server-vercel.js';
import { updateSession, getSession } from '../../api/brain/session/sessionStore.js';

const TEST_RESTAURANT_ID = '00000000-0000-0000-0000-000000000001';
const originalFetch = global.fetch;

describe('Debug V2 all cases', () => {
    let sid;

    beforeEach(() => {
        sid = 'dbg-' + Date.now() + '-' + Math.round(Math.random() * 1000);

        global.fetch = vi.fn(async (url, options) => {
            if (typeof url === 'string' && url.includes('api.openai.com')) {
                const bodyObj = JSON.parse(options.body);
                const text = (bodyObj.messages.find(m => m.role === 'user')?.content || '').toLowerCase();
                let mockIntent = 'unknown';
                if (text.includes('pizz')) mockIntent = 'find_nearby';
                else if (text.includes('menu')) mockIntent = 'show_menu';
                else if (text.includes('margherita')) mockIntent = 'create_order';
                else if (text.includes('potwierdzam')) mockIntent = 'confirm_order';
                return {
                    ok: true,
                    json: async () => ({
                        choices: [{ message: { content: JSON.stringify({ intent: mockIntent, confidence: 0.9, slots: {} }) } }]
                    })
                };
            }
            return originalFetch(url, options);
        });
    });

    it('CASE 1: "chcę pizzę"', async () => {
        const res = await request(app).post('/api/brain/v2').send({ text: 'chcę pizzę', session_id: sid });
        console.error('CASE1:', JSON.stringify({ intent: res.body.intent, meta: res.body.meta }));
        expect(res.status).toBe(200);
        expect(['find_nearby', 'create_order', 'clarify_order']).toContain(res.body.intent);
    }, 30000);

    it('CASE 2: "pokaż menu" with restaurant', async () => {
        updateSession(sid, {
            currentRestaurant: { id: TEST_RESTAURANT_ID, name: 'Testowy Lokal', menu_items: [] }
        });
        const res = await request(app).post('/api/brain/v2').send({ text: 'pokaż menu', session_id: sid });
        console.error('CASE2:', JSON.stringify({ intent: res.body.intent, meta: res.body.meta }));
        expect(res.status).toBe(200);
        // Pipeline might return menu_request or show_menu
        expect(['menu_request', 'show_menu']).toContain(res.body.intent);
    }, 30000);

    it('CASE 3: "2 pizza margherita" with restaurant', async () => {
        updateSession(sid, {
            currentRestaurant: { id: TEST_RESTAURANT_ID, name: 'Testowy Lokal', menu_items: [] }
        });
        const res = await request(app).post('/api/brain/v2').send({ text: 'zamawiam 2 pizza margherita', session_id: sid });
        console.error('CASE3:', JSON.stringify({ intent: res.body.intent, meta: res.body.meta }));
        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('create_order');
    }, 30000);

    it('CASE 4: "potwierdzam" with pending order', async () => {
        updateSession(sid, {
            currentRestaurant: { id: TEST_RESTAURANT_ID, name: 'Testowy Lokal' },
            expectedContext: 'confirm_order',
            pendingOrder: [{ id: 'item1', name: 'Pizza Margherita', quantity: 2, price: 20 }]
        });
        const res = await request(app).post('/api/brain/v2').send({ text: 'potwierdzam', session_id: sid });
        console.error('CASE4:', JSON.stringify({ intent: res.body.intent, meta: res.body.meta }));
        expect(res.status).toBe(200);
        expect(res.body.intent).toBe('confirm_order');
    }, 30000);

    it('CASE 5: "asdasdasd"', async () => {
        const res = await request(app).post('/api/brain/v2').send({ text: 'asdasdasd', session_id: sid });
        console.error('CASE5:', JSON.stringify({ intent: res.body.intent, meta: res.body.meta }));
        expect(res.status).toBe(200);
        expect(['unknown', 'find_nearby', 'clarify_order']).toContain(res.body.intent);
    }, 30000);
});
