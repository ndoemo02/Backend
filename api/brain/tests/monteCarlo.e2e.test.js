
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

describe('Monte Carlo E2E Test (Real DB Data Flow)', () => {
    const sessionId = `test_mc_${Date.now()}`;

    it('should ask for restaurants and get confirmation request', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Pokaż mi restauracje w Piekarach Śląskich',
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.reply).toMatch(/Znalazłam|Piekary Śląskie/i);
    });

    it('should confirm and see the list', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Tak, pokaż',
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.reply).toMatch(/Oto|Pizzeria Monte Carlo/i);
    });

    it('should show the menu for Pizzeria Monte Carlo', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Chcę zobaczyć menu tej restauracji', // Using "tej" because it was the last found
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.intent).toBe('show_menu');
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
});
