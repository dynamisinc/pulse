# Story: Email the personal link (Azure Communication Services)

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-011, COR-017 (part: delivering credentials), NFR-004, NFR-009  ·  **Design decisions:** none (EL-18, C-3 in `implementation.md`)  ·  **Issue:** #478
**Stack:** backend + infra (+ a small frontend slice)  ·  **Review:** Tier-2 (infrastructure identity, outbound email of credentials)  ·  **Priority:** **Could, last**  ·  **Wave:** 3  ·  **Effort:** M

> **This is the piece that may slip past the Thu 10/15 backend freeze, and nothing else may depend on it.**
> It adds **no migration**, is **dark until configured**, and the roster, cards, link and word paths work fully
> without it. If it is not finished for the demo, do not block the demo and do not remove anything: the roster
> already reports `capabilities.emailLinks: false` and renders no email action. Build it only after stories 01 to
> 12 are merged. If it lands after the freeze it must be a config-gated, additive deploy.

## Context

Tom: "Pulse sends email with the personal link." There is no email service today. What exists is groundwork that
was never finished: `infrastructure/modules/communication.bicep` (Azure Communication Services, an Email Service,
and an Azure-managed domain), the `deployCommunication` toggle (off in `uat.bicepparam`), and an `Email__*` block in
`webapp.bicep`. That groundwork is **keyed** (`emailConnectionString`) and **nothing in the API reads it**. Tom's
direction is keyless (managed identity), with the Azure-managed domain acceptable for UAT.

This story adds the send path (an endpoint that emails each selected participant their own link), the keyless
infrastructure, and the roster button that triggers it. A personal link is a bearer credential, so the email is
deliberately minimal.

## Acceptance Criteria

- [ ] **Given** `POST /api/staff/roster/email-links { participantIds? }`, **then** it sends one email per eligible
      participant (omitting the ids means everyone eligible, at most 100 per call; more is `400`) and answers
      `200 RosterEmailResultDto` with, per participant, `sent`, `skipped` (reason: `noEmail`, `noActiveLink`,
      `disabled`, `tokenUnrecoverable`, `notFound`, where `notFound` covers an id from another exercise identically)
      or `failed` (a generic reason). Sends are sequential with a short pause; **one failure never aborts the batch**,
      except the provider's `429`: no further send is attempted; the rest are `failed`/`rateLimited` with no event
      *(amended 2026-10-13, Gate-1 S-1)*.
      Behind `EngineCockpitStaffAuthorizationFilter` + `RosterStaffRoleFilter`, `Cache-Control: no-store`.
- [ ] **Given** `Email:Endpoint` is unset, **then** the endpoint answers `503` ProblemDetails ("Email delivery is not
      configured") and sends nothing, `GET /api/staff/roster` reports `capabilities.emailLinks: false`, and the host
      **starts normally** (no startup failure, no log noise). When configured, the capability is `true`.
- [ ] **Given** the sender, **then** it uses `Azure.Communication.Email` with `EmailClient(endpoint,
      credential)` where the credential is managed identity in Azure and `DefaultAzureCredential` in Development (the
      selection `MediaEndpoints` already makes). **No connection string or access key is read, stored or logged.**
- [ ] **Given** a message, **then** it has the subject "Your sign-in link for {exercise name}", an HTML body and a
      plain-text alternative, the participant's name **HTML-encoded**, the personal join link, the sign-in name (for the
      typed fallback), and one plain sentence of instruction. No images, no tracking pixels, no remote content, no
      other recipients (no cc/bcc), and the sender is `Email:SenderAddress` (the Azure-managed
      `DoNotReply@….azurecomm.net` address in UAT).
- [ ] **Given** a send attempt, **then** one `participant.link.emailed` event is recorded (`sent` / `failed`) with the
      staff actor and the link as target; **no email address, token or URL appears in any event, log line or response
      body**. Provider errors are logged with the operation and status only.
