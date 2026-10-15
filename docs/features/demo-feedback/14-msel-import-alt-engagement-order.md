# Story: MSEL import — alt text and engagement columns; imported items slot in by planned minute

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** NFR-001 (alt text on participant media)  ·  **Decisions:** DF-16, DF-17, DF-18  ·  **Issue:** #518
**Stack:** backend  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 3  ·  **Effort:** S

## Context

The on-stage import (DF-16) brings eight Kestrel single posts in from `docs/demo/pack/kestrel-msel.xlsx`. Building
that file (C2) showed three gaps in story 03's importer, against the same posts when they are seeded:

1. **Alt text.** An imported photo or video gets its file name as alt text (`AltFor(name)` in `MselImportPlanner`),
   e.g. `pio-statement-card`, and that card has text in the image. Participant surfaces must meet WCAG 2.1 AA (NFR-001).
   The media library does not store alt text (it lives on each post's media item), so the file has to carry it.
2. **Engagement.** An MSEL row cannot carry the pack's engagement baseline, so imported posts start at zero likes. The
   Scoop's viral video (962 likes) is the beat where "the rumour outpaces the official word".
3. **Order.** New items are appended after every existing item (`Order = max + 1`), so the eight imported items sit
   below the seven seeded ones and "Fire next" (first pending item in order) fires them out of time.

Tom chose (10/15) to fix all three in the importer before the Sunday freeze (DF-1) rather than work around them on stage.

## Acceptance Criteria

### Columns (Pulse extensions, optional; headers matched like the others: case-insensitive, trimmed)

- [x] **`Pulse Media Alt`**: the alt text for each `Pulse Media` file, **separated by `|`**, in the same order. A
      blank cell, or a blank entry in the list, falls back to today's file-name stem for that file. More entries than
      files ⇒ the row **fails** ("Pulse Media Alt has N entries for M Pulse Media files"); fewer ⇒ the missing ones
      fall back to the stem with a **warning**. Each entry is trimmed and must fit `InjectItemValidator.MaxAltLength`
      (1,000) after the same sanitising the write path applies (longer ⇒ truncated with a warning, like `Title`).
      Alt text with no `Pulse Media` ⇒ warning, ignored.
- [x] **`Pulse Likes`**, **`Pulse Reposts`**, **`Pulse Replies`**: the post's `engagementBaseline` (`like`, `repost`,
      `reply`). Each optional; blank ⇒ not set (0). A value must be a whole number 0…`InjectItemValidator.MaxBaseline`
      (1,000,000); a numeric cell is accepted as-is if it is integral (Excel stores `962` as `962.0`), text is parsed
      with invariant culture, and anything else (negative, fractional, too large, not a number) ⇒ the row **fails**
      with a message naming the column.
- [x] Both flow through the existing write path (`ImportRequests` → `InjectItemValidator.Parse`), so a seeded item
      and an imported item with the same values are indistinguishable.
- [x] **Re-import (DF-10):** a changed alt text or baseline on an unfired item is an update (`status: 'updated'`); the
      same values ⇒ `unchanged`; fired items are left alone as today. `ImportRequests`' change comparison covers both.
- [x] `?dryRun=true` reports the new failures and warnings and writes nothing.

### Order (DF-18)

- [x] An item the import **creates** is placed by `PlannedMinute` among the existing **pending** items: immediately
      before the first pending item (in current `Order`) whose `PlannedMinute` is greater than its own. Ties go after
      the existing items with the same minute; several new items with the same minute keep their file row order. A new
      item with no `PlannedMinute`, or with no later pending item, goes at the end. Non-pending items (fired, failed,
      skipped, held…) keep their places and are never moved; existing pending items keep their relative order.
- [x] Items the import **updates** keep their place (no reordering of existing rows beyond the shift needed to
      insert).
- [x] The new order is written in the same transaction as the created items, through the same mechanics as
      `ReorderAsync` (one queue-version bump, the run-sheet change broadcast staff consoles already receive), so an open
      console shows the new order without a reload. Item versions follow whatever `ReorderAsync` does today.
- [x] A dry run computes nothing about order and writes nothing.

### Cross-cutting

- [x] **Exercise isolation:** order is computed over this exercise's live items only (the central filter plus the
      explicit `ExerciseId` predicate the import already uses on its reads).
- [x] **Telemetry (XC-004):** `injects.imported` is unchanged (counts only).
- [x] No migration (DF contract: one migration for the feature, already shipped). No change to `Program.cs`.

## Out of Scope

Reordering on a plain create from the console (still appended). A media-library alt-text field. Engagement for
burst rows (the importer only makes single-post items, DF-9).

## Tests

Planner unit tests for each column rule above (blank, fallback, too many / too few, truncation, numeric cell vs text,
every invalid number); service tests for create / update / unchanged with the new fields; order tests: interleaving
among pending items, ties, null minutes, fired items fixed in place, several new items with one minute, re-import
leaves positions alone, isolation (another exercise's items never move); one end-to-end HTTP test that imports a
small `.xlsx` with all four columns and reads the items back through `GET /api/injects` in time order.
