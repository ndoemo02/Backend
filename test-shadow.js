
import handler from './api/brain/brainRouter.js';

// Mock Express
const req = {
    method: 'POST',
    body: {
        sessionId: 'test_shadow_user_v1',
        text: 'Znajdź pizzę w Zabrzu'
    },
    json: async () => ({
        sessionId: 'test_shadow_user_v1',
        text: 'Znajdź pizzę w Zabrzu'
    })
};

const res = {
    status: (code) => {
        console.log(`[HTTP ${code}] Status set`);
        return res;
    },
    json: (data) => {
        console.log(`[HTTP Response] Legacy Reply Intent: ${data.intent}`);
        // Simulate response sent
        return data;
    },
    headersSent: false
};

// Test Runner
console.log("--- Test Shadow Mode ---");
handler(req, res).then(() => {
    console.log("--- Handler Promise Resolved (Response sent) ---");
    // Wait a bit for shadow promise to finish in background
    setTimeout(() => {
        console.log("--- Simulation Finished (Check logs above for [ShadowMode]) ---");
    }, 2000);
});
