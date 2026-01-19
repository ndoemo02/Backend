/**
 * ICM (Intent Capability Map) Tests
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests FSM state requirements and cart mutation guards
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
    INTENT_CAPS,
    checkRequiredState,
    getFallbackIntent,
    isHardBlockedFromLegacy,
    mutatesCart,
    getIntentDomain
} from '../api/brain/core/IntentCapabilityMap.js';

describe('IntentCapabilityMap', () => {

    describe('INTENT_CAPS structure', () => {

        it('should define all expected intents', () => {
            const expectedIntents = [
                'find_nearby', 'menu_request', 'show_more_options', 'recommend',
                'select_restaurant',
                'create_order', 'confirm_order', 'confirm_add_to_cart', 'cancel_order',
                'confirm', 'unknown'
            ];
            for (const intent of expectedIntents) {
                expect(INTENT_CAPS[intent]).toBeDefined();
            }
        });

        it('should mark ONLY confirm_order as MUTATES_CART', () => {
            // This is the MOST CRITICAL invariant
            for (const [intent, cap] of Object.entries(INTENT_CAPS)) {
                if (intent === 'confirm_order') {
                    expect(cap.MUTATES_CART).toBe(true);
                } else {
                    expect(cap.MUTATES_CART).not.toBe(true);
                }
            }
        });

        it('should mark create_order as HARD_BLOCK_LEGACY', () => {
            expect(INTENT_CAPS.create_order.HARD_BLOCK_LEGACY).toBe(true);
        });
    });

    describe('checkRequiredState', () => {

        it('should allow find_nearby with empty session', () => {
            const result = checkRequiredState('find_nearby', {});
            expect(result.met).toBe(true);
        });

        it('should block menu_request without currentRestaurant', () => {
            const result = checkRequiredState('menu_request', {});
            expect(result.met).toBe(false);
            expect(result.reason).toContain('currentRestaurant');
        });

        it('should allow menu_request with currentRestaurant', () => {
            const result = checkRequiredState('menu_request', {
                currentRestaurant: { id: '123', name: 'Test' }
            });
            expect(result.met).toBe(true);
        });

        it('should block select_restaurant without last_restaurants_list', () => {
            const result = checkRequiredState('select_restaurant', {});
            expect(result.met).toBe(false);
        });

        it('should allow select_restaurant with non-empty list', () => {
            const result = checkRequiredState('select_restaurant', {
                last_restaurants_list: [{ id: '1', name: 'Test' }]
            });
            expect(result.met).toBe(true);
        });

        it('should block select_restaurant with empty list', () => {
            const result = checkRequiredState('select_restaurant', {
                last_restaurants_list: []
            });
            expect(result.met).toBe(false);
        });

        it('should block confirm_order without pendingOrder', () => {
            const result = checkRequiredState('confirm_order', {
                expectedContext: 'confirm_order'
            });
            expect(result.met).toBe(false);
        });

        it('should block confirm_order without expectedContext', () => {
            const result = checkRequiredState('confirm_order', {
                pendingOrder: { items: [{ name: 'Pizza' }] }
            });
            expect(result.met).toBe(false);
        });

        it('should allow confirm_order with both requirements', () => {
            const result = checkRequiredState('confirm_order', {
                pendingOrder: { items: [{ name: 'Pizza' }] },
                expectedContext: 'confirm_order'
            });
            expect(result.met).toBe(true);
        });

        it('should handle OR conditions for create_order', () => {
            // With currentRestaurant
            const r1 = checkRequiredState('create_order', {
                currentRestaurant: { id: '1' }
            });
            expect(r1.met).toBe(true);

            // With lastRestaurant
            const r2 = checkRequiredState('create_order', {
                lastRestaurant: { id: '2' }
            });
            expect(r2.met).toBe(true);

            // Without any
            const r3 = checkRequiredState('create_order', {});
            expect(r3.met).toBe(false);
        });
    });

    describe('getFallbackIntent', () => {

        it('should return find_nearby for menu_request', () => {
            expect(getFallbackIntent('menu_request')).toBe('find_nearby');
        });

        it('should return find_nearby for create_order', () => {
            expect(getFallbackIntent('create_order')).toBe('find_nearby');
        });

        it('should return find_nearby for unknown', () => {
            expect(getFallbackIntent('unknown')).toBe('find_nearby');
        });

        it('should return find_nearby as safe default for confirm_order', () => {
            // confirm_order has fallbackIntent: null in ICM
            // But getFallbackIntent() returns 'find_nearby' as safe default
            expect(getFallbackIntent('confirm_order')).toBe('find_nearby');
        });
    });

    describe('isHardBlockedFromLegacy', () => {

        it('should return true for create_order', () => {
            expect(isHardBlockedFromLegacy('create_order')).toBe(true);
        });

        it('should return false for find_nearby', () => {
            expect(isHardBlockedFromLegacy('find_nearby')).toBe(false);
        });
    });

    describe('mutatesCart', () => {

        it('should return true ONLY for confirm_order', () => {
            expect(mutatesCart('confirm_order')).toBe(true);
        });

        it('should return false for create_order', () => {
            expect(mutatesCart('create_order')).toBe(false);
        });

        it('should return false for confirm_add_to_cart', () => {
            expect(mutatesCart('confirm_add_to_cart')).toBe(false);
        });

        it('should return false for all other intents', () => {
            const nonMutating = ['find_nearby', 'menu_request', 'select_restaurant', 'cancel_order'];
            for (const intent of nonMutating) {
                expect(mutatesCart(intent)).toBe(false);
            }
        });
    });

    describe('getIntentDomain', () => {

        it('should return food for discovery intents', () => {
            expect(getIntentDomain('find_nearby')).toBe('food');
            expect(getIntentDomain('menu_request')).toBe('food');
        });

        it('should return ordering for order intents', () => {
            expect(getIntentDomain('create_order')).toBe('ordering');
            expect(getIntentDomain('confirm_order')).toBe('ordering');
        });

        it('should return system for system intents', () => {
            expect(getIntentDomain('confirm')).toBe('system');
            expect(getIntentDomain('unknown')).toBe('system');
        });
    });
});

describe('Cart Mutation Invariant (CRITICAL)', () => {

    it('ONLY confirm_order can mutate cart - this is the most important test', () => {
        const cartMutators = Object.entries(INTENT_CAPS)
            .filter(([_, cap]) => cap.MUTATES_CART === true)
            .map(([intent]) => intent);

        expect(cartMutators).toEqual(['confirm_order']);
    });

    it('confirm_order requires BOTH pendingOrder AND expectedContext', () => {
        const cap = INTENT_CAPS.confirm_order;
        expect(cap.requiredState.pendingOrder).toBe('non_empty');
        expect(cap.requiredState.expectedContext).toBe('confirm_order');
    });
});
