# Story: Composer shows persona context while writing

**Feature:** Persona operation  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-003, COR-020, SOC-054  ·  **Design decisions:** D5-014/2.4  ·  **Issue:** #16

## Context
So a persona stays in character across controllers, the composer shows the persona's context while
writing (CTL-003): voice/personality notes (COR-020), a few recent posts, and audience magnitude
(SOC-054), plus a category chip that guards against posting as the wrong persona (D5-014/2.4). This
is what lets a controller pick up "Darco Tripp — mildly grumpy, short sentences" and reply in-voice
within seconds without having authored the persona themselves.

> **Grounding correction (Wave-1 reconciliation).** `voiceNotes` (COR-020) lives on `PersonaTemplate`,
> **not** on the `Persona` instance (`@/features/personas/types.ts`) — an instance carries
> `templateId` but not the voice-notes text itself. The panel must resolve voice notes via
> `personaTemplateById(persona.templateId)` (`@/features/personas`), never off `persona` directly.
> `audienceBand` (SOC-054), by contrast, **is** on the instance — read it straight off `persona`.

## Acceptance Criteria
- [ ] Given an active persona, when the composer is open, then the panel displays the persona's
      voice/personality notes — resolved via
      `personaTemplateById(persona.templateId)?.voiceNotes` (COR-020) — its recent posts, and its
      audience magnitude band read from `persona.audienceBand` (SOC-054).
- [ ] Given an active persona, when the composer is open, then the panel also shows a
      **"POSTING AS {category}"** chip (D5-014/2.4, wrong-persona defense) derived from
      `persona.personaType` (e.g. `citizen` → "CITIZEN VOICE"; `agency`/`weather-scientific` →
      "OFFICIAL ACCOUNT"; `news-outlet` → "NEWS / MEDIA") — unmissable at compose time, distinct per
      category, never color-only (the label text itself carries the signal, NFR-001).
- [ ] Changing the active persona (`persona-operation/02`) updates the context panel — voice notes,
      recents, audience band, and the category chip — to the new persona without a full reload.
- [ ] The panel is read-only reference (it does not let the controller edit the persona template
      here) and does not obstruct the fire path.
- [ ] The context data is scoped to the active exercise's persona instance (COR-001) — recents reflect
      this exercise's history, not another exercise's; template data (voice notes, category) is
      org-library-scoped (not exercise-scoped) by design, matching `PersonaTemplate`'s own scope.
- [ ] Accessible: the panel is reachable and legible via keyboard/screen reader alongside the composer
      (NFR-001).

## Out of Scope
Editing the persona template (E1 persona management); audience-magnitude math itself (defined with
SOC-054 in E2 — this panel only reads `persona.audienceBand`, never recomputes it); the picker
(`persona-operation/02`); the composer itself (`persona-operation/01`) — this panel supplies context
alongside it, it does not compose or publish.

## Technical Notes
Staff world (COBRA). Files this story owns (disjoint from every other Wave-1 story):
`features/controller/components/PersonaContextPanel.tsx` + a small
`features/controller/services/personaVoice.ts` helper that wraps
`personaTemplateById(persona.templateId)` (voice notes) and derives the category-chip label from
`persona.personaType` — both pure reads of the shipped `@/features/personas` module, no new resolver.

**Input, not import (Wave-1 parallel-build contract).** `PersonaContextPanel` takes `persona: Persona`
as a prop, supplied by `persona-operation/02`'s `useActivePersona()` at the Wave-1 integration step.
This story does not import `useActivePersona`/`PersonaPicker`.

See `implementation.md` (story 03) for the file-ownership map + cross-feature wave plan.

## Dependencies
E1 persona voice notes (`PersonaTemplate.voiceNotes`, COR-020) + audience magnitude
(`Persona.audienceBand`, SOC-054); `persona-operation/02` (active persona, as an INPUT contract).
Feeds in-character quality of `persona-operation/01`.

## Tests
- Component (RTL): the panel renders voice notes (via `personaTemplateById`), recents, audience
  magnitude, and the category chip for the active persona, and updates when the active persona
  changes.
- Unit: `personaVoice` resolves voice notes from the template, not the instance; the category-chip
  mapping covers every `PersonaType`.
- Unit: recents query is scoped to the active exercise instance.
