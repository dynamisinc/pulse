# Story Updates — Pulse Social App (D1)

> **Purpose.** The D1 design sessions (2–3) + adversarial review produced decisions that **change
> or sharpen requirements as written**. This checklist is the input for the story/epic agents:
> each item names the requirement ID, the decision (`D1-xxx`), the before → after, and the action.
> Distilled from [`README.md`](README.md) "Story updates needed" and [`DECISIONS.md`](DECISIONS.md).
> Verify each "before" against the current epic text (`../../02-social-network.md`) when editing.

Legend: **AMEND** = edit existing requirement · **ADD** = new requirement/capability ·
**RECONCILE** = supersede/settle an earlier open question · **BACKLOG** = defer as a future story.

---

## A. Requirement amendments / sharpenings

- [x] **SOC-010/011 — thread layout is X-style FLATTENED** · `D1-006` (RECONCILE open question 1)
  - **Before:** "flattened vs nested — design decides" (E2 open question 1).
  - **After:** **Flattened** — ancestry above the focused post, replies below with "Replying to
    @handle" lines. Nested/indented rejected (truncates past ~3 levels on real content).
  - **Action:** write thread stories to flattened; close E2 open question 1.

- [x] **SOC-006 — "Posting as" chip is grant-gated, one identity at a time** · `D1-007`, `D1-R2`
  - **Before:** participants granted org operation get an account switcher in the composer.
  - **After:** the "Posting as: {account} ▾" chip renders **only for users holding org grants**;
    citizens get the stock composer with **no** chip. **One identity at a time.** Multi-persona
    posting is a Controller Console capability, **never** a participant one.
  - **Action:** SOC-006 stories specify conditional (grant-gated) render + single active identity.

- [x] **SOC-053 — suggested-follows titled "Who to follow"; never authority labels** · `D1-R1`
  - **Before:** "suggested follows … key agencies, outlets" (implied "official sources" framing).
  - **After:** module titled **"Who to follow"**; the platform must **never** label accounts
    "official"/authoritative. The verified mark (and its absence) is the only credibility signal.
    The imposter's presence in the module is a legitimate controller lever, not a platform lie.
  - **Action:** SOC-053 stories forbid authority labels on the module.

- [x] **SOC-052 — verified mark is fixed seal-blue `#2D9CDB`, independent of accent** · `D1-003`
  - **Before:** "verified checkmark renders on qualifying personas."
  - **After:** the mark color is a **fixed seal-blue `#2D9CDB`**, independent of the per-exercise
    accent (COR-030) — rebranding an exercise must never alter the trust signal trainees learn.
  - **Action:** SOC-052 AC pins the verified-mark color outside the theme.

- [x] **SOC-070/071 — bursts buffer behind a "new posts" pill; never live-insert** · `D1-005`
  - **Before:** "feeds update in real time (new-posts pill or live insert; design decides)."
  - **After:** bursts **buffer behind a sticky "▲ N new posts" pill** (`aria-live=polite`);
    notifications **aggregate** under load ("… and 41 others"); the feed **never live-inserts /
    auto-scrolls** into the reading stream. (Answers the auto-scroll question: pill, not autoscroll.)
  - **Action:** SOC-083/070/071 stories specify the buffered pill + aggregation; no live-insert.

- [x] **SOC-054 — magnitude counts + "…and ~N others", never fake lists** · `D1-012`
  - **Before:** "displayed follower count = audience magnitude + real edges; lists render real
    edges plus an 'and ~48.2K others' affordance."
  - **After:** confirmed/tightened — profile counts show magnitude ("48.2K"); expanding Followers
    lists the real edges then italic **"…and ~48.2K others"** — never a fabricated scrollable list.
  - **Action:** SOC-054 story ACs codify the affordance exactly.

- [x] **SOC-005 — takedown tombstones are thread-only; feeds silently omit** · `D1-009` (CTL-025)
  - **Before:** "a deleted post shows a 'post unavailable' tombstone in threads."
  - **After:** tombstones appear **inside threads only**; **feeds show no tombstones** — removed
    posts simply vanish from feeds, matching real platforms.
  - **Action:** SOC-005 story distinguishes thread (tombstone) vs feed (silent omit).

- [x] **SOC-002/052 — impersonation pair; platform never flags the fake** · `D1-008`
  - **Before:** "impersonation scenarios (unverified lookalike accounts) must be supportable."
  - **After:** a concrete pair — @FairhavenWater (verified) vs @FairhavenWaterUpd (no mark) —
    woven through feed, thread (a citizen calls it out), and search People (side-by-side). The
    platform **never** flags the fake; absence of the mark is the only signal; near-duplicate
    avatars are intentional.
  - **Action:** SOC-052 verification story + search story carry the impersonation-support ACs.

