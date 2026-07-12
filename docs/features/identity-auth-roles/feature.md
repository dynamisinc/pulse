# Feature: Identity, auth & roles

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.2
**World:** platform/foundation  ·  **Issue:** #39

## Summary
Who can do what, and how they get in: the role set, exercise-provisioned named accounts for active
participants, the shared read-only credential for the "hundred passive participants," the hybrid
identity model (federated staff, Pulse-native participants), and post-as-organization with per-human
attribution. Identity providers stay behind an interface — Entra/SSO is a future direction.

## Requirements covered
COR-010, COR-011, COR-012, COR-013, COR-014, COR-015, COR-016, COR-017, COR-018 (with NFR-009 abuse
resistance and XC-004 attribution).

## Design references
Master §3 scope decision 6 (hybrid identity), decision 6/COR-011 (no fake-signup theater). D0
non-negotiables (staff vs participant worlds).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Role set (Participant/PIO/Controller/Evaluator/Planner/OrgAdmin) | COR-010 | Not Started | #58 |
| 02 | Named participant accounts (provisioned, no self-signup) | COR-011 | Not Started | #59 |
| 03 | Short-lived exercise-bound sessions | COR-012 | Not Started | #60 |
| 04 | Evaluator read-everything, write-nothing | COR-013 | Not Started | #61 |
| 05 | Hybrid identity model behind a provider interface | COR-014 | Not Started | #62 |
| 06 | Shared read-only access (view-only session) | COR-015 | Not Started | #63 |
| 07 | Shared-credential lifecycle (rotate/revoke/lockout) | COR-016 | Not Started | #64 |
| 08 | Participant admin panel (login triage) | COR-017 | Not Started | #65 |
| 09 | Organization-account operation (post-as-org, attribution) | COR-018 | Not Started | #66 |

## Dependencies
Exercise-isolation (session→exercise scoping, COR-001/008); telemetry (XC-004) for attribution. The
identity provider stays behind an interface (COR-014). Backend not present yet.

## Design notes
Foundation, spanning staff and participant worlds. Read-only sessions still get an ephemeral identity
so telemetry can count views/reach without per-user provisioning (COR-015). The shared credential is
an internet-facing secret and is treated as such (COR-016/NFR-009). Fake sign-up UI is omitted
normatively — phishing-pattern optics on a government training site (COR-011).
