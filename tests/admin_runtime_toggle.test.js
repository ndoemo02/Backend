/**
 * Admin Runtime Toggle Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dialogNavGuard, DIALOG_NAV_INTENTS } from '../api/brain/dialog/DialogNavGuard.js';

describe('Admin Runtime Toggles', () => {
    const mockSession = {
        dialogStack: [
            { surfaceKey: 'MENU', renderedText: 'Oto menu' }
        ],
        dialogStackIndex: 0
    };

    describe('dialog_navigation_enabled flag', () => {
        it('should handle BACK when enabled', () => {
            const config = { dialog_navigation_enabled: true };
            const result = dialogNavGuard('cofnij', mockSession, config);
            
            expect(result.handled).toBe(true);
            expect(result.response.intent).toBe(DIALOG_NAV_INTENTS.BACK);
        });

        it('should skip BACK when disabled', () => {
            const config = { dialog_navigation_enabled: false };
            const result = dialogNavGuard('cofnij', mockSession, config);
            
            expect(result.handled).toBe(false);
        });

        it('should always handle STOP (safety)', () => {
            const config = { dialog_navigation_enabled: false };
            const result = dialogNavGuard('stop', mockSession, config);
            
            expect(result.handled).toBe(true);
            expect(result.response.stopTTS).toBe(true);
        });

        it('should skip REPEAT when disabled', () => {
            const config = { dialog_navigation_enabled: false };
            const result = dialogNavGuard('powtórz', mockSession, config);
            
            expect(result.handled).toBe(false);
        });
    });

    describe('fallback_mode: SIMPLE', () => {
        it('should disable nav commands in SIMPLE mode', () => {
            const config = { fallback_mode: 'SIMPLE' };
            const result = dialogNavGuard('cofnij', mockSession, config);
            
            expect(result.handled).toBe(false);
        });

        it('should allow STOP in SIMPLE mode', () => {
            const config = { fallback_mode: 'SIMPLE' };
            const result = dialogNavGuard('stop', mockSession, config);
            
            expect(result.handled).toBe(true);
            expect(result.response.stopTTS).toBe(true);
        });

        it('should work normally in SMART mode', () => {
            const config = { fallback_mode: 'SMART' };
            const result = dialogNavGuard('powtórz', mockSession, config);
            
            expect(result.handled).toBe(true);
        });
    });

    describe('combined flags', () => {
        it('should respect explicit disable over SMART mode', () => {
            const config = { 
                fallback_mode: 'SMART',
                dialog_navigation_enabled: false 
            };
            const result = dialogNavGuard('cofnij', mockSession, config);
            
            expect(result.handled).toBe(false);
        });

        it('should allow STOP regardless of all flags', () => {
            const config = { 
                fallback_mode: 'SIMPLE',
                dialog_navigation_enabled: false 
            };
            const result = dialogNavGuard('cisza', mockSession, config);
            
            expect(result.handled).toBe(true);
            expect(result.response.stopTTS).toBe(true);
        });
    });

    describe('default config behavior', () => {
        it('should work with empty config (defaults enabled)', () => {
            const result = dialogNavGuard('powtórz', mockSession, {});
            
            expect(result.handled).toBe(true);
        });

        it('should work with undefined config', () => {
            const result = dialogNavGuard('dalej', mockSession);
            
            // Should not crash, should handle as enabled
            expect(result).toBeDefined();
        });
    });
});
