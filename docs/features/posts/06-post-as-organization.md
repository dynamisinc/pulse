# Story: Post as organization (grant-gated chip)

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-006 (COR-018)  ·  **Design decisions:** D1-007, D1-R2, R-006 (chip chrome interim), D4-005  ·  **Issue:** #97

## Context
Participants granted org-persona operation (COR-018) get a **"Posting as: {account} ▾" chip** in the
composer and can post/reply/DM as that org. Per the D1 design, the chip renders **only for users
holding org grants** (citizens get the stock composer, no chip), and switching is **one identity at a
time**. Multi-persona posting is a Controller Console capability, **never** a participant one
(SOC-006, D1-007/R2).

## Acceptance Criteria
- [ ] For a user holding org grants, the composer shows a "Posting as" identity switcher listing
      personal + granted org accounts with a "granted for this exercise" hint, visible before typing
      *(the chip + dropdown presentation is inventoried identity chrome: interim — superseded by D7
      shell, R-006/COMPONENTS.md — do not spec the chrome further; the grant-gating and switch
      semantics below stand)*.
- [ ] For a citizen **without** grants, the composer shows **no chip** (stock composer) — the chip is
      conditionally rendered, not disabled (D1-007/R2).
- [ ] Only **one** posting identity is active at a time; selecting an account updates both the inline
      and modal composers.
- [ ] Posting as an org records the **individual human** behind the shared handle (COR-018/XC-004);
      the public sees only the org.
- [ ] Participants can hold at most their granted set — multi-persona free switching is not a
      participant capability (that is the Controller Console).

## Out of Scope
The org-grant model itself (E1 identity-auth-roles COR-018); controller post-as-any-persona (E7
persona-operation); press-room account switcher (E5 PRS-001 — per **D4-005** the Wire Room reuses
**this** chip, labelled "Releasing as {org} ▾"; no second switcher is built).

## Technical Notes
Participant world. Grant-gated conditional render; single active identity in the compose state. Reuses
the E1 org-grant + attribution. See implementation.md (story 06).

## Dependencies
E1 identity-auth-roles (COR-018 grants + attribution); story 01 (composer). Mirrored by E5 PRS-001.

## Tests
- Component (RTL): grant-holder sees the chip + switches identity; a citizen sees no chip; a post as
  org records the acting human.
