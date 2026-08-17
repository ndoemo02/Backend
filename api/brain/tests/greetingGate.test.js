/**
 * greetingGate.test.js
 * Verifies that neutral / greeting inputs do NOT trigger order cascade.
 * Tests parseOrderItems from intent-router.js using vitest mocking.
 * ═══════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';

// ── Mock all heavy transitive deps before any import ──────────────────
vi.mock('../_supabase.js', () => ({
    supabase: { from: vi.fn(() => ({ select: vi.fn(() => ({ limit: vi.fn(() => Promise.resolve({ data: [], error: null })), in: vi.fn(() => Promise.resolve({ data: [], error: null })) })) })) }
}));
vi.mock('../orders.js', () => ({ createOrder: vi.fn() }));
vi.mock('../services/DebugSessionState.js', () => ({ updateDebugSession: vi.fn() }));
vi.mock('../config/configService.js', () => ({ getRestaurantAliases: vi.fn(async () => ({})) }));
vi.mock('./intents/functionalIntentDetector.js', () => ({
    detectFunctionalIntent: vi.fn(() => ({ intent: 'UNKNOWN', confidence: 0 })),
    isFunctionalIntent: vi.fn(() => false),
    FUNCTIONAL_INTENTS: {}
}));

const { parseOrderItems } = await import('../intent-router.js');

// ── Stub catalog ─────────────────────────────────────────────────────
const STUB_CATALOG = [
    { id: 'item-1', name: 'Pizza Margherita', price: 29.99, restaurant_id: 'r1', restaurant_name: 'Stara Kamienica' },
    { id: 'item-2', name: 'Burger Classic', price: 24.99, restaurant_id: 'r2', restaurant_name: 'Klaps Burgers' },
    { id: 'item-3', name: 'Kebab Box', price: 22.99, restaurant_id: 'r3', restaurant_name: 'Kebab House' },
];

describe('🛡️ Greeting Gate — parseOrderItems.any must be false for neutral input', () => {

    describe('Neutral / greeting inputs → any=false, groups=[]', () => {
        const neutralInputs = ['czesc', 'hej', 'witaj', 'elo', 'siema', 'dzien dobry', 'hello', 'hejka', 'dobranoc'];

        for (const input of neutralInputs) {
            it(`"${input}" → any=false`, () => {
                const result = parseOrderItems(input, STUB_CATALOG);
                expect(result.any, `Expected any=false for: "${input}"`).toBe(false);
                expect(result.groups, `Expected empty groups for: "${input}"`).toHaveLength(0);
            });
        }
    });

    describe('Real order inputs → any=true', () => {
        it('"pizza margherita" → any=true', () => {
            const result = parseOrderItems('pizza margherita', STUB_CATALOG);
            expect(result.any).toBe(true);
            expect(result.groups.length).toBeGreaterThan(0);
        });

        it('"burger" → any=true', () => {
            const result = parseOrderItems('burger', STUB_CATALOG);
            expect(result.any).toBe(true);
        });
    });

});
