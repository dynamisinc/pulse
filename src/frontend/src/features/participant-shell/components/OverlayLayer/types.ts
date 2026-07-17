/**
 * features/participant-shell/components/OverlayLayer/types.ts
 * ---------------------------------------------------------------------------
 * The overlay-state shape (feature: participant-shell, story 05; COR-065,
 * CTL-023/024, COR-054; see docs/features/participant-shell/05-overlay-layer.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §3).
 *
 * This is the server-pushed state `OverlayLayer.tsx` renders. It is
 * deliberately a flat `{ state, register, message }` triple, not a
 * discriminated union per state — it mirrors the wire shape a future
 * `/overlay-state` push (SignalR, per CLAUDE.md §G) will deliver, and the
 * mock seam (`overlayState.ts`) validates it defensively rather than trusting
 * a cast.
 *
 * - `state`: which overlay (if any) is active.
 *   - `'none'` — no overlay; the shell renders nothing extra (AC1 default).
 *   - `'pause'` (CTL-023) / `'endex'` (COR-054) — the calm control-page
 *     family, rendered at `SHELL_Z.overlay` (above content/nav/alert-bar,
 *     below compliance chrome).
 *   - `'broadcast'` (CTL-024) — break-fiction, rendered at
 *     `SHELL_Z.breakFiction` (covers everything, including chrome).
 * - `register`: which register a `'pause'`/`'endex'` page renders in.
 *   Ignored for `'none'` and `'broadcast'` (break-fiction has one alien
 *   treatment regardless of register; see `SHELL-CONTRACT.md` §3).
 * - `message`: the break-fiction director-authored message (CTL-024's "the
 *   configured message"). Unused for every other `state`. Authoring/trigger
 *   content for `'pause'`/`'endex'` is explicitly out of scope for this story
 *   (world-steering #26/#27, COR-032) — those pages render static, generic
 *   copy instead of a configured field.
 *
 * This story OWNS this module and the mock hook (`overlayState.ts`) that
 * resolves it — it does NOT build the triggers that set these values
 * server-side (that is world-steering #26/#27, STORY-UPDATES §B).
 *
 * World: participant (except `'broadcast'`, which is intentionally alien to
 * both worlds — see `OverlayLayer.tsx`). Pure types, no UI.
 */

/** Which overlay (if any) the shell is currently rendering. */
export type OverlayStateKind = 'none' | 'pause' | 'endex' | 'broadcast'

/**
 * Which register a `'pause'`/`'endex'` control page renders in (D7-004):
 * `'in-fiction'` preserves the fiction with zero exercise language;
 * `'out-of-fiction'` is the calm slate/mono control-page register that names
 * the exercise explicitly. Irrelevant for `'none'`/`'broadcast'`.
 */
export type OverlayRegister = 'in-fiction' | 'out-of-fiction'

/** The overlay-state envelope `useOverlayState()` resolves. */
export interface OverlayState {
  readonly state: OverlayStateKind
  readonly register: OverlayRegister
  /** The break-fiction configured message (CTL-024). Unused outside `'broadcast'`. */
  readonly message: string
}
