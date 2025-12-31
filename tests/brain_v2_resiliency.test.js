
import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../api/server-vercel.js';
import dotenv from 'dotenv';

dotenv.config();

// Ensure EXPERT_MODE is false as per USER instruction
process.env.EXPERT_MODE = 'false';

describe('Brain V2 - ETAP 5: Resiliency & Quality Assurance', () => {

    describe('5A: API Contract Tests (Boundary Cases)', () => {

        it('should handle missing session_id (default to something stable)', async () => {
            const res = await request(app)
                .post('/api/brain/v2')
                .send({ input: 'cześć' });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('session_id');
            expect(res.body).toHaveProperty('reply');
            expect(res.body.should_reply).toBe(true);
        });

        it('should return 400 for empty input', async () => {
            const res = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: 'test-5a', input: '' });

            expect(res.status).toBe(400);
            expect(res.body.ok).toBe(false);
            expect(res.body.error).toBe('missing_input');
        });

        it('should handle extremely long input without crashing', async () => {
            const longInput = 'A'.repeat(5000);
            const res = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: 'test-5a-long', input: longInput });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('reply');
        });

        it('should maintain session state over sequential requests', async () => {
            const sessionId = 'test-5a-seq-' + Date.now();

            // 1. Find
            const r1 = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: sessionId, input: 'restauracje w Piekary' });
            expect(r1.body.reply).toContain('Piekary');

            // 2. Intent out of context but within same session
            const r2 = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: sessionId, input: 'pokaż menu' });
            // Since no restaurant selected, it should probably ask to select one or return error
            // (Assuming menuHandler returns "Najpierw wybierz restaurację" or similar)
            expect(r2.body).toHaveProperty('reply');
        });
    });

    describe('5B: Chaos / Negative Scenarios', () => {

        it('should handle "zamawiam" without previous selection gracefully', async () => {
            const sessionId = 'chaos-1';
            const res = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: sessionId, input: 'zamawiam pizza' });

            expect(res.status).toBe(200);
            expect(typeof res.body.reply).toBe('string');
            // Check it doesn't return technical junk or crash
            expect(res.body.reply.length).toBeGreaterThan(0);
        });

        it('should handle "tak" without context', async () => {
            const res = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: 'chaos-2', input: 'tak' });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('reply');
        });

        it('should handle "anuluj" when nothing to cancel', async () => {
            const res = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: 'chaos-3', input: 'anuluj zamówienie' });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('reply');
        });

        it('should handle mixed intents gracefully (e.g., find and order)', async () => {
            const res = await request(app)
                .post('/api/brain/v2')
                .send({ session_id: 'chaos-4', input: 'szukam pizzy w Piekarach i zamów mi burgera' });

            expect(res.status).toBe(200);
            expect(res.body).toHaveProperty('reply');
            expect(res.body.should_reply).toBe(true);
        });
    });

    describe('5C: Concurrent Load (Isolation Check)', () => {

        it('should handle 10 parallel requests with different sessions without leaks', async () => {
            const requests = Array.from({ length: 10 }).map((_, i) => {
                return request(app)
                    .post('/api/brain/v2')
                    .send({ session_id: `load-test-${i}`, input: `test ${i}` });
            });

            const results = await Promise.all(requests);

            results.forEach((res, i) => {
                expect(res.status).toBe(200);
                expect(res.body.session_id).toBe(`load-test-${i}`);
            });
        });
    });

});
