# Story: Toolstrip + flyouts (the console's extension point)

**Feature:** Console shell  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** console UI architecture (D5), COR-018  ·  **Design decisions:** D5-004, D5-015, D5-016, D5-017, D5-018, D5-019, **D7-011**  ·  **Issue:** #9

## Context
The controller console must stay legible as surfaces accumulate. The D5 review settled the frame: a
56px **right-edge toolstrip** with **flyouts**, governed by one rule — **continuous-watch** surfaces
(engine review queue, live world) keep permanent rail/column space; **consult-on-demand** surfaces
(Stories, Personas, Trainees, Rumors, participant admin, settings) are toolstrip tools that open as
flyouts with status badges. This is the extension point that keeps the rail from re-bloating as new
tools land.

> **Amendment (D7-011).** The **toolstrip container is `staff-shell`-owned** (one shell dock, two
> zones — `staff-shell/02-toolstrip-dock.md`, **shipped, Complete**). This story is about the
> **console registering its tools into the shell's surface-zone** via the shipped
> `useRegisterSurfaceTool()` seam (`@/features/staffShell/toolRegistry`) — *not* the console drawing
> its own strip. The continuous-watch vs consult-on-demand rule (D5-017) stands as *which* tools the
> console registers vs keeps as permanent rail/column space. Participant-admin is already a
> shell-global tool (`staff-shell/03`, shipped); it is not this feature's to draw.

**Wave-1 scope (this is the KEYSTONE story of a 5-story cross-feature integration wave — see
`implementation.md`).** In addition to the dock-registration behavior above, this story is where the
console's **⌘K command palette**, its **persona-dock host** (the flyout mount point
`persona-operation`'s picker/composer/context-panel render into), and a **Phase-1 mock controller
identity** (COR-018 attribution seam) are built. `persona-operation`'s stories build in parallel
against this story's INPUT/CALLBACK contract (`activePersona`, `actingHumanId`, `callSign` as
props; an `onPublished` callback) — they do not import this feature's files, and this story does not
import theirs. A serial integration step (not a builder wave) wires the two together, assembles the
`ControllerConsole.tsx` composition, creates the cross-feature barrel, and adds the App.tsx `/console`
route. See "Wave-1 integration seam" under Technical Notes.

## Acceptance Criteria
- [ ] Given the console mounted in the staff shell, when it renders, then it **registers** its
      consult-on-demand tools into the shell's toolstrip surface-zone via `useRegisterSurfaceTool()`
      (`@/features/staffShell/toolRegistry`, D7-011) with FontAwesome icons + accessible labels, and
      continuous-watch surfaces occupy permanent rail/column space rather than the toolstrip. The
      console does **not** draw its own strip or its own tool registry.
- [ ] When the controller activates a toolstrip tool (click or keyboard) via `useToolstrip()`'s
      `toggleTool`/`isActive`, then its flyout opens over the console without displacing the live
      world/queue columns, and closes without losing their state.
- [ ] A tool's toolstrip icon carries a **status badge** (e.g. a count) that pulses red when that
      surface is escalating — conveyed by icon/label/number, **never color alone** (NFR-001).
- [ ] The toolstrip and every flyout are fully keyboard-operable and screen-reader labelled
      (NFR-001); focus returns to the toolstrip on flyout close.
- [ ] New tools register through one extension point (adding a tool does not require re-laying-out
      the console), and this surface is staff-only — never reachable from a participant session (XC-002).
- [ ] **⌘K command palette (D5-004/015/017/018).** Given the console, when the controller presses
      ⌘K/Ctrl+K, or activates the registered **"Personas"** surface tool, then a keyboard-first,
      searchable command palette opens with a PERSONAS section that is the entry point to the
      "post as persona" flow. The palette is focus-trapped, closes on Esc, is screen-reader labelled,
      and every step (open → search/type → select) is reachable with no pointer required (NFR-001).
      This story ships the palette shell + the PERSONAS section as a search/select surface; the
      searchable persona list itself is `persona-operation/02`'s (wired at integration).
- [ ] **Persona-dock host.** Given a persona is selected from the palette (or the "Personas" tool is
      otherwise activated), when the flyout opens, then it renders into a console-owned
      **persona-dock host** — a named flyout mount slot that subsequent persona-operation content
      (picker → composer → context panel) renders into. This story ships the host slot itself, empty
      of persona content until the integration step wires it (see Technical Notes) — building persona
      content here would duplicate `persona-operation`'s ownership.
- [ ] **Mock controller identity (COR-018).** Given the console is mounted, when any component needs
      to attribute an action to the operating controller, then `useControllerIdentity()`
      (`features/controller/identity/controllerIdentity.ts`) returns an exercise-scoped
      `{ actingHumanId, callSign, role: 'controller' }` — a Phase-1 mock (rationale below) that other
      Wave-1 stories consume as an **input**, never an import of this module from `persona-operation`.

