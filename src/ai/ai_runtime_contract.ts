/**
 * AI Runtime Contract
 * 
 * Jedyne źródło prawdy o modelach AI używanych w systemie.
 * Definiuje interfejsy i odpowiedzialności dla trzech filarów: NLU, RESPONSE, TTS.
 * 
 * Ten plik służy jako kontrakt architektoniczny dla przyszłej migracji i refaktoryzacji.
 */

// ============================================================================
// 1. NLU (Natural Language Understanding)
// ============================================================================
/**
 * Model odpowiedzialny za:
 * - Klasyfikację intencji (Co użytkownik chce zrobić?)
 * - Ekstrakcję encji (Szczegóły: danie, miasto, ilość)
 * - Rozwiązywanie niejednoznaczności w kontekście (Context Resolution)
 * 
 * Przykład implementacji: Wit.ai, OpenAI, Custom Regex/Hybrid
 */
export interface NLUModel {
    id: string;
    version: string;

    /**
     * Przetwarza tekst użytkownika na strukturę intencji.
     * @param text Surowa transkrypcja z ASR
     * @param sessionContext Aktualny stan sesji (historia, ostatnia intencja)
     */
    detect(text: string, sessionContext?: any): Promise<NLUResult>;
}

export interface NLUResult {
    intent: string;                // Np. 'create_order', 'find_restaurant', 'unknown'
    confidence: number;            // Pewność modelu (0.0 - 1.0)
    entities: Record<string, any>; // Wyekstrahowane dane (np. { dish: "Pizza", quantity: 2 })
    source: 'ai' | 'heuristic';    // Czy wynik pochodzi z AI czy reguł (np. regex)
}

// ============================================================================
// 2. RESPONSE (Reasoning / Content Generation)
// ============================================================================
/**
 * Model odpowiedzialny za:
 * - Logikę biznesową odpowiedzi (Co system ma powiedzieć?)
 * - Generowanie naturalnego tekstu (NLG)
 * - Podejmowanie decyzji o akcjach systemowych (np. dodanie do koszyka)
 * 
 * Przykład implementacji: GPT-4, Szablony (Templates), Reguły
 */
export interface ResponseModel {
    id: string;
    type: 'generative' | 'deterministic' | 'hybrid';

    /**
     * Generuje odpowiedź i akcje na podstawie intencji.
     * @param nluResult Wynik z NLU
     * @param dataContext Dane z repozytorium (menu, restauracje, stan koszyka)
     */
    generate(nluResult: NLUResult, dataContext: any): Promise<ResponsePayload>;
}

export interface ResponsePayload {
    text: string;             // Tekst do przeczytania przez TTS
    actions?: AIAction[];     // Lista akcji do wykonania (np. UpdateCart, ChangeLocation)
    contextPatch?: any;       // Zmiany do zaaplikowania w sesji
}

export interface AIAction {
    type: string; // Np. 'ADD_ITEM', 'SEARCH_RESTAURANTS'
    payload: any;
}

// ============================================================================
// 3. TTS (Text-to-Speech)
// ============================================================================
/**
 * Model odpowiedzialny za:
 * - Zamianę tekstu na mowę
 * - Kontrolę emocji i intonacji
 * - Streaming audio (niskie opóźnienia)
 * 
 * Przykład implementacji: ElevenLabs, Deepgram Aura, OpenAI TTS
 */
export interface TTSModel {
    provider: string; // Np. 'elevenlabs'
    voiceId: string;  // ID głosu

    /**
     * Syntezuje tekst.
     * @param text Tekst do syntezy
     * @param options Opcje (np. streaming=true)
     */
    speak(text: string, options?: TTSOptions): Promise<ArrayBuffer | ReadableStream>;
}

export interface TTSOptions {
    stability?: number;
    similarityBoost?: number;
    stream?: boolean;
}

// ============================================================================
// REGISTRY (Runtime Configuration)
// ============================================================================
/**
 * Kontrakt konfiguracji uruchomieniowej.
 * Definiuje, jakie modele są aktualnie wpięte w Pipeline.
 */
export interface AIRuntimeRegistry {
    nlu: NLUModel;
    response: ResponseModel;
    tts: TTSModel;

    // Metoda do podmiany modelu w locie (np. fallback)
    switchModel(type: 'nlu' | 'response' | 'tts', newModel: any): void;
}
