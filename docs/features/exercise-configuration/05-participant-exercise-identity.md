# Story: Participant-visible exercise identity — requirements gap

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-005 (gap; touches COR-003/004, COR-031, XC-002/XC-003)  ·  **Design decisions:** R-006, COMPONENTS.md divergence #5  ·  **Issue:** #180

## Context
The session-3 shell extraction surfaced a **requirements gap, not a visual task** (COMPONENTS.md
"Shell extraction", divergence #5): the controller console shows the exercise name + role
**persistently** during conduct (COR-005; `console-shell/03`), while participant surfaces show
**no exercise identity anywhere** — nobody looking at a participant screen can tell which exercise
session it belongs to. No requirement currently says whether that asymmetry is intended.

The tension this decision must resolve:

- **COR-004 / XC-002** deliberately keep the exercise *concept* out of the participant world — no
  picker, no list, no simulation-status surface (`exercise-isolation/04`). "Which session is this"
  must not reintroduce admin/meta affordances into the fiction.
- **Concurrent exercises are a core capability** (COR-003, multi-instance personas; per-exercise
  hostnames in `exercise-isolation/08`). Two sessions of the same fiction family can run in one
  facility — a wrong-room/wrong-hostname screen is plausible and today **undetectable from the
  participant frame**.
- **Out-of-fiction framing already exists**: the compliance chrome (COR-031, XC-003;
  `exercise-configuration/02`) renders configurable text outside the app frame on every channel —
  the one place session identity could appear without breaking fiction (D0 §2).

This story delivers the **requirement decision** that the D7 unified-shell session (R-006) then
designs against. It must land **before D7 specs the shared frame**.

### The gap is no longer hypothetical: `/api/exercise-context` leaks the INTERNAL name (WR-004)

Surfaced at the wave-3 Gate 2 review and cross-referenced here so the connection is not lost. The
asymmetry above was framed as "participants see *no* exercise identity". That is not quite true —
they see the **wrong one**, and it is the staff-facing one:

- `Features/ExerciseResolution/ExerciseScopeDto.FromExercise` sets `ExerciseName = exercise.Name` —
  `Exercise.Name` is the **internal, staff-facing** name.
- `/api/exercise-context` is the one **pre-auth, participant-reachable** endpoint, and
  `features/login/pages/ParticipantSignInPage.tsx` renders its value as *"Sign in to {exerciseName}"*.
- Concretely: name an exercise **"CPKC Q3 Derailment — Eval Cohort B"** and every participant reads that
  before they have even signed in — cohort structure, sponsor and evaluation intent, in the fiction's
  front door.

The condition is **pre-existing on `main`**, but `exercise-configuration` makes it a live internal
inconsistency rather than a latent one: story 01a added `Exercise.WorldName` explicitly as the
*participant-visible* name "as distinct from `Name`, which is the staff-facing internal name", and 01b's
`ExerciseShellConfigSource` read model documents that it "carries no staff-world state: not the internal
`Exercise.Name`…". One participant-reachable endpoint did not get the memo.

**Why it is filed here and not fixed in passing:** `ExerciseScopeDto` is a **frozen contract** and
repointing `exerciseName` at `WorldName` (or adding a field beside it) is a **Tier-2 change** needing human
sign-off (`docs/ORCHESTRATION_MECHANICS.md` §3) — exactly the class of decision this story exists to take.
It is also not merely a rename: `WorldName` is nullable ("not configured" → the shipped Phase-1 constant),
so the decision must say what a participant sees when no world name is set, and whether the staff-side
consumers of `exerciseName` (e.g. `ExerciseSwitcher`) keep the internal name — they should.

So this story's decision should settle **which name `/api/exercise-context` serves** in the same breath as
whether participants carry session identity at all; see AC5 below.

## Acceptance Criteria
- [ ] A written requirement decision (recorded in this story and reflected into the E1 epic text)
      answering: **do participant surfaces carry visible exercise-session identity?** If yes —
      *what* identity (exercise name, session code), *for whom* (participants, room facilitators,
      support staff), and *where it may render* (environment chrome only — never inside the
      fiction).
- [ ] The decision explicitly reconciles **COR-004/XC-002**: any identity shown creates no
      exercise-selection or simulation-status affordance for participants
      (`exercise-isolation/04` ACs remain satisfiable as written).
- [ ] The decision is handed to **D7 as a named input** (cited from the D7 brief/session notes as
      resolving COMPONENTS.md divergence #5) before the unified shell is specced.
- [ ] Outcome routing: if "yes, in the chrome" — `exercise-configuration/02` (compliance chrome)
      and the D7 shell inherit it as a chrome **content** requirement, consistent across every
      enabled channel (XC-003); if "no" — the D1↔D5 asymmetry is recorded as intended and the
      wrong-session risk is explicitly accepted in the E1 epic.
- [ ] **WR-004 — the decision names which exercise name `/api/exercise-context` serves.** Whichever way
      the question above goes, the decision states whether `ExerciseScopeDto.exerciseName` keeps carrying
      the **internal** `Exercise.Name` to participants or is repointed at the participant-visible
      `Exercise.WorldName`; what a participant sees when `WorldName` is unconfigured (null); and that the
      staff consumers of that field are unaffected. If it is repointed, the decision records that this is
      a **Tier-2 frozen-contract change** and names the story that carries it — this story ships no code.

## Out of Scope
Any visual or shell design (D7 owns the shell — R-006); the staff identity badge
(`console-shell/03`, COR-005 as amended by D5-012(g)); banner presentation (interim pending D7);
hostname-scoping mechanics (`exercise-isolation/08`).

## Technical Notes
**Requirements/documentation story — no code, no stack, and deliberately excluded from the Wave Plan**
(`implementation.md`): it is never dispatched to a builder and never appears in a wave fan-out. The
likely resolution surface is the COR-031
environment chrome (outside the fiction frame), already per-exercise-configurable text — that
path keeps XC-002 intact and needs no new participant-world element. Whatever is decided must
hold on every participant channel (social, portal, outlets, weather — XC-003).

## Dependencies
COMPONENTS.md ("Shell extraction", divergence #5) + R-006 (`docs/design/`);
COR-004 (`exercise-isolation/04`), COR-031 (`exercise-configuration/02`), COR-005
(`console-shell/03`). **Blocks:** the D7 unified-shell session consumes this decision.

**Inputs from the tree** (for whoever takes the decision): `Data/Entities/Exercise.cs` — `Name` (internal)
vs `WorldName` (participant-visible, nullable, story 01a);
`Features/ExerciseResolution/ExerciseScopeDto.cs` — the frozen shape and the `ExerciseName = exercise.Name`
projection; `Features/ExerciseConfiguration/ParticipantShellConfigService.cs` — the `ExerciseShellConfigSource`
read model that already carries `WorldName` and documents the no-staff-state rule;
`features/login/pages/ParticipantSignInPage.tsx` — the participant render site. Recorded at feature level as
`feature.md` open question **(e)**.

## Tests
None here (requirements decision). The outcome is tested by the stories it lands in (compliance
chrome / D7 shell stories).
