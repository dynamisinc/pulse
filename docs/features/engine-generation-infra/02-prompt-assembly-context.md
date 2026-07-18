# Story: Prompt assembly & context assembly

**Feature:** Engine generation infrastructure  ·  **Epic:** E8  ·  **Phase:** 2 (v1)  ·  **Status:** In Progress
**Requirements:** ADP-020 (context)  ·  **Design decisions:** none  ·  **Issue:** #143

## Context
One generation call produces **one burst** (multiple personas, one storyline). The prompt has three
strata with a hard trust boundary (architecture §3.3): a **system** prompt carrying *trusted* engine
context (exercise brief, the absolute rules, storyline state, and the selected personas' dossiers +
style params + 2–3 prior-post exemplars); a **user** turn carrying the *untrusted* world feed
(handled by story 03) plus the task instruction; and a forced **`emit_posts` tool schema** that
constrains output to structured per-post objects. Context assembly selects the storyline state + the
relevant persona dossiers + the last K world posts relevant to the storyline (by hashtag/mention/recency).

## Acceptance Criteria
- [ ] Given a storyline and a set of participating personas, when the engine assembles a generation
      request, then the system prompt contains the exercise brief, the absolute rules, the storyline
      state, and per-persona voice notes (COR-020) + style params + prior-post exemplars.
- [ ] Given a burst request, when output is produced, then it comes **only** via a forced
      `emit_posts` tool call returning `[{personaHandle, text, sentiment, hashtags}]` — no free-form
      prose, no preamble.
- [ ] Given the last K world posts, when context is assembled, then only posts relevant to the
      storyline (hashtag/mention/recency) are included, bounded to a token budget.
- [ ] Given scenario time, when it appears in the prompt, then it is carried as **storyline state**
      (after the cache breakpoint), never interpolated into the stable system prefix (so caching in
      story 04 is not invalidated).
- [ ] **LLM governance (NFR-005):** the assembled request goes only to the tenant-bounded provider
      (story 01); untrusted world content is placed only where story 03 fences it, never in the
      system role.

## Out of Scope
The provider interface (story 01); the fencing/sanitisation of untrusted content (story 03); caching
mechanics (story 04); the voice-notes authoring (persona-management); persona selection policy
(persona-voice-engine / reaction-loop decide *which* personas — this story assembles the prompt for
a given set).

## Technical Notes
Staff/backend. Mirrors the validated prototype `spikes/e8-generation-loop/index.mjs`
(`systemPrompt`, `userTurn`, `EMIT_POSTS_TOOL`). Stable prefix = brief + rules + dossiers; volatile
tail = storyline state + world feed. See implementation.md (story 02) and architecture §3.3.

## Dependencies
Story 01 (provider interface); persona dossiers (persona-management COR-020); storyline-model
(storyline state shape). Consumed by persona-voice-engine and reaction-loop.

## Tests
- Unit: assembled request has the three strata; output is forced through the tool schema.
- Unit: scenario time lands in the volatile tail, not the cached prefix (asserted against the
  cache-key boundary from story 04).
