/**
 * features/controller/engine/models/reviewContracts.ts
 * ---------------------------------------------------------------------------
 * The engine-review-cockpit's TYPE MIRROR of the FROZEN backend autonomy/safety
 * contracts (feature: engine-review-cockpit, story 01 — the keystone; ADP-040,
 * D5-014/1.1, E8 architecture §8). STAFF world (Controller Console / COBRA) —
 * pure data/model module, no UI, no COBRA import, no participant surface (XC-002).
 *
 * These shapes are a FIELD-FOR-FIELD port of the C# records/enums the backend's
 * autonomy layer PRODUCES and this cockpit CONSUMES:
 *   - `src/Pulse.Core/Features/Autonomy/Models/EngineReviewItem.cs`
 *     (`DraftDisposition`, `EngineReviewItem.NeedsController`)
 *   - `.../DelayedAutoCountdown.cs` (`ControllerDecision`, `DelayedAutoCountdown`
 *     with `DeadlineScenarioMinute` / `HasExpired` / `MinutesRemaining` / `WithDecision`)
 *   - `.../TimeoutDisposition.cs`, `.../AutonomyLevel.cs`, `.../EffectiveAutonomy.cs`
 *   - `src/Pulse.Core/Features/Generation/Models/GenerationDtos.cs` (`GeneratedPost`)
 * The port is deliberate: the .NET backend does not exist yet, so the cockpit is
 * built + tested against this mirror; when the real API lands it slots in behind
 * the same shapes with no cockpit rewrite. Do NOT invent fields here — mirror the
 * frozen contract, and (where the Phase-1 MOCK needs more than the wire shape,
 * e.g. the actual draft posts + a mocked storyline brief) call the extension out
 * explicitly.
 *
 * ENUM STYLE: each C# enum is ported as a `const` value object + a derived union
 * type of the same name, so call sites read like the C# (`DraftDisposition.Held`)
 * while staying idiomatic TS (no `enum`, no numeric back-mapping surprises).
 *
 * SCENARIO TIME (COR-050/051): every countdown value here is in SCENARIO minutes,
 * never wall-clock — a freeze holds the deadline, a time-jump can carry it past
 * expiry. The whole-minute contract (`hasExpired` / `minutesRemaining`) drives the
 * SAFETY decision (`autoHoldPolicy`); `remainingMs` is a finer, display-only read
 * for the card's "holds in M:SS" depleting bar. Both derive from the SAME
 * scenario clock the caller passes in — this module never reads a clock itself.
 */

// ---------------------------------------------------------------------------
// Enums (const value + derived union), mirroring the frozen C# enums
// ---------------------------------------------------------------------------

/**
 * The disposition of an engine burst in the review flow (mirrors
 * `EngineReviewItem.cs`'s `DraftDisposition`). `Held` is the safety default on
 * timeout — silence is never approval (D5-014/1.1).
 */
export const DraftDisposition = {
  /** Suggest: queued for review; nothing publishes without an explicit approve. */
  Queued: 'queued',
  /** Delayed-auto: counting down in scenario time; a controller may approve or veto. */
  CountingDown: 'counting-down',
  /** Auto-HELD on expiry ("timer expired — held for you"); surfaces in NEEDS YOU. */
  Held: 'held',
  /** Published into the E2 pipeline (approved or edited-then-approved). */
  Published: 'published',
  /** Vetoed by the controller; never published. */
  Vetoed: 'vetoed',
} as const
export type DraftDisposition = (typeof DraftDisposition)[keyof typeof DraftDisposition]

/** The controller's decision on a Delayed-auto draft (mirrors `ControllerDecision`). */
export const ControllerDecision = {
  None: 'none',
  Approved: 'approved',
  Vetoed: 'vetoed',
} as const
export type ControllerDecision = (typeof ControllerDecision)[keyof typeof ControllerDecision]

/**
 * The outcome of evaluating a Delayed-auto countdown (mirrors `TimeoutDisposition`).
 * `Hold` is the load-bearing safety default: expired + no decision → Hold, never a
 * silent auto-send (except behind the lead-gated swamped mode, story 03).
 */
export const TimeoutDisposition = {
  AwaitDecision: 'await-decision',
  Hold: 'hold',
  Publish: 'publish',
} as const
export type TimeoutDisposition = (typeof TimeoutDisposition)[keyof typeof TimeoutDisposition]

