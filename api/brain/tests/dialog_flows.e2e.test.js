/**
 * E2E Tests: Dialog Flows (LIGHTWEIGHT VERSION)
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests for dialog policy implementation - using direct module calls.
 * 
 * NOTE: Full pipeline E2E tests require live backend or complex mocking.
 * These tests focus on the dialog logic modules directly.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi } from 'vitest';
import { renderSurface, detectSurface } from '../dialog/SurfaceRenderer.js';
import { checkRequiredState, getFallbackIntent, INTENT_CAPS } from '../core/IntentCapabilityMap.js';

describe('🗣️ Dialog Flows - Policy Compliance (Unit)', () => {

    // ═══════════════════════════════════════════════════════════════════════════
    // ICM BLOCK DETECTION
    // ═══════════════════════════════════════════════════════════════════════════

    describe('A. ICM Block Detection', () => {

        it('menu_request bez currentRestaurant → NIE spełnia wymagań', () => {
            const session = { currentRestaurant: null };
            const result = checkRequiredState('menu_request', session);
            
            expect(result.met).toBe(false);
            expect(result.reason).toMatch(/currentRestaurant/i);
        });

        it('menu_request z currentRestaurant → spełnia wymagania', () => {
            const session = { currentRestaurant: { name: 'Test' } };
            const result = checkRequiredState('menu_request', session);
            
            expect(result.met).toBe(true);
        });

        it('create_order bez restauracji → NIE spełnia wymagań', () => {
            const session = { currentRestaurant: null, lastRestaurant: null };
            const result = checkRequiredState('create_order', session);
            
            expect(result.met).toBe(false);
        });

        it('create_order z lastRestaurant → spełnia wymagania (OR condition)', () => {
            const session = { currentRestaurant: null, lastRestaurant: { name: 'Old' } };
            const result = checkRequiredState('create_order', session);
            
            expect(result.met).toBe(true);
        });

        it('confirm_order bez pendingOrder → NIE spełnia wymagań', () => {
            const session = { pendingOrder: null, expectedContext: null };
            const result = checkRequiredState('confirm_order', session);
            
            expect(result.met).toBe(false);
        });

        it('find_nearby → zawsze spełnia (no requirements)', () => {
            const session = {};
            const result = checkRequiredState('find_nearby', session);
            
            expect(result.met).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FALLBACK MAPPING
    // ═══════════════════════════════════════════════════════════════════════════

    describe('B. Fallback Intent Mapping', () => {

        it('menu_request → fallback to find_nearby', () => {
            expect(getFallbackIntent('menu_request')).toBe('find_nearby');
        });

        it('create_order → fallback to find_nearby', () => {
            expect(getFallbackIntent('create_order')).toBe('find_nearby');
        });

        it('confirm_order → fallback to find_nearby (default)', () => {
            // Note: confirm_order has fallbackIntent: null in CAPS, 
            // but getFallbackIntent returns 'find_nearby' as default
            expect(getFallbackIntent('confirm_order')).toBe('find_nearby');
        });

        it('confirm_add_to_cart → fallback to create_order', () => {
            expect(getFallbackIntent('confirm_add_to_cart')).toBe('create_order');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DIALOG SURFACE PRODUCTION
    // ═══════════════════════════════════════════════════════════════════════════

    describe('C. Dialog Surface for Blocking Situations', () => {

        it('ASK_RESTAURANT_FOR_MENU generuje poprawny dialog', () => {
            const result = renderSurface({
                key: 'ASK_RESTAURANT_FOR_MENU',
                facts: {
                    restaurants: [
                        { name: 'Bar Praha' },
                        { name: 'Monte Carlo' }
                    ]
                }
            });

            expect(result.reply).toMatch(/Bar Praha/);
            expect(result.reply).toMatch(/Monte Carlo/);
            expect(result.reply).toMatch(/menu|którą/i);
        });

        it('ASK_RESTAURANT_FOR_ORDER zachowuje wzmiankę o daniu', () => {
            const result = renderSurface({
                key: 'ASK_RESTAURANT_FOR_ORDER',
                facts: {
                    restaurants: [{ name: 'Kebab House' }],
                    dishNames: ['kebab']
                }
            });

            expect(result.reply).toMatch(/kebab/i);
            expect(result.reply).toMatch(/Kebab House/);
        });

        it('ASK_LOCATION bez restauracji', () => {
            const result = renderSurface({
                key: 'ASK_LOCATION',
                facts: {}
            });

            expect(result.reply).toMatch(/miasto|powiedz/i);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DETECT SURFACE FROM HANDLER RESULT
    // ═══════════════════════════════════════════════════════════════════════════

    describe('D. Detect Surface from Handler Results', () => {

        it('needsClarification → CLARIFY_ITEMS', () => {
            const surface = detectSurface({
                needsClarification: true,
                clarify: [{ base: 'Pizza', options: [{ name: 'Mała' }] }]
            });

            expect(surface?.key).toBe('CLARIFY_ITEMS');
        });

        it('unknownItems → ITEM_NOT_FOUND', () => {
            const surface = detectSurface({
                unknownItems: [{ name: 'nieznane danie' }]
            });

            expect(surface?.key).toBe('ITEM_NOT_FOUND');
        });

        it('needsLocation → ASK_LOCATION', () => {
            const surface = detectSurface({
                needsLocation: true
            });

            expect(surface?.key).toBe('ASK_LOCATION');
        });

        it('brak specjalnych flag → null', () => {
            const surface = detectSurface({
                ok: true,
                items: [{ name: 'Pizza' }]
            });

            expect(surface).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ICM CAPS STRUCTURE
    // ═══════════════════════════════════════════════════════════════════════════

    describe('E. ICM CAPS Structure Verification', () => {

        it('wszystkie intenty mają domain', () => {
            for (const [intent, cap] of Object.entries(INTENT_CAPS)) {
                expect(cap.domain, `${intent} missing domain`).toBeTruthy();
            }
        });

        it('ordering domain intenty mają MUTATES_CART flag', () => {
            const orderingIntents = Object.entries(INTENT_CAPS)
                .filter(([_, cap]) => cap.domain === 'ordering');
            
            for (const [intent, cap] of orderingIntents) {
                expect(cap).toHaveProperty('MUTATES_CART');
            }
        });

        it('tylko confirm_order ma MUTATES_CART=true', () => {
            for (const [intent, cap] of Object.entries(INTENT_CAPS)) {
                if (cap.MUTATES_CART === true) {
                    expect(intent).toBe('confirm_order');
                }
            }
        });
    });

});
