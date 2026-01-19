# 🔧 Refactoring Roadmap Report

**Generated:** 2026-01-13  
**Purpose:** Prepare for AI Voice Agent Implementation + Component Decomposition  
**Scope:** BusinessPanel, Home.tsx, API Architecture

---

## Executive Summary

The codebase has successfully completed the **Stabilization Phase** (CSS tokens, TS migration). We are now ready for:
1. **Decomposition** of monolithic components (`Home.tsx` ~500 lines, `BusinessPanel.jsx` ~616 lines)
2. **API Standardization** to support AI Voice Agent "Tools" (Menu, Stock, Order)

**Overall Health:** ✅ **GOOD** — Clean separation of concerns exists in state management (Zustand, Context), but components need decomposition to reduce complexity.

---

## 1. COMPONENT ANALYSIS

### 🎯 **Home.tsx** (~510 lines)
**Location:** `frontend/src/pages/Home.tsx`  
**Current Responsibilities:**
- Voice recognition orchestration
- AI Brain API communication (Brain V2)
- TTS playback management
- Presentation mode coordination (restaurants, menu, cart)
- UI mode switching (Bar vs Island)
- Geolocation
- Cart synchronization

#### **Recommended Extractions:**

| Component/Hook | Lines | Responsibility | Priority |
|----------------|-------|----------------|----------|
| `useVoiceOrchestrator` | ~150 | Voice recording, TTS playback, audio preloading | 🔴 HIGH |
| `useBrainAPI` | ~200 | API communication, response parsing, contract generation | 🔴 HIGH |
| `HomeHeader` | ~15 | Logo, cart button, menu button | 🟢 LOW |
| `ModeToggleSwitch` | ~5 | Bar/Island view mode toggle | 🟢 LOW |
| `IntentTiles` | ~15 | Food/Taxi/Hotel quick actions | 🟡 MEDIUM |
| `useGeolocation` | ~15 | Warsaw coords + Poland boundary check | 🟡 MEDIUM |

#### **Shared Logic → Custom Hooks:**

```typescript
// ✅ EXTRACT: useVoiceOrchestrator
export function useVoiceOrchestrator() {
  // playTTS, stopAllTTS, preloadedAudioRef, isPlayingAudio
  // Manages audio lifecycle, caching, and playback
}

// ✅ EXTRACT: useBrainAPI
export function useBrainAPI(sessionId, coords, onCartSync) {
  // sendToAmberBrain, parseResponse, buildLLMContract
  // Handles Brain V2 API, response adaptation, mode detection
}

// ✅ EXTRACT: useGeolocation
export function useGeolocation(options) {
  // coords, loading, error
  // Simple geolocation with Poland boundary check
}
```

#### **State Distribution:**
- ✅ **KEEP in Zustand (`ui.ts`):** `mode`, `presentationItems`, `highlightedCardId`
- ✅ **KEEP in CartContext:** `cart`, `syncCart`, `submitOrder`
- ✅ **MOVE to Local State (hooks):** `voiceQuery`, `amberResponse`, `isPlayingAudio`, `isProcessing`

---

### 🏢 **BusinessPanel** (3 Implementations Found!)
**Locations:**
1. `frontend/src/components/BusinessPanel.jsx` (~284 lines) — **Modal Version** with tabs
2. `frontend/src/pages/BusinessPanel.js` (~95 lines) — **Minimal Placeholder**
3. `frontend/src/pages/Panel/BusinessPanel.jsx` (~616 lines) — **⚠️ GOD COMPONENT**

#### **Analysis of `/pages/Panel/BusinessPanel.jsx`:**

**Current Responsibilities:**
- Restaurant management (CRUD)
- Menu item management
- Order display + status updates
- Real-time polling (5s interval)
- 4 Modal dialogs (Add Item, Create Restaurant, Delete Confirmation, Order Details)
- Statistics calculation

#### **Recommended Extractions:**

