# Dialog Surface & Soft Bridge Implementation

## Status
- **Repository**: Up to date (synced with origin/main)
- **Tests**: All passed (15 Surface tests, 30 ICM tests)
- **Server**: Running on port 3000

## Features Implemented

### 1. Soft Dialog Bridge (Pipeline)
Instead of resetting context when `menu_request` or `create_order` is blocked by ICM:
- **Before**: Block -> Fallback to `find_nearby` -> Context Reset
- **After**: Block -> Check for restaurants -> **Show Dialog** ("Chcesz menu której restauracji?")
- Sets `session.dialog_focus` for context tracking.

### 2. Surface Renderer (New Module)
Located at `api/brain/dialog/SurfaceRenderer.js`.
Deterministic Polish templates for:
- `ASK_RESTAURANT_FOR_MENU`: "Chcesz menu której restauracji? 1. A, 2. B..."
- `ASK_RESTAURANT_FOR_ORDER`: "Chcesz zamówić... z której restauracji?"
- `CONFIRM_SELECTED_RESTAURANT`: "Czy chodzi o X?"
- `ITEM_NOT_FOUND`, `CLARIFY_ITEMS`, etc.

### 3. Weak Intent Fix (NLU Router)
Fixed `choose_restaurant` detection logic.
- Previously: Ignored ambiguous orders like "pizzę" (treated as weak).
- Now: Correctly recognizes ambiguous results with multiple options as valid intents.

## Verification
- **"mam ochotę na pizzę"**: Correctly triggers restaurant picker dialog instead of generic search reset.
- **"pokaż menu"** (without context): Triggers restaurant picker if list exists.
