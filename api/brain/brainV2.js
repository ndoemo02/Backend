/**
 * Brain V2 - Modular Pipeline Entry Point
 * Zastępuje monolityczny brainRouter.js
 */

import { BrainPipeline } from './core/pipeline.js';
import { NLURouter } from './nlu/router.js';
import { sanitizeAssistantResponse } from './core/securityGuards.js';
import { updateSession } from './session/sessionStore.js';
import {
    buildDemoSessionPatch,
    resolveDemoContextFromRequest,
} from '../demo/demoContext.js';

// Singleton Initialization (Warm Start)
const nlu = new NLURouter();
export const pipeline = new BrainPipeline({ nlu });

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ ok: false, error: 'Method not allowed' });
    }

    try {
        const body = req.body || {};

        // ETAP 4 Contract: { session_id, input, meta }
        const { session_id, input, meta = {} } = body;

        const text = input || body.text;
        const sessionId = session_id || body.sessionId;

        if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
            return res.status(400).json({ ok: false, error: 'missing_session_id' });
        }

        if (!text && !body.text) {
            return res.status(400).json({ ok: false, error: 'missing_input' });
        }

        const demoContext = resolveDemoContextFromRequest(body);
        updateSession(sessionId.trim(), buildDemoSessionPatch(demoContext));

        console.log(`[BrainV2] Request: ${sessionId} -> "${text}" (Channel: ${meta.channel || 'unknown'})`);

        const options = {
            includeTTS: body.includeTTS || false,
            stylize: body.stylize || false,
            ttsOptions: body.ttsOptions || {},
            requestBody: body,
        };

        const result = await pipeline.process(sessionId.trim(), text, options);
        const safeResult = sanitizeAssistantResponse(result);

        return res.status(200).json(safeResult);
    } catch (error) {
        const statusCode = error?.statusCode || error?.status || 500;

        if (statusCode === 400) {
            return res.status(400).json({ ok: false, error: error.message || 'bad_request' });
        }

        console.error('[BrainV2] Generic Error:', error);
        return res.status(500).json({ ok: false, error: 'internal_server_error' });
    }
}
