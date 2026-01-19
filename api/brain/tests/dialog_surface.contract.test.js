/**
 * Contract Tests: Dialog Surface Renderer
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests the contract between handlers and SurfaceRenderer.
 * Ensures all dialog_keys produce valid, non-empty replies.
 * 
 * This is a "contract test" - it verifies the API/interface stability.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { 
    renderSurface, 
    detectSurface, 
    getSurfaceKeys, 
    hasSurfaceKey 
} from '../dialog/SurfaceRenderer.js';

describe('📜 Contract Tests: Dialog Surface Renderer', () => {

    // ═══════════════════════════════════════════════════════════════════════════
    // SURFACE KEY CATALOG VERIFICATION
    // ═══════════════════════════════════════════════════════════════════════════

    describe('A. Surface Key Catalog', () => {

        it('powinien mieć wszystkie wymagane klucze z polityki dialogowej', () => {
            const requiredKeys = [
                // Discovery & Location
                'ASK_LOCATION',
                
                // ICM Block / Dialog Bridges
                'ASK_RESTAURANT_FOR_MENU',
                'ASK_RESTAURANT_FOR_ORDER',
                
                // Selection & Disambiguation
                'CHOOSE_RESTAURANT',
                'CONFIRM_SELECTED_RESTAURANT',
                'ITEM_NOT_FOUND',
                'CLARIFY_ITEMS',
                'ASK_CLARIFICATION_DISH',
                
                // Order Flow
                'CONFIRM_ADD',
                
                // Error Handling
                'ERROR'
            ];

            requiredKeys.forEach(key => {
                expect(hasSurfaceKey(key), `Missing key: ${key}`).toBe(true);
            });
        });

        it('powinien mieć nowe klucze z Agent 2 (Policy Map)', () => {
            const newKeys = [
                'ITEM_UNAVAILABLE',
                'CART_EMPTY',
                'ASK_WHAT_TO_ORDER',
                'CONFIRM_IMPLICIT_ORDER',
                'LEGACY_ORDER_BLOCKED',
                'ASK_LOCATION_CLARIFY',
                'CART_MUTATION_BLOCKED'
            ];

            newKeys.forEach(key => {
                expect(hasSurfaceKey(key), `Missing NEW key: ${key}`).toBe(true);
            });
        });

        it('getSurfaceKeys() zwraca niepustą listę', () => {
            const keys = getSurfaceKeys();
            expect(keys.length).toBeGreaterThan(10);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // RENDER CONTRACT: Each key → valid reply
    // ═══════════════════════════════════════════════════════════════════════════

    describe('B. Render Contract: All keys produce valid output', () => {

        it('każdy klucz produkuje niepusty reply', () => {
            const keys = getSurfaceKeys();

            keys.forEach(key => {
                const result = renderSurface({ key, facts: {} });
                
                expect(result.reply, `Key ${key} produced empty reply`).toBeTruthy();
                expect(typeof result.reply).toBe('string');
                expect(result.reply.length).toBeGreaterThan(5);
            });
        });

        it('każdy klucz produkuje uiHints z surfaceKey', () => {
            const keys = getSurfaceKeys();

            keys.forEach(key => {
                const result = renderSurface({ key, facts: {} });
                
                expect(result.uiHints, `Key ${key} missing uiHints`).toBeTruthy();
                expect(result.uiHints.surfaceKey).toBe(key);
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // FACTS SUBSTITUTION: Template placeholders work
    // ═══════════════════════════════════════════════════════════════════════════

    describe('C. Facts Substitution', () => {

        it('ASK_LOCATION z dish → wspomina danie', () => {
            const result = renderSurface({
                key: 'ASK_LOCATION',
                facts: { dishNames: ['pizza'] }
            });

            expect(result.reply).toMatch(/pizza/i);
        });

        it('ASK_RESTAURANT_FOR_MENU z restaurants → wymienia restauracje', () => {
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
        });

        it('ITEM_NOT_FOUND z unknownItems → wymienia nieznane danie', () => {
            const result = renderSurface({
                key: 'ITEM_NOT_FOUND',
                facts: {
                    unknownItems: [{ name: 'sushi z ananasem' }],
                    restaurantName: 'Kebab House'
                }
            });

            expect(result.reply).toMatch(/sushi z ananasem/i);
            expect(result.reply).toMatch(/Kebab House/i);
        });

        it('CONFIRM_ADD z dishNames i priceTotal → pokazuje listę i cenę', () => {
            const result = renderSurface({
                key: 'CONFIRM_ADD',
                facts: {
                    dishNames: ['Kebab duży', 'Cola'],
                    priceTotal: 35,
                    currency: 'zł'
                }
            });

            expect(result.reply).toMatch(/Kebab duży/);
            expect(result.reply).toMatch(/Cola/);
            expect(result.reply).toMatch(/35/);
            expect(result.reply).toMatch(/zł/);
        });

        it('CLARIFY_ITEMS z options → generuje numerowaną listę', () => {
            const result = renderSurface({
                key: 'CLARIFY_ITEMS',
                facts: {
                    clarify: [{
                        base: 'Pizza',
                        options: [
                            { name: 'Margherita 30cm', price: 25 },
                            { name: 'Margherita 40cm', price: 35 }
                        ]
                    }]
                }
            });

            expect(result.reply).toMatch(/1\)/);
            expect(result.reply).toMatch(/2\)/);
            expect(result.reply).toMatch(/Margherita/);
            expect(result.reply).toMatch(/30cm|40cm/);
        });

        it('ITEM_UNAVAILABLE z itemName → wspomina niedostępny produkt', () => {
            const result = renderSurface({
                key: 'ITEM_UNAVAILABLE',
                facts: { itemName: 'Zupa dnia' }
            });

            expect(result.reply).toMatch(/Zupa dnia/i);
            expect(result.reply).toMatch(/niedostępn/i);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // ERROR HANDLING: Graceful fallback
    // ═══════════════════════════════════════════════════════════════════════════

    describe('D. Error Handling', () => {

        it('nieznany klucz → ERROR fallback', () => {
            const result = renderSurface({
                key: 'TOTALLY_UNKNOWN_KEY_123',
                facts: {}
            });

            expect(result.reply).toMatch(/przepraszam|błąd|nie tak/i);
            expect(result.uiHints.surfaceKey).toBe('TOTALLY_UNKNOWN_KEY_123');
        });

        it('null input → ERROR fallback (no crash)', () => {
            const result = renderSurface(null);

            expect(result.reply).toBeTruthy();
            expect(result.uiHints.surfaceKey).toBe('ERROR');
        });

        it('ERROR z reason=timeout → specific message', () => {
            const result = renderSurface({
                key: 'ERROR',
                facts: { reason: 'timeout' }
            });

            expect(result.reply).toMatch(/zbyt długo|ponownie/i);
        });

        it('ERROR z reason=no_menu → specific message', () => {
            const result = renderSurface({
                key: 'ERROR',
                facts: { reason: 'no_menu' }
            });

            expect(result.reply).toMatch(/menu|restauracji/i);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // DETECT SURFACE: Handler result → Surface key detection
    // ═══════════════════════════════════════════════════════════════════════════

    describe('E. Detect Surface Logic', () => {

        it('needsClarification=true → CLARIFY_ITEMS', () => {
            const surface = detectSurface({
                needsClarification: true,
                clarify: [{ base: 'Pizza', options: [] }]
            });

            expect(surface?.key).toBe('CLARIFY_ITEMS');
        });

        it('unknownItems → ITEM_NOT_FOUND', () => {
            const surface = detectSurface({
                unknownItems: [{ name: 'sushi' }]
            });

            expect(surface?.key).toBe('ITEM_NOT_FOUND');
        });

        it('needsLocation=true → ASK_LOCATION', () => {
            const surface = detectSurface({
                needsLocation: true
            });

            expect(surface?.key).toBe('ASK_LOCATION');
        });

        it('brak warunków → null (no surface)', () => {
            const surface = detectSurface({
                ok: true,
                items: []
            });

            expect(surface).toBeNull();
        });
    });

});
