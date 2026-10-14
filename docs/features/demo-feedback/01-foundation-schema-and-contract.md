# Story: Foundation: schema, contract, watermark flag

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** NFR-008 (watermark to the participant client), groundwork for DF-6, DF-7, DF-10, DF-12  ·  **Decisions:** DF-3, DF-6, DF-7, DF-10, DF-12  ·  **Issue:** _TBD_
**Stack:** backend  ·  **Review:** **Tier-2** (schema)  ·  **Priority:** Must  ·  **Wave:** 0  ·  **Effort:** S

## Context

Stories 03, 04 and 05 each need a column or a table, and parallel builders must never fight over the EF model
snapshot. This story lands **the one migration** for the whole feature, plus the two small contract pieces other
stories read: the `noise` post origin and the `watermark` flag on the participant chrome config. Nothing here adds
an endpoint or behaviour beyond that. The frozen shapes are in [`implementation.md`](implementation.md#frozen-wire-contract).

## Acceptance Criteria

- [ ] **Given** the schema table in `implementation.md`, **then** one migration named `DemoFeedbackPinsNoiseImport`
      adds exactly: `Post.PinnedForAllAt` + `Post.PinnedForAllByHumanId` and the filtered index;
      `InjectItem.ExternalRef` and its filtered unique index; `Exercise.NoiseLevel` (required, default `'off'`);
      and the new `NoisePost` table with its index. Existing rows get `NoiseLevel = 'off'`.
- [ ] `NoisePost` implements `IExerciseScoped`, is registered in `PulseDbContext` with the **central exercise filter**,
      and has the lengths in the contract (`Text` 280, `PinnedForAllByHumanId` 128, `ExternalRef` 64, `NoiseLevel` 8).
- [ ] `ReactionKinds.Pin = "pin"` exists beside `Like` and `Repost`. **No behaviour change**: `ReactionService.TryParseKind`
      still rejects `pin` until story 04 (this story only adds the constant).
- [ ] `PostIngestService.AllowedOrigins` accepts `noise`. HTTP callers still cannot reach it (`PostAttributionResolver`
      is unchanged), proven by a test that a participant or controller `POST /api/posts` can never produce `Origin = "noise"`.
- [ ] **Given** `GET /api/chrome-config`, **then** the response carries `watermark: boolean` equal to the exercise's
      `WatermarkEnabled`. `enabled`, `top` and `bottom` are unchanged, including `ResolveEffectiveChromeEnabled`.
- [ ] The migration replays in `IdempotentMigrationScriptTests`. Any hand-written SQL that names a column added in this
      migration is `EXEC(N'…')`-wrapped (#413).

### Cross-cutting
- [ ] **Isolation (XC-001):** an isolation test proves a `NoisePost` from exercise A is invisible from exercise B
      through the central filter (extend the standing isolation suite).
- [ ] **Two worlds (XC-002):** `watermark` is the only new field on a participant-facing projection.

## Out of Scope

Every endpoint and behaviour that uses these columns (02–05). The participant client's use of `watermark` (06).

## Tests

Migration replay (`IdempotentMigrationScriptTests`), model snapshot shape, the isolation case, the `noise` origin guard,
and a `GET /api/chrome-config` projection test with `WatermarkEnabled` on and off.
