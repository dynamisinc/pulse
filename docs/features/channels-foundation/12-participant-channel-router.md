# Story: Participant channel router and landing

**Feature:** Channels foundation  ·  **Epic:** E3 (shell: E1)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-001, PRT-003, PRT-020, COR-004, COR-060, COR-061, XC-002  ·  **Design decisions:** D7-001, D7-005, D2-005  ·  **Issue:** —
**Stack:** frontend  ·  **World:** participant  ·  **Wave:** 3  ·  **Effort:** M

## Context
`App.tsx` hard-codes `<SocialChannel />` inside `<ShellLayout>`. With four more channels the participant surface needs a router that mounts the channel for the URL, honours the
enabled set, gives each channel its own theme scope, and keeps a mistyped participant URL inside the fiction (participant-shell WR-002 / #238).

## Acceptance Criteria
- [ ] **Channel registry.** Given `registerChannel({ id, pathPrefix, element, themeScope })`, when a channel feature registers itself, then `<ChannelRouter>` mounts it at its prefix (FC-4 UI routes) with **no change to router or shell code**; the Social channel registers at `/` and its existing sub-routes keep working unchanged; a channel owns every sub-route under its prefix (e.g. `/portal/resources`, `/weather/zones/:zoneSlug`) and the login-free `/display/:token` route lives **outside** the session shell, so the router neither mounts nor 404s it (portal FU-3).
- [ ] **Per-channel theme scope.** Given a channel mounts, then its theme/skin is applied **inside its route subtree only** (Social: `SocialBrandScope`; others: `OutletSkinScope`, story 13); nothing is applied above `ShellLayout`; no COBRA theme is ever imported by this module (a static import test).
- [ ] **Nav agreement.** Given the enabled set, then the shell's `ChannelNav` and the mounted routes agree: an enabled channel is navigable and appears in the nav; a disabled one is absent from both and its URL renders the participant `ChannelNotFound` (story 08 guard).
- [ ] **Landing (PRT-001).** Given a participant logs in, when the portal channel is enabled, then they land on `/portal`; otherwise on Social home exactly as in pilot mode (Master §4); a read-only session keeps `landingSelection` behaviour.
- [ ] **Deep links survive login.** Given a signed-out visitor opens `/news/newsline-7/emergency-call-delays` (a shared link, often on a phone), when they sign in via the exercise host, then they arrive at that permalink, not the landing page; a link whose channel is disabled or whose item does not exist lands on `ChannelNotFound`. (Verify against the existing `/login` + `/join` flows; if return-to is missing, this story adds it.)
- [ ] **Participant not-found.** Given an unknown participant path, then a brand-skinned, fiction-safe not-found renders inside the shell (no exercise/admin wording, no COBRA 404); staff and unknown-staff paths keep the COBRA 404 (WR-002). A channel may fall back to its own author-only read when the public route 404s (press embargoed release): `ChannelNotFound` is rendered **by the channel's page** on the final 404, never swallowed or pre-empted by the router (press FU-6).
- [ ] **Channels cannot escape the shell.** A mounted channel renders only in the content region: it cannot render cross-channel nav or draw above the overlay layer (SHELL-CONTRACT; the mount contract's z-order tests still pass).
- [ ] **Focus and title.** On route change, focus moves to the content region heading and `document.title` is set by the channel (existing `RouteFocusScope` pattern); keyboard-only navigation across channels works.

## Out of Scope
Any channel's own pages; kiosk variant routing (PRT-040, Phase 3 later); the portal itself (E3); read-only/preview variants beyond what the shell already provides.

## Technical Notes
Files: `features/participant-shell/channelRouter/**` (router, registry, `ChannelNotFound`, return-to helper). `App.tsx` replaces the single-channel element with `<ChannelRouter>` as an **orchestrator-owned** edit between Waves 3 and 4. Reuse `ParticipantLandingGuard`, `RouteFocusScope`, `BrandThemeProvider`.

## Dependencies
08 (enabled set + guard), 13 (skin scope). Can run with 05, 06, 07, 11.