/**
 * How generated content ships (mirrors `AutonomyLevel`). The values ascend in
 * autonomy (Suggest < Delayed-auto < Auto); safety controls only ever move it
 * DOWN (see {@link AutonomyLevels.lower}). `Auto` is reserved for v1.1.
 */
export const AutonomyLevel = {
  Suggest: 'suggest',
  DelayedAuto: 'delayed-auto',
  Auto: 'auto',
} as const
export type AutonomyLevel = (typeof AutonomyLevel)[keyof typeof AutonomyLevel]

/** Autonomy ordering — `(int)` in C#; here an explicit rank so `lower` is total. */
const AUTONOMY_RANK: Readonly<Record<AutonomyLevel, number>> = {
  [AutonomyLevel.Suggest]: 0,
  [AutonomyLevel.DelayedAuto]: 1,
  [AutonomyLevel.Auto]: 2,
}

/**
 * Helpers over {@link AutonomyLevel} that keep the §8.2 safety invariants in one
 * place (mirrors `AutonomyLevels`): the "lower of two" every safety control uses,
 * and the v1 selectability gate.
 */
export const AutonomyLevels = {
  /** The safest level — the floor a kill switch / degraded-mode fallback drops to. */
  Floor: AutonomyLevel.Suggest,
  /** The less-autonomous of two levels — degradation can never RAISE autonomy. */
  lower(a: AutonomyLevel, b: AutonomyLevel): AutonomyLevel {
    return AUTONOMY_RANK[a] <= AUTONOMY_RANK[b] ? a : b
  },
  /** True if `candidate` is strictly more autonomous than `current`. */
  isRaise(current: AutonomyLevel, candidate: AutonomyLevel): boolean {
    return AUTONOMY_RANK[candidate] > AUTONOMY_RANK[current]
  },
} as const

// ---------------------------------------------------------------------------
// EffectiveAutonomy (mirrors the C# readonly record struct)
// ---------------------------------------------------------------------------

/**
 * The engine's resolved disposition for one storyline (mirrors `EffectiveAutonomy`):
 * whether generation is stopped and, if not, the effective {@link AutonomyLevel}
 * after per-storyline override / exercise default / safety clamp. Check
 * `generationStopped` first, then dispatch on `level`.
 */
export interface EffectiveAutonomy {
  readonly generationStopped: boolean
  readonly level: AutonomyLevel
}

/** The fully-stopped disposition (kill-switch full stop). */
export const STOPPED_AUTONOMY: EffectiveAutonomy = {
  generationStopped: true,
  level: AutonomyLevel.Suggest,
}

/** A running disposition at `level`. */
export function runningAutonomy(level: AutonomyLevel): EffectiveAutonomy {
  return { generationStopped: false, level }
}

// ---------------------------------------------------------------------------
// GeneratedPost (mirrors GenerationDtos.cs)
// ---------------------------------------------------------------------------

/**
 * One generated post, attributable to a persona (mirrors `GeneratedPost`). Its
 * engine origin is captured for telemetry/E10 but is never participant-visible
 * (SOC-003). `personaHandle` resolves to a persona INSTANCE id via
 * `personaIdForHandle` on the publish path.
 */
export interface GeneratedPost {
  readonly personaHandle: string
  readonly text: string
  readonly sentiment: number
  readonly hashtags: readonly string[]
}

// ---------------------------------------------------------------------------
// Scenario-minute helpers (COR-050/051)
// ---------------------------------------------------------------------------

/** Milliseconds per scenario minute — the unit `DelayedAutoCountdown` counts in. */
export const SCENARIO_MS_PER_MINUTE = 60_000

/**
 * The whole scenario MINUTE an instant (ms since epoch) falls in — the integer
 * `currentScenarioMinute` the safety decision uses. Callers derive `instantMs`
 * from the exercise clock (`scenarioNow().getTime()`); this helper is pure.
 */
export function scenarioMinuteOf(instantMs: number): number {
  return Math.floor(instantMs / SCENARIO_MS_PER_MINUTE)
}

// ---------------------------------------------------------------------------
// DelayedAutoCountdown (mirrors DelayedAutoCountdown.cs)
// ---------------------------------------------------------------------------

