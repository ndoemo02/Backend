/**
 * Brain V2 - Modular Pipeline Entry Point
 * Zastępuje monolityczny brainRouter.js
 */

import { BrainPipeline } from './core/pipeline.js';
import { NLURouter } from './nlu/router.js';
import { sanitizeAssistantResponse } from './core/securityGuards.js';
import {
    getSession,
    setSession,
    updateSessionAsync,
} from './session/sessionStore.js';
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

        const normalizedSessionId = sessionId.trim();
        const demoContext = resolveDemoContextFromRequest(body);

        // Serverless safety: hydrate the durable session before adding request
        // metadata. A sync update on a cold instance would create an optimistic
        // empty session and could overwrite the real conversation snapshot.
        await updateSessionAsync(
            normalizedSessionId,
            buildDemoSessionPatch(demoContext),
        );

        console.log(`[BrainV2] Request: ${sessionId} -> "${text}" (Channel: ${meta.channel || 'unknown'})`);

        const options = {
            includeTTS: body.includeTTS || false,
            stylize: body.stylize || false,
            ttsOptions: body.ttsOptions || {},
            requestBody: body,
        };

        const result = await pipeline.process(normalizedSessionId, text, options);

        // Vercel may freeze an invocation immediately after res.json(). Persist
        // all mutations performed by legacy sync call-sites before responding.
        const finalSessionId = String(result?.session_id || normalizedSessionId);
        const finalSessionSnapshot = getSession(finalSessionId);
        if (finalSessionSnapshot) {
            await setSession(finalSessionId, finalSessionSnapshot);
        }

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
