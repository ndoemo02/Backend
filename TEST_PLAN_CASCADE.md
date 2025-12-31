# Test Plan: FreeFlow Cascading Logic

This document outlines the testing strategy for the "FreeFlow" voice-commerce application, specifically focusing on the cascading flow from **Voice Input** to **Visual Action**.

## 🌊 Philosophy: The Cascade

A "Cascading Test" verifies that a single user intent triggers a synchronized chain of events across the system. It is not just about the API returning 200 OK, but about the *contract* being fulfilled for the UI to animate correctly.

**Flow:** `Voice -> NLU (Brain V2) -> Logic (OrderHandler) -> UI Contract (JSON) -> RenderEngine (Frontend) -> Visual Action (Island/Cart)`

---

## 🧪 Automated Tests (Backend/Integration)

These tests are run via `npm test` in the backend directory. They verify the NLU and Logic layers, ensuring the **UI Contract** is generated correctly.

### Tier 1-14: Core Intelligence
*Existing tests in `brain-cascade.test.js` covering Health, Intent Detection, GeoContext, Memory, Fuzzy Matching, etc.*

### Tier 15: UI Contract & Actions (NEW)
**Goal:** Verify that specific intents trigger the correct JSON contracts for the Frontend RenderEngine.

1.  **Contextual Island Contract**:
    *   **Input**: "Pokaż menu Monte Carlo"
    *   **Expectation**: Response must contain `actions` or `ui_mode: 'menu_presentation'`, and `presentationItems` must use the unified schema (id, name, price, description).
    
2.  **Cart Trigger Action**:
    *   **Input**: "Zamów pizzę Margherita"
    *   **Expectation**: Response must include `actions: [{ type: 'SHOW_CART', ... }]`. This is critical for the "Delayed Cart Opening" feature.
    
3.  **Sync Metadata**:
    *   **Input**: (Any order command)
    *   **Expectation**: Response must include `meta.cart` with accurate totals to ensure the UI badge updates immediately.

### Tier 16: Context Persistence
**Goal**: Ensure the "Island" remains valid across adjacent requests.

1.  **Island Stability**:
    *   **Input**: "Pokaż menu" -> "Opowiedz o pierwszym daniu"
    *   **Expectation**: The system should maintain `lastRestaurant` context so the Island doesn't disappear or switch content unexpectedly.

---

## 📱 Manual / Frontend E2E Tests (Visual & Gestures)

These tests require running the Frontend (`npm run dev`) and interacting with the device/simulator.

### Tier 17: Visual Feedback & Gestures (ContextualIsland)
**Component**: `ContextualIsland.tsx` / `IslandWrapper.tsx`

1.  **Swipe Up (Expand)**:
    *   *Action*: Drag the minimized Island (bottom left/right) upwards.
    *   *Result*: Island expands to show the full list of items.
    
2.  **Swipe Down (Collapse)**:
    *   *Action*: Drag the expanded Island downwards.
    *   *Result*: Island collapses back to the single active item.
    
3.  **Swipe Horizontal (Navigation)**:
    *   *Action*: Swipe Left/Right on the collapsed Island.
    *   *Result*: The active item changes (Name/Price updates). The "dots" indicator updates.

4.  **Selection**:
    *   *Action*: Tap the "Wybierz" or "Dodaj" button.
    *   *Result*: Item is selected/ordered.

### Tier 18: Action Synchronization (The "Wait" Check)
**Feature**: Delayed Cart Opening (`HOME.tsx`)

1.  **Test Step**: Say "Zamów pizzę" (or click a tile).
2.  **Observation**:
    *   **Step A**: AI starts speaking ("Dodałam pizzę do koszyka...").
    *   **Step B**: Visual Cart (`Drawer`) **remains closed** while AI is speaking.
    *   **Step C**: AI finishes speaking.
    *   **Step D**: Visual Cart **automatically opens** immediately after audio ends.
    
    *Failure Condition*: Cart opens *before* or *during* the speech.

### Tier 19: Focus Management
**Component**: `Cart.jsx`

1.  **Test Step**: Trigger the Cart to open.
2.  **Observation**:
    *   The keyboard should **NOT** open automatically on mobile.
    *   Focus should **NOT** jump to the "Name" or "Address" input immediately.
    *   User should see the animation of the item flying into the list (if implemented) or just the list appearing.

---

## 🚀 Execution Guide

1.  **Run Automated Tiers**:
    ```bash
    cd backend
    npm test tests/brain-cascade.test.js
    ```

2.  **Run Frontend for Manual Tiers**:
    ```bash
    cd frontend
    npm run dev
    ```
    *   Open `http://localhost:5173` (or network IP on mobile).
    *   Toggle "Immersive Mode" or "Bar Mode" to test different layouts.
