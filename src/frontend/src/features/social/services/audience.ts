/**
 * features/social/services/audience.ts
 * ---------------------------------------------------------------------------
 * THE AUDIENCE-MAGNITUDE MODEL (feature: profiles-social-graph, story 05;
 * SOC-054, D1-012). This module is the SINGLE SOURCE of the reach / velocity
 * formula for the whole product — it is deliberately pure so three epics can
 * share one definition instead of three drifting ones:
 *
 *   - E2 (here)  — the participant profile's follower COUNT and the
 *                  "…and ~48.2K others" affordance (`<FollowerList>`).
 *   - E8 ADP-004 — amplification/spread VELOCITY ("velocity shaped by storyline
 *                  intensity and audience magnitude, SOC-054"); also the
 *                  substrate the v1.1 rumor `spreadProfile` builds on.
 *   - E10 EVL-012 — the evaluator's reach/IMPRESSIONS proxy ("computed over the
 *                  audience-magnitude model rather than a literal roster").
 *
 * DO NOT fork this math into E8 or E10. Import `audienceReach()`; if a consumer
 * needs a term this model doesn't have, add the term HERE (with its coefficient
 * in `AUDIENCE_REACH_MODEL` and a test at its boundary) so every surface keeps
 * computing the same number.
 *
 * ── THE TWO POPULATIONS (SOC-054) ────────────────────────────────────────────
 * Every account has an **audience magnitude** — a believable simulated audience
 * derived from the E1 template band (COR-020: nano/micro/mid/large/mega, turned
 * into a concrete number by `seedCast`, evolving with activity) — which is
 * DISTINCT from the **real follow graph** (actual follow edges created by
 * participants, story 02). They never overlap: magnitude is the crowd that does
 * not exist as rows, edges are the accounts that do.
 *
 *   displayed follower count = audience magnitude + real edges
 *
 * Phase-1 note: the seeded `Persona.followerCount` IS the audience magnitude
 * (band-derived at seed time, `personas/seedCast.ts`) — it is NOT a total that
 * already includes edges. Pass it as `magnitude`, never as the whole count.
 *
 * ── PURITY ──────────────────────────────────────────────────────────────────
 * No React, no I/O, no clock (COR-053: elapsed time is passed in as SCENARIO
 * minutes, never read from the wall clock), no exercise-scoped fetch — the
 * caller supplies already-scoped numbers (COR-001). Same inputs, same outputs,
 * forever; that is what makes it safe for a backend/engine port later.
 *
 * ── THE FORMULA, AND WHY THESE COEFFICIENTS ─────────────────────────────────
 * SOC-054 fixes the SHAPE of the model ("reach and velocity are functions of
 * audience magnitude") but the epics deliberately leave the coefficients to a
 * definition workshop (docs/10-evaluation-aar.md open item: "the specific
 * formula still needs a definition workshop"). Rather than leave E8/E10 to
 * guess, this module states a defensible default contract:
 *
 *   audience    A = magnitude + edges                       (the addressable base)
 *   intensity   F = 1 + INTENSITY_LIFT · clamp(intensity,0,100)/100     → [1, 2]
 *   organic     O = A · BASE_EXPOSURE_RATE · F
 *   amplified   M = amplifications^AMPLIFICATION_EXPONENT
 *                     · amplifierMagnitude · BASE_EXPOSURE_RATE · F
 *   impressions I∞ = round(O) + round(M)                    (eventual reach)
 *   spread time τ = SPREAD_TIME_CONSTANT_MINUTES / F        (scenario minutes)
 *   velocity    v = I∞ / τ                    (impressions per scenario minute)
 *   accrued     I(t) = I∞ · (1 − e^(−t/τ))                  (t = scenario mins)
 *
 * Rationale for each chosen coefficient (all overridable by a later workshop —
 * change them here and every surface moves together):
 *
 *  - `BASE_EXPOSURE_RATE = 0.12` — not everyone in an audience sees a given
 *    post. Real platforms land in the 5–15% organic-reach range; 12% sits in
 *    that band and keeps a mid-band (~46K) agency post at a believable ~5.5K
 *    impressions rather than an absurd 46K "everyone saw it".
 *  - `INTENSITY_LIFT = 1.0` — a storyline at full intensity (100) attracts at
 *    most DOUBLE the attention of a quiet one. Bounded on purpose: E8's dial
 *    must not be able to manufacture unbounded reach (ADP-011's rate caps are
 *    the hard limit; this is the soft one).
 *  - `AMPLIFICATION_EXPONENT = 0.75` — audiences OVERLAP, so N reposts never
 *    deliver N× fresh eyes. A sub-linear exponent encodes diminishing returns
 *    (10 reposts ≈ 5.6 effective, 100 ≈ 31.6) — the honest alternative to a
 *    linear model that would let a repost chain "reach" more people than exist.
 *  - `SPREAD_TIME_CONSTANT_MINUTES = 45` — content accrues its reach on a
 *    saturating curve, ~63% within one time constant. 45 SCENARIO minutes fits
 *    a typical exercise arc (an advisory has largely landed within an hour).
 *    Dividing τ by F is what makes a hot storyline spread FASTER as well as
 *    further, which is exactly ADP-004's "velocity scales with intensity".
 *  - Velocity is the initial slope of that curve (dI/dt at t=0 = I∞/τ), so the
 *    rate and the total are two views of ONE model and cannot drift apart.
 *
 * ── MAGNITUDE FORMATTING (D1-012) ───────────────────────────────────────────
 * `formatMagnitude` produces the compact in-fiction form ("48.2K"). It
 * TRUNCATES rather than rounds, so a count is never overstated, and it uses
 * integer arithmetic to avoid float artifacts (2,900,000 must read "2.9M", not
 * "2.8M"). Below 1,000 the exact number is shown — a small local account's 450
 * followers is a real, checkable number and compacting it would read as evasive.
 *
 * ── WHAT THIS MODULE MUST NEVER DO ──────────────────────────────────────────
 * Fabricate identities. Magnitude is a NUMBER, never a list of rows: no
 * function here returns synthetic follower records, and `<FollowerList>` renders
 * only the real edges it is handed plus the "…and ~N others" line (D1-012).
 */

