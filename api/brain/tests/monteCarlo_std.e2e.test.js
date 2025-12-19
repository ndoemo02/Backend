
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

describe('Monte Carlo E2E Test (Standard Flow)', () => {
    // Generate a unique session ID for this entire E2E flow to avoid context pollution from other runs
    // We use one session for all steps because this simulates a CONTINUOUS, sequential conversation.
    let sessionId;

    beforeAll(() => {
        sessionId = `test_mc_std_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        console.log(`🚀 Starting Monte Carlo E2E Flow with Session ID: ${sessionId}`);
    });

    it('should find restaurants in the city directly', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Gdzie mogę zjeść w Piekarach Śląskich?',
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.intent).toBe('find_nearby');
        expect(res.body.reply).toMatch(/Piekary Śląskie/i);
    });

    it('should show the menu for Pizzeria Monte Carlo', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Pokaż menu Pizzeria Monte Carlo',
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        // The system returns menu_request for this
        expect(['menu_request', 'show_menu']).toContain(res.body.intent);
        expect(res.body.reply).toMatch(/Margherita|Spinaci/i);
    });

    it('should add Margherita to cart', async () => {
        const res = await request(app)
            .post('/api/brain')
            .send({
                sessionId,
                text: 'Poproszę jedną dużą pizzę Margherita z Pizzeria Monte Carlo',
                lat: 50.37,
                lng: 18.94
            });

        expect(res.status).toBe(200);
        expect(res.body.ok).toBe(true);
        expect(res.body.intent).toBe('create_order');
        expect(res.body.reply).toMatch(/dodałam|Margherita|Rozumiem|koszyka/i);
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
        expect(res.body.reply).toMatch(/przyjęłam|potwierdzam|gotowe|zamówienie|menu|Dodaję|koszyka|Dodano/i);
    });
});