## Out of Scope
**SCOPE GUARD — this wave builds ONLY the frame extension point + palette + persona-dock host.** It
explicitly does NOT build: the individual tools/flyouts' own content (persona picker/composer/context
panel — `persona-operation`; trainee monitor — console-shell story 05; Flag → AAR — console-shell
story 04; NEEDS-YOU bar — console-shell story 02); the MSEL/conduct-timeline rail (`inject-queue`);
the live-world columns (`live-monitoring`); the engine review queue (`engine-review-cockpit`);
storylines/escalation dial (`storyline-model`, `world-steering/02`); the rumor tracker
(`rumor-tracker`); break-fiction, tiered pause, or any other guarded control (`world-steering`); the
engine cockpit / adaptive-content surfaces (E8). Those are separately staged features/stories, not
this wave. Also out of scope, per the original story: the contents/behavior of each hosted tool.

## Technical Notes
Staff world (COBRA). Owns the console's **tool definitions + flyout content** that register into the
shipped `staff-shell` toolstrip dock (D7-011, `@/features/staffShell/toolRegistry`'s
`useRegisterSurfaceTool()`/`useToolstrip()`) — the strip container itself is `staff-shell`'s (shipped,
Complete). Continuous-watch vs consult-on-demand is a per-tool config, not per-instance logic.
FontAwesome icons; MUI 9 `sx`-only.

**Files this story owns** (disjoint from every other Wave-1 story — see the umbrella wave plan):
- `features/controller/components/ControllerConsole.tsx` — the console surface mounted in
  `StaffShellFrame`'s work area; registers its tool(s) via `useRegisterSurfaceTool()`; renders its own
  flyout(s) keyed on `useToolstrip().isActive(id)`.
- `features/controller/console/CommandPalette.tsx` — the ⌘K palette shell.
- `features/controller/console/personaDockHost.*` — the flyout mount slot.
- `features/controller/identity/controllerIdentity.ts` — `useControllerIdentity()`.

**Mock controller identity — rationale.** Staff routes do not currently mount `SessionProvider`
(App.tsx has no `/console` route yet, and `/evaluator` doesn't mount one either), and the one mock
`resolveSession()` returns a single fixed **participant** session (Dana Reyes) — there is no
controller-session mock. Forking `core/auth`'s resolver to be surface-aware in the middle of a
5-story parallel wave is a shared-foundation change owned by no single story and a merge hazard
across all five builders. So the controller identity is a small, staff-feature-owned mock now
(`features/controller/identity/controllerIdentity.ts`); the real controller-session endpoint is the
deferred backend edge (no `.NET` backend exists yet).

**Wave-1 integration seam (serial, not a builder wave).** After all five stories land:
1. Create the `features/controller` barrel (`index.ts`) — NOT built during the fan-out (collision risk).
2. Add the App.tsx `/console` route: `ExerciseContextProvider > ToolstripProvider > StaffShellFrame`
   (mirrors the shipped `/evaluator` composition) with `ControllerConsole` as `children`.
3. Wire `persona-operation/02`'s `PersonaPicker`/`useActivePersona()` and `persona-operation/03`'s
   `PersonaContextPanel` into this story's persona-dock host.
4. Wire `persona-operation/01`'s `PersonaComposer`'s `onPublished?(post)` to
   `feeds-discovery/07`'s `postStore.appendPost(post)`.
5. Pass this story's `useControllerIdentity()` output (`actingHumanId`, `callSign`) as props into
   `persona-operation/01`'s compose hook/component.

See `implementation.md` (story 01) for the full reuse map + wave plan.

## Dependencies
`staff-shell` (shipped, Complete — the toolstrip dock + `useRegisterSurfaceTool()`/`useToolstrip()`
seam this story registers into); E1 roles/exercise-context (staff-only gating, XC-002). Foundation
for every other E7 surface (Wave 1) and the persona-dock host `persona-operation` mounts into.

## Tests
- Component (RTL): activating a toolstrip tool opens its flyout without unmounting the live columns.
- Component (RTL): an escalating tool shows a badge with a number/label (not color-only).
- Unit: the tool registry lists continuous-watch vs consult-on-demand placement correctly.
- Component (RTL): ⌘K opens the palette; Esc closes it; focus is trapped inside while open and
  returns to the trigger on close.
- Unit: `useControllerIdentity()` returns an exercise-scoped identity and is exercise-context-bound
  (a different mounted exercise yields a different scope, mirroring `useExerciseContext()`'s pattern).
