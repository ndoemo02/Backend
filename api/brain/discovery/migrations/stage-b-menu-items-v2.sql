-- ============================================================
-- MIGRATION: stage-b-menu-items-v2.sql
-- Table:     menu_items_v2  (EXISTING PRODUCTION TABLE — canonical item table, 269 rows)
-- Type:      ADDITIVE ONLY — no drops, no renames, no alters of existing columns
-- Status:    DRAFT — NOT EXECUTED
-- Date:      2026-04-09
-- Project:   FreeFlow (ezemaacyyvbpjlagchds)
--
-- PRE-FLIGHT: columns already confirmed PRESENT in production (DO NOT ADD):
--   base_name     TEXT nullable   ← already exists, already in findHandler.js SELECT
--   variant_name  TEXT nullable   ← already exists
--   variant_type  TEXT nullable   ← already exists
--   size_or_variant TEXT nullable ← already exists (= item_variant concept)
--   spicy         BOOLEAN         ← already exists (maps to item_tags 'spicy')
--   is_vege       BOOLEAN         ← already exists (maps to item_tags 'vege')
--
-- Backfill order after applying:
--   1. backfill-menu-item-families.ts — fills item_family at score >= 100 (semi-auto)
--   2. Manual review of item_family for rows with score < 100
--   3. Manual entry of item_aliases per family group
--   4. item_tags: can be auto-populated from existing spicy/is_vege columns
--   5. dietary_flags: MANUAL ONLY — requires per-dish operator data
--   6. GIN indexes — only after item_family and item_aliases are populated
--   7. popularity_score — filled from analytics pipeline (separate process)
-- ============================================================

BEGIN;

-- ── 1. base_name — SKIPPED ───────────────────────────────────
-- Already exists as TEXT nullable in production.
-- Already in findHandler.js SELECT. No migration needed.

-- ── 2. item_family ───────────────────────────────────────────
-- Maps item to a family from ITEM_FAMILY_DICTIONARY in findHandler.js.
-- Valid values (keys of ITEM_FAMILY_DICTIONARY):
--   'rollo' | 'calzone' | 'schabowy' | 'nalesnik' | 'pierogi' | 'zurek'
-- NULL = item does not belong to a known family (expected for most rows).
-- Nullable: YES — most menu items will remain NULL legitimately.
-- Backfill: semi-auto via backfill-menu-item-families.ts (score >= 100 only).
-- Purpose: enables SQL filter `WHERE item_family = 'kebab'`
--          instead of JS scan of 5000 rows per city query.
ALTER TABLE menu_items_v2
  ADD COLUMN IF NOT EXISTS item_family TEXT DEFAULT NULL;

-- ── 3. item_variant — SKIPPED ────────────────────────────────
-- size_or_variant (TEXT nullable) already exists in production.
-- This column covers the item_variant concept (durum/box/mini etc.).
-- No new column needed. Code reads size_or_variant directly.

-- ── 4. item_aliases ──────────────────────────────────────────
-- Pre-computed alias list for this item (replaces per-request buildItemAliases()).
-- Examples: ['kebab', 'döner', 'doner', 'rollo kebab', 'kebab rollo']
-- Empty array = no pre-computed aliases → runtime buildItemAliases() is used as fallback.
-- Nullable: NO — empty array is the safe default (no aliases known).
-- Backfill: MANUAL — populated per item_family group after item_family is filled.
-- Purpose: reduces alias computation from O(n items × aliases) per request
--          to O(1) per item when aliases are pre-stored.
ALTER TABLE menu_items_v2
  ADD COLUMN IF NOT EXISTS item_aliases TEXT[] DEFAULT '{}';

-- ── 5. item_tags ─────────────────────────────────────────────
-- Taste/characteristic tags at the dish level.
-- Values: subset of CoreTag — 'spicy' | 'vege'
--   (NOT 'delivery', 'quick', 'open_now' — those are restaurant-level)
-- Nullable: NO — empty array = no tags known for this dish.
-- Backfill: MANUAL — requires inspection of dish description / ingredients.
ALTER TABLE menu_items_v2
  ADD COLUMN IF NOT EXISTS item_tags TEXT[] DEFAULT '{}';

-- ── 6. dietary_flags ─────────────────────────────────────────
-- Dietary compliance flags — more granular than CoreTag 'vege'.
-- Values: 'gluten_free' | 'lactose_free' | 'vegan' | 'halal' | 'kosher'
-- Nullable: NO — empty array = no dietary compliance data.
-- Backfill: MANUAL — requires per-dish data from operators.
ALTER TABLE menu_items_v2
  ADD COLUMN IF NOT EXISTS dietary_flags TEXT[] DEFAULT '{}';

-- ── 7. popularity_score ──────────────────────────────────────
-- Ranking signal for tie-breaking when query confidence = 'empty'
-- or when item has no family match.
-- Range: 0–100. 0 = unknown. Higher = more popular.
-- Nullable: NO — 0 is safe default (no ranking advantage, not excluded).
-- Backfill: sourced from analytics pipeline — separate process, not this migration.
ALTER TABLE menu_items_v2
  ADD COLUMN IF NOT EXISTS popularity_score SMALLINT DEFAULT 0;

ALTER TABLE menu_items_v2
  ADD CONSTRAINT IF NOT EXISTS chk_menu_items_popularity_score
    CHECK (popularity_score BETWEEN 0 AND 100);

COMMIT;

-- ============================================================
-- POST-BACKFILL: Indexes (run separately after item_family and item_aliases populated)
-- Do NOT run at migration time — most rows will have NULL / empty arrays.
-- ============================================================

-- Selective index — item_family is NULL for most rows:
-- CREATE INDEX IF NOT EXISTS idx_menu_item_family
--   ON menu_items_v2 (item_family)
--   WHERE item_family IS NOT NULL;

-- GIN for future item_aliases containment queries:
-- CREATE INDEX IF NOT EXISTS idx_menu_item_aliases
--   ON menu_items_v2 USING GIN (item_aliases)
--   WHERE array_length(item_aliases, 1) > 0;

-- GIN for item_tags filtering (spicy, vege at dish level):
-- CREATE INDEX IF NOT EXISTS idx_menu_item_tags
--   ON menu_items_v2 USING GIN (item_tags)
--   WHERE array_length(item_tags, 1) > 0;
