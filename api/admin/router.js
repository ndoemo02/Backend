
import express from 'express';
import conversations from './conversations.js';
import conversation from './conversation.js';
import stats from './business-stats.js';
import systemStatus from './system-status.js';

const router = express.Router();

// Helper to wrap Vercel-style handlers (req, res) -> Express
const wrap = (handler) => async (req, res, next) => {
    try {
        await handler(req, res);
    } catch (err) {
        next(err);
    }
};

router.get('/conversations', wrap(conversations));
router.get('/conversation', wrap(conversation));
router.get('/business-stats', wrap(stats));
router.get('/system-status', wrap(systemStatus));

// Dodać resztę endpointów w miarę potrzeb

export default router;
