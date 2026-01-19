/**
 * LLM Translator Offline Safety Tests
 * ═══════════════════════════════════════════════════════════════════════════
 * Tests for: timeout, invalid JSON, 429 rate limit, forbidden fields stripping
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateLLMOutput, sanitizeLLMOutput, FORBIDDEN_FIELDS } from '../api/brain/nlu/intents/IntentSchema.js';

describe('IntentSchema Validation', () => {

    describe('validateLLMOutput', () => {

        it('should accept valid intent output', () => {
            const valid = {
                intent: 'find_nearby',
                confidence: 0.9,
                entities: { location: 'Bytom' }
            };
            const result = validateLLMOutput(valid);
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject invalid intent enum', () => {
            const invalid = {
                intent: 'hack_system',
                confidence: 0.9,
                entities: {}
            };
            const result = validateLLMOutput(invalid);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('Invalid intent'))).toBe(true);
        });

        it('should reject confidence outside 0-1', () => {
            const invalid = {
                intent: 'find_nearby',
                confidence: 1.5,
                entities: {}
            };
            const result = validateLLMOutput(invalid);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('confidence'))).toBe(true);
        });

        it('should detect forbidden field at root: sessionId', () => {
            const hacked = {
                intent: 'find_nearby',
                confidence: 0.9,
                sessionId: 'HACK_SESSION',
                entities: {}
            };
            const result = validateLLMOutput(hacked);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('sessionId'))).toBe(true);
        });

        it('should detect forbidden field at root: actions', () => {
            const hacked = {
                intent: 'confirm_order',
                confidence: 0.95,
                actions: [{ type: 'DANGEROUS_ACTION' }],
                entities: {}
            };
            const result = validateLLMOutput(hacked);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('actions'))).toBe(true);
        });

        it('should detect forbidden field at root: pendingOrder', () => {
            const hacked = {
                intent: 'confirm_order',
                confidence: 0.9,
                pendingOrder: { items: [{ name: 'Pizza' }] },
                entities: {}
            };
            const result = validateLLMOutput(hacked);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('pendingOrder'))).toBe(true);
        });

        it('should detect forbidden field in entities: restaurantId', () => {
            const hacked = {
                intent: 'select_restaurant',
                confidence: 0.9,
                entities: {
                    restaurant: 'Bar Praha',
                    restaurantId: 'uuid-12345' // FORBIDDEN - IDs must come from DB
                }
            };
            const result = validateLLMOutput(hacked);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('restaurantId'))).toBe(true);
        });

        it('should detect forbidden field: reply', () => {
            const hacked = {
                intent: 'find_nearby',
                confidence: 0.9,
                reply: 'Znalazłem restauracje!', // LLM cannot generate replies
                entities: {}
            };
            const result = validateLLMOutput(hacked);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('reply'))).toBe(true);
        });

        it('should detect forbidden field: cart', () => {
            const hacked = {
                intent: 'confirm_order',
                confidence: 0.9,
                cart: { items: [], total: 0 }, // LLM cannot touch cart
                entities: {}
            };
            const result = validateLLMOutput(hacked);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('cart'))).toBe(true);
        });

        it('should reject non-object input', () => {
            const result = validateLLMOutput('not an object');
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('must be an object'))).toBe(true);
        });

        it('should reject null input', () => {
            const result = validateLLMOutput(null);
            expect(result.valid).toBe(false);
        });
    });

    describe('sanitizeLLMOutput', () => {

        it('should cap confidence at 0.95', () => {
            const input = {
                intent: 'find_nearby',
                confidence: 1.0, // Too confident
                entities: {}
            };
            const result = sanitizeLLMOutput(input);
            expect(result.confidence).toBe(0.95);
        });

        it('should truncate long location strings', () => {
            const input = {
                intent: 'find_nearby',
                confidence: 0.8,
                entities: {
                    location: 'A'.repeat(200) // Too long
                }
            };
            const result = sanitizeLLMOutput(input);
            expect(result.entities.location.length).toBe(100);
        });

        it('should cap quantity at 99', () => {
            const input = {
                intent: 'create_order',
                confidence: 0.8,
                entities: {
                    quantity: 9999 // Exploit attempt
                }
            };
            const result = sanitizeLLMOutput(input);
            expect(result.entities.quantity).toBe(99);
        });

        it('should set invalid intent to unknown', () => {
            const input = {
                intent: 'hack_system',
                confidence: 0.8,
                entities: {}
            };
            const result = sanitizeLLMOutput(input);
            expect(result.intent).toBe('unknown');
        });

        it('should handle missing entities gracefully', () => {
            const input = {
                intent: 'find_nearby',
                confidence: 0.8
            };
            const result = sanitizeLLMOutput(input);
            expect(result.entities).toBeDefined();
            // location can be null or undefined depending on implementation
            expect(result.entities.location === null || result.entities.location === undefined).toBe(true);
        });

        it('should trim whitespace from strings', () => {
            const input = {
                intent: 'find_nearby',
                confidence: 0.8,
                entities: {
                    location: '  Bytom  ',
                    dish: '  Kebab duży  '
                }
            };
            const result = sanitizeLLMOutput(input);
            expect(result.entities.location).toBe('Bytom');
            expect(result.entities.dish).toBe('Kebab duży');
        });
    });
});

describe('FORBIDDEN_FIELDS completeness', () => {

    it('should include all session mutation fields', () => {
        const sessionFields = ['sessionId', 'pendingDish', 'pendingOrder', 'awaiting', 'expectedContext'];
        for (const field of sessionFields) {
            expect(FORBIDDEN_FIELDS).toContain(field);
        }
    });

    it('should include all ID fields', () => {
        const idFields = ['restaurantId', 'restaurant_id', 'menuItemId', 'orderId', 'id'];
        for (const field of idFields) {
            expect(FORBIDDEN_FIELDS).toContain(field);
        }
    });

    it('should include cart/order fields', () => {
        const cartFields = ['cart', 'items', 'price', 'total'];
        for (const field of cartFields) {
            expect(FORBIDDEN_FIELDS).toContain(field);
        }
    });

    it('should include action/response fields', () => {
        const actionFields = ['actions', 'contextUpdates', 'reply', 'should_reply'];
        for (const field of actionFields) {
            expect(FORBIDDEN_FIELDS).toContain(field);
        }
    });
});