| Component/Hook | Lines | Responsibility | Priority |
|----------------|-------|----------------|----------|
| `RestaurantSelector` | ~50 | Restaurant dropdown + Add/Delete buttons | 🔴 HIGH |
| `MenuTable` | ~30 | Menu items table display | 🔴 HIGH |
| `OrdersList` | ~80 | Orders list with status controls | 🔴 HIGH |
| `StatsDashboard` | ~20 | Quick stats cards (restaurants, items, orders) | 🟡 MEDIUM |
| `useRestaurants` | ~60 | Restaurant CRUD operations | 🔴 HIGH |
| `useMenuItems` | ~40 | Menu items CRUD | 🔴 HIGH |
| `useOrders` *(exists!)* | — | Orders fetch + status update | ✅ REUSE |
| `AddItemModal` | ~25 | Dialog for adding menu items | 🟡 MEDIUM |
| `CreateRestaurantModal` | ~50 | Dialog for creating restaurants | 🟡 MEDIUM |
| `DeleteConfirmModal` | ~25 | Generic delete confirmation | 🟡 MEDIUM |
| `OrderDetailsModal` | ~90 | Order details view | 🟡 MEDIUM |

#### **Shared Logic → Custom Hooks:**

```typescript
// ✅ EXTRACT: useRestaurants
export function useRestaurants(userId) {
  // restaurants, loading, createRestaurant, deleteRestaurant
  // Handles Supabase queries for restaurants table
}

// ✅ EXTRACT: useMenuItems
export function useMenuItems(restaurantId) {
  // items, loading, addItem, updateItem, deleteItem
  // Handles menu_items table operations
}

// ✅ REUSE: useOrders (already exists in /hooks/useOrders.js)
// - Needs enhancement for real-time polling (already has it)
// - Current implementation uses backend API (/api/orders)
```

#### **State Distribution:**
- ✅ **Local State (hooks):** `restaurants`, `items`, `orders`, `loading*` flags
- ✅ **Modal State:** `addOpen`, `createOpen`, `deleteOpen`, `orderDetailsOpen`
- ✅ **Form State:** `newName`, `newPrice`, `restName`, `restCity`

---

### 📊 **Component Complexity Matrix**

| Component | Lines | State Variables | API Calls | Modals | Refactor Priority |
|-----------|-------|-----------------|-----------|--------|-------------------|
| Home.tsx | 510 | 15+ | 1 | 0 | 🔴 HIGH |
| BusinessPanel (Panel/) | 616 | 20+ | 3 | 4 | 🔴 CRITICAL |
| BusinessPanel (components/) | 284 | 2 | 0 | 0 | 🟢 STABLE |

---

## 2. API READINESS

### 🔍 **Current API Architecture**

#### **API Layer Status:**
- **❌ NO Centralized API Layer**  
  - `fetch()` calls are **scattered** across components
  - 52 occurrences of `fetch(` found in `frontend/src`
  - Helper exists: `lib/api.ts` but only used for TTS/orders

#### **Existing Patterns:**

1. **Direct Fetch in Components:**
   ```typescript
   // ❌ SCATTERED: Home.tsx, BusinessPanel.jsx, CartContext.jsx
   const response = await fetch(getApiUrl('/api/brain/v2'), {...})
   ```

2. **Helper Function (lib/api.ts):**
   ```typescript
   // ✅ PARTIALLY USED: Only for TTS, orders
   export default async function api(path, init) {...}
   ```

3. **Custom Hooks:**
   ```typescript
   // ✅ GOOD: useOrders.js
   // Uses direct fetch, but encapsulated
   const { orders, createOrder } = useOrders()
   ```

4. **URL Management:**
   ```typescript
   // ✅ GOOD: lib/config.ts
   export function getApiUrl(path: string): string
   // Handles localhost vs production vs Cloudflare tunnel
   ```

---

### 🛠️ **Required AI Agent Endpoints**

The AI Voice Agent requires **3 key tools** implemented as backend endpoints:

| Tool | Endpoint | Method | Current Status | Files to Touch |
|------|----------|--------|----------------|----------------|
| **Get Menu** | `/api/ai/tools/menu` | GET | ❌ Missing | Create: `backend/api/ai/tools/menu.js` |
| **Get Stock** | `/api/ai/tools/stock` | GET | ❌ Missing | Create: `backend/api/ai/tools/stock.js` |
| **Create Order** | `/api/ai/tools/order` | POST | ⚠️ Partial | Adapt: `backend/api/orders.js` (exists, needs AI wrapper) |

#### **1. GET /api/ai/tools/menu**
**Purpose:** AI retrieves restaurant menu for order assistance  
**Files to Create/Modify:**

```
✅ CREATE:
  - backend/api/ai/tools/menu.js (new endpoint)
  
✅ REUSE:
  - backend/api/brain/menuService.js (existing service)
  - backend/api/admin/menu.js (existing admin endpoint, reference)
  
✅ MODIFY:
  - frontend/src/lib/api.ts (add getMenuForAI helper)
```

**Implementation Location:**
```
backend/api/ai/tools/menu.js
├── Uses: brain/menuService.js (already exists)
├── Returns: { items: [...], restaurant_id, restaurant_name }
└── Auth: Optional (AI agent context)
```

#### **2. GET /api/ai/tools/stock**
**Purpose:** AI checks item availability before confirming orders  
**Files to Create/Modify:**

```
✅ CREATE:
  - backend/api/ai/tools/stock.js (new endpoint)
  - backend/api/brain/stockService.js (new service)
  
⚠️ DATABASE SCHEMA:
  - Need to add 'available' or 'stock' column to menu_items_v2
  - Current: menu_items_v2.available (boolean) exists!
  
✅ MODIFY:
  - frontend/src/lib/api.ts (add getStockForAI helper)
```

**Implementation Location:**
```
backend/api/ai/tools/stock.js
├── NEW: brain/stockService.js
├── Query: menu_items_v2.available
└── Returns: { available: boolean, item_id, quantity? }
```

#### **3. POST /api/ai/tools/order**
**Purpose:** AI creates orders on behalf of users  
**Files to Modify:**

```
✅ REUSE (with wrapper):
  - backend/api/orders.js (exists, 491 lines)
  - backend/api/brain/orderService.js (exists, used by Brain V2)
  - backend/api/brain/domains/food/confirmHandler.js (Voice flow)
  
✅ CREATE WRAPPER:
  - backend/api/ai/tools/order.js (thin wrapper, delegates to orderService)
  
✅ MODIFY:
  - frontend/src/lib/api.ts (add createOrderForAI helper)
```

**Implementation Location:**
```
backend/api/ai/tools/order.js
├── Delegates to: brain/orderService.js
├── Uses: brain/domains/food/confirmHandler.js (Voice V2)
└── Returns: { order_id, status, total_cents }
```

---

### 📦 **Recommended Centralized API Layer**

**Create:** `frontend/src/lib/aiTools.ts`

```typescript
// frontend/src/lib/aiTools.ts
import { getApiUrl } from './config'

/**
 * AI Voice Agent Tool APIs
 * Centralized layer for AI-specific endpoints
 */

export interface MenuItem {
  id: string
  name: string
  price_pln: number
  available: boolean
  category?: string
}

export interface StockStatus {
  item_id: string
  available: boolean
  quantity?: number
}

export interface OrderRequest {
  restaurant_id: string
  items: { menu_item_id: string; quantity: number }[]
  customer_name?: string
  notes?: string
}

// 🔧 GET Menu
export async function getMenuForAI(restaurantId: string): Promise<MenuItem[]> {
  const url = getApiUrl(`/api/ai/tools/menu?restaurant_id=${restaurantId}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Menu fetch failed: ${res.status}`)
  const data = await res.json()
  return data.items || []
}

// 🔧 GET Stock
export async function getStockForAI(itemId: string): Promise<StockStatus> {
  const url = getApiUrl(`/api/ai/tools/stock?item_id=${itemId}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Stock check failed: ${res.status}`)
  return res.json()
}

// 🔧 POST Order
export async function createOrderForAI(order: OrderRequest): Promise<any> {
  const url = getApiUrl('/api/ai/tools/order')
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(order)
  })
  if (!res.ok) throw new Error(`Order creation failed: ${res.status}`)
  return res.json()
}
```

