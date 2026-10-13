# Implementation: Easy participant login

> Decided with Tom on 2026-10-13 (interview brief, Looking Glass StartEx login triage, COR-017 / adversarial
> review A9). Must exist for the **Tue 10/20 demo**. **Backend freeze Thu 10/15 EOD**; frontend freeze
> Mon 10/19. Every backend Must story is sized to finish by the freeze. Frontend runs mock-first behind the
> axios client against the **frozen wire contract below** and does not wait for the backend.
>
> This file holds, in order: [decisions](#decisions-el-n) · [conflicts found and how they were resolved](#where-the-brief-met-the-code) ·
> [frozen wire contract](#frozen-wire-contract) · [per-story tech notes](#per-story-tech-notes) · [reuse map](#reuse-map) ·
> [gotchas](#gotchas-that-will-bite-a-parallel-builder) · [wave plan](#wave-plan-dag-ready) · [integration seam](#integration-seam-orchestrator-owned-never-a-wave-story) ·
> [risks](#risks).

## Decisions (EL-n)

| # | Decision | Why |
|---|---|---|
| EL-1 | **Words.** *Sign-in name* = the existing `Account.Username` (no new column; unique per exercise, case-insensitive). *Persona handle* = `Persona.Handle` (in-fiction, public). They are different things and are never the same string by construction. In the roster CSV, `role` is a **free-text label** ("EOC Liaison"), not an `ExerciseRole`; the account's `ExerciseRole` is derived (`pio` when bound to an org persona, else `participant`). | The legacy CSV used `role` for the ExerciseRole vocabulary (`participant`/`pio`). The brief's `role` is a job label. Keeping them apart avoids a second meaning of one column name. A visible persona handle must not double as the sign-in name, or every participant could read every other participant's sign-in name off the feed. |
| EL-2 | **One new staff API, `/api/staff/roster*`.** The legacy `POST /api/staff/accounts` and `/accounts/import` stay as they are (no regression, password accounts still work). | Roster rows need persona, link and idempotency semantics the legacy import does not have, and the legacy CSV leaves no persona (no composer). |
| EL-3 | **CSV import applies per row, reports per row, and supports `?dryRun=true`.** Valid rows commit in one `SaveChanges`; failed rows are listed with a reason and write nothing. Re-upload is **idempotent**: a row is matched to an existing participant by identity key `signInName` > `email` > `name + agency` (case-insensitive, normalised) and reported `unchanged` / `updated`, never duplicated. An empty cell never clears a stored value. | Matches the existing import (`AccountProvisioningService.ImportAsync`: partial success). All-or-nothing would let one typo in row 80 block 79 people at StartEx; idempotency makes "fix the row and upload the whole file again" safe, and dry-run gives a no-write preview. |
| EL-4 | **Personas.** A row naming `personaHandle` binds that persona, which must exist **in this exercise** and be `Kind = org` (COR-018). Any other row gets an **auto-created citizen persona**: `Kind = human`, `PersonaType = citizen`, `Verified = false`, `AudienceBand = nano`, and **`Castable = false`**. | `Castable = false` is load-bearing: otherwise the engine can write as a real participant. `scripts/uat/New-DemoParticipant.ps1` already warns about exactly this ("the engine posting under their own name"). Restricting a named binding to org personas keeps seeded citizen personas, which the engine voices, out of participant hands. |
| EL-5 | **Personal link token.** 128 random bits, base64url (22 chars). Stored as a SHA-256 hash for lookup (`SessionTokens.Hash`) **and** an ASP.NET Data Protection-encrypted copy so staff can reprint and copy the same link. One `ParticipantLink` row per account. Revoke clears the encrypted copy. If the key ring is lost and the copy cannot be decrypted, the row reports `needsReissue` (never a 500). | Tom's decision is "reprintable, because cards get lost", and "Copy link" in the console needs the link at any time, so show-once is out. Data Protection needs no new package and no new secret; on App Service its default key ring lives under `$HOME`, which is persisted storage (confirm on UAT with one reprint after a restart). The graceful `needsReissue` path makes a lost key ring an inconvenience, not an outage. |
| EL-6 | **The join URL is built from `Authentication:FrontendBaseUrl`** (the SPA origin, `https://pulse-uat.cobrasoftware.com` in UAT), **not** from `Exercise.Hostname`. When unset, links are unavailable (`joinLinksAvailable: false`), never guessed. | In UAT the exercise `Hostname` is the **API** host (`app-pulse-api-uat-dynamis.azurewebsites.net`), while participants open the **SPA** host. The setting already exists (CORS uses it) and is provisioned by `webapp.bicep`. |
| EL-7 | **`POST /api/auth/join { token }`** is a sibling of `/auth/login`, same success envelope. The token travels in the POST **body**, never in an API URL. The SPA route `/join/:token` reads it, immediately rewrites the address bar, and sends `Referrer-Policy: no-referrer` and `Cache-Control: no-store` for `/join/*`. | Keeps the credential out of API access logs and the browser history, and out of `Referer`. |
| EL-8 | **Revoke and reissue end all of that participant's live sessions** (explicit `ExerciseId` + `AccountId` predicate on `Session`, which is not `IExerciseScoped`). **Disable** is the person-level revoke: `Account.DisabledAt` set, sessions ended, and the link, the word and the password sign-in all refuse that account. | Tom: "revoking a link or the person must end their sessions". A link revoke alone would leave the person able to walk back in with the word, so "the person" needs its own switch. |
| EL-9 | **Day word.** One word per exercise per **calendar date in the exercise time zone**; "today" is the real wall-clock date there (scenario time is for the fiction and is never used). Stored hashed (`ISharedCredentialHasher`, PBKDF2) and **shown to staff once**, at set/generate time. Normalised before hashing (NFKD, accents stripped, lower-case, ASCII `a-z0-9` only; so `Café-7` → `cafe7`), 6 to 64 characters after normalisation. Every client hint (stories 09, 11) applies exactly this rule. The word is verified **before** the sign-in name is looked up, and every failure is the same 401. **No exercise-wide lockout**; only the per-IP limiter. | A hashed word cannot be shown again, so "forgot it" means rotate. An exercise-wide failed-attempt lockout (the shared-credential design) would let anyone with a script lock **all** participants out at StartEx. Word-first verification means a guesser needs the word and a real name at once and learns nothing from either alone. |
| EL-10 | **Day-long sessions.** The access token stays 60 min (COR-012: short-lived with refresh). For `participant`-kind sessions the **refresh window ends at the end of the exercise day** (exercise-TZ midnight plus a configurable rollover hour, default 0), recomputed on each refresh, so a session can never slide past the day. The SPA persists participant tokens in `localStorage`; **staff stay in `sessionStorage`**. | Today's refresh window is a sliding 12 h that renews on every refresh, so a session never ends "at end of day" and, in `sessionStorage`, dies with the tab. Both ends need fixing. Staff tokens are higher privilege and keep the smaller XSS blast radius that `tokenStore.ts` chose on purpose. |
| EL-11 | **EndEx.** Enforced by what already exists: the lifecycle gate returns 403 on participant routes outside Staged/Live/Paused, and the two new sign-in routes refuse (uniform 401) outside Staged/Live/Paused. Refresh is deliberately **not** changed. | Refusing refresh at `completed` would bounce participants off the COR-054 EndEx overlay they are meant to see. |
| EL-12 | **QR is generated on the server** with the **QRCoder** NuGet package (MIT), `SvgQRCode` only (pure managed; the `System.Drawing` renderers are Windows-only). The API returns an SVG **data URI** per card and the page shows it in an `<img>`. **No npm dependency is added.** | The frontend may not add npm packages this week. A data URI in an `<img>` needs no `dangerouslySetInnerHTML`, and an SVG loaded as an image cannot run script. |
| EL-13 | **Who may use the roster API:** a staff session assigned to the active exercise (`EngineCockpitStaffAuthorizationFilter`) **and** holding `controller` or `planner` there (new `RosterStaffRoleFilter`). Evaluators and org admins get 403. | The legacy accounts endpoints accept any live staff session (a documented gap on story 02). These endpoints hand out sign-in credentials, so they are tighter from day one. |
| EL-14 | **Where the roster lives.** A new staff-registry surface `participant-admin` at `/staff/participant-admin` (`group: 'administer'`, `allowedRoles: ['planner','controller']`), composed from a page plus optional slots (day word, cards, email). It is the "full participant-admin surface" the staff-shell flyout has been waiting for (see `identity-auth-roles/08`). The code lives in `features/participantAdmin/`: **staff world despite the name**, so it is deliberately not one of the participant roots that `staffShell/twoWorldsSeparation.test.ts` scans, and story 10 adds it to that test's forbidden-import list so a participant surface can never import it. | One registry entry, per `staffRouteRegistry.tsx`. A planner-only settings section would lock controllers out of the one screen they need at StartEx. |
| EL-15 | **Card sheet** renders into a print-only portal outside `#root` and hides `#root` under `@media print`. Neutral black-on-white print styling, a "training exercise" line, no COBRA chrome, no in-fiction branding. | The staff shell is a fixed-height `overflow: hidden` flex column; printed as-is it would print one screen. A portal sidesteps it. The card is a logistics artifact handed to participants, so it is neither COBRA nor fiction. |
| EL-16 | **Rate limits get dedicated, config-driven policies** (`easy-login-join` default 30/min/IP, `easy-login-word` default 10/min/IP), not the shared `participant-login` bucket. See the forwarded-headers note under [conflicts](#where-the-brief-met-the-code). | The token is 128-bit, so brute force is not a concern for join, only load. The word is guessable, so it keeps the 10/min Tom asked for. Config lets operators raise either without a deploy. |
| EL-17 | **Collision control for parallel builders.** (a) Story 01 owns the **only** migration. (b) Story 01 owns the **only** new `Exercises` read (`ExerciseFactsReader`, +1 to the pinned `ResolvedScope` count in `OrganizationScopeSweepTests`); stories 02 to 06 read exercise facts through it. (c) The two new pre-auth routes and the pinned `11` in the two anonymous-access tests change **once**, in the orchestrator seam commit. | The repo pins these (migration snapshot, org-scope-exempt inventory, the allowlist size). Four builders editing them in parallel would conflict every time. |
| EL-18 | **Email is a Could, dark by default.** No migration. Absent `Email:Endpoint` the endpoint answers 503 and `capabilities.emailLinks` is `false`. Nothing else depends on it, and it may merge after the freeze. | Tom: lowest priority, must not block the rest. |
| EL-19 | **Tom's answers to the open questions (2026-10-13).** (a) Rotating the word **only blocks new sign-ins**; sessions already signed in with the old word stay (staff revoke or disable a person). (b) The planner's legacy "Import accounts" section **stays** beside the new roster screen. (c) The exercise day ends at **midnight in the exercise time zone** (`DayRolloverHour` default 0). (d) The forwarded-headers / per-room rate-limit fix is **post-demo** (filed as a security follow-up); the demo and the 4-5 testers are far under the limits. | Recorded so builders and reviewers treat these as decided. |

## Where the brief met the code

Everything below was a mismatch between the interview brief and what the repository does today. Each is resolved in the stories; the ones that need Tom's call are repeated in the report.

| # | Brief said | Code / requirements say | Resolution |
|---|---|---|---|
| C-1 | "Keep the existing per-IP login rate limit." | `participant-login` is 10/min per `RemoteIpAddress`. Behind Azure App Service that is the platform proxy's address (see the comment above `UseRateLimiter()` in `Program.cs`; no forwarded-headers handling exists), so the "per-IP" bucket is **one global bucket: 10 sign-ins a minute for the whole platform**. A real room of 100 behind one NAT hits the same wall even with forwarded headers. | New dedicated policies, default word 10/min as asked, join 30/min, both **config-driven** (EL-16). Forwarded headers stay a `/security-review` deploy item, called out as an open question. For the 5-person stress test this is fine; for a real StartEx it is not. |
| C-2 | "Per-brand participant skin" on `/join` and the sign-in page. | `/api/brand-tokens` is behind the default-deny gate (needs a session), and `GET /api/exercise-context` exposes only name/time zone/status. Pre-session pages cannot fetch brand tokens. | Both pages use the existing brand-neutral consumer skin (`ParticipantSignInPage.module.css`) plus the exercise name; never COBRA. The participant shell applies the exercise brand after sign-in. A branded pre-login skin needs brand tokens on the pre-auth allowlist: a follow-up, not this week. |
| C-3 | "Bicep in `infra/`", "no email service today". | The folder is `infrastructure/`. `modules/communication.bicep` (ACS + Email Service + Azure-managed domain), the `deployCommunication` toggle and `Email__*` app settings already exist, but are **keyed** (`emailConnectionString`) and nothing in the API reads them. | Story 13 reuses the module, switches to keyless (managed identity role assignment), and adds `Email__Endpoint`. |
| C-4 | "Staff-only (planner/controller roles, check what exists)." | `/api/staff/accounts*` is gated on "any live staff session". There is a reusable assigned-staff filter and a controller-only filter, but nothing admits controller **or** planner. | New `RosterStaffRoleFilter` (EL-13). The legacy gap is unchanged and is noted, not fixed here. |
| C-5 | CSV column `role`. | Legacy `role` = `ExerciseRole` (`participant`/`pio`). | EL-1: new `role` is a free-text label; accepts legacy aliases `displayName` and `username` so an old file still imports. |
| C-6 | "Sessions last until end of day." | Refresh is a sliding 12 h window, renewed on every refresh. `tokenStore` is `sessionStorage`, so a closed tab ends the session regardless. | Stories 06 and 07 (EL-10). If 06 slips, the existing 12 h window is an acceptable degraded demo behaviour; 07 is the part testers will feel. |
| C-7 | The word is "stored hashed" and the card has a "today's-word slot". | A hash cannot be shown again. | The word is shown once at set time; the card carries a **blank slot** to write or sticker the announced word. Forgot it: rotate. |
| C-8 | New sign-in paths "same 401-without-detail". | `/auth/login` does not check lifecycle state; the lifecycle gate covers participant data routes only. | New routes also refuse outside Staged/Live/Paused (EL-11). `/auth/login` is unchanged; the inconsistency is noted. |
| C-9 | No epic requirement covers personal links, day words or card sheets. | The epics are the source of truth for requirement wording. | Stories cite the requirements they serve (COR-011, COR-012, COR-017 in part, COR-018) and the EL-n decisions here. **Proposed** new requirement text is in the report for Tom to add to `docs/01`; nothing in the epics was edited. |

## Frozen wire contract

> **Frozen when this file merges.** Frontend stories build mocks against it; backend story 01 turns it into
> `Features/Identity/EasyLogin/EasyLoginDtos.cs`. A change is an orchestrator decision, made in this file
> first. All JSON is camelCase; an absent optional field is **omitted, never `null`**; all instants are ISO-8601
> (`"O"` round-trip); `date` is `yyyy-MM-dd`. No request carries an `exerciseId`: the server scopes everything
> (COR-001). A cross-exercise id is **indistinguishable from an unknown id** (same status, body and timing class).

### Routes

Staff routes need a live **staff** session assigned to the active exercise, holding **`controller` or `planner`** there (`EngineCockpitStaffAuthorizationFilter` then `RosterStaffRoleFilter`): 401 no staff session or no scope, 403 not assigned or wrong role. Staff responses send `Cache-Control: no-store`. 400/404/409 bodies are ProblemDetails with a readable `detail`.

| Method + route | Body / query | Success | Errors | Story |
|---|---|---|---|---|
| `GET /api/staff/roster` | none | 200 `RosterListDto` | 401 · 403 | 02 |
| `POST /api/staff/roster` | `RosterRowWrite` | 201 `RosterEntryDto` | 400 · 409 (key already on the roster) | 02 |
| `POST /api/staff/roster/import?dryRun=true\|false` | multipart `file` (CSV, 1 MB, 5000 rows) | 200 `RosterImportResultDto` | 400 (not CSV, empty, oversized, bad header, too many rows) | 02 |
| `POST /api/staff/roster/{id}/link/reissue` | none | 200 `RosterActionResultDto` | 404 | 03 |
| `POST /api/staff/roster/{id}/link/revoke` | none | 200 `RosterActionResultDto` | 404 | 03 |
| `POST /api/staff/roster/{id}/disable` | none | 200 `RosterActionResultDto` | 404 | 03 |
| `POST /api/staff/roster/{id}/enable` | none | 200 `RosterActionResultDto` | 404 | 03 |
| `GET /api/staff/roster/cards?id={id}&id={id}…` | optional repeated `id` (none = every eligible participant); at most 500 | 200 `RosterCardsDto` | 400 (over 500) · 409 (join base not configured) | 04 |
| `GET /api/staff/day-word` | none | 200 `DayWordStatusDto` | | 05 |
| `PUT /api/staff/day-word` | `DayWordPutBody` | 200 `DayWordSetResultDto` | 400 | 05 |
| `DELETE /api/staff/day-word?date=yyyy-MM-dd` | optional `date` (default today) | 204 (idempotent) | 400 | 05 |
| `POST /api/staff/roster/email-links` | `{ participantIds?: string[] }` (none = all eligible, at most 100) | 200 `RosterEmailResultDto` | 400 · 503 (email not configured) | 13 |
| `POST /api/auth/join` | `{ token }` | 200 `LoginEnvelope` | 400 (missing body/field) · 401 (everything else, no detail) · 429 | 03 |
| `POST /api/auth/word` | `{ signInName, word }` | 200 `LoginEnvelope` | 400 (missing/oversized field) · 401 (everything else, no detail) · 429 | 05 |

`{id}` is the participant's **account id** (`RosterEntryDto.id`), declared `{id:guid}` so a malformed id is a 404 like an unknown one. The two `/api/auth/*` routes are **pre-auth**: marked `.AllowAnonymousPreAuth()` and added to `PreAuthAllowlist` (integration seam), with `WithLoginBodyLimit()`.

### Types

```ts
// src/frontend/src/features/participantAdmin/**  ⇄  src/Pulse.WebApi/Features/Identity/EasyLogin/EasyLoginDtos.cs

// ---------------------------------------------------------------- roster (staff)
export type RosterLinkStatus = 'active' | 'revoked' | 'none'

export interface RosterPersonaDto {
  id: string
  handle: string                      // persona handle, stored without '@'
  displayName: string
  kind: 'human' | 'org'
  autoCreated: boolean                // true = the citizen persona the roster made for this person
}

export interface RosterLinkDto {
  status: RosterLinkStatus
  issuedAt?: string
  revokedAt?: string
  lastUsedAt?: string
  useCount: number
  joinUrl?: string                    // SECRET. Only when status === 'active' and the token is recoverable
  needsReissue?: boolean              // active, but the stored token cannot be decrypted (key ring lost)
}

export interface RosterEntryDto {
  id: string                          // Account id
  name: string                        // Account.DisplayName
  agency?: string
  role?: string                       // free-text job label. NOT an ExerciseRole
  email?: string                      // staff-only (XC-002): never on any participant projection
  signInName: string                  // Account.Username
  exerciseRole: 'participant' | 'pio'
  persona?: RosterPersonaDto          // omitted when the account has no persona
  link: RosterLinkDto
  access: 'enabled' | 'disabled'
  liveSessions: number                // sessions not revoked and still usable (access window or refresh window open)
  lastSignInAt?: string               // Account.LastLoginAt
  createdAt: string
}

export interface RosterListDto {
  participants: RosterEntryDto[]
  joinLinksAvailable: boolean         // false when Authentication:FrontendBaseUrl is unset
  capabilities: { emailLinks: boolean }   // false until story 13 is configured
}

export interface RosterRowWrite {
  name: string                        // required, 1..256, sanitized
  agency?: string                     // <= 128
  role?: string                       // <= 128
  email?: string                      // <= 254, simple address check
  personaHandle?: string              // an ORG persona in this exercise; '@' tolerated
  signInName?: string                 // ^[a-z0-9][a-z0-9._-]{2,31}$ after trim + lower-case
}

export type RosterRowStatus = 'created' | 'updated' | 'unchanged' | 'failed'

export interface RosterImportRowDto {
  rowNumber: number                   // 1-based data row, header not counted
  name: string
  signInName?: string                 // the name the row resolved to (derived or given), when known
  status: RosterRowStatus
  personaHandle?: string              // the persona the row ended up bound to
  personaCreated: boolean             // an auto citizen persona was created for this row
  message?: string                    // reason when failed; what changed when updated
}

export interface RosterImportResultDto {
  dryRun: boolean
  totalRows: number
  createdCount: number
  updatedCount: number
  unchangedCount: number
  failedCount: number
  rows: RosterImportRowDto[]
}

export interface RosterActionResultDto {
  participantId: string
  link: RosterLinkDto
  access: 'enabled' | 'disabled'
  sessionsEnded: number
}

// ---------------------------------------------------------------- cards (staff)
export interface RosterCardDto {
  participantId: string
  name: string
  agency?: string
  role?: string
  signInName: string
  joinUrl: string                     // SECRET
  qrSvgDataUri: string                // 'data:image/svg+xml;base64,…' encoding exactly joinUrl
}
export type RosterCardSkipReason =
  'notFound' | 'noActiveLink' | 'disabled' | 'tokenUnrecoverable'
export interface RosterCardsDto {
  exerciseName: string
  cards: RosterCardDto[]
  skipped: { participantId: string; reason: RosterCardSkipReason }[]
}

// ---------------------------------------------------------------- day word (staff)
export interface DayWordStatusDto {
  timeZone: string                    // IANA, the exercise time zone
  today: string                       // 'yyyy-MM-dd' in that zone
  todayEndsAt: string                 // the next local rollover, as an instant
  todaySet: boolean
  setAt?: string
  setByName?: string
  replacedCount: number               // times today's word was replaced after it was first set
  upcoming: { date: string; setAt: string }[]   // words pre-set for later dates (never the words)
}
export interface DayWordPutBody {
  word?: string                       // omit = the server generates one
  date?: string                       // today (default) up to 14 days ahead; never the past
}
export interface DayWordSetResultDto {
  date: string
  word: string                        // SECRET. Plaintext, returned this once and never stored or re-readable
  generated: boolean
  replaced: boolean                   // true = this replaced a word already set for that date (rotation)
  setAt: string
  validUntil: string                  // the rollover instant that ends that date
}

// ---------------------------------------------------------------- email (staff, story 13 only)
export interface RosterEmailResultDto {
  results: { participantId: string; status: 'sent' | 'skipped' | 'failed'; reason?: string }[]
}

// ---------------------------------------------------------------- participant sign-in (anonymous)
// POST /api/auth/join  { token }              POST /api/auth/word  { signInName, word }
// Both answer exactly what POST /api/auth/login answers today (ParticipantLoginResponseDto):
export interface LoginEnvelope {
  token: string
  refreshToken: string
  session: {
    exerciseId: string
    accountId: string
    role: 'participant' | 'pio'
    personaId?: string                // omitted when the account has no persona
    actingHumanId: string
    isReadOnly: false
    expiresAt: string                 // wall clock; for a participant, at most the end of the exercise day
  }
}
```

### Roster CSV (story 02 parses it, story 10 shows the template)

UTF-8 (a BOM is tolerated), comma-separated, optional double-quote wrapping, one header row, header names case-insensitive, unknown columns ignored, blank lines skipped, at most 5000 rows and 1 MB.

| Column | Required | Aliases | Meaning |
|---|---|---|---|
| `name` | yes | `displayName` | Participant's name. Becomes `Account.DisplayName` (and the auto persona's display name). |
| `agency` | no | | Free text, shown in the roster and on the card. |
| `role` | no | | Free-text job label, shown in the roster and on the card. |
| `email` | no | | Staff-only. Used for the identity key and for story 13. |
| `personaHandle` | no | `persona` | An **org** persona in this exercise (`FulcoEM` or `@FulcoEM`). Blank = auto-create a citizen persona. |
| `signInName` | no | `username` | Explicit sign-in name. Blank = derived. |

Template: `name,agency,role,email,personaHandle,signInName`.

### Derivation and matching rules (frozen; story 02 implements, story 10 explains them to staff)

* **Derived sign-in name:** ASCII-fold the name (strip diacritics), lower-case, drop suffixes `jr sr ii iii iv md phd`, then first initial of the first word + last word, letters and digits only, at most 32 characters. `Jane Smith` → `jsmith`; `Mary-Ann O'Neil` → `moneil`; `José Álvarez` → `jalvarez`; `Madonna` → `madonna`; `Ng` → `ng1` (a derived name under 3 characters gets `1` appended). On a collision with an existing account **or an earlier row in the same file**, the smallest free integer from 2 is appended: `jsmith2`. An explicit `signInName` is never altered: invalid or taken means that row fails.
* **Auto persona handle:** the full name as a slug, `[a-z0-9_]` only, at most 30 characters: `Jane Smith` → `jane_smith`; on a collision with any persona in the exercise (case-insensitive, with or without a leading `@`) or an earlier row, `_2`, `_3`, and so on.
* **Identity key** (idempotency): `signInName`, else `email`, else `name + agency`. The comparison is case-insensitive and whitespace-normalised. A second row in the same file with the same key fails ("duplicate of row N; give a signInName to tell them apart"). A row matching an existing participant is `updated` if agency, role, email, display name (only when matched by `signInName` or `email`) or the org-persona binding changed, otherwise `unchanged`. A blank `personaHandle` on re-upload keeps the current persona.
* **ExerciseRole:** `pio` while bound to an org persona, otherwise `participant`.

### Telemetry (XC-004, all `channel: 'system'`, v0 envelope, same unit of work as the mutation)

| Event type | When | Actor | Target | Payload |
|---|---|---|---|---|
| `login` | join or word sign-in, success | `participant`, `participantId` = account id | none | `{"outcome":"success","method":"link"\|"word"}` |
| `login` | join or word sign-in, failure | `system`, no identity | word: `{entityType:"accountHandle", entityId:<sanitized attempted name>}`; link: none | `{"outcome":"failure","method":"link"\|"word"}` |
| `participant.link.issued` / `.reissued` / `.revoked` | staff action, or first issue at provisioning | `system` + staff `role` + `actingHumanId` = staff user id | `participantLink`, link id | `{"accountId":"…","sessionsEnded":n}` |
| `participant.disabled` / `.enabled` | staff action | as above | `account`, account id | `{"sessionsEnded":n}` |
| `roster.imported` | import (not dry-run) | as above | none | `{"created":n,"updated":n,"unchanged":n,"failed":n}` |
| `roster.cards.generated` | cards endpoint | as above | none | `{"count":n}` |
| `credential.rotated` | day word set or replaced | as above | `dayWord`, row id | `{"date":"yyyy-MM-dd","first":bool,"generated":bool}` |
| `credential.revoked` | day word cleared | as above | `dayWord`, row id | `{"date":"yyyy-MM-dd"}` |
| `participant.link.emailed` | story 13, one per send | as above | `participantLink`, link id | `{"outcome":"sent"\|"failed"}` |

**Never in telemetry, logs, or any error body:** a raw link token, a word (set or attempted), an email address, a join URL. Scenario time is `IExerciseClock.CurrentScenarioTime(id) ?? Exercise.CurrentScenarioTime ?? now`, as `InjectQueueService` does.

### Configuration

| Key | Default | Used by |
|---|---|---|
| `Authentication:FrontendBaseUrl` | (existing; set in UAT) | join URL base, 01 |
| `Authentication:EasyLogin:JoinPermitPerMinute` | 30 | 03 |
| `Authentication:EasyLogin:WordPermitPerMinute` | 10 | 05 |
| `Authentication:EasyLogin:DayRolloverHour` | 0 (allowed 0 to 6) | 05, 06 |
| `Authentication:EasyLogin:MaxCardsPerRequest` | 500 | 04 |
| `Authentication:Session:ParticipantDayLong` | `true` | 06 |
| `Email:Endpoint`, `Email:SenderAddress` | unset (feature dark) | 13 |

## Per-story tech notes

| Story | Approach | Key files it owns | Exports (that others import) |
|---|---|---|---|
| 01 Foundation (BE) | Entities, one migration, options, frozen DTOs, and the small shared kernel the other five backend stories import, so none of them has to touch a shared file. | `Data/Entities/{ParticipantLink,ExerciseDayWord}.cs`, `Account.cs` (additive), `PulseDbContext.cs` (DbSets + model config only), the migration, `Features/Identity/EasyLogin/**` | `EasyLoginDtos`, `EasyLoginOptions`, `ParticipantLinkTokens`, `IParticipantLinkTokenProtector`, `JoinUrlBuilder`, `ExerciseDay`, `ExerciseFactsReader`, `EasyLoginTelemetry`, `ParticipantSessionRequests`, `RosterStaffRoleFilter`, `IParticipantLinkIssuer`, `RosterLinkDtoFactory`, `AddEasyLoginFoundation()` |
| 02 Roster (BE) | CSV parse, per-row validation, derive names, upsert on the identity key, create the auto persona, list. Links are issued through `IParticipantLinkIssuer`. | `Features/Identity/Roster/**` | `AddRoster()` / `MapRosterEndpoints()` |
| 03 Personal links (BE) | Real `IParticipantLinkIssuer`, `POST /api/auth/join`, staff revoke/reissue/disable/enable, session termination, the disabled-account check in password login. | `Features/Identity/PersonalLinks/**`, `Accounts/ParticipantLoginService.cs` (the disabled check only) | `AddPersonalLinks()` / `MapPersonalLinkEndpoints()` |
| 04 Cards + QR (BE) | Read active links, decrypt, render one SVG data URI each. | `Features/Identity/LinkCards/**` | `AddLinkCards()` / `MapLinkCardEndpoints()` |
| 05 Day word (BE) | Staff set/get/clear, generator, normaliser, and the `POST /api/auth/word` login. | `Features/Identity/DayWord/**` | `AddDayWord()` / `MapDayWordEndpoints()` |
| 06 Day-long sessions (BE) | Participant refresh window and access expiry capped at the end of the exercise day. | `Sessions/{SessionIssuer,SessionService,SessionOptions}.cs` | none |
| 07 Token persistence (FE core) | Participant tokens in `localStorage`, staff in `sessionStorage`; refresh keeps the mode; cross-tab refresh race closed. | `core/auth/tokenStore.ts`, `core/services/api.ts`, their tests | `setTokens(pair, { persist? })` |
| 08 Join page (FE) | `/join/:token`: exchange once, scrub the URL, store, redirect. | `features/login/pages/JoinPage*`, `features/login/services/joinService*`, `public/staticwebapp.config.json` | `<JoinPage>`, `JOIN_PATH` |
| 09 Today's word sign-in (FE) | Third method on the sign-in page; existing flows now persist. | `features/login/pages/ParticipantSignInPage*`, `features/login/services/participantSignInService*` | `signInWithDayWord()` |
| 10 Roster screen (FE staff) | List, add, CSV import with dry-run, link actions, disable, selection; slots for day word, cards, email. | `features/participantAdmin/{pages,components/people,services,hooks,types.ts,mocks}`, `ParticipantAdminRoute.tsx`, `staffShell/twoWorldsSeparation.test.ts` (one forbidden pattern) | `<RosterPage>` (slot props), `ParticipantAdminRoute` |
| 11 Day word panel (FE staff) | Status, set/generate/rotate/clear, show-once, large-type display. | `features/participantAdmin/dayWord/**` | `<DayWordPanel>` |
| 12 Card sheet (FE staff) | Fetch cards, preview, print-only portal and print CSS. | `features/participantAdmin/cards/**` | `<PrintCardsButton selection>` |
| 13 Email (BE + infra, Could) | ACS Email via managed identity; Bicep; one send per participant. | `Features/Identity/LinkEmail/**`, `features/participantAdmin/email/**`, `infrastructure/**` | `AddLinkEmail()` / `MapLinkEmailEndpoints()`, `<EmailLinksButton>` |
| 14 UAT script | Staff sign-in, CSV upload, optional word, links to a local file. | `scripts/uat/Import-Roster.ps1`, a header note in `New-DemoParticipant.ps1` | none |

## Reuse map

Backend (`src/Pulse.WebApi`):

* **Sessions:** `ISessionIssuer` / `SessionIssueRequest`, mirror `ParticipantLoginService` step 7 (via `ParticipantSessionRequests`); `SessionTokens.Hash` for the link token hash; `ParticipantLoginResponseDto.From(issued)` for the success body; `SessionDto`. Do not fork them.
* **Pre-auth pattern:** `AccountEndpoints.MapAccountEndpoints` (`RequireRateLimiting`, `WithLoginBodyLimit`, `AllowAnonymousPreAuth`), `LoginRequestLimits`. Rate limiter registration: additive `services.AddRateLimiter(...)` as in `AddParticipantAccounts`.
* **Hashing:** `ISharedCredentialHasher` (PBKDF2, `Hash`/`Verify`/`VerifyDecoy`) for the day word. `SharedCredentialPasswordGenerator` is the model for the generator's unambiguous alphabet.
* **Staff gate:** `EngineCockpitStaffAuthorizationFilter` (assigned) + the new `RosterStaffRoleFilter` (model: `EngineCockpitControllerRoleFilter`, `OrgAdminAuthorizationFilter`). Staff identity: `ICurrentStaffSessionAccessor`, `StaffCallerContext`.
* **Revoke-sessions pattern:** `SharedCredentialLifecycleService.RevokeAsync` (explicit `ExerciseId` on the unscoped `Session` table).
* **CSV:** `AccountCsvParser` (`SplitLines`/`ParseLine` become `internal`), `AccountEndpoints.MaxImportFileBytes` and `IsCsvUpload`, `AccountFieldRules` (sanitize via `PostSanitizer`), `OpsPersonaResolver.TryNormalizeHandle`.
* **Personas:** `PersonaCastSeeder.DeriveAudienceMagnitude`, `Persona` defaults; unique index `IX_Personas_ExerciseId_Handle`.
* **Telemetry:** `TelemetryEvent`, `TelemetryActor`, `TelemetryTarget`, `TelemetryEnvelopeRules`; clock `IExerciseClock`. Model events on `SharedCredentialLifecycleService.BuildLifecycleTelemetry` and `ParticipantLoginService.BuildLoginTelemetry`.
* **Lifecycle:** `ExerciseLifecycleStates.IsParticipantAccessible`.
* **Staff names:** `_dbContext.StaffUsers.AsNoTracking().InOrganization(orgId)` (as `InjectQueueService`), never an unbounded `StaffUsers` read.
* **Credential for Azure SDKs (story 13):** the credential selection in `MediaEndpoints` (managed identity in Azure, `DefaultAzureCredential` in Development); `Azure.Identity` is already referenced by `Pulse.Core`.
* **Infra (story 13):** `infrastructure/modules/communication.bicep`, the `storage.bicep` role-assignment-to-`backendPrincipalId` pattern, the `Email__*` block in `webapp.bicep`.

Frontend (`src/frontend/src`):

* **HTTP:** `@/core/services/api` (base `/api`, so service paths are `/auth/join`, `/staff/roster`). **Mock-first:** `USE_MOCK_DATA` from `@/core/config/mockData`; follow `features/planner/services/accountImportService.ts` (mock adapter, typed error class, runtime guards).
* **Auth:** `@/core/auth` (`setTokens`, `clearTokens`, `endSession`, `useSession`), `tokenStore.ts`.
* **Participant pages:** the CSS Module and structure of `features/login/pages/ParticipantSignInPage.tsx` (labels, `role="alert"`, `role="status"`, `faTriangleExclamation`), `participantSignInService.ts` (`ParticipantSignInError`, `isUnauthorizedSignInError`, `LoginEnvelope`), `resolveExerciseContext` for the exercise name. **No `@mui/material`, no `@/theme/*`.**
* **Staff screens:** `StaffShellFrame` / `StaffHeader` / `Toolstrip` / `ToolstripProvider` (as in `PlannerWorkspaceRoute.tsx`), `@/theme/styledComponents` (`CobraPrimaryButton`, `CobraSecondaryButton`, `CobraDeleteButton`, `CobraLinkButton`, `CobraTextField`), `CobraStyles`, MUI `Dialog`/`Table` under the COBRA theme the frame mounts, `react-toastify` (`toast`), `@tanstack/react-query`, FontAwesome.
* **Registry:** `features/staff/staffRouteRegistry.tsx` (one entry), `StaffRouteEntry` in `app-shell/staffRouting.ts`.
* **No new npm package.** Anything that looks like it needs one (QR, CSV, clipboard, print) does not; see EL-12 and the stories.

## Gotchas that will bite a parallel builder

1. **`Program.cs` is orchestrator-owned.** Each backend story exposes `Add…()` / `Map…()` and never edits it.
2. **`PreAuthAllowlist` is a closed list with pinned counts.** `DefaultDenySessionGateTests` asserts the marked endpoints equal the allowlist and `AnonymousAccessRegressionTests` pins `11`. A new anonymous route without the matching allowlist entry fails closed (401 in production); one in the allowlist but not marked fails the equality test. Stories 03 and 05 mark their route; the **seam commit** does the list and the tests (EL-17).
3. **`OrganizationScopeSweepTests` pins the `ResolvedScope` exemption count.** Any new `_dbContext.Exercises` read needs a marker and a bump. Read exercise facts through `ExerciseFactsReader` (story 01 adds the one marker). Never add another `Exercises` read.
4. **`Session` is not `IExerciseScoped`.** Every session query by account or exercise needs the explicit `ExerciseId` predicate. Forgetting it is a cross-exercise bug, not a style point.
5. **Anonymous requests are scoped by `Host`.** `ExerciseResolutionMiddleware` resolves the exercise from the API host before the handler runs; `ParticipantLink` and `Account` lookups then run through the central filter. A token or name from another exercise is simply not found.
6. **Telemetry is validated on write.** `actor.kind = 'participant'` requires `participantId`; an identity-less failure is `system` (the #356 trap). Build events with `EasyLoginTelemetry`.
7. **One migration.** Story 01 only. If a downstream story thinks it needs a column, that is a contract change and goes back to this file.
8. **Do not log secrets.** No `ILogger` call, exception message or ProblemDetails may contain a token, word, join URL or email address.
9. **The SPA and API are different origins in UAT.** Join links and QR codes point at the SPA. The `/join` call goes SPA to API (CORS already allows the SPA origin).
10. **Safari only allows clipboard writes inside the click.** "Copy link" must use data already in memory (the list response carries `joinUrl`), not an `await fetch` first.
11. **React 19 StrictMode runs effects twice in development.** The join page's exchange must be guarded so it posts once.
12. **MUI 9: system props are `sx`-only.** FontAwesome only. COBRA on staff pages only.

## Wave plan (DAG-ready)

`Stack` tells the orchestrator which builder to spawn and which Gate-0 command to run. `Effort`: S ≤ 2 h, M ≤ half a day, L ≤ a day. **Priority** is MoSCoW for the demo.

| Story | Stack | Priority | Files it owns | Depends-on | Can-run-with | Wave | Effort |
|---|---|---|---|---|---|---|---|
| 01 Foundation | backend | Must | see per-story table | none | none (everything backend waits on it) | 0 | M |
| 02 Roster | backend | Must | `Features/Identity/Roster/**`, `Accounts/AccountCsvParser.cs` (visibility only), `Accounts/AccountEndpoints.cs` (`IsCsvUpload` visibility only) | 01 | 03, 04, 05, 06, 07, 10, 11, 12 | 1 | L |
| 03 Personal links | backend | Must | `Features/Identity/PersonalLinks/**`, `Accounts/ParticipantLoginService.cs` (disabled check) | 01 | 02, 04, 05, 06, 07, 10, 11, 12 | 1 | L |
| 04 Cards + QR | backend | Must | `Features/Identity/LinkCards/**` | 01 | 02, 03, 05, 06, 07, 10, 11, 12 | 1 | S |
| 05 Day word | backend | Must | `Features/Identity/DayWord/**` | 01 | 02, 03, 04, 06, 07, 10, 11, 12 | 1 | M |
| 06 Day-long sessions | backend | Must | `Sessions/{SessionIssuer,SessionService,SessionOptions}.cs` | 01 | 02, 03, 04, 05, 07, 10, 11, 12 | 1 | S |
| 07 Token persistence | frontend | Must | `core/auth/tokenStore.ts`, `core/services/api.ts` (+ tests) | contract only | all W1 | 1 | M |
| 10 Roster screen | frontend | Must | `features/participantAdmin/{pages,components/people,services,hooks,mocks,types.ts}`, `ParticipantAdminRoute.tsx`, `staffShell/twoWorldsSeparation.test.ts` (one forbidden pattern) | contract only | all W1 | 1 | L |
| 11 Day word panel | frontend | Must | `features/participantAdmin/dayWord/**` | contract only | all W1 | 1 | S |
| 12 Card sheet | frontend | Must | `features/participantAdmin/cards/**` | contract only | all W1 | 1 | M |
| 08 Join page | frontend | Must | `features/login/pages/JoinPage*`, `features/login/services/joinService*`, `public/staticwebapp.config.json` | 07 | 09, 14 | 2 | S |
| 09 Today's word sign-in | frontend | Must | `features/login/pages/ParticipantSignInPage*`, `features/login/services/participantSignInService*` | 07 | 08, 14 | 2 | S |
| 14 UAT script | script | Could | `scripts/uat/Import-Roster.ps1` (+ one header note in `New-DemoParticipant.ps1`) | backend seam deployed | 08, 09 | 2 | S |
| 13 Email delivery | backend + infra | Could | `Features/Identity/LinkEmail/**`, `features/participantAdmin/email/**`, `infrastructure/**` | 02, 03, 10 | none required | 3 (may slip past the freeze) | M |

**Why FE W1 does not wait for BE W0:** the contract above is frozen text. Each frontend story ships a mock adapter behind `USE_MOCK_DATA` and flips to the live API with no consumer change once the backend is deployed. **Why 08 and 09 are W2:** both call `setTokens(pair, { persist: true })`, which 07 introduces; they start the moment 07 merges and may overlap W1's tail.

### Calendar (today is Tue 10/13)

| When | What |
|---|---|
| Tue 10/13 | This feature merges to `main`. Backend W0 (story 01) builds. FE W1 builders can start. |
| Wed 10/14 | 01 merges (morning). **Backend W1 fan-out: 02 ∥ 03 ∥ 04 ∥ 05 ∥ 06.** FE W1 continues: 07 ∥ 10 ∥ 11 ∥ 12. |
| Thu 10/15 | Backend W1 Gate-1 and Gate-2 merges. **Orchestrator seam commit** (backend rows below). **Backend freeze EOD:** last deploy + reset. Anything backend not merged is out; story 13 is the only item allowed to land after, because it is additive, dark by default and has no migration. |
| Fri 10/16 to Sat 10/17 | FE W1 merges. FE W2 (08, 09). FE seam commit (routes, registry, slot composition). 14 (script). Mock-to-live check against UAT. |
| Sun 10/18 | Fix-ups. Manual UAT walk-through (see `feature.md`). |
| Mon 10/19 | Rehearsal; frontend freeze. |

### Integration seam (orchestrator-owned, never a wave story)

Every surface-adding story would touch these, so no builder owns them. The orchestrator edits them serially, between waves, in its own commit.

| Seam | File(s) | Rule |
|---|---|---|
| Backend composition root | `src/Pulse.WebApi/Program.cs` | After backend W1: `AddEasyLoginFoundation()`, `AddRoster()`, `AddPersonalLinks()`, `AddLinkCards()`, `AddDayWord()` and the matching `Map…()` calls, in one commit. `AddEasyLoginFoundation()` must be registered so that `AddPersonalLinks()` **replaces** the null `IParticipantLinkIssuer` (use `Replace`, as `AddSessions` does for the staff accessor). |
| Pre-auth allowlist | `Features/Identity/Sessions/PreAuthAllowlist.cs`, `…Tests/Features/Identity/Sessions/AnonymousAccessRegressionTests.cs` (`11` → `13`), `DefaultDenySessionGateTests.cs` (theory rows, "eleven" comments) | Same commit as `Program.cs`: add `POST /api/auth/join` and `POST /api/auth/word`. The two stories mark their route; this commit makes the list and the pinned counts agree. |
| Composition wiring test | `CompositionRootWiringTests` | Same commit: assert each new route is mapped exactly once on the real `WebApplicationFactory<Program>` host (the #310 to #317 lesson). |
| Frontend routes | `app-shell/routes.tsx`, `app-shell/constants.ts` | After 08: add `JOIN_PATH` and the `/join/:token` route beside `/login`. |
| Staff registry | `features/staff/staffRouteRegistry.tsx` | After 10: add the `participant-admin` entry (EL-14). `staffRouteRegistry.test.tsx` rules apply (unique id and path, path starts `/staff/`, `isDefaultFor ⊆ allowedRoles`). |
| Roster slot composition | `features/participantAdmin/ParticipantAdminRoute.tsx`, `features/participantAdmin/index.ts` | After 11 and 12 (and 13 if it lands): pass `<DayWordPanel/>`, `selection => <PrintCardsButton selection={selection}/>` and, only when `capabilities.emailLinks`, `<EmailLinksButton/>` into `<RosterPage>`. |

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Backend W0 (01) slips | Everything backend waits | 01 is mostly declarative. Cut line: if the Data Protection protector or telemetry helpers lag, 02/03/05 can start on entities + DTOs + interfaces alone (those land first inside 01). |
| Data Protection key ring not persisted or slot-swapped | Stored links cannot be decrypted | Graceful `needsReissue` (EL-5). Document in the UAT runbook: after a deploy that changes slots, reissue links. |
| Rate limit collapses to one global bucket behind App Service (C-1) | 10 sign-ins a minute for everyone | Config-driven limits (EL-16). Fine for the demo (5 testers); an open question before any real StartEx. |
| In-app browsers (Gmail, Outlook, Teams) open the link in a webview with separate storage | Session does not carry into the normal browser | Documented limitation. Re-tapping the link signs in again. QR via the phone camera opens the real browser. |
| Agency web filters block the SPA host (adversarial review A10) | Link and QR load nothing | Out of scope for this feature; same exposure as typing the URL today. |
| Four backend builders in one wave | Merge friction | EL-17 collision control; disjoint folders; only the seam commit touches shared files. |
| `localStorage` for participant tokens widens an XSS blast radius (NFR-004) | A stored script could read a participant token | Participant-only; staff unchanged; existing sanitizer + CSP posture; story 07 is Tier-2 reviewed. |
| Auto-created personas clutter the controller persona picker | Noise for controllers | `PersonaAutoCreated` lets a later change group or hide them; not fixed this week. |
