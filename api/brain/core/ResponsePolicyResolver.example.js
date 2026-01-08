/**
 * Dev Panel Integration Example
 * 
 * Przykład pokazuje, jak ResponsePolicyResolver może być zintegrowany
 * z panelem admina (bez zmiany istniejącego kodu BrainPipeline).
 * 
 * UWAGA: To jest MOCKUP dokumentacyjny, nie jest uruchamiany w runtime.
 */

// ========================================
// 1. Backend: Pobieranie konfiguracji z Dev Panel
// ========================================

/**
 * Przykład rozszerzenia getConfig() w configService.js
 * (lub dodanie nowego endpointu dla response policy)
 */
async function getResponsePolicyConfigFromDevPanel() {
    // W rzeczywistości to byłoby pobierane z Supabase tabeli 'config'
    // lub dedykowanej tabeli 'response_policy_config'

    const config = {
        // Global overrides (stosowane do wszystkich requestów)
        global: {
            forceStyle: null,        // null = auto, 'professional' | 'casual' | ...
            forceVerbosity: null,    // null = auto, 'concise' | 'normal' | 'detailed'
            disableLLM: false,       // true = wyłącz stylizację GPT-4o (performance mode)
            fastTTS: false           // true = TTS w trybie przyspieszonym
        },

        // Intent-specific overrides (nadpisanie dla konkretnych intencji)
        intentOverrides: {
            'find_nearby': {
                style: 'enthusiastic',  // Override default
                verbosity: 'concise'    // Shorter responses for find_nearby
            },
            'create_order': {
                style: 'professional',
                shouldUseLLM: false     // Disable LLM for order confirmations (faster)
            }
        },

        // A/B Testing (przypisanie użytkowników do grup)
        abTesting: {
            enabled: true,
            groups: {
                'control': { forceStyle: null },           // Default behavior
                'test_enthusiastic': { forceStyle: 'enthusiastic' },
                'test_concise': { forceVerbosity: 'concise' }
            }
        }
    };

    return config;
}

// ========================================
// 2. Backend: Użycie w BrainPipeline (lub handlerze)
// ========================================

/**
 * Przykład integracji w pipeline.process() lub handlerze
 * (bez zmiany istniejącego kodu - tylko rozszerzenie)
 */
import { resolveResponsePolicy } from './ResponsePolicyResolver.js';

async function exampleHandlerWithPolicy(ctx) {
    const { text, session, entities } = ctx;

    // A. Pobierz konfigurację z Dev Panel (1x per request)
    const devPanelConfig = await getResponsePolicyConfigFromDevPanel();

    // B. Przygotuj admin overrides dla policy resolver
    let adminConfig = devPanelConfig.global;

    // C. Jeśli intent ma dedykowane override, użyj go
    const intentOverride = devPanelConfig.intentOverrides[ctx.intent];
    if (intentOverride) {
        adminConfig = { ...adminConfig, ...intentOverride };
    }

    // D. A/B Testing: Przypisz użytkownika do grupy
    if (devPanelConfig.abTesting.enabled) {
        const userGroup = getUserABGroup(session.userId); // hash(userId) % groups.length
        const groupConfig = devPanelConfig.abTesting.groups[userGroup];
        adminConfig = { ...adminConfig, ...groupConfig };
    }

    // E. Resolve policy
    const policy = resolveResponsePolicy({
        intent: ctx.intent,
        entities,
        session,
        adminConfig
    });

    console.log('📋 Resolved Policy:', policy);

    // F. Użyj policy (przykład - stylizacja LLM)
    let reply = "Znalazłam 5 restauracji w Piekarach."; // Raw reply

    if (policy.shouldUseLLM) {
        reply = await stylizeWithGPT4o(reply, policy.style);
    }

    if (policy.verbosity === 'concise') {
        reply = reply.split('.')[0] + '.'; // Tylko pierwsze zdanie
    }

    return {
        reply,
        meta: { policy } // Przekaż policy do TTS/Frontend
    };
}

// ========================================
// 3. Frontend: Dev Panel UI (mockup)
// ========================================

/**
 * Przykład komponentu React w AdminPanel.jsx
 * (NIE implementowane teraz - tylko mockup)
 */