---

### 📋 **Files to Touch Summary**

#### **Backend (Create):**
```
backend/api/ai/tools/
├── menu.js        (NEW - 50 lines)
├── stock.js       (NEW - 40 lines)
└── order.js       (NEW - 30 lines)

backend/api/brain/
└── stockService.js  (NEW - 80 lines)
```

#### **Backend (Modify):**
```
backend/api/orders.js          (ADAPT - add AI context support)
backend/api/brain/menuService.js   (VERIFY - already used)
backend/api/brain/orderService.js  (VERIFY - already used)
```

#### **Frontend (Create):**
```
frontend/src/lib/aiTools.ts    (NEW - 100 lines)
```

#### **Frontend (Modify):**
```
frontend/src/lib/api.ts        (ADD - AI tool helpers)
```

---

## 3. RISK ASSESSMENT

### 🔴 **HIGH RISK: Breaking Points**

#### **1. State Synchronization Between Voice & UI**
**Location:** `Home.tsx` L282-284  
**Risk:** Cart sync from Brain V2 → Frontend  
**Why Fragile:**
```typescript
// Cart state is updated from AI response
if (data.meta?.cart) {
  syncCart(data.meta.cart.items, ...)  // ⚠️ Tightly coupled
}
```
**Mitigation:**
- Create `useCartSync` hook to isolate this logic
- Add validation layer before syncing
- Implement rollback mechanism for failed syncs

---

#### **2. Brain V2 Contract Parsing**
**Location:** `Home.tsx` L269-380  
**Risk:** Response parsing + mode detection  
**Why Fragile:**
```typescript
// Complex conditional logic based on backend response
const isMenuIntent = data.intent === 'menu_request' || ...
const isConfirmIntent = data.intent === 'confirm_order' || ...
```
**Mitigation:**
- Extract to `parseBrainResponse()` utility
- Add comprehensive unit tests for all intent types
- Create TypeScript interfaces for all response shapes

---

#### **3. Real-time Order Polling**
**Location:** `BusinessPanel.jsx` L139-145  
**Risk:** Polling interval + race conditions  
**Why Fragile:**
```typescript
// 5-second polling can cause stale state
const interval = setInterval(load, 5000)
```
**Mitigation:**
- Replace with Supabase Realtime subscriptions
- Add optimistic updates for status changes
- Implement debouncing for rapid updates

---

### 🟡 **MEDIUM RISK: Architectural Concerns**

#### **4. Multiple `BusinessPanel` Implementations**
**Locations:**
- `components/BusinessPanel.jsx` (modal version)
- `pages/BusinessPanel.js` (placeholder)
- `pages/Panel/BusinessPanel.jsx` (full version)

**Risk:** Unclear which is canonical, potential duplication  
**Mitigation:**
- **DECIDE:** Which version is production?
- **DELETE:** Other implementations
- **RENAME:** Canonical version to clear name

---

#### **5. Direct Supabase Calls in Components**
**Locations:** Throughout `BusinessPanel.jsx`, `CartContext.jsx`  
**Risk:** No abstraction layer, hard to test  
**Mitigation:**
- Move all Supabase queries to service layer (`lib/services/`)
- Create `restaurantService.ts`, `menuService.ts`
- Mock services for testing

---

### 🟢 **LOW RISK: Well-Isolated Areas**

✅ **State Management (Zustand + Context):**
- Clean separation of concerns
- Well-typed interfaces
- Easy to test

✅ **CSS Token System:**
- Consolidated in `index.css`
- No inline styles in critical components
- Design system ready for component library

✅ **Voice Recognition:**
- Isolated in `useSpeechRecognition` hook
- Clear API boundaries
- No cross-component dependencies

---

### 🧪 **Smoke Test Recommendations**

Priority tests to prevent regressions during refactoring:

