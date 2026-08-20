import { ToolRouter } from './ToolRouter.js';
import { LIVE_TOOL_SCHEMAS, toGeminiFunctionDeclarations } from './ToolSchemas.js';
import { GeminiLiveGateway } from './GeminiLiveGateway.js';
import { validateLiveInternalKey, validateLiveOrigin } from './liveSecurity.js';
import { buildInitialTurnTrace } from './liveTurnLedger.js';
import openAIRealtimeSessionHandler, { getOpenAIRealtimeFallbackConfig } from './openai-session.js';
import { updateSession } from '../../brain/session/sessionStore.js';
import {
    buildDemoSessionPatch,
    resolveDemoContextFromRequest,
} from '../../demo/demoContext.js';
import { validateSessionId } from '../../brain/session/sessionIdContract.js';

let gateway = null;
const toolRouter = new ToolRouter();

export function isLiveModeEnabled() {
    return String(process.env.LIVE_MODE || '').toLowerCase() === 'true';
}

export function registerLiveRoutes(app) {
    app.post('/api/voice/live/openai-session', openAIRealtimeSessionHandler);
    app.options('/api/voice/live/openai-session', openAIRealtimeSessionHandler);

    app.post('/api/voice/live/token', async (req, res) => {
        try {
            const { default: tokenHandler } = await import('./token.js');
            return tokenHandler(req, res);
        } catch (error) {
            console.error('[LIVE_TOKEN_ROUTE_ERROR]', error?.message || 'unknown_error');
            return res.status(500).json({ ok: false, error: 'live_token_route_unavailable' });
        }
    });

    app.get('/api/voice/live/runtime-config', async (req, res) => {
        const fallbackModel =
            process.env.GEMINI_LIVE_MODEL ||
            process.env.LIVE_MODEL ||
            'gemini-2.5-flash-native-audio-preview-12-2025';

        try {
            const { getConfig } = await import('../../config/configService.js');
            const cfg = await getConfig();
            const liveModel =
                typeof cfg?.live_model === 'string' && cfg.live_model.trim().length > 0
                    ? cfg.live_model.trim()
                    : fallbackModel;
            const liveVoice =
                typeof cfg?.live_voice === 'string' && cfg.live_voice.trim().length > 0
                    ? cfg.live_voice.trim()
                    : 'Aoede';
            const speechStyle =
                typeof cfg?.speech_style === 'string' && cfg.speech_style.trim().length > 0
                    ? cfg.speech_style.trim()
                    : 'standard';
            const amberPrompt =
                typeof cfg?.amber_prompt === 'string' && cfg.amber_prompt.trim().length > 0
                    ? cfg.amber_prompt.trim()
                    : '';

            return res.status(200).json({
                ok: true,
                live_mode: isLiveModeEnabled(),
                live_model: liveModel,
                live_voice: liveVoice,
                speech_style: speechStyle,
                amber_prompt: amberPrompt,
                prompt_source: amberPrompt ? 'system_config:amber_prompt' : `speech_style:${speechStyle}`,
                openai_fallback: getOpenAIRealtimeFallbackConfig(),
            });
        } catch (error) {
            return res.status(200).json({
                ok: true,
                live_mode: isLiveModeEnabled(),
                live_model: fallbackModel,
                live_voice: 'Aoede',
                speech_style: 'standard',
                amber_prompt: '',
                prompt_source: 'fallback',
                openai_fallback: getOpenAIRealtimeFallbackConfig(),
                error: error?.message || 'runtime_config_unavailable',
            });
        }
    });

    app.get('/api/voice/live/health', (req, res) => {
        res.status(200).json({
            ok: true,
            live_mode: isLiveModeEnabled(),
            fallback: '/api/brain/v2',
            openai_realtime: getOpenAIRealtimeFallbackConfig(),
        });
    });

    app.get('/api/voice/live/tools', (req, res) => {
        res.status(200).json({
            ok: true,
            live_mode: isLiveModeEnabled(),
            tools: LIVE_TOOL_SCHEMAS,
            gemini_function_declarations: toGeminiFunctionDeclarations(),
        });
    });

  app.post('/api/voice/live/tool-call', async (req, res) => {
    const body = req.body || {};
    const sessionId = body.session_id || body.sessionId;
    const toolName = body.tool || body.tool_name;
    const args = body.args || {};
    const requestId = body.request_id || null;
    const turnId = body.turn_id || requestId || null;
    const transcript = body.transcript || body.transcript_text || null;
    const userText = body.user_text || body.userText || null;
    const t0 = Date.now();
        const originCheck = validateLiveOrigin(req.headers?.origin);
        if (!originCheck.ok) {
            return res.status(403).json({
                ok: false,
                error: 'origin_not_allowed',
                reason: originCheck.reason,
            });
        }
        const internalKeyCheck = validateLiveInternalKey(req.headers || {});
        if (!internalKeyCheck.ok) {
            return res.status(403).json({
                ok: false,
                error: 'forbidden',
                reason: internalKeyCheck.reason,
            });
        }

        if (!isLiveModeEnabled()) {
            return res.status(409).json({
                ok: false,
                error: 'live_mode_disabled',
                fallback: '/api/brain/v2',
                message: 'LIVE_MODE=false. Use classic /api/brain/v2 pipeline.',
            });
        }

        const sessionIdVerdict = validateSessionId(sessionId);
        if (!sessionIdVerdict.ok || !toolName) {
            return res.status(400).json({
                ok: false,
                error: !sessionIdVerdict.ok ? sessionIdVerdict.error : 'missing_tool',
            });
        }

        const normalizedSessionId = sessionIdVerdict.sessionId;
        try {
      const demoContext = resolveDemoContextFromRequest(body);
      updateSession(normalizedSessionId, buildDemoSessionPatch(demoContext));
      const turnTrace = buildInitialTurnTrace({
        sessionId: normalizedSessionId,
        turnId,
        requestId,
        toolName: String(toolName),
        rawArgs: args,
        rawTranscript: body.raw_transcript || body.transcript_raw || null,
        finalTranscript: transcript || userText || null,
        source: 'live_tool_http',
      });
      const result = await toolRouter.executeToolCall({
        sessionId: normalizedSessionId,
        toolName: String(toolName),
        args,
        requestId,
        turnId,
        debugLiveFlow: {
          turnTrace,
          rawArgs: args,
          finalTranscript: transcript || userText || null,
          userText,
          sttSource: transcript ? 'transcript' : (userText ? 'user_text' : null),
        },
      });

      const backendMs = result.backend_ms || (Date.now() - t0);
      result.backend_ms = backendMs;

            const status = result.ok ? 200 : 400;
            return res.status(status).json(result);
        } catch (error) {
            if (error?.statusCode === 400) {
                return res.status(400).json({
                    ok: false,
                    error: 'invalid_demo_context',
                    detail: error.message,
                });
            }
            return res.status(500).json({
                ok: false,
                error: 'live_tool_router_error',
                message: error?.message || 'unknown_error',
            });
        }
    });
}

export function attachLiveGateway(server) {
    if (!isLiveModeEnabled()) return null;
    if (gateway) return gateway;

    gateway = new GeminiLiveGateway({
        toolRouter,
        isLiveEnabled: isLiveModeEnabled,
    });
    gateway.attach(server);
    return gateway;
}

