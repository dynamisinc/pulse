# Story: Hybrid identity model behind a provider interface

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-014  ·  **Design decisions:** none  ·  **Issue:** #62

## Context
The decided hybrid model: **staff** (controller/evaluator/planner) authenticate against the Dynamis
identity provider directly in Phase 1; active participants use Pulse-native named accounts; read-only
access via COR-015. The identity provider stays **behind an interface** — Entra ID / AD / SSO is an
anticipated future direction, not a launch requirement; Cadence session federation arrives with E9
(Phase 4) (COR-014).

## Acceptance Criteria
- [ ] Staff authenticate against the Dynamis IdP in Phase 1; participants use Pulse-native accounts
      (story 02) or read-only sessions (story 06).
- [ ] The identity provider is accessed through an **interface/abstraction** so a future Entra/AD/SSO
      provider can be added without touching call sites.
- [ ] No Cadence-federation dependency is required for Phase 1 (that arrives with E9, Phase 4).

## Out of Scope
Actual Entra/AD/SSO integration (future); Cadence federation (E9, Phase 4); the shared credential
(story 06).

## Technical Notes
Foundation. Provider-behind-interface is the key architectural constraint. See implementation.md
(story 05).

## Dependencies
Story 03 (sessions); story 01 (roles). Future E9 federation slots behind the same interface.

## Tests
- Unit: the auth layer resolves staff via the provider interface; swapping the provider needs no
  call-site change (interface test/mock).
