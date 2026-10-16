/**
 * features/controller — the D5 dark operator-chrome token set (STAFF world).
 *
 * The single source of truth for the controller console's raw chrome hexes. This
 * block was previously copy-pasted (as a local `const chrome`) into seven
 * components across `engine/` and `components/steering/`; each copy carried a
 * SUBSET of these keys with identical values, so a palette change meant a
 * seven-file sweep. Extracted verbatim — no value changed, so there is no
 * visual delta at any call site.
 *
 * TWO WORLDS (the cardinal rule). These are STAFF-ONLY tokens: the dense, dark
 * COBRA operator look. Never import this from a participant surface (social,
 * portal, outlets, weather) — those mount their own per-exercise brand themes,
 * and staff chrome bleeding into the fiction is a two-worlds violation.
 *
 * Consumers import it aliased to the local name the call sites already use:
 *
 *   import { consoleChrome as chrome } from '@/features/controller/consoleChrome'
 *
 * ACCESSIBILITY (NFR-001). These are raw hexes, not semantic state. A severity
 * or status must never be signalled by colour alone (WCAG 2.1 AA) — pair every
 * tonal cue with text or an icon, exactly as the existing call sites do.
 */
export const consoleChrome = {
  /** Console backdrop — the darkest surface (`EngineControlBar`'s strip). */
  bg: '#0a1017',
  /** Panel/flyout surface, one step up from `bg`. */
  panel: '#0f1826',
  /** Card surface inside a panel. */
  card: '#111c2b',
  /** Card hairline — deliberately softer than `line`. */
  cardBorder: '#1c2a3a',
  /** General hairline/divider. */
  line: '#28384b',
  /** Primary text. */
  ink: '#e9eff7',
  /** Secondary text (labels, hints). AA: 8.69:1 on `bg`, 8.11:1 on `panel`, 7.80:1 on `card`. */
  inkMuted: '#9db1c8',
  /**
   * Tertiary text (metadata, disabled copy). Was #63758b: 4.05:1 on `bg`, 3.77:1 on `panel`,
   * 3.63:1 on `card` — below AA for the 10-12px copy it paints (demo-feedback 25, #461 §1).
   * #7f91a7 is 5.92:1 / 5.52:1 / 5.32:1, still a step dimmer than `inkMuted`.
   * `theme/cobraTheme.contrast.test.ts` computes both inks on all three surfaces.
   */
  inkFaint: '#7f91a7',
  /** Interactive/informational accent. */
  blue: '#4d97d1',
  /** Stop / destructive tone. */
  red: '#e42217',
  /** Caution tone. */
  amber: '#f5a623',
  /** Go / healthy tone. */
  green: '#33a06f',
  /**
   * Pause-state tones (`PausePill`). Intentionally DISTINCT hexes from
   * `green`/`blue` — they read against `card`, not `panel`. Do not "tidy" them
   * into `green`/`blue`: that would be a visual change, not a de-duplication.
   */
  running: '#37c46b',
  paused: '#4a90d9',
} as const

export type ConsoleChrome = typeof consoleChrome