function ResponsePolicyControlPanel() {
    const [config, setConfig] = useState({
        forceStyle: null,
        forceVerbosity: null,
        disableLLM: false,
        fastTTS: false
    });

    const saveConfig = async () => {
        await fetch('/api/admin/config/response-policy', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        alert('Policy config saved!');
    };

    return (
        <div className="policy-control-panel">
            <h3>Response Policy Configuration</h3>

            <div className="control-group">
                <label>Force Style (Override):</label>
                <select
                    value={config.forceStyle || ''}
                    onChange={(e) => setConfig({ ...config, forceStyle: e.target.value || null })}
                >
                    <option value="">Auto (based on intent)</option>
                    <option value="professional">Professional</option>
                    <option value="casual">Casual</option>
                    <option value="enthusiastic">Enthusiastic</option>
                    <option value="empathetic">Empathetic</option>
                    <option value="neutral">Neutral</option>
                </select>
            </div>

            <div className="control-group">
                <label>Force Verbosity:</label>
                <select
                    value={config.forceVerbosity || ''}
                    onChange={(e) => setConfig({ ...config, forceVerbosity: e.target.value || null })}
                >
                    <option value="">Auto</option>
                    <option value="concise">Concise</option>
                    <option value="normal">Normal</option>
                    <option value="detailed">Detailed</option>
                </select>
            </div>

            <div className="control-group">
                <label>
                    <input
                        type="checkbox"
                        checked={config.disableLLM}
                        onChange={(e) => setConfig({ ...config, disableLLM: e.target.checked })}
                    />
                    Disable LLM Stylization (Performance Mode)
                </label>
            </div>

            <div className="control-group">
                <label>
                    <input
                        type="checkbox"
                        checked={config.fastTTS}
                        onChange={(e) => setConfig({ ...config, fastTTS: e.target.checked })}
                    />
                    Fast TTS Mode (1.2x speed)
                </label>
            </div>

            <button onClick={saveConfig}>Save Configuration</button>

            {/* Podgląd aktualnej policy (live testing) */}
            <div className="policy-preview">
                <h4>Current Policy Preview:</h4>
                <pre>{JSON.stringify(config, null, 2)}</pre>
            </div>
        </div>
    );
}

// ========================================
// 4. A/B Testing Helper (hash-based group assignment)
// ========================================

function getUserABGroup(userId) {
    const groups = ['control', 'test_enthusiastic', 'test_concise'];
    const hash = simpleHash(userId);
    return groups[hash % groups.length];
}

function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

// ========================================
// 5. Logowanie i Analytics
// ========================================

/**
 * Przykład logowania policy decisions do analytics
 */
async function logPolicyDecision(sessionId, policy, result) {
    await supabase.from('policy_analytics').insert({
        session_id: sessionId,
        intent: policy.metadata.sourceIntent,
        style: policy.style,
        verbosity: policy.verbosity,
        used_llm: policy.shouldUseLLM,
        admin_override: policy.metadata.adminOverride,
        user_satisfaction: null, // To be updated later by user feedback
        timestamp: new Date().toISOString()
    });
}

/**
 * Przykład dashboardu analytics (SQL query)
 */
const analyticsQuery = `
    SELECT 
        style,
        AVG(user_satisfaction) as avg_satisfaction,
        COUNT(*) as usage_count
    FROM policy_analytics
    WHERE timestamp > NOW() - INTERVAL '7 days'
    GROUP BY style
    ORDER BY avg_satisfaction DESC;
`;

// ========================================
// PODSUMOWANIE
// ========================================

/**
 * Ten plik pokazuje KOMPLETNY przykład integracji ResponsePolicyResolver
 * z istniejącym systemem, bez zmiany core logic (BrainPipeline, handlery).
 * 
 * Kolejne kroki integracji:
 * 1. Dodać endpoint /api/admin/config/response-policy (backend)
 * 2. Dodać UI w AdminPanel.jsx (frontend)
 * 3. Rozszerzyć configService.js o getResponsePolicyConfig()
 * 4. Dodać policy resolution w handlerach (pilot: FindRestaurantHandler)
 * 5. Dodać analytics tracking (policy_analytics table)
 * 6. A/B testing infrastruktura (user group assignment)
 */

export {
    getResponsePolicyConfigFromDevPanel,
    exampleHandlerWithPolicy,
    ResponsePolicyControlPanel,
    getUserABGroup,
    logPolicyDecision
};
