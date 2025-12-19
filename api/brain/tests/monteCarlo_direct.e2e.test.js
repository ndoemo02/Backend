
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import dotenv from 'dotenv';

// Load envs
dotenv.config();

const app = express();
app.use(express.json());

// Import the router handler
import brainRouter from '../brainRouter.js';

app.post('/api/brain', brainRouter);

describe('Monte Carlo E2E Test (Direct Flow)', () => {
    let sessionId;

    beforeAll(() => {
        sessionId = `test_mc_direct_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🚀 Starting Monte Carlo Direct Flow with Session ID: ${sessionId}`);
    });

    it('should show menu for a specific restaurant in a specific city', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Chcę zobaczyć menu Pizzeria Monte Carlo w Piekarach Śląskich',
                lat: 50.37,
                lng: 18.94
            });

        // console.log('Reply:', res.body.reply);
        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(['show_menu', 'menu_request']).toContain(res.body.intent);
        expect(res.body.reply).toMatch(/Margherita/i);
    });

    it('should add Margherita to cart', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Dodaj pizzę Margherita do zamówienia',
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.intent).toBe('create_order');
        expect(res.body.reply).toMatch(/dodałam|Margherita|Rozumiem/i);
    });

    it('should confirm the order', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Tak, potwierdzam zamówienie',
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(['confirm_order', 'create_order', 'clarify_order']).toContain(res.body.intent);
        expect(res.body.reply).toMatch(/przyjęłam|potwierdzam|gotowe/i);
    });
});