---

## B. New requirements / capabilities to add

- [x] **ADD — PIO multi-column mode (grant-gated, off by default)** · `D1-010`
  - A "Columns" nav toggle rendered **only for org-grant holders**, off by default. On: center +
    sidebar are replaced by TweetDeck-style columns (All Posts · saved hashtag · saved search ·
    Mentions) with compact rows, action bars suppressed; nav persists; one click back.
  - **Action:** add a PIO-columns story (the epic listed it only in design notes).

- [x] **ADD — Observer / read-only mode: controls absent, not disabled** · `D1-011` (COR-015)
  - Observer hides composer, Post, Follow, DM input, and the new-posts pill; action rows remain
    visible as inert counts. **No disabled buttons anywhere.**
  - **Action:** every posting/interaction story states the observer-mode (controls-absent) variant.

- [x] **ADD — Demo/world state is exercise-config, not in-app UI** · `D1-002`
  - `worldState` (normal/burst/alert), `observer`, `orgGrants`, and `accent` are exercise-config
    props pushed by the engine/role — **never** in-fiction controls (XC-002). Dark mode + PIO
    Columns ARE real in-fiction user settings.
  - **Action:** stories treat these as inputs from config/role, not participant-visible toggles.

- [x] **ADD — Visual/UX spec: left-anchored frame, Figtree, depleting ring counter, dark-in-menu**
  · `D1-013`, `D1-R5`, Tokens
  - Left-anchored 240 / 600 / 344 layout; Figtree type; X-style depleting ring char counter (count
    at ≤20 remaining); dark-mode toggle lives in the account (…) menu; token set in the README.
  - **Action:** the design-notes/tech-notes of the relevant stories reference the token set.

---

## C. Reconcile / settle

- [x] **RECONCILE — E2 open question 1 (flattened vs nested)** settled to **flattened** (`D1-006`).
- [x] **RECONCILE — alert delivery in pilot mode:** the mockup previews the **PRT-010 in-app
  advisory bar** (an E3/Phase-3 surface). In E2 pilot mode, high-priority alerts deliver via
  **platform notifications (SOC-072)**; the advisory bar itself is tracked under E3. Keep E2 stories
  on SOC-072; note the PRT-010 preview.

---

## D. Deferred → backlog (log as future stories, not this pass)

- [ ] **Mobile citizen frame** (D0 §4.6 mobile-first) — its own design session (D1 was desktop-first).
- [ ] **Photo avatar library integration** (COR-024) — initials are placeholders in the mockup.
- [ ] **In-content "EXERCISE" watermark slot on media** (NFR-008) — placeholder media only this pass.
- [ ] **Media / quote-post composer states** — text + attach affordance only in the mockup.
- [ ] **Full screen-reader live-region spec for feed updates** (NFR-001) — noted, needs full spec
  (launch gate).

---

## Traceability at a glance

| Requirement | Decision(s) | Type | One-line change |
|---|---|---|---|
| SOC-010/011 | D1-006 | RECONCILE | Threads flattened (X-style); nested rejected |
| SOC-006 | D1-007, D1-R2 | AMEND | "Posting as" chip grant-gated, one identity; multi-persona is controller-only |
| SOC-053 | D1-R1 | AMEND | "Who to follow"; never authority labels |
| SOC-052 | D1-003, D1-008 | AMEND | Verified mark fixed seal-blue; impersonation pair, platform never flags |
| SOC-070/071 | D1-005 | AMEND | Burst buffers behind "new posts" pill; aggregate; no live-insert |
| SOC-054 | D1-012 | AMEND | Magnitude counts + "…and ~N others"; no fake lists |
| SOC-005 | D1-009 | AMEND | Tombstones thread-only; feeds silently omit |
| — (PIO columns) | D1-010 | ADD | Grant-gated multi-column mode, off by default |
| — (observer) | D1-011 | ADD | Read-only = controls absent, not disabled |
| — (world state) | D1-002 | ADD | worldState/observer/orgGrants/accent are config, not in-app UI |
| open Q1 / PRT-010 | D1-006 / D1-004 | RECONCILE | Q1 settled; alert bar is E3, SOC-072 in pilot |
| mobile / avatars / watermark | D1-R6, open | BACKLOG | Deferred, not this pass |