/** Constructor params for {@link DelayedAutoCountdown}. */
export interface DelayedAutoCountdownInit {
  readonly exerciseId: string
  readonly storylineId: string
  readonly draftId: string
  readonly startedScenarioMinute: number
  readonly countdownMinutes: number
  readonly decision?: ControllerDecision
}

/**
 * The scenario-time countdown state for one Delayed-auto draft (mirrors the C#
 * record). Immutable: the loop advances a draft by recording a NEW snapshot
 * (`withDecision`), so the terminal decision is a pure function of the snapshot
 * plus the current scenario minute — no hidden timer state. Validates its fields
 * up front so an invalid countdown can never exist (a negative length would
 * "expire" immediately and mis-drive `autoHoldPolicy`).
 */
export class DelayedAutoCountdown {
  readonly exerciseId: string
  readonly storylineId: string
  readonly draftId: string
  readonly startedScenarioMinute: number
  readonly countdownMinutes: number
  readonly decision: ControllerDecision

  constructor(init: DelayedAutoCountdownInit) {
    if (!init.exerciseId) {
      throw new Error('A countdown must belong to an exercise (COR-001).')
    }
    if (!init.storylineId) {
      throw new Error('A countdown must name its storyline.')
    }
    if (!init.draftId) {
      throw new Error('A countdown must name its draft.')
    }
    if (init.startedScenarioMinute < 0) {
      throw new Error('startedScenarioMinute must be non-negative.')
    }
    if (init.countdownMinutes < 0) {
      throw new Error('countdownMinutes must be non-negative.')
    }

    this.exerciseId = init.exerciseId
    this.storylineId = init.storylineId
    this.draftId = init.draftId
    this.startedScenarioMinute = init.startedScenarioMinute
    this.countdownMinutes = init.countdownMinutes
    this.decision = init.decision ?? ControllerDecision.None
  }

  /** The scenario minute at which the countdown expires (start + length). */
  get deadlineScenarioMinute(): number {
    return this.startedScenarioMinute + this.countdownMinutes
  }

  /** Whether the countdown has expired at `currentScenarioMinute`. */
  hasExpired(currentScenarioMinute: number): boolean {
    return currentScenarioMinute >= this.deadlineScenarioMinute
  }

  /**
   * Scenario minutes left before expiry (0 once expired) — the whole-minute,
   * NFR-001 by-number read used by the safety decision.
   */
  minutesRemaining(currentScenarioMinute: number): number {
    return Math.max(0, this.deadlineScenarioMinute - currentScenarioMinute)
  }

  /**
   * Milliseconds left before expiry given the current scenario instant `nowMs`
   * (0 once expired). DISPLAY-ONLY — a finer read than the whole-minute safety
   * contract, so the card can render a smooth "holds in M:SS" depleting bar. The
   * expiry DECISION always uses {@link hasExpired}, never this.
   */
  remainingMs(nowMs: number): number {
    return Math.max(0, this.deadlineScenarioMinute * SCENARIO_MS_PER_MINUTE - nowMs)
  }

  /** Records the controller's decision, returning the updated snapshot. */
  withDecision(decision: ControllerDecision): DelayedAutoCountdown {
    return new DelayedAutoCountdown({
      exerciseId: this.exerciseId,
      storylineId: this.storylineId,
      draftId: this.draftId,
      startedScenarioMinute: this.startedScenarioMinute,
      countdownMinutes: this.countdownMinutes,
      decision,
    })
  }
}

// ---------------------------------------------------------------------------
// EngineReviewItem (mirrors EngineReviewItem.cs + the Phase-1 mock extension)
// ---------------------------------------------------------------------------

/**
 * Constructor params for {@link EngineReviewItem}.
 *
 * FROZEN-CONTRACT fields (`exerciseId`, `storylineId`, `draftId`, `routedAtLevel`,
 * `disposition`, `countdown`) mirror `EngineReviewItem.cs` exactly. The remaining
 * fields are the PHASE-1 MOCK EXTENSION the cockpit needs before the real engine
 * exists: the actual draft `posts` the burst would publish (the wire contract
 * carries only `PostCount`, since the backend holds the drafts), and mocked
 * storyline context (`storylineTag` + a short `storylineBrief`) standing in for
 * world-steering, which is not built (see feature.md). All are staff-only (XC-002).
 */
