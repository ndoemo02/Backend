# 🔄 Migracja na `menu_items_v2`

## Co Zostało Zmienione

Brain API (`/api/brain`) teraz używa **`menu_items_v2`** zamiast starej tabeli `menu_items`.

---

## 📋 Zmiany w Plikach

### 1. **`api/brain/brainRouter.js`**

Zaktualizowane odwołania do bazy:

```javascript
// PRZED:
.from('menu_items')
.select('id, name, price, is_available')

// PO ZMIANIE:
.from('menu_items_v2')
.select('id, name, price_pln, available, category')
```

**Zmienione kolumny:**
- `price` → `price_pln`
- `is_available` → `available`
- Dodano `category`

**Lokalizacje zmian:**
- Linia ~228: `findDishInMenu()` 
- Linia ~285: `parseOrderItems()`
- Linia ~1523: `menu_request` case
- Linia ~1699: `create_order` case (menu fallback)

---

### 2. **`api/brain/intent-router.js`**

Zaktualizowane:

```javascript
// Linia ~203: loadMenuCatalog()
.from('menu_items_v2')
.select('id,name,price_pln,restaurant_id')

// Linia ~271: catalog mapping
price: mi.price_pln  // zamiast mi.price

// Linia ~1002: menu_request fallback
.from("menu_items_v2")
.select("name, price_pln")
```

---

## ✅ Testowanie

### 1. **Restart Backend** (WAŻNE!)

```bash
cd freeflow-backend
npm start
```

> ⚠️ **Backend nie przeładowuje kodu automatycznie!** Musisz go zrestartować.

### 2. **Test Callzone Menu (35 pozycji)**

```bash
node test-callzone-full-menu.js
```

Lub PowerShell:
```powershell
Invoke-RestMethod http://localhost:3000/api/brain -Method POST -Body (@{text='Pokaż menu Callzone'; sessionId='test'} | ConvertTo-Json) -ContentType 'application/json'
```

**Oczekiwany wynik:**
```json
{
  "ok": true,
  "intent": "menu_request",
  "restaurant": { "name": "Callzone" },
  "reply": "W Callzone dostępne m.in.: Bacon Burger, Pizza Margherita, Sałatka Cezar...",
  "context": {
    "last_menu": [ /* 35 pozycji */ ]
  }
}
```

### 3. **Test Zamówienia z Callzone**

```powershell
# Wybierz Callzone
Invoke-RestMethod http://localhost:3000/api/brain -Method POST -Body (@{text='Pokaż menu Callzone'; sessionId='order-test'} | ConvertTo-Json) -ContentType 'application/json'

# Zamów danie
Invoke-RestMethod http://localhost:3000/api/brain -Method POST -Body (@{text='Zamów bacon burgera'; sessionId='order-test'} | ConvertTo-Json) -ContentType 'application/json'
```

---

## 📊 Struktura `menu_items_v2`

Nowe kolumny w v2:

```javascript
{
  "id": "uuid",
  "restaurant_id": "uuid",
  "name": "string",
  "description": "string",
  "category": "string",          // NOWOŚĆ (Burger, Pizza, Sałatki)
  "base_type": "string",          // NOWOŚĆ (burger, pizza, salad)
  "meat_type": "string",          // NOWOŚĆ (mięsne, wege)
  "size_or_variant": "string",    // NOWOŚĆ
  "price_pln": number,            // ZMIANA (było: price)
  "spicy": boolean,               // NOWOŚĆ
  "is_vege": boolean,             // NOWOŚĆ
  "image_url": "string",
  "available": boolean,           // ZMIANA (było: is_available)
  "created_at": "timestamp"
}
```

---

## 🔍 Weryfikacja

### Sprawdź ile pozycji ma Callzone:

```bash
node check-callzone-menu.js
```

**Oczekiwany wynik:**
```
✅ Znaleziono 35 pozycji menu dla Callzone

Kategorie:
- Burger: 5 pozycji
- Pizza: 5 pozycji
- Sałatki: 7 pozycji
- Bowle: 4 pozycji
- Napoje: 7 pozycji
- Desery: 3 pozycji
- Sosy: 4 pozycji
```

---

## 🐛 Troubleshooting

### Problem: Brain pokazuje tylko 4 stare pizze

**Przyczyna:** Backend nie został zrestartowany lub używa cache

**Rozwiązanie:**
1. Zatrzymaj backend (Ctrl+C)
2. Uruchom ponownie: `npm start`
3. Test ponownie: `node test-callzone-full-menu.js`

### Problem: Błąd "column price does not exist"

**Przyczyna:** Gdzieś jeszcze używana jest stara kolumna `price`

**Rozwiązanie:**
```bash
# Znajdź wszystkie wystąpienia
grep -r "\.price[^_]" api/brain/
```

---

## ✅ Status

| Plik | Status | Notatki |
|------|--------|---------|
| `brainRouter.js` | ✅ Zmienione | Wszystkie 4 query na menu_items_v2 |
| `intent-router.js` | ✅ Zmienione | loadMenuCatalog + menu_request |
| Testy | ⏳ Czekają | Wymaga restart backendu |

---

## 🎉 Po Restarcie

Brain API będzie:
- ✅ Wykrywał **35 pozycji** menu Callzone
- ✅ Rozpoznawał **kategorie** (Burger, Pizza, Sałatki, etc.)
- ✅ Obsługiwał **wszystkie dania** z fuzzy matching
- ✅ Używał **prawidłowych cen** z `price_pln`

**Zrestartuj backend i przetestuj!** 🚀