- [ ] **Given** the infrastructure, **then** `uat.bicepparam` sets `deployCommunication = true` *(amended 10/14, Tom: `false` until after the 10/20 demo; the code merges dark)*;
      `communication.bicep` grants the App Service's system-assigned identity the built-in role that allows sending on
      the Communication Service (**confirm the role against the current Microsoft Learn page on ACS Email with
      Microsoft Entra authentication and state the role and its id in the PR; least privilege, not Owner**) using the
      `storage.bicep` role-assignment pattern; `webapp.bicep` sets `Email__Endpoint` (from the Communication Service host
      name) and `Email__SenderAddress` (the managed-domain sender) and stops depending on `emailConnectionString`;
      `az bicep build --file infrastructure/main.bicep` is clean (the CI step), and `infrastructure/main.json` is
      regenerated if that is the repo's convention (`git log` shows it is). The README toggle table is updated.
- [ ] **Given** the frontend slice, **then** `<EmailLinksButton selection={ids} />` (mounted by the orchestrator into
      the roster's `renderEmailAction`, and only when `capabilities.emailLinks`) shows **Email links (N)**, confirms
      ("This emails each person a personal sign-in link. An emailed link can't be recalled; reissue it to cancel it."),
      calls the endpoint, and shows a result summary (counts by status and the reasons for skipped and failed). It is
      COBRA, mock-first against the frozen contract, and renders nothing when the capability is off.

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** participants are found under the central filter; an id from another exercise is
      `notFound` exactly as an unknown id; the exercise name in the subject comes from `ExerciseFactsReader`, not the
      request. Extends the standing suite.
- [ ] **Content security (NFR-004):** names are encoded for HTML and stripped of control characters for the plain
      text part and the subject; nothing user-supplied is placed in a header; the join URL is built by `JoinUrlBuilder`
      only. **Secrets (NFR-009):** keyless; no secret in config, Bicep output, logs or telemetry.
- [ ] **Accessibility (NFR-001) for the button/dialog:** keyboard-operable, `role="alertdialog"` confirm with focus
      management, results in an `aria-live` region, statuses text plus icon.

## Out of Scope

A custom or customer-managed email domain (the module supports it; UAT uses the managed one). Bounce handling,
delivery receipts, unsubscribe, templates in several languages, an email of the day word. Resending automatically. SMS.
Any change to how links are issued. Marking a participant "emailed" in the roster (would need a column, and this story
has no migration). Production sender reputation and DKIM tuning.

## Technical Notes

Backend + infra. New folder `Features/Identity/LinkEmail/`: `LinkEmailEndpoints` (`AddLinkEmail()` /
`MapLinkEmailEndpoints()`), `LinkEmailService`, `IParticipantLinkMailer` with an `AcsParticipantLinkMailer` and a
fail-closed `NullParticipantLinkMailer` when `Email:Endpoint` is unset (so the capability flag and the 503 come from one
place). Add the `Azure.Communication.Email` NuGet reference (`Azure.Identity` is already referenced by `Pulse.Core`).
Frontend: `features/participantAdmin/email/` (`EmailLinksButton`, service, mock, types). Infra: `communication.bicep`,
`webapp.bicep`, `main.bicep` (outputs/wiring), `parameters/uat.bicepparam`, `README.md`. **The `Deploy Infrastructure`
workflow is a manual human step** (it needs the deploy principal's role-assignment rights and a few minutes for the
role to propagate); note that in the PR. Managed-domain mail often lands in junk: test with a recipient you control and
check the junk folder before declaring it broken. See `implementation.md` (story 13, reuse map).

## Dependencies

Stories 02 and 03 (accounts with `Email`, active links), 10 (the roster slot). Infra: `deployCommunication` and a
human-run infrastructure deploy. **Nothing depends on this story.**

## Tests

`Pulse.WebApi.Tests/Features/Identity/LinkEmail/`: `LinkEmailServiceTests` (eligibility and each skip reason, a fake
mailer, one failure does not abort, the 429 exception `AfterTheFirst429_NobodyElseIsAttempted_TheyAreRateLimited_AndNothingIsRecordedForThem`,
no secrets in events/logs, HTML encoding of a hostile name), `LinkEmailEndpointsHttpTests`
(200/400/401/403/503, `no-store`), `LinkEmailIsolationTests` (`[RequiresDockerFact]`), `NullParticipantLinkMailerTests`
(startup with no config). `features/participantAdmin/email/*.test.tsx` (button hidden without the capability, confirm,
summary). Infra: `az bicep build` in CI. Manual: send to a controlled mailbox and tap the link (walk-through step 9).