/**
 * The reach-model coefficients, frozen and exported so E8/E10 (and their tests)
 * can cite the same constants instead of hardcoding their own. See the module
 * header for the rationale behind each value.
 */
export const AUDIENCE_REACH_MODEL = Object.freeze({
  /** Fraction of an addressable audience that sees a given post organically. */
  baseExposureRate: 0.12,
  /** Extra exposure multiplier at full storyline intensity (F ∈ [1, 1 + lift]). */
  intensityLift: 1.0,
  /** Sub-linear exponent on repost/quote count — audiences overlap. */
  amplificationExponent: 0.75,
  /** Saturating-curve time constant, in SCENARIO minutes (COR-053). */
  spreadTimeConstantMinutes: 45,
})

/** Inputs to the shared reach/velocity model. All counts are exercise-scoped
 * numbers the CALLER has already resolved (COR-001) — this module fetches
 * nothing. */
export interface AudienceReachInput {
  /**
   * The author's audience magnitude (SOC-054) — the E1 band-derived simulated
   * audience, i.e. Phase-1's `Persona.followerCount`. NOT a total that already
   * includes follow edges.
   */
  readonly magnitude: number
  /** Real follow edges into the author (story 02's graph). Defaults to 0. */
  readonly followEdges?: number
  /** Observed reposts + quotes of the content (E2 amplification). Defaults to 0. */
  readonly amplifications?: number
  /**
   * MEAN audience magnitude of the amplifying accounts. When omitted (and
   * amplifications > 0) it defaults to the author's own `magnitude` — the
   * stated "absent data, assume amplifiers are peers" assumption, so a caller
   * that hasn't wired the amplifier set yet still gets a sane, documented
   * number rather than a silent zero.
   */
  readonly amplifierMagnitude?: number
  /**
   * Storyline intensity 0–100 (E8 ADP-003). Clamped into range. Defaults to 0
   * — a quiet world, no attention lift.
   */
  readonly intensity?: number
  /**
   * SCENARIO minutes elapsed since publication (COR-053 — never wall-clock).
   * Omitted means "fully accrued", i.e. `accruedImpressions === impressions`.
   */
  readonly elapsedScenarioMinutes?: number
}

/** The shared reach/velocity result. Impression figures are whole people;
 * `velocity` and `spreadMinutes` are unrounded rates. */
export interface AudienceReachResult {
  /** Addressable base: magnitude + real edges (the same sum the profile shows). */
  readonly audience: number
  /** Impressions from the author's own audience. */
  readonly organicImpressions: number
  /** Additional impressions delivered by reposts/quotes (overlap-discounted). */
  readonly amplifiedImpressions: number
  /** Eventual total impressions (I∞) — `organic + amplified`. */
  readonly impressions: number
  /** Impressions accrued by `elapsedScenarioMinutes` on the saturating curve. */
  readonly accruedImpressions: number
  /** Spread velocity: impressions per SCENARIO minute at t=0 (E8 ADP-004). */
  readonly velocity: number
  /** The curve's time constant τ in scenario minutes (shrinks as intensity rises). */
  readonly spreadMinutes: number
}

/** Coerces any numeric input to a finite, non-negative value (defensive: a NaN
 * or negative count is a caller bug, and must not poison a rendered figure). */
function safeCount(value: number | undefined, fallback = 0): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback
  return value
}

