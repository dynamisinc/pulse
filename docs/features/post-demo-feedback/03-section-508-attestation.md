# Story: Section 508 attestation (ACR/VPAT) and accessibility gate (PDF-12)

**Feature:** Post-demo customer feedback  ·  **Epic:** cross-cutting  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** NFR-001 (WCAG 2.1 AA), Revised Section 508 (36 CFR 1194)  ·  **Design decisions:** D0 §4 non-negotiable 1, PDF-D7 (Tom, 10/21)  ·  **Issue:** #680
**Stack:** process + test tooling + docs  ·  **World:** both  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Effort:** L

## Context
10/20 demo: we must attest to, and be able to prove, Section 508 compliance. Source: Tom's demo notes. NFR-001 says
WCAG 2.1 AA on participant and evaluator surfaces, and every story carries an a11y AC, but there is no evidence package, no
automated gate, and no assistive-technology audit. The Revised 508 Standards incorporate WCAG 2.0 AA, so the attestation
reports against WCAG 2.x AA plus the 508 chapters WCAG does not cover (support documentation, authoring/generated content;
hardware N/A). The staff console is in scope too, because customers' controllers and evaluators are users.

## Acceptance Criteria
- [ ] A completed Accessibility Conformance Report (ITI VPAT 2.5 Rev 508 edition) covers the participant surface (social) and
      the staff surfaces (controller console, evaluator/report), each criterion marked Supports / Partially Supports /
      Does Not Support / N/A with remarks; stored at `docs/compliance/ACR-Pulse.md` with the build and date tested.
- [ ] Given the Vitest suite, when it runs, then an axe check (`vitest-axe` or `jest-axe`) renders each key participant and
      staff component and fails on any serious or critical violation.
- [ ] Given a browser-level run (Playwright, adopted; extends the existing `e2e/` suite, plus `@axe-core/playwright`) against the key flows (join, feed, composer,
      controller run sheet, report), when CI runs it, then serious or critical violations fail the build, with a reviewed
      baseline for known issues that each links to a tracked issue.
- [ ] A manual audit is done with NVDA, JAWS and VoiceOver (macOS Safari and iOS), plus keyboard-only and 200% zoom/reflow,
      covering the live feed's live-region behavior and the controller console's keyboard operation; findings are logged with
      severity and each becomes an issue or an accepted ACR remark.
- [ ] Given audit findings rated Critical or Serious, then they are fixed or listed as "Partially Supports" in the ACR with a
      remediation date; nothing is silently omitted.
- [ ] `CLAUDE.md` (Design non-negotiables item 1) and `docs/design/D0-FOUNDATIONS.md` §4 link to NFR-001, the ACR and the test
      gate, and state the 508 attestation requirement. (Edits outside this feature folder; apply when this story is built.)
- [ ] A re-test cadence is recorded: the ACR is refreshed before each release (December included) and when a surface changes
      materially.

## Out of Scope
Third-party certification or a legal opinion; WCAG 2.2 AAA; auditing customer-authored content (uploaded media, alt text)
beyond giving authors the tools; the December channels' own audits (each new channel joins this gate as it lands).

## Technical Notes
Participant surfaces are per-brand skinned, so contrast must be checked per brand skin, not once. Severity and alert states are
never color-only (D0). Reuse the existing test setup under `src/frontend`; add the axe helper as one shared test util. Playwright is adopted (Tom, 10/21): `@playwright/test` is
already in `src/frontend/package.json` and `e2e/` exists from #606; the same runner also serves multi-session scenarios. See `implementation.md` PDF-D7.

## Dependencies
None to start. The December channels add scope as they land. PDF-01 (phones and tablets) feeds the mobile AT audit.
