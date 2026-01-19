# DISAMBIGUATION CONTRACT (SPEC)
## Context
This contract defines the strict structure that the Order Processing Backend expects from the NLU/Disambiguation Layer.
It completely eliminates runtime decisions by the LLM regarding availability, pricing, or logic. The LLM's only job is to map user intent to this structure using the known IDs.

## Structure
The payload is a JSON object describing a single Line Item in an order (or a list of them).

```json
{
  "item_id": "UUID",            // The base menu_item_id (from menu_items_v2)
  "quantity": "INTEGER",        // Default 1
  "modifications": [            // List of changes to the standard composition
    {
      "type": "ENUM",           // "INGREDIENT_ACTION" | "EXPLICIT_MODIFIER"
      
      // --- Case A: Ingredient Action (Bez X, Extra X, Podwójny X) ---
      "ingredient_id": "UUID?", // Required if type == INGREDIENT_ACTION
      "action": "ENUM?",        // "REMOVE" | "ADD" | "EXTRA"
      "qty_delta": "INTEGER?",  // Optional multiplier (e.g. 2 for double meat). 
                                // REMOVE implies quantity=0 (relative to default). 
                                // ADD/EXTRA implies +1, +2 etc.
      
      // --- Case B: Explicit Modifier (Size, Dough, Option) ---
      "modifier_id": "UUID?",   // Required if type == EXPLICIT_MODIFIER
    }
  ]
}
```

## Detailed Rules

### 1. Ingredient Actions (`type: "INGREDIENT_ACTION"`)
Used for manipulating the atomic composition of the dish (defined in `menu_item_ingredients`).

| Action | Description | Backend Logic |
| :--- | :--- | :--- |
| **REMOVE** | User wants to remove a default ingredient. | Sets ingredient quantity to 0. Validates `default_included=TRUE` and `is_optional=TRUE`. |
| **ADD** | User wants an optional ingredient not in default. | Sets key quantity=1. Validates `default_included=FALSE` and `is_optional=TRUE`. Applies `price_pln`. |
| **EXTRA** | User wants MORE of an existing ingredient. | Increments quantity. Logic: Base + 1. Validates `max_extra`. Applies `price_pln`. |

**Payload Example ("Bez Cebuli", "Podwójny Ser"):**
```json
{
  "item_id": "...", 
  "modifications": [
    {
      "type": "INGREDIENT_ACTION",
      "ingredient_id": "uuid-cebula",
      "action": "REMOVE"
    },
    {
      "type": "INGREDIENT_ACTION",
      "ingredient_id": "uuid-ser",
      "action": "EXTRA" 
    }
  ]
}
```

### 2. Explicit Modifiers (`type: "EXPLICIT_MODIFIER"`)
Used for selecting variants, sizes, or preparations defined in `modifiers` table and linked via `menu_item_modifiers`.

**Payload Example ("Duża Pizza", "Ciasto Grube"):**
```json
{
  "item_id": "...", 
  "modifications": [
    {
      "type": "EXPLICIT_MODIFIER",
      "modifier_id": "uuid-size-large" 
    },
    {
      "type": "EXPLICIT_MODIFIER",
      "modifier_id": "uuid-dough-thick"
    }
  ]
}
```

## Validation Error Codes
The backend will respond with 400 Bad Request if validation fails:

- `ERR_ITEM_NOT_FOUND`: Invalid `item_id`.
- `ERR_INGREDIENT_NOT_ALLOWED`: Ingredient not linked to this item.
- `ERR_MODIFIER_NOT_ALLOWED`: Modifier not linked to this item.
- `ERR_QUANTITY_LIMIT`: `max_extra` exceeded.
- `ERR_MANDATORY_REMOVAL`: Tried to remove a required ingredient (`is_optional=FALSE`).
- `ERR_CONFLICT`: Mutually exclusive modifiers selected (e.g. 2 sizes).

---
## Full Example JSON
**User Request:** "Poproszę dużą Margheritę na grubym cieście, bez sosu, ale z podwójną szynką."

```json
{
  "order_items": [
    {
      "item_id": "uuid-margherita",
      "quantity": 1,
      "modifications": [
        {
          "type": "EXPLICIT_MODIFIER",
          "modifier_id": "uuid-size-large"
        },
        {
          "type": "EXPLICIT_MODIFIER",
          "modifier_id": "uuid-dough-thick"
        },
        {
          "type": "INGREDIENT_ACTION",
          "ingredient_id": "uuid-sauce",
          "action": "REMOVE"
        },
        {
          "type": "INGREDIENT_ACTION",
          "ingredient_id": "uuid-ham",
          "action": "ADD" 
        },
        {
          "type": "INGREDIENT_ACTION",
          "ingredient_id": "uuid-ham",
          "action": "EXTRA" 
          // Alternatively, just one entry with "EXTRA" or explicit qty=2 if protocol allows
        }
      ]
    }
  ]
}
```
*Note: For "Podwójna szynka" where ham is not default, it is conceptually ADD + EXTRA. The Protocol allows handling this as simply a target quantity or multiple increments.*
