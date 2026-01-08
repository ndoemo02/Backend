# ResponseController - Migration Guide

## Czym jest ResponseController?

**ResponseController** to jedno źródło prawdy dla **wszystkich odpowiedzi systemu**. Zapewnia:
- ✅ Brak podwójnych odpowiedzi (guard mechanism)
- ✅ Centralne logowanie i analytics
- ✅ Stopniową migrację (shadow mode → active mode)
- ✅ Bezpieczne rollback

## Tryby działania

### SHADOW MODE (domyślny - BEZPIECZNY)
```javascript
SHADOW_MODE: true  // Policy obliczane, logowane, ALE NIE wpływa na odpowiedź
ACTIVE_MODE: false
```
- Policy jest resolved i logged
- **Odpowiedź NIE jest transformowana**
- `reply === rawReply` (100% backward compatible)
- **Zero risk** - można włączyć w produkcji natychmiast

### ACTIVE MODE (po testach A/B)
```javascript
SHADOW_MODE: false
ACTIVE_MODE: true  // Policy WPŁYWA na odpowiedź
```
- Policy resolved
- **Odpowiedź jest transformowana** (verbosity, LLM stylization)
- `reply` może różnić się od `rawReply`
- Wymaga testów A/B przed włączeniem

---

## Migracja krok po kroku

### Faza 1: Shadow Mode (bezpieczna integracja)

#### Krok 1.1: Import ResponseController w handlerze

**Przed:**
```javascript
// FindRestaurantHandler.js
async execute(ctx) {
  const restaurants = await this.searchRestaurants(city, cuisine);
  const reply = `Znalazłam ${restaurants.length} restauracji.`;
  
  return { reply, restaurants };
}
```

**Po:**
```javascript
// FindRestaurantHandler.js
import { finalizeResponse } from '../core/ResponseController.js';

async execute(ctx) {
  const { text, session, entities } = ctx;
  
  // 1. Handler generuje RAW odpowiedź (logika biznesowa)
  const restaurants = await this.searchRestaurants(city, cuisine);
  const rawReply = `Znalazłam ${restaurants.length} restauracji.`;
  
  // 2. Finalizacja przez ResponseController
  const finalized = await finalizeResponse(rawReply, {
    intent: 'find_nearby',
    entities,
    session,
    adminConfig: session.adminOverrides, // z Dev Panel
    meta: { restaurantCount: restaurants.length }
  });
  
  // 3. Zwróć sfinalizowaną odpowiedź
  return {
    reply: finalized.reply, // W shadow mode: identyczne jak rawReply
    restaurants,
    meta: {
      policy: finalized.policy,      // Debug: policy decision
      rawReply: finalized.rawReply   // Debug: oryginalna odpowiedź
    }
  };
}
```

**Rezultat:**
- ✅ Odpowiedź **identyczna** jak przed migracją
- ✅ Policy jest obliczane i logowane w tle
- ✅ Zero wpływu na użytkownika
- ✅ Analytics zaczynają gromadzić dane

#### Krok 1.2: Weryfikacja w testach

```bash
# Sprawdź czy wszystkie testy przechodzą
npm test

# Zweryfikuj że odpowiedzi są identyczne
node tests/pipeline_context_flow.test.js
```

#### Krok 1.3: Deploy na produkcję

```bash
# Deploy z shadow mode (SAFE)
git add api/brain/domains/food/findHandler.js
git commit -m "feat: integrate ResponseController (shadow mode)"
git push
```

**Monitoring:**
- Sprawdź logi policy decisions
- Porównaj `rawReply` vs `finalReply` (powinny być identyczne)
- Zbieraj dane o najczęściej używanych policy

---

### Faza 2: Active Mode (po analizie danych)

#### Krok 2.1: Analiza danych z Shadow Mode

```sql
-- Przykład query analytics (gdy będzie zaimplementowane)
SELECT 
  policy_style,
  AVG(user_satisfaction) as avg_satisfaction,
  COUNT(*) as usage_count
FROM response_policy_analytics
WHERE mode = 'shadow'
  AND timestamp > NOW() - INTERVAL '30 days'
GROUP BY policy_style
ORDER BY avg_satisfaction DESC;
```

#### Krok 2.2: A/B Testing

```javascript
// W configService.js lub .env
RESPONSE_POLICY_ACTIVE=true  // Włącz dla 10% użytkowników
AB_TEST_PERCENTAGE=10
```

#### Krok 2.3: Monitoring transformacji

```javascript
// Sprawdź różnice w odpowiedziach
if (finalized.reply !== finalized.rawReply) {
  console.log('🔄 Transformation applied:', {
    before: finalized.rawReply,
    after: finalized.reply,
    policy: finalized.policy
  });
}
```

