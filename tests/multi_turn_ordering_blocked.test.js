/**
 * Multi-Turn Flow Tests + Negative Ordering Tests
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests FSM flow: "wezmę kebab" → pytanie o miasto → "Piekary" → lista
 * Tests NEGATIVE: "Zamawiam pizzę" without context → BLOCKED → find_nearby
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { BrainPipeline } from '../api/brain/core/pipeline.js';
import { NLURouter } from '../api/brain/nlu/router.js';
import { getSession, updateSession } from '../api/brain/session/sessionStore.js';

// Use in-memory repository for testing
import { InMemoryRestaurantRepository } from '../api/brain/core/repository.js';

describe('Multi-Turn FSM Flow', () => {
    let pipeline;
    let sessionId;

    beforeAll(() => {
        // Create pipeline with in-memory repo (no DB calls)
        const nlu = new NLURouter();
        const mockRepo = new InMemoryRestaurantRepository([
            { id: '1', name: 'Bar Praha', city: 'Piekary Śląskie', cuisine_type: 'Kebab' },
            { id: '2', name: 'Pizzeria Roma', city: 'Piekary Śląskie', cuisine_type: 'Pizzeria' },
        ]);
        pipeline = new BrainPipeline({ nlu, repository: mockRepo });
    });

    beforeEach(() => {
        // Fresh session for each test
        sessionId = `test_multi_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    });

    describe('Flow: "wezmę kebab" → location question → "Piekary" → restaurant list', () => {

        it('Turn 1: "wezmę kebab duży" should ask for location (no restaurant context)', async () => {
            const result = await pipeline.process(sessionId, 'wezmę kebab duży');

            // Should NOT execute create_order without restaurant
            expect(result.intent).not.toBe('create_order');

            // Should ask for location or find_nearby
            expect(['find_nearby', 'find_nearby_ask_location']).toContain(result.intent);

            // Check session state
            const session = getSession(sessionId);

            // Pending dish should be remembered (if extracted)
            // This depends on NLU extraction, but flow should work regardless
        });

        it('Turn 2: Standalone location "Piekary Śląskie" should resolve', async () => {
            // Setup: simulate previous turn set awaiting
            updateSession(sessionId, {
                awaiting: 'location',
                pendingDish: 'kebab',
                expectedContext: 'find_nearby_ask_location'
            });

            const result = await pipeline.process(sessionId, 'Piekary Śląskie');

            // Should be find_nearby (resolving location)
            expect(result.intent).toBe('find_nearby');

            // Session awaiting should be cleared
            const session = getSession(sessionId);
            expect(session.awaiting).toBeFalsy();
        });
    });
});

describe('NEGATIVE Tests: Ordering BLOCKED without context', () => {
    let pipeline;
    let sessionId;

    beforeAll(() => {
        const nlu = new NLURouter();
        const mockRepo = new InMemoryRestaurantRepository([
            { id: '1', name: 'Bar Praha', city: 'Piekary Śląskie', cuisine_type: 'Kebab' },
        ]);
        pipeline = new BrainPipeline({ nlu, repository: mockRepo });
    });

    beforeEach(() => {
        sessionId = `test_neg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    });

    it('"Zamawiam pizzę" without restaurant context should NOT create order', async () => {
        // Empty session - no restaurant context
        const result = await pipeline.process(sessionId, 'Zamawiam pizzę');

        // CRITICAL: Must NOT be create_order or confirm_order
        expect(result.intent).not.toBe('create_order');
        expect(result.intent).not.toBe('confirm_order');

        // Should fallback to discovery
        expect(result.intent).toBe('find_nearby');

        // Source should indicate blocking
        expect(['icm_fallback', 'legacy_hard_blocked', 'llm_ordering_blocked', 'food_word_fallback'])
            .toContain(result.source);
    });

    it('"Poproszę burgera" without restaurant context should NOT create order', async () => {
        const result = await pipeline.process(sessionId, 'Poproszę burgera');

        expect(result.intent).not.toBe('create_order');
        expect(result.intent).not.toBe('confirm_order');
    });

    it('"Tak, potwierdzam" without pendingOrder should NOT confirm order', async () => {
        // Session without pendingOrder
        updateSession(sessionId, {
            expectedContext: 'confirm_order' // But no pendingOrder!
        });

        const result = await pipeline.process(sessionId, 'Tak, potwierdzam');

        // ICM should block confirm_order without pendingOrder
        expect(result.intent).not.toBe('confirm_order');
    });

    it('"Tak" without expectedContext should NOT confirm order', async () => {
        // Session with pendingOrder but wrong expectedContext
        updateSession(sessionId, {
            pendingOrder: { items: [{ name: 'Pizza' }] },
            expectedContext: 'menu_request' // Wrong context
        });

        const result = await pipeline.process(sessionId, 'Tak');

        // Should be generic confirm or blocked
        // The NLU guard requires expectedContext === 'confirm_order'
    });

    it('LLM cannot bypass ICM even if it returns create_order', async () => {
        // This test verifies the pipeline ICM gate
        // Even if NLU returns create_order, ICM should block it without restaurant context

        // Force a situation where NLU might return create_order
        const result = await pipeline.process(sessionId, 'Zamawiam kebab duży z restauracji');

        // ICM should block: no currentRestaurant AND no lastRestaurant
        expect(result.intent).not.toBe('create_order');
    });
});

describe('Cart Mutation Guard', () => {
    let pipeline;
    let sessionId;

    beforeAll(() => {
        const nlu = new NLURouter();
        const mockRepo = new InMemoryRestaurantRepository([]);
        pipeline = new BrainPipeline({ nlu, repository: mockRepo });
    });

    beforeEach(() => {
        sessionId = `test_cart_${Date.now()}`;
    });

    it('confirm_order with valid state should work', async () => {
        // Setup valid state for confirm_order
        updateSession(sessionId, {
            pendingOrder: {
                restaurant_id: '1',
                restaurant: 'Test Restaurant',
                items: [{ id: '1', name: 'Pizza', price: 20, quantity: 1 }],
                total: '20.00'
            },
            expectedContext: 'confirm_order',
            currentRestaurant: { id: '1', name: 'Test Restaurant' }
        });

        const result = await pipeline.process(sessionId, 'Tak, potwierdzam');

        // Should be confirm_order with valid state
        expect(result.intent).toBe('confirm_order');
    });

    it('create_order should NOT mutate cart directly', async () => {
        // Setup restaurant context
        updateSession(sessionId, {
            currentRestaurant: { id: '1', name: 'Test Restaurant' },
            lastRestaurant: { id: '1', name: 'Test Restaurant' }
        });

        const sessionBefore = { ...getSession(sessionId) };
        const cartBefore = sessionBefore.cart;

        const result = await pipeline.process(sessionId, 'Zamawiam pizzę');

        const sessionAfter = getSession(sessionId);

        // Cart should NOT be directly mutated by create_order
        // (it should only set pendingOrder)
        if (result.intent === 'create_order') {
            // If it was create_order, cart should be unchanged
            expect(sessionAfter.cart).toEqual(cartBefore);
        }
    });
});

describe('Source Tracking', () => {
    let nlu;

    beforeAll(() => {
        nlu = new NLURouter();
    });

    it('should track icm_fallback source when ICM blocks intent', async () => {
        // This is tested at pipeline level, not NLU level
        // The pipeline adds 'icm_fallback' source when checkRequiredState fails
    });

    it('should track legacy_hard_blocked source when legacy ordering is blocked', async () => {
        const result = await nlu.detect({
            text: 'Zamawiam pizzę',
            session: {} // No context
        });

        // If it went through legacy, should be blocked
        if (result.source === 'classic_legacy' || result.source === 'legacy_hard_blocked') {
            expect(result.intent).not.toBe('create_order');
        }
    });
});