/**
 * The displayed follower COUNT for an account (SOC-054, AC1):
 * `audience magnitude + real follow edges`.
 *
 * The two populations are disjoint by definition — magnitude is the simulated
 * crowd (never enumerable), edges are the real accounts that followed during
 * the exercise — so the sum double-counts nobody. Callers render it through
 * `formatMagnitude()`.
 *
 * @param magnitude   the account's audience magnitude (Phase 1: `Persona.followerCount`)
 * @param followEdges the count of REAL follow edges (story 02); defaults to 0
 */
export function displayedFollowerCount(magnitude: number, followEdges = 0): number {
  return Math.floor(safeCount(magnitude)) + Math.floor(safeCount(followEdges))
}

/** Compact-form unit thresholds, largest first. */
const MAGNITUDE_UNITS: readonly { readonly value: number; readonly suffix: string }[] = [
  { value: 1_000_000_000, suffix: 'B' },
  { value: 1_000_000, suffix: 'M' },
  { value: 1_000, suffix: 'K' },
]

/**
 * Formats an audience figure in the compact in-fiction form participants see
 * (D1-012): `48200 → "48.2K"`, `1500000 → "1.5M"`.
 *
 * Rules (frozen — E8/E10 staff surfaces reuse this so one number reads the same
 * everywhere):
 *  - below 1,000 the EXACT integer is shown (`450 → "450"`, `999 → "999"`);
 *  - at/above a unit the value is TRUNCATED to one decimal, never rounded up,
 *    so a count is never overstated (`48299 → "48.2K"`, `999999 → "999.9K"`);
 *  - a `.0` tenth is dropped (`1000 → "1K"`, `220000 → "220K"`);
 *  - fractions are floored, and a negative / NaN / infinite input yields `"0"`
 *    rather than throwing — a broken count must never break a profile render.
 *
 * Integer arithmetic (divide by a tenth of the unit) is used deliberately:
 * float division would render 2,900,000 as "2.8M".
 */
export function formatMagnitude(value: number): string {
  const safe = Math.floor(safeCount(value))

  for (const unit of MAGNITUDE_UNITS) {
    if (safe < unit.value) continue
    const tenths = Math.floor(safe / (unit.value / 10))
    const whole = Math.floor(tenths / 10)
    const tenth = tenths % 10
    return tenth === 0 ? `${whole}${unit.suffix}` : `${whole}.${tenth}${unit.suffix}`
  }

  return String(safe)
}

/**
 * THE shared reach/velocity computation (SOC-054) — see the module header for
 * the full formula, the coefficient rationale, and the list of consumers
 * (E2 profile, E8 ADP-004 velocity, E10 EVL-012 impressions).
 *
 * Everything is derived from audience MAGNITUDE plus optional amplification and
 * storyline intensity; the returned `velocity` is the initial slope of the same
 * saturating curve `accruedImpressions` walks, so rate and total can never
 * disagree.
 *
 * E10 note (EVL-012): these are an impressions PROXY computed over the audience
 * model, never person-level proof — surfaces rendering them must carry the
 * "session-level evidence" labelling. This module returns numbers only; it
 * makes no claim about who saw anything.
 */
export function audienceReach(input: AudienceReachInput): AudienceReachResult {
  const { baseExposureRate, intensityLift, amplificationExponent, spreadTimeConstantMinutes } =
    AUDIENCE_REACH_MODEL

  const audience = displayedFollowerCount(input.magnitude, input.followEdges)

  const intensity = Math.min(100, safeCount(input.intensity))
  const intensityFactor = 1 + intensityLift * (intensity / 100)

  const organicRaw = audience * baseExposureRate * intensityFactor

  const amplifications = safeCount(input.amplifications)
  // Absent amplifier data, assume the amplifiers are the author's peers (see
  // `amplifierMagnitude` doc) rather than silently contributing zero reach.
  const amplifierMagnitude = safeCount(input.amplifierMagnitude, safeCount(input.magnitude))
  const effectiveAmplifiers = amplifications === 0
    ? 0
    : Math.pow(amplifications, amplificationExponent)
  const amplifiedRaw = effectiveAmplifiers * amplifierMagnitude * baseExposureRate * intensityFactor

  // Parts are rounded first and the total is their sum, so the reported total
  // always equals the reported breakdown (an evaluator can add them up).
  const organicImpressions = Math.round(organicRaw)
  const amplifiedImpressions = Math.round(amplifiedRaw)
  const impressions = organicImpressions + amplifiedImpressions

  // τ shrinks as intensity rises: a hot storyline spreads faster AND further.
  const spreadMinutes = spreadTimeConstantMinutes / intensityFactor
  const velocity = impressions / spreadMinutes

  const elapsed = input.elapsedScenarioMinutes
  const accruedImpressions = elapsed === undefined || !Number.isFinite(elapsed) || elapsed < 0
    ? impressions
    : Math.round(impressions * (1 - Math.exp(-elapsed / spreadMinutes)))

  return {
    audience,
    organicImpressions,
    amplifiedImpressions,
    impressions,
    accruedImpressions,
    velocity,
    spreadMinutes,
  }
}
