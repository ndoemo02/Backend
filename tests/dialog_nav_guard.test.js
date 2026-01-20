/**
 * DialogNavGuard Unit Tests
 */

import { describe, it, expect, vi } from 'vitest';
import {
    detectDialogNav,
    dialogNavGuard,
    pushDialogStack,
    goBackInDialog,
    goForwardInDialog,
    getCurrentDialogEntry,
    DIALOG_NAV_INTENTS
} from '../api/brain/dialog/DialogNavGuard.js';

describe('DialogNavGuard', () => {
    describe('detectDialogNav', () => {
        it('should detect BACK intent', () => {
            expect(detectDialogNav('cofnij').navIntent).toBe(DIALOG_NAV_INTENTS.BACK);
            expect(detectDialogNav('wróć').navIntent).toBe(DIALOG_NAV_INTENTS.BACK);
            expect(detectDialogNav('poprzednie').navIntent).toBe(DIALOG_NAV_INTENTS.BACK);
            expect(detectDialogNav('pokaż poprzednie').navIntent).toBe(DIALOG_NAV_INTENTS.BACK);
        });

        it('should detect REPEAT intent', () => {
            expect(detectDialogNav('powtórz').navIntent).toBe(DIALOG_NAV_INTENTS.REPEAT);
            expect(detectDialogNav('pokaż jeszcze raz').navIntent).toBe(DIALOG_NAV_INTENTS.REPEAT);
            expect(detectDialogNav('jeszcze raz').navIntent).toBe(DIALOG_NAV_INTENTS.REPEAT);
        });

        it('should detect NEXT intent', () => {
            expect(detectDialogNav('dalej').navIntent).toBe(DIALOG_NAV_INTENTS.NEXT);
            expect(detectDialogNav('następne').navIntent).toBe(DIALOG_NAV_INTENTS.NEXT);
            expect(detectDialogNav('pokaż więcej').navIntent).toBe(DIALOG_NAV_INTENTS.NEXT);
        });

        it('should detect STOP intent', () => {
            expect(detectDialogNav('stop').navIntent).toBe(DIALOG_NAV_INTENTS.STOP);
            expect(detectDialogNav('wystarczy').navIntent).toBe(DIALOG_NAV_INTENTS.STOP);
            expect(detectDialogNav('cisza').navIntent).toBe(DIALOG_NAV_INTENTS.STOP);
        });

        it('should return null for non-nav text', () => {
            expect(detectDialogNav('chcę pizzę').navIntent).toBeNull();
            expect(detectDialogNav('pokaż menu').navIntent).toBeNull();
            expect(detectDialogNav('zamów kebab').navIntent).toBeNull();
        });
    });

    describe('Dialog Stack Management', () => {
        it('should push entries to dialog stack', () => {
            const session = {};
            pushDialogStack(session, {
                surfaceKey: 'CHOOSE_RESTAURANT',
                facts: { city: 'Piekary' },
                renderedText: 'Mam 5 restauracji w Piekarach'
            });

            expect(session.dialogStack).toHaveLength(1);
            expect(session.dialogStack[0].surfaceKey).toBe('CHOOSE_RESTAURANT');
            expect(session.dialogStackIndex).toBe(0);
        });

        it('should go back in dialog history', () => {
            const session = {
                dialogStack: [
                    { surfaceKey: 'A', renderedText: 'First' },
                    { surfaceKey: 'B', renderedText: 'Second' },
                    { surfaceKey: 'C', renderedText: 'Third' }
                ],
                dialogStackIndex: 2
            };

            const prev = goBackInDialog(session);
            expect(prev.surfaceKey).toBe('B');
            expect(session.dialogStackIndex).toBe(1);
        });

        it('should go forward in dialog history', () => {
            const session = {
                dialogStack: [
                    { surfaceKey: 'A', renderedText: 'First' },
                    { surfaceKey: 'B', renderedText: 'Second' }
                ],
                dialogStackIndex: 0
            };

            const next = goForwardInDialog(session);
            expect(next.surfaceKey).toBe('B');
            expect(session.dialogStackIndex).toBe(1);
        });

        it('should get current dialog entry', () => {
            const session = {
                dialogStack: [
                    { surfaceKey: 'A', renderedText: 'First' },
                    { surfaceKey: 'B', renderedText: 'Second' }
                ],
                dialogStackIndex: 1
            };

            const current = getCurrentDialogEntry(session);
            expect(current.surfaceKey).toBe('B');
        });
    });

    describe('dialogNavGuard', () => {
        it('should handle REPEAT with dialog history', () => {
            const session = {
                dialogStack: [
                    { surfaceKey: 'MENU', renderedText: 'Oto menu: pizza, kebab' }
                ],
                dialogStackIndex: 0
            };

            const result = dialogNavGuard('powtórz', session);
            expect(result.handled).toBe(true);
            expect(result.response.reply).toBe('Oto menu: pizza, kebab');
            expect(result.response.intent).toBe('DIALOG_REPEAT');
        });

        it('should handle STOP without reply', () => {
            const result = dialogNavGuard('stop', {});
            expect(result.handled).toBe(true);
            expect(result.response.reply).toBe('');
            expect(result.response.stopTTS).toBe(true);
        });

        it('should not handle regular text', () => {
            const result = dialogNavGuard('chcę pizzę', {});
            expect(result.handled).toBe(false);
        });
    });
});
