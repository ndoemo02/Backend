/**
 * SurfaceRenderer Unit Tests
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests for deterministic Polish template rendering (NO network)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
    renderSurface,
    detectSurface,
    getSurfaceKeys,
    hasSurfaceKey
} from '../api/brain/dialog/SurfaceRenderer.js';

describe('SurfaceRenderer', () => {

    describe('renderSurface', () => {

        it('should render ASK_LOCATION without dish', () => {
            const result = renderSurface({
                key: 'ASK_LOCATION',
                facts: {}
            });

            expect(result.reply).toContain('powiedz mi miasto');
            expect(result.uiHints.surfaceKey).toBe('ASK_LOCATION');
        });

        it('should render ASK_LOCATION with dish', () => {
            const result = renderSurface({
                key: 'ASK_LOCATION',
                facts: { dishNames: ['kebab'] }
            });

            expect(result.reply).toContain('kebab');
            expect(result.reply).toContain('miasto');
        });

        it('should render CHOOSE_RESTAURANT with city', () => {
            const result = renderSurface({
                key: 'CHOOSE_RESTAURANT',
                facts: { city: 'Bytomiu', restaurantCount: 5 },
                options: [
                    { id: '1', label: 'Bar Praha' },
                    { id: '2', label: 'Pizzeria Roma' }
                ]
            });

            expect(result.reply).toContain('Bytomiu');
            expect(result.reply).toContain('5');
            expect(result.uiHints.options).toHaveLength(2);
        });

        it('should render ITEM_NOT_FOUND with unknown item', () => {
            const result = renderSurface({
                key: 'ITEM_NOT_FOUND',
                facts: {
                    unknownItems: [{ name: 'spaghetti carbonara' }],
                    restaurantName: 'Bar Praha'
                }
            });

            expect(result.reply).toContain('spaghetti carbonara');
            expect(result.reply).toContain('Bar Praha');
            expect(result.reply).toContain('pokaż menu');
        });

        it('should render CLARIFY_ITEMS with options', () => {
            const result = renderSurface({
                key: 'CLARIFY_ITEMS',
                facts: {
                    clarify: [{
                        base: 'pizza',
                        options: [
                            { name: 'Pizza mała', price: 25 },
                            { name: 'Pizza duża', price: 35 }
                        ]
                    }]
                }
            });

            expect(result.reply).toContain('pizza');
            expect(result.reply).toContain('Pizza mała');
            expect(result.reply).toContain('25 zł');
            expect(result.reply).toContain('Pizza duża');
        });

        it('should render CONFIRM_ADD with items and price', () => {
            const result = renderSurface({
                key: 'CONFIRM_ADD',
                facts: {
                    dishNames: ['Kebab duży', 'Cola'],
                    priceTotal: 32.50,
                    currency: 'zł'
                }
            });

            expect(result.reply).toContain('Kebab duży');
            expect(result.reply).toContain('Cola');
            expect(result.reply).toContain('32.5');
            expect(result.reply).toContain('tak');
            expect(result.reply).toContain('nie');
        });

        it('should render ERROR for unknown key', () => {
            const result = renderSurface({
                key: 'UNKNOWN_KEY',
                facts: {}
            });

            expect(result.reply).toContain('poszło nie tak');
            expect(result.uiHints.surfaceKey).toBe('UNKNOWN_KEY');
        });

        it('should handle null input gracefully', () => {
            const result = renderSurface(null);
            expect(result.reply).toBeDefined();
            expect(result.uiHints.surfaceKey).toBe('ERROR');
        });
    });

    describe('detectSurface', () => {

        it('should detect CLARIFY_ITEMS from needsClarification', () => {
            const surface = detectSurface({
                needsClarification: true,
                clarify: [{
                    base: 'burger',
                    options: [{ name: 'Burger mały' }, { name: 'Burger duży' }]
                }]
            }, {});

            expect(surface).not.toBeNull();
            expect(surface.key).toBe('CLARIFY_ITEMS');
            expect(surface.facts.clarify).toHaveLength(1);
        });

        it('should detect ITEM_NOT_FOUND from unknownItems', () => {
            const surface = detectSurface({
                unknownItems: [{ name: 'pierogi ruskie', reason: 'no_match' }]
            }, {
                session: { currentRestaurant: { name: 'Stara Kamienica' } }
            });

            expect(surface).not.toBeNull();
            expect(surface.key).toBe('ITEM_NOT_FOUND');
            expect(surface.facts.unknownItems[0].name).toBe('pierogi ruskie');
        });

        it('should detect ASK_LOCATION from session.awaiting', () => {
            const surface = detectSurface({}, {
                session: { awaiting: 'location', pendingDish: 'pizza' },
                entities: {}
            });

            expect(surface).not.toBeNull();
            expect(surface.key).toBe('ASK_LOCATION');
            expect(surface.facts.dishNames).toContain('pizza');
        });

        it('should detect CHOOSE_RESTAURANT from multiple restaurants', () => {
            const surface = detectSurface({
                restaurants: [
                    { id: '1', name: 'Bar A' },
                    { id: '2', name: 'Bar B' },
                    { id: '3', name: 'Bar C' }
                ]
            }, {
                session: {
                    expectedContext: 'select_restaurant',
                    last_location: 'Katowice'
                }
            });

            expect(surface).not.toBeNull();
            expect(surface.key).toBe('CHOOSE_RESTAURANT');
            expect(surface.facts.city).toBe('Katowice');
            expect(surface.options).toHaveLength(3);
        });

        it('should return null when no actionable surface', () => {
            const surface = detectSurface({
                reply: 'Wszystko OK'
            }, {
                session: {}
            });

            expect(surface).toBeNull();
        });
    });

    describe('utility functions', () => {

        it('should return all surface keys', () => {
            const keys = getSurfaceKeys();
            expect(keys).toContain('ASK_LOCATION');
            expect(keys).toContain('CHOOSE_RESTAURANT');
            expect(keys).toContain('ITEM_NOT_FOUND');
            expect(keys).toContain('CLARIFY_ITEMS');
            expect(keys).toContain('CONFIRM_ADD');
            expect(keys).toContain('ERROR');
        });

        it('should check if surface key exists', () => {
            expect(hasSurfaceKey('ASK_LOCATION')).toBe(true);
            expect(hasSurfaceKey('INVALID_KEY')).toBe(false);
        });
    });
});