#### Krok 2.4: Pełne włączenie (po pozytywnych wynikach A/B)

```bash
# .env
RESPONSE_POLICY_SHADOW=false
RESPONSE_POLICY_ACTIVE=true
```

---

## Guard Mechanism (ochrona przed podwójnymi odpowiedziami)

### Problem:
```javascript
// ❌ ZŁY KOD (przed ResponseController)
async execute(ctx) {
  const reply1 = generateReply1();
  const reply2 = generateReply2(); // Podwójna odpowiedź!
  return { reply: reply1 + reply2 };
}
```

### Rozwiązanie:
```javascript
// ✅ ResponseController GUARD
async execute(ctx) {
  const rawReply = generateReply();
  
  // Pierwsza finalizacja: OK
  const finalized = await finalizeResponse(rawReply, ctx);
  
  // Druga próba finalizacji: THROW ERROR
  try {
    await finalizeResponse('Druga odpowiedź', ctx);
  } catch (err) {
    // Error: "Response already finalized!"
    console.error(err);
  }
  
  return { reply: finalized.reply };
}
```

**Mechanizm:**
- Pierwsza finalizacja ustawia `ctx.responseFinalized = true`
- Druga próba rzuca błędem
- **Gwarantuje:** tylko jedna odpowiedź per request

---

## Rollback Plan

Jeśli coś pójdzie nie tak (w Active Mode):

### Opcja 1: Natychmiastowy rollback do Shadow Mode
```bash
# .env
RESPONSE_POLICY_ACTIVE=false  # Wyłącz transformacje
RESPONSE_POLICY_SHADOW=true   # Wróć do shadow mode
```
**Rezultat:**
- Odpowiedzi wracają do formy `rawReply`
- System działa jak przed migracją

### Opcja 2: Wyłączenie ResponseController
```javascript
// W handlerze: zakomentuj finalizację
// const finalized = await finalizeResponse(rawReply, ctx);

// Zwróć raw reply bezpośrednio
return { reply: rawReply, restaurants };
```

---

## Checklist migracji handlera

- [ ] Import `finalizeResponse` z `ResponseController.js`
- [ ] Zmiana `reply` → `rawReply` w logice handlera
- [ ] Wywołanie `finalizeResponse(rawReply, context)`
- [ ] Zwrócenie `finalized.reply` zamiast `rawReply`
- [ ] Dodanie `meta.policy` i `meta.rawReply` dla debugowania
- [ ] Testy jednostkowe przechodzą
- [ ] Testy integracyjne przechodzą
- [ ] Deploy na staging
- [ ] Monitoring przez 24h
- [ ] Deploy na produkcję

---

## Przykłady dla różnych handlerów

### FindRestaurantHandler
```javascript
const finalized = await finalizeResponse(rawReply, {
  intent: 'find_nearby',
  entities,
  session,
  adminConfig: session.adminOverrides
});
```

### MenuHandler
```javascript
const finalized = await finalizeResponse(rawReply, {
  intent: 'menu_request',
  entities: { restaurantId: restaurant.id },
  session,
  meta: { menuItemCount: menuItems.length }
});
```

### OrderHandler
```javascript
const finalized = await finalizeResponse(rawReply, {
  intent: 'create_order',
  entities: { dish, quantity },
  session,
  meta: { orderTotal: calculateTotal(items) }
});
```

### ConfirmOrderHandler
```javascript
const finalized = await finalizeResponse(rawReply, {
  intent: 'confirm_order',
  entities: {},
  session,
  meta: { orderId: createdOrder.id }
});
```

---

## FAQ

**Q: Czy muszę migrować wszystkie handlery naraz?**  
A: Nie. Migruj po kolei. Każdy handler może działać niezależnie.

**Q: Co się stanie jeśli zapomnę wywołać finalizeResponse?**  
A: Handler zwróci raw reply. System będzie działał, ale policy nie będzie applied.

**Q: Czy ResponseController wpływa na wydajność?**  
A: W Shadow Mode: minimalne (~2-5ms overhead na policy resolution). W Active Mode: zależy od transformacji (LLM = +200-500ms).

**Q: Jak wyłączyć logging?**  
A: Ustaw `RESPONSE_POLICY_LOGGING=false` w `.env`.

**Q: Czy mogę używać ResponseController w testach?**  
A: Tak. Użyj `resetFinalizationFlag(ctx)` aby wyczyścić guard między testami.

---

**Wersja dokumentacji:** 1.0  
**Data:** 2026-01-08  
**Status:** Ready for Stage 1 (Shadow Mode) deployment
