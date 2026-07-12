# Story: Amplification chain reconstruction

**Feature:** Amplification (reposts & quotes)  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-022  ·  **Design decisions:** none  ·  **Issue:** #103

## Context
A post's amplification chain — who spread it, when, in what order — is **fully reconstructable from
telemetry** (SOC-022). This is the raw material for E10's spread trees and E8's rumor lineage.

## Acceptance Criteria
- [ ] Every repost/quote emits a telemetry event (XC-004) capturing actor, source post, timestamp
      (wall + scenario), and parent (what was reposted).
- [ ] From telemetry, the full amplification chain/tree (order + edges) can be reconstructed for any
      post.
- [ ] The chain data is exercise-scoped (COR-001) and feeds E10 (spread metrics) and E8 (rumor lineage
      ADP-032).

## Out of Scope
The E10 spread-tree visualization (E10); E8 rumor objects (E8 F8.4).

## Technical Notes
Backend/telemetry. Each amplification event records its parent so the tree is derivable. See
implementation.md (story 03).

## Dependencies
story 01 (events); E1 telemetry (XC-004). Consumed by E10/E8.

## Tests
- Unit: a repost chain reconstructs in correct order with parent edges from telemetry.
