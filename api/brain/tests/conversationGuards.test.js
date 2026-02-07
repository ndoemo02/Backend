/**
 * Unit Tests: ConversationGuards
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests for UX conversation improvement helpers.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
    hasLockedRestaurant,
    isOrderingContext,
    containsDishLikePhrase,
    recoverRestaurantFromFullText,
    calculatePhase
} from '../core/ConversationGuards.js';

describe('🛡️ ConversationGuards', () => {

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 1: hasLockedRestaurant
    // ═══════════════════════════════════════════════════════════════════════════
    describe('hasLockedRestaurant', () => {

        it('returns false for empty session', () => {
            expect(hasLockedRestaurant({})).toBe(false);
        });

        it('returns false for null session', () => {
            expect(hasLockedRestaurant(null)).toBe(false);
        });

        it('returns true when currentRestaurant exists', () => {
            expect(hasLockedRestaurant({ currentRestaurant: { name: 'Test' } })).toBe(true);
        });

        it('returns true when lockedRestaurantId exists', () => {
            expect(hasLockedRestaurant({ lockedRestaurantId: 123 })).toBe(true);
        });

        it('returns true when lastRestaurant exists', () => {
            expect(hasLockedRestaurant({ lastRestaurant: { name: 'Old' } })).toBe(true);
        });

        it('returns true when entityCache has restaurants', () => {
            expect(hasLockedRestaurant({
                entityCache: { restaurants: [{ name: 'Cached' }] }
            })).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 3: isOrderingContext
    // ═══════════════════════════════════════════════════════════════════════════
    describe('isOrderingContext', () => {

        it('returns false for empty session', () => {
            expect(isOrderingContext({})).toBe(false);
        });

        it('returns true when currentRestaurant exists', () => {
            expect(isOrderingContext({ currentRestaurant: { name: 'Test' } })).toBe(true);
        });

        it('returns true when lastIntent is select_restaurant', () => {
            expect(isOrderingContext({ lastIntent: 'select_restaurant' })).toBe(true);
        });

        it('returns true when lastIntent is menu_request', () => {
            expect(isOrderingContext({ lastIntent: 'menu_request' })).toBe(true);
        });

        it('returns true when conversationPhase is ordering', () => {
            expect(isOrderingContext({ conversationPhase: 'ordering' })).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 5: containsDishLikePhrase
    // ═══════════════════════════════════════════════════════════════════════════
    describe('containsDishLikePhrase', () => {

        it('returns false for empty text', () => {
            expect(containsDishLikePhrase('')).toBe(false);
            expect(containsDishLikePhrase(null)).toBe(false);
        });

        it('detects pizza', () => {
            expect(containsDishLikePhrase('chcę pizzę')).toBe(true);
        });

        it('detects kebab', () => {
            expect(containsDishLikePhrase('zamów mi kebab')).toBe(true);
        });

        it('detects burger', () => {
            expect(containsDishLikePhrase('poproszę burgera')).toBe(true);
        });

        it('detects naleśniki', () => {
            expect(containsDishLikePhrase('naleśniki z kurczakiem')).toBe(true);
        });

        it('detects pierogi', () => {
            expect(containsDishLikePhrase('dwa pierogi ruskie')).toBe(true);
        });

        it('returns false for location query', () => {
            expect(containsDishLikePhrase('znajdź restauracje')).toBe(false);
        });

        it('returns false for generic question', () => {
            expect(containsDishLikePhrase('co masz w ofercie')).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 2: recoverRestaurantFromFullText
    // ═══════════════════════════════════════════════════════════════════════════
    describe('recoverRestaurantFromFullText', () => {

        const restaurants = [
            { name: 'Stara Kamienica', id: 1 },
            { name: 'Bar Praha', id: 2 },
            { name: 'Monte Carlo', id: 3 }
        ];

        it('returns null for empty text', async () => {
            const result = await recoverRestaurantFromFullText('', restaurants);
            expect(result).toBeNull();
        });

        it('returns null for empty restaurants list', async () => {
            const result = await recoverRestaurantFromFullText('pokaż menu', []);
            expect(result).toBeNull();
        });

        it('recovers restaurant from text (case insensitive)', async () => {
            const result = await recoverRestaurantFromFullText(
                'pokaż co mają w starej kamienicy',
                restaurants
            );
            expect(result?.id).toBe(1);
            expect(result?.name).toBe('Stara Kamienica');
        });

        it('recovers restaurant with diacritics', async () => {
            const result = await recoverRestaurantFromFullText(
                'menu bar praha',
                restaurants
            );
            expect(result?.id).toBe(2);
        });

        it('returns null when no match', async () => {
            const result = await recoverRestaurantFromFullText(
                'pokaż menu restauracji',
                restaurants
            );
            expect(result).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FIX 4: calculatePhase
    // ═══════════════════════════════════════════════════════════════════════════
    describe('calculatePhase', () => {

        it('returns restaurant_selected for select_restaurant intent', () => {
            expect(calculatePhase('select_restaurant', 'discovery')).toBe('restaurant_selected');
        });

        it('returns ordering for create_order intent', () => {
            expect(calculatePhase('create_order', 'discovery')).toBe('ordering');
        });

        it('returns discovery for find_nearby intent', () => {
            expect(calculatePhase('find_nearby', 'ordering')).toBe('discovery');
        });

        it('preserves phase for find_nearby from continuity_guard', () => {
            expect(calculatePhase('find_nearby', 'ordering', 'continuity_guard')).toBe('ordering');
        });

        it('returns current phase for unknown intent', () => {
            expect(calculatePhase('unknown', 'ordering')).toBe('ordering');
        });
    });

});
