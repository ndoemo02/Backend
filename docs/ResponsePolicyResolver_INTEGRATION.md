# Response Policy Resolver - Integration Guide

## Czym jest ResponsePolicyResolver?

Moduł odpowiedzialny za **oddzielenie decyzji "JAK mówić" od "CO mówić"**.

- **Handler** (np. `FindRestaurantHandler`) decyduje **CO** powiedzieć (logika biznesowa, treść merytoryczna)
- **ResponsePolicyResolver** decyduje **JAK** to powiedzieć (styl, ton, długość, emocje)

## Struktura Policy Object

```javascript
{
  style: 'professional' | 'casual' | 'enthusiastic' | 'neutral' | 'empathetic',
  verbosity: 'concise' | 'normal' | 'detailed',
  recommendationMode: 'subtle' | 'direct' | 'none',
  shouldUseLLM: boolean,
  ttsMode: 'standard' | 'expressive' | 'fast',
  metadata: {
    sourceIntent: string,
    wasAdapted: boolean,
    adminOverride: boolean
  }
}
```

## Przykład użycia w handlerze

### Przed (bez policy):
```javascript
// FindRestaurantHandler.js
async execute(ctx) {
  const restaurants = await this.searchRestaurants(city, cuisine);
  
  const reply = `Znalazłam ${restaurants.length} restauracji w ${city}.`;
  
  return { reply, restaurants };
}
```

### Po (z policy):
```javascript
// FindRestaurantHandler.js
import { resolveResponsePolicy } from '../core/ResponsePolicyResolver.js';
import { stylizeWithGPT4o } from '../tts/ttsClient.js';

async execute(ctx) {
  const { text, session, entities } = ctx;
  
  // 1. Logika biznesowa (CO powiedzieć)
  const restaurants = await this.searchRestaurants(city, cuisine);
  const rawReply = `Znalazłam ${restaurants.length} restauracji w ${city}.`;
  
  // 2. Resolve policy (JAK powiedzieć)
  const policy = resolveResponsePolicy({
    intent: 'find_nearby',
    entities,
    session,
    adminConfig: session.adminOverrides // z Dev Panel
  });
  
  // 3. Adaptacja odpowiedzi według policy
  let finalReply = rawReply;
  
  if (policy.shouldUseLLM && process.env.NODE_ENV !== 'test') {
    finalReply = await stylizeWithGPT4o(rawReply, policy.style);
  }
  
  // 4. Wybór verbosity (opcjonalnie)
  if (policy.verbosity === 'concise') {
    finalReply = finalReply.split('.')[0] + '.'; // Tylko pierwsze zdanie
  }
  
  return {
    reply: finalReply,
    restaurants,
    meta: { 
      policy, // Przekaż policy do TTS dla wyboru voice/rate
      rawReply // Debug: oryginalna odpowiedź przed stylizacją
    }
  };
}
```

## Integracja z Dev Panel

### Backend (dodaj do session):
```javascript
// W brainRouter.js lub pipeline.js, po pobraniu konfiguracji:
const cfg = await getConfig();
session.adminOverrides = {
  forceStyle: cfg?.response_style || null,
  disableLLM: cfg?.disable_llm || false,
  fastTTS: cfg?.fast_tts || false
};
```

### Frontend (Dev Panel UI):
```javascript
// W AdminPanel.jsx, dodaj kontrolki:
<select onChange={(e) => updateConfig({ response_style: e.target.value })}>
  <option value="">Auto (based on intent)</option>
  <option value="professional">Professional</option>
  <option value="casual">Casual</option>
  <option value="enthusiastic">Enthusiastic</option>
  <option value="empathetic">Empathetic</option>
  <option value="neutral">Neutral</option>
</select>

<label>
  <input type="checkbox" onChange={(e) => updateConfig({ disable_llm: e.target.checked })} />
  Disable LLM Stylization (for performance testing)
</label>
```

## Integracja z TTS

Policy object można przekazać do `playTTS` dla wyboru parametrów:

```javascript
// W handlerze lub pipeline:
const policy = resolveResponsePolicy({ intent, entities, session });

const ttsOptions = {
  voice: 'pl-PL-Wavenet-A',
  speakingRate: policy.ttsMode === 'fast' ? 1.2 : 1.0,
  pitch: policy.style === 'enthusiastic' ? 2 : 0
};

const audioContent = await playTTS(reply, ttsOptions);
```

## Logika adaptacji (Session Context)

ResponsePolicyResolver automatycznie adaptuje politykę na podstawie stanu sesji:

| **Warunek sesji** | **Adaptacja** | **Cel** |
|---|---|---|
| `interactionCount > 10` | `professional` → `casual` | Użytkownik jest "oswojony", może być bardziej swobodnie |
| `lastIntent === 'unknown'` | Zawsze `empathetic` + `detailed` | Po błędzie, system ma być bardziej pomocny |
| `interactionCount < 3` | `normal` → `concise` | Nowi użytkownicy preferują zwięzłość |
| `lastRestaurant` istnieje | `direct` → `subtle` | Jeśli wybrano restaurację, mniej agresywnych rekomendacji |

## Testowanie

```bash
# Test jednostkowy (standalone)
node tests/unit/ResponsePolicyResolver.test.js

# Weryfikacja integracji w całym pipeline (TODO - po integracji)
node tests/pipeline_context_flow.test.js
```

## Roadmap integracji

1. ✅ **Etap 1 (DONE):** Utworzenie `ResponsePolicyResolver.js` jako standalone module
2. ⏳ **Etap 2:** Integracja w `FindRestaurantHandler` (pilot)
3. ⏳ **Etap 3:** Rozszerzenie na pozostałe handlery (`MenuHandler`, `OrderHandler`)
4. ⏳ **Etap 4:** Dodanie kontrolek w Dev Panel (Admin UI)
5. ⏳ **Etap 5:** A/B testing różnych stylów (logging & analytics)

## FAQ

**Q: Czy mogę używać policy bez LLM?**  
A: Tak. Jeśli `policy.shouldUseLLM === false`, możesz pominąć krok stylizacji i użyć raw reply directly.

**Q: Jak policy wpływa na TTS?**  
A: `policy.ttsMode` sugeruje parametry syntezy (speaking rate, pitch). Handler/Pipeline może to wykorzystać przy wywołaniu `playTTS`.

**Q: Czy policy cache'uje decyzje?**  
A: Nie. Policy jest **deterministyczne** i obliczane on-the-fly. Jeśli potrzebujesz cache, dodaj na poziomie handlera.

**Q: Co się stanie jeśli adminConfig jest null?**  
A: Policy użyje domyślnych wartości z `DEFAULT_INTENT_POLICIES` + session adaptation. Admin overrides są opcjonalne.

---

**Dokumentacja wersja:** 1.0  
**Data utworzenia:** 2026-01-08  
**Autor:** AI Refactoring Team
