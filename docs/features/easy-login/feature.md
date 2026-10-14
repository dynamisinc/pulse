# Feature: Easy participant login

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.2 (extends `identity-auth-roles`; the COR-017 login-triage need)
**World:** both. Participant (the `/join` page and the sign-in page) and staff (the roster, the day word, the card sheet)  ·  **Issue:** #465
**Target:** Tue 10/20 demo. **Backend freeze Thu 10/15 EOD.** Decisions: [`implementation.md`](implementation.md) (EL-1 to EL-18).

## Summary

The first 30 minutes of every StartEx is login triage (COR-017, adversarial review A9), and typing a handle and a password on a phone is where it goes wrong. This feature gives each participant three ways in, all provisioned by staff from one roster, none requiring a self-registration page:

1. **A personal link or QR code.** One per person. Tap or scan it and you are signed in as yourself, with your persona and your composer. Valid until staff revoke or reissue it, or EndEx.
2. **Sign-in name plus today's word.** Staff set one word for the exercise day and read it out; each person types their short sign-in name (`jsmith`) and the word.
3. **A printed card.** Name, QR, link, sign-in name and a blank slot for the word, from the console, ready to hand out.

A participant then **stays signed in for the exercise day**: closing the tab and locking the phone do not sign them out. Staff add people by CSV roster or one at a time, see who has signed in, and revoke, reissue or disable from the same screen. An optional email of the personal link is the last, lowest-priority piece.

## Requirements covered

The epics have no requirement text for personal links, day words or card sheets (see conflict C-9 in `implementation.md`). The stories serve these existing requirements and cite the EL-n decisions for the rest.

