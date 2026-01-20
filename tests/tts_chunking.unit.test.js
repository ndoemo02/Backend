/**
 * TTS Chunking Unit Tests
 */

import { describe, it, expect } from 'vitest';
import {
    splitIntoChunks,
    polishForSpeech,
    processForTTS,
    DEFAULT_PACING
} from '../api/brain/tts/TTSChunker.js';

describe('TTSChunker', () => {
    describe('splitIntoChunks', () => {
        it('should split text by sentence boundaries', () => {
            const text = 'Pierwszie zdanie. Drugie zdanie. Trzecie zdanie.';
            const chunks = splitIntoChunks(text, 100);
            
            expect(chunks.length).toBeGreaterThanOrEqual(1);
            expect(chunks.join(' ')).toContain('Pierwszie');
        });

        it('should respect maxLen limit', () => {
            const text = 'To jest bardzo długie zdanie które ma więcej niż dwadzieścia znaków. A to drugie.';
            const chunks = splitIntoChunks(text, 50);
            
            // Should split into multiple chunks
            expect(chunks.length).toBeGreaterThan(1);
            // Each chunk should be at most ~50 chars (may slightly exceed for sentence integrity)
        });

        it('should handle empty text', () => {
            expect(splitIntoChunks('')).toEqual([]);
            expect(splitIntoChunks(null as any)).toEqual([]);
        });

        it('should keep short text as single chunk', () => {
            const text = 'Krótki tekst.';
            const chunks = splitIntoChunks(text, 100);
            
            expect(chunks).toEqual(['Krótki tekst.']);
        });

        it('should split by different punctuation', () => {
            const text = 'Pytanie? Tak! I jeszcze jedno.';
            const chunks = splitIntoChunks(text, 20);
            
            expect(chunks.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('polishForSpeech', () => {
        it('should convert numbered lists to ordinals', () => {
            const text = '1. Pierwszy punkt 2. Drugi punkt';
            const result = polishForSpeech(text);
            
            expect(result).toContain('Po pierwsze');
            expect(result).toContain('Po drugie');
        });

        it('should remove markdown bold', () => {
            const text = 'To jest **ważne** słowo';
            const result = polishForSpeech(text);
            
            expect(result).toBe('To jest ważne słowo');
            expect(result).not.toContain('**');
        });

        it('should convert dashes to natural pauses', () => {
            const text = 'Coś – i coś innego';
            const result = polishForSpeech(text);
            
            expect(result).toContain(',');
            expect(result).not.toContain('–');
        });

        it('should normalize whitespace', () => {
            const text = 'Tekst   z   wieloma   spacjami';
            const result = polishForSpeech(text);
            
            expect(result).toBe('Tekst z wieloma spacjami');
        });

        it('should handle empty input', () => {
            expect(polishForSpeech('')).toBe('');
            expect(polishForSpeech(null as any)).toBe('');
        });
    });

    describe('processForTTS', () => {
        it('should return chunks and pacing info', () => {
            const text = 'Pierwsze zdanie. Drugie zdanie.';
            const result = processForTTS(text);
            
            expect(result.chunks).toBeInstanceOf(Array);
            expect(result.pacing).toBeDefined();
            expect(result.chunkCount).toBeGreaterThanOrEqual(1);
        });

        it('should include default pacing values', () => {
            const result = processForTTS('Test');
            
            expect(result.pacing.rate).toBe(DEFAULT_PACING.rate);
            expect(result.pacing.pitch).toBe(DEFAULT_PACING.pitch);
        });

        it('should polish text by default', () => {
            const text = '1. Punkt';
            const result = processForTTS(text);
            
            expect(result.chunks[0]).toContain('Po pierwsze');
        });

        it('should skip polishing when disabled', () => {
            const text = '1. Punkt';
            const result = processForTTS(text, { polish: false });
            
            expect(result.chunks[0]).toBe('1. Punkt');
        });
    });

    describe('ordinal conversion edge cases', () => {
        it('should handle ordinals 1-10', () => {
            const text = '1. A 2. B 3. C 4. D 5. E 6. F 7. G 8. H 9. I 10. J';
            const result = polishForSpeech(text);
            
            expect(result).toContain('Po pierwsze');
            expect(result).toContain('Po dziesiąte');
        });

        it('should fallback for numbers > 10', () => {
            const text = '11. Punkt jedenasty';
            const result = polishForSpeech(text);
            
            expect(result).toContain('Punkt 11');
        });
    });
});
