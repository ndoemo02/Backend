import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../_supabase.js', () => {
    const empty = { data: [], error: null };
    const builder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        lte: vi.fn().mockReturnThis(),
        update: vi.fn().mockReturnThis(),
        upsert: vi.fn().mockResolvedValue(empty),
        maybeSingle: vi.fn().mockResolvedValue(null),
        limit: vi.fn().mockResolvedValue(empty),
        then: vi.fn((onSuccess) => Promise.resolve(empty).then(onSuccess)),
    };

    return {
        supabase: {
            from: vi.fn(() => builder),
        },
    };
});

vi.mock('../services/DebugSessionState.js', () => ({
    updateDebugSession: vi.fn(),
}));

vi.mock('../../brain/supabaseClient.js', () => ({
    default: {
        from: vi.fn(() => ({
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
    },
}));

import { BrainPipeline } from '../core/pipeline.js';
import { NLURouter } from '../nlu/router.js';
import { InMemoryRestaurantRepository } from '../core/repository.js';
import { getSession, updateSession } from '../session/sessionStore.js';

function createPipeline() {
    return new BrainPipeline({
        nlu: new NLURouter(),
        repository: new InMemoryRestaurantRepository({ restaurants: [] }),
    });
}

describe('open_checkout bridge', () => {
    beforeEach(() => {
        process.env.USE_LLM_INTENT = 'false';
        process.env.LLM_TRANSLATOR_ENABLED = 'false';
    });

    it('opens checkout when cart has items', async () => {
        const pipeline = createPipeline();
        const sessionId = `sess_checkout_bridge_${Date.now()}`;

        updateSession(sessionId, {
            conversationPhase: 'ordering',
            cart: {
                items: [{ id: 'x1', name: 'Pepsi', price_pln: 12, qty: 1, restaurant_id: 'r1' }],
                total: 12,
                restaurantId: 'r1',
            },
        });

        const response = await pipeline.process(sessionId, 'przejdz do checkoutu');

        expect(response.intent).toBe('open_checkout');
        expect(response.phase).toBe('checkout');
        expect(response.meta?.checkoutUi).toBe(true);
        expect(Array.isArray(response.actions)).toBe(true);
        expect(response.actions[0]?.type).toBe('SHOW_CART');
        expect(response.actions[0]?.payload?.mode).toBe('checkout');

        const session = getSession(sessionId);
        expect(session.conversationPhase).toBe('checkout');
        expect(session.expectedContext).toBe('confirm_order');
    });

    it('returns cart-empty clarify when checkout requested without items', async () => {
        const pipeline = createPipeline();
        const sessionId = `sess_checkout_empty_${Date.now()}`;

        updateSession(sessionId, {
            conversationPhase: 'ordering',
            cart: {
                items: [],
                total: 0,
                restaurantId: null,
            },
        });

        const response = await pipeline.process(sessionId, 'checkout');

        expect(response.intent).toBe('open_checkout');
        expect(response.phase).toBe('ordering');
        expect(response.meta?.cartEmpty).toBe(true);
        expect(String(response.reply || '').toLowerCase()).toContain('koszyk jest pusty');
    });
});
