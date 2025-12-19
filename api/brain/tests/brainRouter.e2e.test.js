import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../../server-vercel.js';

describe('🧠 BrainRouter E2E - Restaurant & Menu Flow', () => {
    let sessionId;

    beforeAll(() => {
        // Unikalna sesja dla całego zestawu testów
        sessionId = `e2e_piekary_${Date.now()}`;
    });

    describe('A. Intent find_nearby (Znajdowanie restauracji)', () => {
        it('powinien znaleźć restauracje w Piekarach Śląskich', async () => {
            const res = await request(app)
                .post('/api/brain')
                .send({
                    sessionId,
                    text: 'Znajdź restaurację w Piekarach Śląskich'
                });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            // Intent może być find_nearby lub find_nearby_confirmation w zależności od logiki GeoContext
            expect(res.body.intent).toMatch(/find_nearby/);

            // Sprawdzamy czy w odpowiedzi są dane restauracji
            // GeoContext zwraca listę w res.body.restaurants (jeśli direct) 
            // lub w res.body.context.last_restaurants_list
            const restaurants = res.body.restaurants || res.body.context?.last_restaurants_list || [];
            expect(restaurants.length).toBeGreaterThan(0);

            const names = restaurants.map(r => r.name);
            const expectedNamesSnippet = [
                'Stara Kamienica',
                'Rezydencja Luxury Hotel',
                'Klaps Burgers',
                'Vien-Thien',
                'Monte Carlo',
                'Bar Praha',
                'Dwór Hubertus',
                'Callzone',
                'Tasty King Kebab'
            ];

            const foundMatch = expectedNamesSnippet.some(snip =>
                names.some(n => n.includes(snip))
            );
            expect(foundMatch).toBe(true);
        });

        it('powinien obsłużyć zapytanie "Pokaż restauracje w Piekarach Śląskich"', async () => {
            const res = await request(app)
                .post('/api/brain')
                .send({
                    sessionId,
                    text: 'Pokaż restauracje w Piekarach Śląskich'
                });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toMatch(/find_nearby/);
        });
    });

    describe('B. Intent menu_request (Menu konkretnej restauracji)', () => {
        it('powinien pokazać menu dla Restauracja Stara Kamienica', async () => {
            const res = await request(app)
                .post('/api/brain')
                .send({
                    sessionId,
                    text: 'Pokaż menu Restauracja Stara Kamienica'
                });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toBe('menu_request');
            // Sprawdzamy czy logika nie utknęła na wybieraniu restauracji
            expect(res.body.reply).not.toMatch(/którą wybierasz/i);
            expect(res.body.reply.toLowerCase()).toMatch(/menu|karta|polecam|proponuję|dostępne|dania/i);
        });

        it('powinien pokazać menu dla Klaps Burgers', async () => {
            const res = await request(app)
                .post('/api/brain')
                .send({
                    sessionId,
                    text: 'Jakie jest menu w Klaps Burgers?'
                });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toMatch(/menu_request|show_menu/);
        });

        it('powinien pokazać menu dla Pizzeria Monte Carlo', async () => {
            const res = await request(app)
                .post('/api/brain')
                .send({
                    sessionId,
                    text: 'Pokaż menu w Pizzeria Monte Carlo'
                });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toMatch(/menu_request|show_menu/);
        });
    });

    describe('C. Intent create_order (Złożenie zamówienia)', () => {
        it('powinien dodać pizzę margheritę do zamówienia w Pizzeria Monte Carlo', async () => {
            // Najpierw upewniamy się, że restauracja jest w sesji
            await request(app)
                .post('/api/brain')
                .send({ sessionId, text: 'Wybieram Pizzeria Monte Carlo' });

            const res = await request(app)
                .post('/api/brain')
                .send({
                    sessionId,
                    text: 'Zamów jedną dużą pizzę margherita'
                });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toBe('create_order');
            expect(res.body.reply).toMatch(/dodałam|zamówienie|koszyk|margherita/i);
        });

        it('powinien dodać burgery do zamówienia w Klaps Burgers', async () => {
            const specificSessionId = `e2e_legacy_klaps_${Date.now()}`;
            // Zmiana restauracji w sesji
            await request(app)
                .post('/api/brain')
                .send({ sessionId: specificSessionId, text: 'Chcę zamówić w Klaps Burgers' });

            const res = await request(app)
                .post('/api/brain')
                .send({
                    sessionId: specificSessionId,
                    text: 'Chcę dwa burgery'
                });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toBe('create_order');
            expect(res.body.reply).toMatch(/dodałam|burgery|2|dwa/i);
        });
    });

    describe('D. Nowe testy kaskadowe w Klaps Burgers (Dane produkcyjne)', () => {
        let sessionKlaps;

        beforeAll(() => {
            // Oddzielna sesja dla kaskady, aby nie śmiecić w poprzednich
            sessionKlaps = `e2e_klaps_cascade_${Date.now()}`;
        });

        it('Test 1 (burger ogólny): powinien obsłużyć "Chcę burgery" po wyborze Klaps Burgers', async () => {
            // Krok 1: Wybór Klaps Burgers
            await request(app)
                .post('/api/brain')
                .send({ sessionId: sessionKlaps, text: 'Pokaż restauracje w Piekarach Śląskich' });

            await request(app)
                .post('/api/brain')
                .send({ sessionId: sessionKlaps, text: 'Wybierz Klaps Burgers' });

            // Krok 2: Zamówienie "burgery"
            const res = await request(app)
                .post('/api/brain')
                .send({ sessionId: sessionKlaps, text: 'Chcę burgery' });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toMatch(/create_order|confirm_order/); // Może być confirm_order jeśli wymaga potwierdzenia
            // Oczekiwanie: nazwa jakiegoś burgera z menu Klaps Burgers w odpowiedzi
            const expectedNames = /desperado|fiction|serano|halloween|głodzilla|smak vegas|mrdrwal|onionator|milczenie|wegetrix|kosmiczne/i;
            expect(res.body.reply.toLowerCase()).toMatch(expectedNames);
        });

        it('Test 2 (konkretny burger z aliasem): powinien dopasować "burgera Vegas" do "Smak Vegas"', async () => {
            const res = await request(app)
                .post('/api/brain')
                .send({ sessionId: sessionKlaps, text: 'Poproszę burgera Vegas' });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toMatch(/create_order|confirm_order/);
            expect(res.body.reply).toMatch(/Smak Vegas/i);
        });

        it('Test 3 (napój): powinien dodać napój do zamówienia (np. Pepsi)', async () => {
            // W CSV Klaps ma głównie burgery, ale sprawdzamy czy flow napojów działa
            // (Możemy użyć czegoś co jest w Aliasach lub ogólnie znane, np. Pepsi)
            const res = await request(app)
                .post('/api/brain')
                .send({ sessionId: sessionKlaps, text: 'Poproszę dwie pepsi' });

            expect(res.status).toBe(200);
            expect(res.body.ok).toBe(true);
            expect(res.body.intent).toMatch(/create_order/);
            expect(res.body.reply.toLowerCase()).toMatch(/pepsi/);
        });
    });
});