* **COR-011** named participant accounts, staff-provisioned, no self-registration. *Still holds:* every path here signs in an account staff created. No anonymous route creates or changes an account.
* **COR-012** short-lived sessions with refresh, bound to one exercise and one account. *Preserved:* the access token stays 60 minutes; only the participant refresh window and where the SPA stores it change.
* **COR-017** participant admin panel / login triage. *Partly delivered* (see [below](#relationship-to-identity-auth-roles08-participant-admin-panel)).
* **COR-018** participants can operate org personas. A roster row naming an org persona handle binds it; per-human attribution is preserved because each person keeps their own account.
* **COR-008** per-exercise hostname (consumed: the API host still scopes the exercise), **COR-015/016** (unchanged: the view-only "Exercise code" stays as is).
* **NFR-009** abuse resistance (rate limits, uniform 401s), **NFR-001** accessibility, **NFR-004** content security, **XC-001/002** isolation and staff/participant separation, **XC-004** telemetry.

## Design references

* [`docs/design/D0-FOUNDATIONS.md`](../../design/D0-FOUNDATIONS.md) §2: the two worlds. Participant pages are a consumer-app skin and never COBRA; staff pages are COBRA and never confusable with a participant view.
* No design brief or `STORY-UPDATES.md` exists for login, so no D-series decision applies. (The pre-session pages cannot be per-exercise branded; see C-2.)
* Related: [`docs/features/staff-shell/03-participant-admin-flyout.md`](../staff-shell/03-participant-admin-flyout.md) (the flyout whose "full admin surface" link this roster becomes).

## Stories

`Priority` is MoSCoW for the 10/20 demo. `Wave` is from the [wave plan](implementation.md#wave-plan-dag-ready).

| # | Story | Stack | Priority | Wave | Depends on | Status | Issue |
|---|-------|-------|----------|------|------------|--------|-------|
| 01 | [Foundation: schema, shared kernel, frozen contract](01-foundation-schema-and-seams.md) | backend | Must | 0 | none | In Review | #466 |
| 02 | [Roster provisioning: CSV, add one, list, personas](02-roster-provisioning.md) | backend | Must | 1 | 01 | In Review | #467 |
| 03 | [Personal links: join, revoke, reissue, disable](03-personal-links.md) | backend | Must | 1 | 01 | In Review | #468 |
| 04 | [Link cards and QR codes](04-link-cards-and-qr.md) | backend | Must | 1 | 01 | In Review | #469 |
| 05 | [Day word: staff controls and word sign-in](05-day-word.md) | backend | Must | 1 | 01 | In Review | #470 |
| 06 | [Day-long participant sessions](06-day-long-sessions.md) | backend | Must | 1 | 01 | In Review | #471 |
| 07 | [Participant tokens survive a closed tab](07-fe-token-persistence.md) | frontend | Must | 1 | contract | In Review | #472 |
| 08 | [Join page: tap the link, you are in](08-fe-join-page.md) | frontend | Must | 2 | 07 | In Review | #473 |
| 09 | [Sign-in page: Today's word](09-fe-todays-word-sign-in.md) | frontend | Must | 2 | 07 | In Review | #474 |
| 10 | [Roster screen (staff)](10-fe-roster-screen.md) | frontend | Must | 1 | contract | In Review | #475 |
| 11 | [Today's word panel (staff)](11-fe-day-word-panel.md) | frontend | Must | 1 | contract | In Review | #476 |
| 12 | [Printable card sheet (staff)](12-fe-card-sheet.md) | frontend | Must | 1 | contract | In Review | #477 |
| 13 | [Email the personal link (Azure Communication Services)](13-email-delivery.md) | backend + infra | **Could** | 3 | 02, 03, 10 | Not Started | #478 |
| 14 | [UAT tester provisioning script](14-uat-roster-script.md) | script | Could | 2 | backend deployed | In Review | #479 |

**Story 13 is the piece that may slip past the freeze, and nothing else depends on it.** It adds no migration, is dark until configured, and the roster screen works fully without it. If it is not built, delete nothing: the `capabilities.emailLinks: false` flag and the unused slot already cover its absence.

## Relationship to `identity-auth-roles/08` (participant admin panel)

Story 08 (COR-017, Not Started) asks a controller to reset passwords, unlock accounts, force-logout sessions, reassign roles/affiliations and diagnose "wrong account" situations. This feature **implements part of it**, in a form that fits the new sign-in model:

| 08 asks for | Delivered here by | Left on 08 |
|---|---|---|
| Force-logout a session | 03: revoke, reissue and disable all end the participant's live sessions (and show the count) | |
| Reset a credential | 03 reissue-link, 05 rotate-the-word (a participant has no password to reset on the new paths) | Password reset for legacy password accounts |
| Diagnose "wrong account" | 02/10: the roster shows each person's persona binding, last sign-in, live sessions and link state in one table | A guided "who is this person signed in as" view |
| Reassign role/affiliation mid-exercise | 02: re-uploading a corrected CSV updates agency, role and org-persona binding in place | A single-participant edit form |
| Unlock an account | not needed: the new paths have no per-account lockout (EL-9) | Lockout for password accounts (`LockedOutUntil` is still reserved) |
| Audit-logged, staff-only, keyboard-operable, exercise-scoped | 02, 03, 05, 10 | |

08 stays **Not Started** as a story, with a scope note added to its file, because the toolstrip flyout wiring, password reset, unlock and the single-edit form remain. The roster route (EL-14) is the "full admin surface" the flyout's footer link is waiting for (see the note in `ParticipantAdminFlyout.tsx`); restoring that link is a one-line follow-up outside this feature.

## Dependencies

* **Already built, consumed unchanged:** `identity-auth-roles/02` (accounts), `/03` (session issuer, refresh, logout), `/11` (default-deny gate and pre-auth allowlist), `/12` (post attribution from the session persona); `exercise-isolation/08` (host resolves the exercise); `exercise-configuration/03` (lifecycle states); the engine personas seed (org personas to bind).
* **`login/`** (the sign-in page and UAT runbook) is extended, not replaced: story 09 edits `ParticipantSignInPage`.
* **`demo-polish` participant shell** supplies the post-sign-in landing and composer; nothing here changes it.
* **Infrastructure** (story 13 only): `deployCommunication`, a role assignment, an app setting.

## Design notes

* **Two worlds.** `/join` and the sign-in page are participant pages: a brand-neutral consumer skin from a CSS Module, FontAwesome icons, no `@mui/material`, no COBRA, mobile-first (a phone with no typing is the primary case). The roster, the day-word panel and the card sheet's **screen** are staff pages: COBRA, desktop-first, dense, keyboard-first. The **printed** card is neither (EL-15).
* **Isolation is Critical.** `ParticipantLink` and `ExerciseDayWord` are `IExerciseScoped` through the central filter. Every staff action finds its target by account id under that filter, so another exercise's id is a 404 identical to an unknown id. A link token or sign-in name from exercise B presented on exercise A's host is a uniform 401. `Session` is not scoped, so every session query carries an explicit `ExerciseId`.
* **No oracle.** `/auth/join` and `/auth/word` answer every failure with the same bodyless 401. The word is checked before the name; a revoked link and an unknown link are the same single hash lookup.
* **Telemetry (XC-004).** Sign-ins, link issue/reissue/revoke, disable/enable, imports, card generation and word set/clear are server-emitted with the staff actor (role and acting human) or the participant. No secret ever reaches an event, a log or an error body.
* **Scenario time (COR-053).** No participant-visible time appears on `/join` or the sign-in page. Staff screens show real wall-clock instants in the exercise time zone, labelled. "Today" for the word is the real date in the exercise time zone, never scenario time.
* **Accessibility (NFR-001).** Real labels, `role="alert"` and `role="status"` regions, status chips as text plus icon, confirm dialogs with focus management, tables with proper headers and keyboard-operable row actions. Nothing relies on colour alone.
* **Secrets handling.** A join URL is a bearer credential. It is shown to staff only, copied from memory, never put in a toast, a log or a query string; the cards endpoint and the list are `no-store`.

## Acceptance walk-through (manual UAT, before the 10/19 freeze)

Run on UAT after the backend seam deploy and the frontend deploy, on a real phone and a laptop. Each line is a pass/fail check; failures go back to the owning story.

1. As controller or planner, open **Participants** (`/staff/participant-admin`). Upload a 6-row CSV with: two org-persona rows (`FulcoEM`), three plain rows, one row with a bad persona handle. **Validate** shows the bad row failed and nothing created; **Import** creates five; uploading the same file again reports five `unchanged`. (02, 10)
2. Each of the five has a sign-in name, a persona (two org, three auto-created "citizen") and an active link. (02)
3. **Copy link** for one person, open it on a phone with no typing: you land on the participant feed as that person, and the composer is present. Close the browser, reopen the site: still signed in. (03, 07, 08)
4. **Print cards** for the five. The print preview shows eight-up letter pages with QR, link text, sign-in name and a blank word slot; nothing from the staff shell prints. Scan a printed QR with the phone camera: signed in. (04, 12)
5. **Set today's word** (generate one). Sign out on a second phone; sign in with sign-in name + word: signed in. A wrong word and a wrong name show the same "wasn't recognized". **Rotate** the word: the old word now fails at once, the new one works. (05, 09, 11)
6. **Revoke** that person's link: the open phone is signed out within one request, the old link says it isn't working, the sign-in name + word still works. **Disable** them: every path refuses. **Enable**, **Reissue**: the new link works, the old one does not. (03, 10)
7. Post as a participant bound to `FulcoEM`, and as a plain participant: both appear in the controller's feed, attributed to the right persona and acting human. (02, 03)
8. As a staff user assigned to a *different* exercise (or with the evaluator role), the roster calls answer 404 / 403. (02, 03, 04, 05)
9. (Could) Configure email, send one participant their link, tap it from the email. (13)

## Not in this feature (and where it goes)

* Self-registration or password reset by the participant: never (COR-011).
* A per-exercise **branded** pre-login page: needs brand tokens on the pre-auth allowlist; follow-up (C-2).
* Forwarded-headers handling for a true per-IP limiter, and any limit sized for a 100-person NAT: a `/security-review` deploy decision (C-1).
* Ending all sessions that used the word when it is rotated: not built; rotation only stops new sign-ins (open question).
* Group or hide auto-created citizen personas in the controller persona picker: follow-up.
* SSO or federation for participants: a future direction (COR-014).
