# Story: Deep-linked planner settings sections + AccountImport's home

**Feature:** Staff navigation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress — built
**Requirements:** COR-072  ·  **Design decisions:** none  ·  **Issue:** —

## Context
`ExerciseSettingsPage` (`src/frontend/src/features/planner/pages/ExerciseSettingsPage.tsx`) is a
left-nav + content-pane composition over five sections (Identity & schedule, Channels, Theming &
outlets, Compliance chrome, Practice/sandbox). Which section is showing lived in a plain
`useState<ExerciseConfigSectionId>(DEFAULT_SECTION)` (`DEFAULT_SECTION = 'identity'`) — there was no
URL participation at all. A planner deep in the Theming section who reloaded the tab, or who was
sent a link by a colleague ("go check the compliance chrome settings"), always landed back on
Identity & schedule. This story makes the section the URL's business, the same way story 01 makes
the *surface* the URL's business.

This is also the closing move for a named open question. `exercise-configuration/feature.md`'s open
question **(b)** records that `AccountImport` (`features/planner/components/AccountImport.tsx`,
built and tested for planners under COR-011, exported from `features/planner/index.ts`) was
**mounted nowhere** — verified by grep, the only hits outside the planner folder were two comments.
The question that feature explicitly declined to answer ("where does account import live — a third
panel on the settings page, a sibling planner route, or a tab?") is this story's to answer: **a
sixth section** on `ExerciseSettingsPage`, exactly like Compliance chrome and Practice/sandbox
(self-contained panel, own hook/service/query, no props) — not a sibling route, because "provision
participants" is squarely inside what this page already calls itself ("Set up the exercise you are
signed in to").

## What was built
- `features/planner/pages/ExerciseSettingsPage.tsx` — edited in place (not rewritten): the section
  id is now read from `?section=<id>` via `useSearchParams`, written back through the existing
  `selectSection` callback (still the single seam every click and the "Back to Identity & schedule"
  link go through). `resolveSectionId()` is the one fail-safe boundary: an absent or unknown
  `section` value degrades to `DEFAULT_SECTION` rather than throwing; `sectionById()` still throws
  on a miss, but is now only ever called with `resolveSectionId()`'s already-validated output, so a
  stale/hand-edited URL can never reach it. `lastSettingsSection` ("the section to come back to") is
  now kept in sync with the URL by its own effect, not only by `selectSection`, so a browser
  back/forward hop lands the shared-form panel on the right one of the three settings views.
- `AccountImport` mounted as a sixth `SECTIONS` entry (`id: 'accounts'`, label "Import participant
  accounts") — no wrapper needed; `AccountImport.tsx` already takes no props. Closes
  `exercise-configuration/feature.md` open question (b).
- URL shape chosen: `?section=<id>` on the planner's own path (`/staff/plan?section=channels`), NOT
  a path segment (`/staff/plan/channels`) — see "URL shape" below.

## AC5 amended (reviewer WR-004) — focus does not move on the initial deep-linked render
**As written, AC5 said:** "focus moves to the content pane on selection... including the initial
load from a deep link." That directly contradicted this same story's own Technical Notes, which say
the focus-management effect is "untouched" by this story. The as-built code resolves the
contradiction in favor of **never moving focus on first render, including a first render that
happens to land on a non-default section via a deep link** — i.e. the pre-existing "never steal
focus on first render" rule is preserved unchanged, and a deep link is treated as a case of first
render, not as a case of "selection."

**Why (reviewer agrees, on a11y grounds):** yanking focus off the page's `h1`/heading block the
moment a screen-reader or keyboard user's page finishes loading — merely because the URL happened
to name a non-default section — is worse than leaving them at the top of the document, which is
where a browser lands any freshly-loaded page. Focus moving away from arrival is the surprising
behavior, not the safe one. This also protects a pre-existing shipped accessibility test
(`ExerciseSettingsPage.test.tsx` → `does not steal focus on first render`) that predates this story
and was written for exactly this property.

**Amended AC5 (replaces the original clause verbatim):**
> Given the page's existing accessibility contract (a real `<nav>`, `aria-current="page"`, focus-to-
> content-pane on an explicit section change, unselected sections `hidden`), when section selection
> is now URL-driven, then that contract is unchanged: focus moves to the content pane only on an
> **explicit** selection made through `selectSection` (a nav click, or programmatic re-selection),
> and never on first render — **including a first render that lands on a non-default section via a
> deep link.** A reload or a fresh deep-link visit renders the correct section without moving focus
> away from the page heading.

Recorded here so nobody later "fixes" the code to satisfy the original, contradictory wording — the
shipped behavior is the intended one.

## URL shape: query param, not a path segment
The story's AC sanctioned either (`?section=<id>` or `/staff/plan/channels`). The builder chose the
query param specifically **to avoid coupling the planner surface's internal sections to the shared
staff route registry** (story 01) — `ExerciseSettingsPage` owns its own `SECTIONS` registry and
needs no `StaffRouteEntry` per section, no route-tree edit, and no dependency on story 01 landing
first (the two stories were built to agree on *a* consistent deep-link pattern — surface path +
section — without requiring sequencing). This is recorded so a future surface deep-linking its own
internal state (explicitly out of scope here) has a documented precedent to follow or deliberately
deviate from.

## Acceptance Criteria
- [x] Given `ExerciseSettingsPage`, when a section is selected, then the URL reflects it (a query
      string under the planner's registered path from story 01) — reloading the page or opening the
      URL fresh lands on that section, not always `identity`.
- [x] Given a URL naming an unknown/removed section id, when the page loads, then it fails closed to
      `DEFAULT_SECTION` rather than throwing (the existing `sectionById()` throw-on-miss behavior is
      for a registry/id drift bug, not for a stale or hand-edited URL — those must degrade
      gracefully).
- [x] Given the existing "one shared settings form across three sections" constraint
      (`PUT /api/staff/exercise-settings` is a full replace — `ExerciseSettingsPanel` stays mounted
      across Identity/Channels/Theming), when the URL changes between those three, then no data is
      lost and no extra fetch/save is triggered — this story changes *what drives* `activeId`, not
      the page's existing mount-once-hide-when-inactive behavior.
- [x] `AccountImport` is mounted as a **sixth section** on `ExerciseSettingsPage` (registered in
      `SECTIONS` exactly like `ComplianceChromePanel`/`PracticeModePanel`) — closing
      `exercise-configuration/feature.md` open question (b). It is deep-linkable under this story's
      same URL mechanism.
- [x] ~~Given the page's existing accessibility contract..., focus moves to the content pane on
      selection, including the initial load from a deep link...~~ **AMENDED (WR-004) — see "AC5
      amended" above.** Focus moves only on an explicit `selectSection` call; a deep link's initial
      render is treated as first render and never steals focus, matching the pre-existing rule.

### Cross-cutting
- [x] **Accessibility (NFR-001):** unchanged from the page's existing contract per the amended AC5
      above — this story does not regress `ExerciseSettingsPage.test.tsx`'s landmark/focus
      assertions (it extends them with deep-link cases).

## Out of Scope
Any change to `ExerciseSettingsPanel`'s form behavior, `ComplianceChromePanel`, or
`PracticeModePanel`'s content; building a *new* settings capability (this story only makes existing
and one orphaned section addressable); deep-linking the controller console or evaluator dashboard's
internal state (a separate concern, not scoped to this story — the registry from story 01 is where a
future story would hang that); coupling section ids to the story-01 staff route registry (explicitly
declined — see "URL shape" above).

## Technical Notes
Staff world (COBRA). `src/frontend/src/features/planner/pages/ExerciseSettingsPage.tsx` (edit, not
a rewrite) — `useSearchParams` from React Router 7, kept behind the existing `selectSection`
callback so the focus-management effect stays untouched (see the amended AC5). `AccountImport`
needed no wrapper — its existing props (none) already match the "self-contained panel" shape the
other two panels follow. See implementation.md (story 03).

## Dependencies
`exercise-configuration/01b` (`ExerciseSettingsPage`, `SECTIONS` registry); `identity-auth-roles/02`
(`AccountImport`, Complete). Deliberately does **not** depend on story 01 landing first (see "URL
shape" above) — the two agree on a pattern, not a shared mechanism.

## Tests
Vitest + RTL, all in `ExerciseSettingsPage.test.tsx` unless noted.

**AC1 — URL reflects the section; reload/fresh-URL lands on it**
- `ExerciseSettingsPage — deep-linked sections`: `renders the section named by the URL on arrival —
  not the default (AC1)`, `a reload at a section URL does not fall back to Identity & schedule
  (AC1)`

**AC2 — unknown/removed section id fails closed to DEFAULT_SECTION**
- `ExerciseSettingsPage — deep-linked sections`: `falls back to the default section for an unknown
  id, without throwing (AC2)`, `falls back to the default section when the parameter is simply
  absent (AC2)`

**AC3 — shared-form data survives a URL-driven section change**
- `ExerciseSettingsPage — unsaved changes and off-screen validation`: `saves EVERY shared-form field
  after switching between all three sections via the URL (AC3)`, `keeps the edit, and says where it
  is, when the planner moves to another form (AC3)`

**AC4 — AccountImport as a registered, deep-linkable sixth section**
- `ExerciseSettingsPage — deep-linked sections`: `mounts AccountImport as a registered,
  deep-linkable sixth section (AC4)`, `reaches AccountImport from the nav too (not only by direct
  link) (AC4)`

**AC5 (amended) — focus behavior on deep link vs explicit selection**
- `ExerciseSettingsPage — section nav accessibility (NFR-001)`: `moves focus to the content pane so
  a keyboard user lands on what they chose (AC5 — explicit selection)`, `does not steal focus on
  first render (AC5 — the pre-existing rule this story preserves, now proved to also cover a
  deep-linked first render — see the `renders the section named by the URL on arrival` fixture,
  which asserts no focus move alongside the section render)`

**Browser back/forward (a consequence of the URL becoming the source of truth, not a separate AC)**
- `ExerciseSettingsPage — deep-linked sections`: `moves between sections on browser back and
  forward`

### Existing tests touched
None of the pre-existing `ExerciseSettingsPage.test.tsx` assertions (composition-point mount guard,
content-pane scroll ownership, section-nav accessibility, unsaved-changes handling) were rewritten —
they were extended with a new `describe('ExerciseSettingsPage — deep-linked sections')` block. The
one pre-existing assertion this story leans on for proof, `does not steal focus on first render`,
was **not modified**; it is cited above because it is what makes the amended AC5 checkable without a
new test duplicating it.
