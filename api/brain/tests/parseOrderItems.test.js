/**
 * parseOrderItems.test.js
 * Tests for Semantic Guard in parseOrderItems
 */

import { describe, it, expect, vi } from 'vitest';

// Mock Supabase before importing the module
vi.mock('../../_supabase.js', () => ({
    supabase: {
        from: vi.fn(() => ({
            select: vi.fn(() => ({
                eq: vi.fn(() => ({
                    data: [
                        { id: '1', name: 'Pizza Margherita', price_pln: 28, category: 'Pizza', available: true },
                        { id: '2', name: 'Burger Classic', price_pln: 22, category: 'Burger', available: true },
                        { id: '3', name: 'Coca-Cola 0.5L', price_pln: 6, category: 'Napoje', available: true }
                    ],
                    error: null
                }))
            }))
        }))
    }
}));

// Import after mocking
import { parseOrderItems } from '../order/parseOrderItems.js';

describe('parseOrderItems', () => {
    
    describe('SEMANTIC GUARD - Pure Confirmation Blocking', () => {
        
        it('should NOT parse order on pure confirmation "potwierdzam"', async () => {
            const result = await parseOrderItems('potwierdzam', 'restaurant-123');
            
            expect(result.any).toBe(false);
            expect(result.groups.length).toBe(0);
            expect(result.reason).toBe('NO_EXPLICIT_MENU_REQUEST');
        });

        it('should NOT parse order on "tak"', async () => {
            const result = await parseOrderItems('tak', 'restaurant-123');
            
            expect(result.any).toBe(false);
            expect(result.reason).toBe('NO_EXPLICIT_MENU_REQUEST');
        });

        it('should NOT parse order on "ok"', async () => {
            const result = await parseOrderItems('ok', 'restaurant-123');
            
            expect(result.any).toBe(false);
            expect(result.reason).toBe('NO_EXPLICIT_MENU_REQUEST');
        });

        it('should NOT parse order on "dobrze"', async () => {
            const result = await parseOrderItems('dobrze', 'restaurant-123');
            
            expect(result.any).toBe(false);
            expect(result.reason).toBe('NO_EXPLICIT_MENU_REQUEST');
        });

        it('should NOT parse order on "zgoda"', async () => {
            const result = await parseOrderItems('zgoda', 'restaurant-123');
            
            expect(result.any).toBe(false);
            expect(result.reason).toBe('NO_EXPLICIT_MENU_REQUEST');
        });

        it('should NOT parse order on casual confirmations like "git", "spoko"', async () => {
            const result1 = await parseOrderItems('git', 'restaurant-123');
            const result2 = await parseOrderItems('spoko', 'restaurant-123');
            
            expect(result1.reason).toBe('NO_EXPLICIT_MENU_REQUEST');
            expect(result2.reason).toBe('NO_EXPLICIT_MENU_REQUEST');
        });
    });

    describe('Explicit Order Requests - Should Pass Guard', () => {
        
        it('should NOT block when text contains "pizza"', async () => {
            const result = await parseOrderItems('pizza margherita', 'restaurant-123');
            
            // Should NOT return the guard object (no reason field)
            expect(result.reason).toBeUndefined();
        });

        it('should NOT block when text contains quantity like "2x"', async () => {
            const result = await parseOrderItems('2x cokolwiek', 'restaurant-123');
            
            // Quantity indicator should pass guard
            expect(result.reason).toBeUndefined();
        });

        it('should NOT block when text contains "zamawiam"', async () => {
            const result = await parseOrderItems('zamawiam coś', 'restaurant-123');
            
            expect(result.reason).toBeUndefined();
        });
    });

    describe('Edge Cases', () => {
        
        it('should return empty array for null input', async () => {
            const result = await parseOrderItems(null, 'restaurant-123');
            expect(result).toEqual([]);
        });

        it('should return empty array for missing restaurantId', async () => {
            const result = await parseOrderItems('pizza', null);
            expect(result).toEqual([]);
        });
    });
});