```typescript
// HIGH PRIORITY
1. Voice → Cart Sync Flow
   - Send voice order → Verify cart items match backend response

2. Business Panel Order Status Update
   - Update order status → Verify polling picks up change

3. Brain V2 Mode Switching
   - Send different intents → Verify correct UI mode activated

// MEDIUM PRIORITY
4. Restaurant Selector
   - Create/Delete restaurant → Verify dropdown updates

5. Menu Item CRUD
   - Add item → Verify appears in table

6. Geolocation Fallback
   - Mock geo failure → Verify Warsaw coords used
```

---

## 📐 **Proposed File Structure (After Refactoring)**

```
frontend/src/
├── components/
│   ├── business/
│   │   ├── RestaurantSelector.tsx
│   │   ├── MenuTable.tsx
│   │   ├── OrdersList.tsx
│   │   ├── StatsDashboard.tsx
│   │   └── modals/
│   │       ├── AddItemModal.tsx
│   │       ├── CreateRestaurantModal.tsx
│   │       └── OrderDetailsModal.tsx
│   ├── voice/
│   │   ├── VoiceOrchestrator.tsx
│   │   └── IntentTiles.tsx
│   └── [existing components...]
│
├── hooks/
│   ├── useVoiceOrchestrator.ts      (NEW)
│   ├── useBrainAPI.ts                (NEW)
│   ├── useRestaurants.ts             (NEW)
│   ├── useMenuItems.ts               (NEW)
│   ├── useGeolocation.ts             (NEW)
│   ├── useOrders.js                  (EXISTS - enhance)
│   └── [existing hooks...]
│
├── lib/
│   ├── api.ts                        (EXISTS - enhance)
│   ├── aiTools.ts                    (NEW)
│   ├── services/
│   │   ├── restaurantService.ts     (NEW)
│   │   ├── menuService.ts           (NEW)
│   │   └── orderService.ts          (NEW)
│   └── [existing lib files...]
│
└── pages/
    ├── Home.tsx                      (REFACTOR - 200 lines target)
    └── Panel/
        └── BusinessPanel.tsx         (REFACTOR - 300 lines target)
```

---

## 🚀 **Recommended Refactoring Order**

### **Phase 1: Extract Shared Logic (Week 1)**
1. ✅ Create `useVoiceOrchestrator` hook
2. ✅ Create `useBrainAPI` hook
3. ✅ Create `useRestaurants` hook
4. ✅ Create `useMenuItems` hook
5. ✅ Enhance `useOrders` with Realtime

### **Phase 2: AI Tool Endpoints (Week 1-2)**
1. ✅ Create `backend/api/ai/tools/menu.js`
2. ✅ Create `backend/api/ai/tools/stock.js`
3. ✅ Create `backend/api/ai/tools/order.js`
4. ✅ Create `frontend/src/lib/aiTools.ts`

### **Phase 3: Component Decomposition (Week 2)**
1. ✅ Extract `BusinessPanel` subcomponents
2. ✅ Extract `Home.tsx` subcomponents
3. ✅ Create service layer for Supabase

### **Phase 4: Testing & Validation (Week 3)**
1. ✅ Write smoke tests
2. ✅ Manual QA on staging
3. ✅ Performance audit
4. ✅ Deploy

---

## 🎯 **Success Criteria**

### **Metrics:**
- Home.tsx: **510 → ~200 lines** (-60%)
- BusinessPanel.jsx: **616 → ~300 lines** (-50%)
- API calls centralized: **52 scattered → 1 layer** (100%)
- Test coverage: **0% → 60%+** (critical paths)

### **Deliverables:**
- ✅ 3 AI Tool Endpoints operational
- ✅ 5+ Custom hooks extracted
- ✅ BusinessPanel split into 7+ subcomponents
- ✅ Centralized API layer (`aiTools.ts`)
- ✅ Smoke test suite (6+ scenarios)

---

## 📝 **Next Steps**

1. **Review this report** with the team
2. **Choose Phase 1 or Phase 2** to start (can parallel)
3. **Create feature branch:** `refactor/god-components`
4. **Set up code freeze** for stabilization period
5. **Deploy incrementally** (feature flags recommended)

---

**Report Prepared By:** Antigravity AI Assistant  
**Last Updated:** 2026-01-13
