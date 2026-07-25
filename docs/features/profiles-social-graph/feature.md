# Feature: Profiles & social graph

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.6
**World:** participant  ·  **Issue:** #88

## Summary
Profile pages, follow/unfollow, the trainable verification signal (with impersonation support), the
"Who to follow" module, and the audience-magnitude model that reach/spread compute over.

## Requirements covered
SOC-050, SOC-051, SOC-052, SOC-053, SOC-054 (with COR-030 accent, E1 verification flag, XC-004).

## Design references
`docs/design/D1-social-app/` + `STORY-UPDATES.md`. Amendments: **SOC-052** verified mark fixed
seal-blue `#2D9CDB` + impersonation pair, platform never flags fake (D1-003/008); **SOC-053** module
titled **"Who to follow"**, never authority labels (D1-R1); **SOC-054** magnitude counts + "…and ~N
others", never fake lists (D1-012).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Profile page (banner/avatar/bio/tabs) | SOC-050 | Complete | #109 |
| 02 | Follow / unfollow | SOC-051 | Not Started | #110 |
| 03 | Verification signal & impersonation support | SOC-052 / D1-003, D1-008 | Complete | #111 |
| 04 | "Who to follow" suggested follows | SOC-053 / D1-R1 | Not Started | #112 |
| 05 | Audience magnitude & follower affordance | SOC-054 / D1-012 | Not Started | #113 |
| 06 | Persona presentation fields (backend) | COR-020, COR-021, SOC-052, SOC-054, XC-005 | Not Started | _TBD_ |
| 07 | Follow graph (backend) | SOC-051, SOC-054, SOC-081, COR-001, XC-004 | Not Started | _TBD_ |

**Stories 01 and 03 are Complete against the mock only.** Both were built and verified against the
frontend's `SEEDED_PERSONAS`/`seedCast()` mock fixture, which already carries real bios, varied
follower counts, distinct join dates, and the `@FairhavenWater`/`@FairhavenWaterUpd` impersonation
pair. The **live** `GET /api/personas` does not: `PersonaResponseDto` currently returns documented
B1 stand-in values for `personaType`/`avatarColor`/`initials`/`audienceBand`/`followerCount`/
`joinedAt` (and omits `bio` entirely), and the live-seeded cast (`PersonaCastSeeder.Catalog`) has no
impersonator and only six of the mock's nine personas. So in UAT (mock off) today, every profile
renders 0 followers, no bio, an identical join date, and no lookalike account exists to demonstrate
SOC-052 against. Stories 06 and 07 are what make 01 and 03 true against live data, and what unblock
02/04/05, which cannot be honestly built against a backend with no real presentation fields and no
follow edges at all.

## Dependencies
posts (PostCard, verified mark); E1 verification flag, isolation, telemetry; persona-management
(personas). Feeds E8 spread + E10 reach (SOC-054 formula). Steered by E7 CTL-021 (suggested follows).

## Design notes
Participant world. The verified mark (and its **absence**) is the **only** credibility signal — the
platform never flags impersonators (D1-008); near-duplicate lookalikes are allowed by design (SOC-052).
Follower **lists** never fabricate scrollable entries (D1-012).
