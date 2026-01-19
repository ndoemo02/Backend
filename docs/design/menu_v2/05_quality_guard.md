# 05 — QUALITY GUARD: BRAINV2 VALIDATION SUITE
## Cel
Zestaw testów regresyjnych i walidacyjnych dla rdzenia BrainV2, zapewniający poprawność przepływu danych od NLU do Renderowania Dialogu, ze szczególnym uwzględnieniem nowej warstwy tokenizacji Menu V2.

---

## 🧪 01 — NLU: Intent + Entities
**Lokalizacja testu:** `api/brain/tests/nlu_core.test.js`
**Cel:** Weryfikacja klasyfikacji intencji i ekstrakcji encji bez "halucynacji" lokalizacji/dań.

```javascript
import { detectIntent } from '../nlu/router.js';

describe('01_NLU: Intent & Entities', () => {
  it('find_nearby => location + cuisine', async () => {
    const result = await detectIntent({
      text: 'Gdzie w Piekarach zjem kebaba',
      session: {}
    });
    expect(result.intent).toBe('find_nearby');
    expect(result.entities.location).toBe('Piekary Śląskie');
    expect(result.entities.cuisine).toBe('Kebab');
  });

  it('should NOT parse random words as location', async () => {
    const result = await detectIntent({
      text: 'Pokaż co mają w menu',
      session: {}
    });
    expect(result.entities.location).toBeNull();
  });

  it('should detect menu_request without restaurant', async () => {
    const result = await detectIntent({
      text: 'Pokaż co mają w menu',
      session: { last_location: 'Piekary Śląskie' }
    });
    expect(result.intent).toBe('menu_request');
  });
});
```
👉 *FAIL → poprawki w NLU regex / overrides / safety guards.*

---

## 🧪 02 — Intent Capability / FSM Gate
**Lokalizacja testu:** `api/brain/tests/icm_fsm.test.js`
**Cel:** Sprawdzenie, czy intencje są dopuszczalne w bieżącym stanie sesji (Bramka FSM).

```javascript
import { checkRequiredState } from '../core/IntentCapabilityMap.js';

describe('02_ICM/FSM: Required State Checks', () => {
  it('blocks menu_request without restaurant', () => {
    expect(checkRequiredState('menu_request', {}).met).toBe(false);
  });

  it('allows menu_request with currentRestaurant', () => {
    expect(checkRequiredState('menu_request', { currentRestaurant: { id: 'uuid' } }).met).toBe(true);
  });

  it('confirm_order requires pendingOrder + expectedContext', () => {
    expect(checkRequiredState('confirm_order', { pendingOrder: null, expectedContext: null }).met).toBe(false);
  });
});
```
👉 *FAIL → poprawki w IntentCapabilityMap (rules, requiredState).*

---

## 🧪 03 — Disambiguation / Item Parsing
**Lokalizacja testu:** `api/brain/tests/disambiguation_v2.test.js`
**Cel:** Weryfikacja dopasowania elementów menu i obsługi niejasności (fuzzy matching).

```javascript
import { parseOrderItems } from '../order/parseOrderItems.js';

describe('03_Disambiguation: Item Matching', () => {
  const sampleCatalog = []; // Zasilane z 02_seed_menu_item_ingredients.json

  it('matches exact menu item', () => {
    const parsed = parseOrderItems('carpaccio z kaczki marynowanej w grzańcu', sampleCatalog);
    expect(parsed.available.length).toBeGreaterThan(0);
    expect(parsed.needsClarification).toBe(false);
  });

  it('partial match triggers clarification', () => {
    const parsed = parseOrderItems('carpaccio z kaczki marynowanej', sampleCatalog);
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.unknownItems.length).toBeGreaterThan(0);
  });
});
```
👉 *FAIL → poprawki w aliasach / fuzzy matcherze w parseOrderItems.*

---

## 🧪 04 — Dialog Surface Rendering
**Lokalizacja testu:** `api/brain/tests/surface_renderer.test.js`
**Cel:** Sprawdzenie czytelności komunikatów i UI hints.

```javascript
import { renderSurface } from '../dialog/SurfaceRenderer.js';

describe('04_Dialog Surface', () => {
  it('ASK_RESTAURANT_FOR_MENU renders options', () => {
    const { text, ui_hints } = renderSurface({
      dialog_key: 'ASK_RESTAURANT_FOR_MENU',
      facts: { restaurants: [{ id: 'A', name: 'Restauracja A' }] }
    });
    expect(text).toMatch(/Którą restaurację/);
    expect(ui_hints.list).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'A' })]));
  });
});
```
👉 *FAIL → poprawki w SurfaceRenderer templates.*

---

## 🧪 05 — FULL PIPELINE FLOWS (Integracyjne)
**Lokalizacja testu:** `api/brain/tests/pipeline_v2.test.js`
**Cel:** End-to-end od wejścia użytkownika do wyniku końcowego.

```javascript
test('User: Gdzie w Piekarach zjem kebaba → Show restaurants', async () => {
  const res1 = await pipeline.process(sessionId(), 'Gdzie w Piekarach zjem kebaba');
  expect(res1.intent).toBe('find_nearby');
  expect(res1.uiHints?.panel).toBe('restaurants');
});
```

---

## 🧠 DEBUGGING HELPERS
**Lokalizacja:** `api/brain/helpers/debugUtils.js`

```javascript
export function logResult(res) {
  console.log('--- RESULT ---');
  console.log('intent:', res.intent);
  console.log('entities:', res.entities);
  console.log('uiHints:', res.uiHints);
  console.log('session:', res.sessionSnapshot);
}
```