export interface EngineReviewItemInit {
  readonly exerciseId: string
  readonly storylineId: string
  readonly draftId: string
  readonly routedAtLevel: AutonomyLevel
  readonly disposition: DraftDisposition
  readonly countdown?: DelayedAutoCountdown | null
  /** MOCK extension: the burst's actual draft posts (backend carries only a count). */
  readonly posts: readonly GeneratedPost[]
  /** MOCK extension: the storyline hashtag/tag shown on the card (e.g. `#WaterIssues`). */
  readonly storylineTag: string
  /** MOCK extension: a short mocked storyline "brief" for the card's context line. */
  readonly storylineBrief: string
  /** MOCK extension: the human-readable action label (e.g. `reply → @mvega_fh`). */
  readonly actionLabel: string
}

/**
 * A single engine burst as the review cockpit sees it (mirrors the C# record).
 * ONE burst = ONE review decision (not one per post) — the unit batch-approve and
 * the CTL-034 demand meter count. Immutable: a disposition change or a re-roll
 * produces a NEW instance (`withDisposition` / `withReroll`) so the store can swap
 * array identity like `postStore` does. Staff-only (XC-002); scenario time only.
 */
export class EngineReviewItem {
  readonly exerciseId: string
  readonly storylineId: string
  readonly draftId: string
  readonly routedAtLevel: AutonomyLevel
  readonly disposition: DraftDisposition
  readonly countdown: DelayedAutoCountdown | null
  readonly posts: readonly GeneratedPost[]
  readonly storylineTag: string
  readonly storylineBrief: string
  readonly actionLabel: string

  constructor(init: EngineReviewItemInit) {
    this.exerciseId = init.exerciseId
    this.storylineId = init.storylineId
    this.draftId = init.draftId
    this.routedAtLevel = init.routedAtLevel
    this.disposition = init.disposition
    this.countdown = init.countdown ?? null
    this.posts = init.posts
    this.storylineTag = init.storylineTag
    this.storylineBrief = init.storylineBrief
    this.actionLabel = init.actionLabel
  }

  /** Posts in the burst — informational; the burst is still one decision. */
  get postCount(): number {
    return this.posts.length
  }

  /**
   * Whether this item currently demands controller attention (mirrors
   * `NeedsController`): a queued Suggest item or an auto-HELD item. Published and
   * vetoed items are resolved and do not. This is the D5-014/2.1 single source of
   * truth the inline count + the (future) NEEDS-YOU bar share.
   */
  get needsController(): boolean {
    return (
      this.disposition === DraftDisposition.Queued ||
      this.disposition === DraftDisposition.Held
    )
  }

  /** The burst's lead persona handle (drives the card's persona identity). */
  get leadPersonaHandle(): string {
    return this.posts[0]?.personaHandle ?? ''
  }

  /** The burst's preview text (the lead draft post). */
  get previewText(): string {
    return this.posts[0]?.text ?? ''
  }

  private cloneWith(overrides: Partial<EngineReviewItemInit>): EngineReviewItem {
    return new EngineReviewItem({
      exerciseId: this.exerciseId,
      storylineId: this.storylineId,
      draftId: this.draftId,
      routedAtLevel: this.routedAtLevel,
      disposition: this.disposition,
      countdown: this.countdown,
      posts: this.posts,
      storylineTag: this.storylineTag,
      storylineBrief: this.storylineBrief,
      actionLabel: this.actionLabel,
      ...overrides,
    })
  }

  /** Returns a copy at a new disposition (e.g. Published / Vetoed / Held). */
  withDisposition(disposition: DraftDisposition): EngineReviewItem {
    return this.cloneWith({ disposition })
  }

  /**
   * Returns a copy with a fresh re-rolled draft: new `posts`, a reset `countdown`
   * (or null for a Suggest item), and a back-to-review `disposition`
   * (CountingDown for Delayed-auto, else Queued).
   */
  withReroll(
    posts: readonly GeneratedPost[],
    countdown: DelayedAutoCountdown | null,
    disposition: DraftDisposition,
  ): EngineReviewItem {
    return this.cloneWith({ posts, countdown, disposition })
  }
}
