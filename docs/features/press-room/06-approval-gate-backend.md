# Story: Approval gate backend

**Feature:** Press Room  ·  **Epic:** E5  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-021, EVL-010 (approval latency capture)  ·  **Design decisions:** D4-002 (cancel-embargo notifies approvers + audit), D4-007, D4-007 sign-off #1, C-1  ·  **Issue:** —
**Stack:** backend  ·  **World:** participant write path (+ staff settings API)  ·  **Wave:** 4  ·  **Effort:** L

## Context
An optional, off-by-default gate: a participant release is held until an approver approves it. The approver is a **participant role** (JIC lead, legal reviewer) **or a controller playing that role**
(epic PRS-021); per C-1 the gate is participant paper regardless of who operates it, so this story exposes participant-session routes that a controller reaches through the participant approval view.
Routing is per-exercise config with per-org defaults (D4-007 sign-off #1). Owns **M5**, the last entry of the foundation [migration ledger](../channels-foundation/implementation.md#migration-ledger) (FU-4 resolved).

## Acceptance Criteria
- [ ] **Off by default.** Given a fresh exercise, then `ApprovalGate.EvaluateAsync` returns `Pass` for every release and no approval rows exist; the participant publish path is unchanged from story 05.
- [ ] **Hold.** Given the gate is enabled for the release's org, when the author confirms publish, then no publish happens: a `PressReleaseEvent` (`approval_requested`) is written, the release stays a foundation `draft` surfaced to participants as `pending_approval`, approvers are notified wire-internally, `press_approval_requested` is emitted, and the author sees it pending.
- [ ] **Approve.** Given a pending release, when an approver calls `POST /api/press/approvals/{releaseId}/approve { confirmed: true }`, then it publishes through the funnel with the **author as acting human** and the approver recorded in `PressReleaseEvent`; one `press_release` event (payload `approvalRequired: true`) and one `press_approval_approved { latencySec }` are emitted; an approver cannot approve their own release unless routing names them sole approver (config flag, default disallow).
- [ ] **Return requires a note (D4-007).** Given a pending release, when return is called without a non-empty note (after trim), then it is a 400; with a note, the release goes back to the author as `returned` carrying the note, approver name and scenario time, `press_approval_returned` is emitted, and the next author save/resubmit clears the returned banner state.
- [ ] **Draft diff.** Given `GET /api/press/approvals/{releaseId}`, then it returns the release plus a structured diff against the last revision the approver (or anyone) previously approved/saw (removed/added text runs, headline and contact changes), computed server-side from `ContentItemRevision` snapshots.
- [ ] **Routing and settings.** Given `GET|PUT /api/press/settings` (staff, controller role), then a controller can enable the gate per exercise, set a default approver role/persona, and override per org; changes are versioned; the participant `ReleaseOrgDto.approvalRequired` reflects them; a non-staff caller is 403.
- [ ] **Who may approve (C-1).** Given routing names a participant role, then humans holding it see the inbox and can act; a controller acts through the participant approval route and the participant UI frame (story 10), recorded as `approverKind: controller` in the audit row; no staff-only approve endpoint exists.
- [ ] **Latency for E10 (EVL-010).** Every approval row stores request and decision scenario + wall times and the acting humans, so approval latency is queryable separately from release latency.
- [ ] **Audit trail ("wire audit trace").** Given requests, approvals, returns and embargo cancellations, then `PressReleaseEvent` rows form an append-only audit visible to approvers and the author's org (display names, scenario time) and to staff in full; never edited, soft-delete only.
- [ ] **Isolation and no leaks (XC-001/002).** Approvers see only their routed orgs' pending releases; cross-exercise ids are 404; participant DTOs never expose approver wall-clock times or staff fields.
- [ ] **Controller bypass is audited (Q-E5-6).** Given a staff publish of a release that is `pending_approval`, then F04's `IContentPublishGate` (registered here) returns `Allow("controller bypass of pending approval")`, the funnel records it as `payload.gateNote`, a `PressReleaseEvent` audit row is written, and the pending approval is closed; no participant route can bypass.
- [ ] **Migration (M5).** One migration adds `PressReleaseEvent` and `PressApprovalSettings` (both `IExerciseScoped`, soft-deleted, behind the central filter), idempotent-script safe, merged **after M4 (F16)** per the ledger and regenerated against that snapshot.

## Out of Scope
The approval UI (10), the settings UI (14), notifications beyond the wire (D4-007 sign-off #3), multi-stage approval chains (single approval step only), approval of revisions to an already-published release (revise-own is immediate, PRS-005), staff-chrome approve controls (C-1).

## Technical Notes
Files: `Features/Press/Approval/**`, `Data/Entities/Press*.cs`, migration **M5**. Implements `IReleaseApprovalGate` (story 01), `IApprovalNotifier` (used by 05) and an `IContentPublishGate` (F04) for the audited staff bypass (Q-E5-6).

## Dependencies
Stories 01, 04; foundation F04. Can run with 05, 07, F15, F16, F17, F18, F19. Migration M5 is orchestrator-serialized after F16's M4 (ledger).

## Tests
Gate matrix (off/on/per-org), return-without-note, self-approval, diff correctness, authz (controller via participant route), migration test, isolation additions, wiring test.
