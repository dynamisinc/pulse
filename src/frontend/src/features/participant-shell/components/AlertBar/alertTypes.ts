/**
 * features/participant-shell/components/AlertBar/alertTypes.ts
 * ---------------------------------------------------------------------------
 * The alert-bar CONTENT contract (feature: participant-shell, story 02;
 * PRT-010/011/012; see docs/features/participant-shell/02-alert-bar-host.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §2 "Alert bar
 * component contract").
 *
 * `Alert` is the shape the shell renders one alert as — channels/controllers
 * supply CONTENT (D2 alert patterns, world-steering CTL-020/021, Phase 3);
 * this story supplies the container, severities, collapse, and stacking
 * (SHELL-CONTRACT.md §1 "Alert bar host"). `scenarioTime` is deliberately a
 * WIRE-shaped ISO string (like `ShellState.scenarioNow` in `../../
 * mountContract.ts`) — an instant fixed to when the alert became active, NOT
 * "now". It is rendered through `formatScenarioTime()`/`useScenarioTime()`
 * from `@/core/clock` (COR-053) — never treated as a live clock itself.
 *
 * Deliberately a pure data module (types only) with no FontAwesome / UI
 * import — presentation (icon, label, palette) lives in `AlertBar.tsx`, the
 * one place that needs it.
 *
 * World: participant. No COBRA, no MUI — a pure contract module.
 */

/**
 * The three active-alert severities (PRT-010/011). `'none'` (zero active
 * alerts, zero height, no reserved space) is a host STATE, not a severity a
 * single alert carries — see {@link AlertBarState}.
 */
export type AlertSeverity = 'info' | 'advisory' | 'emergency'

/**
 * One active, in-fiction alert (PRT-010/011/012). Alerts are simulated
 * content only — a real-world message is the break-fiction overlay (story
 * 05), never this shape.
 */
export interface Alert {
  /** Stable identity — used for React keys and stack de-duplication. */
  readonly id: string
  /** Drives the chip icon/label/palette and the host's overall treatment. */
  readonly severity: AlertSeverity
  /** The alert's in-fiction message text. */
  readonly message: string
  /**
   * The scenario-time instant this alert became active, as an ISO string
   * (wire shape — see module header). Rendered via
   * `formatScenarioTime()`/`useScenarioTime()`; never wall-clock (COR-053).
   */
  readonly scenarioTime: string
}

/**
 * The alert-bar host's overall rendered state (story 02's AC): `'none'` when
 * there is no active alert (zero height, no reserved space); otherwise the
 * highest-severity active alert drives the state, matching
 * SHELL-CONTRACT.md §2's four states.
 */
export type AlertBarState = 'none' | AlertSeverity
