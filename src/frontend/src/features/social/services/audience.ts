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
 * ── WHICH PERSONA FIELD IS THE MAGNITUDE (read this before calling) ─────────
 * `Persona.audienceMagnitude` IS the magnitude — pass THAT as `magnitude`.
 *
 * `Persona.followerCount` is the COMPOSED, already-displayed total: since
 * profiles-social-graph backend story 07 the server returns
 * `followerCount = audienceMagnitude + inbound follow edges`, and
 * `personas/seedCast.ts` seeds the mock cast the same way (a freshly seeded
 * instance has zero edges, so the two numbers merely HAPPEN to be equal there —
 * that coincidence is not the contract). Passing `followerCount` as
 * `magnitude` alongside a `followEdges` term therefore counts the real edges
 * TWICE (`magnitude + edges + edges`).
 *
 * An earlier revision of this header said the opposite ("the seeded
 * `Persona.followerCount` IS the audience magnitude… pass it as `magnitude`,
 * never as the whole count"). That was true before story 07 and is now false;
 * it is corrected here because this module is the designated cross-epic source
 * of the formula, so a wrong instruction here propagates into E8/E10.
 *
 *   ✅  audienceReach({ magnitude: persona.audienceMagnitude ?? 0, followEdges })
 *   ❌  audienceReach({ magnitude: persona.followerCount, followEdges })
 *
 * `audienceMagnitude` is typed optional only for the literal-construction
 * reason `personas/types.ts` documents — every real read path (live API and
 * seeded mock alike) always populates it.
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
 *                     · meanAmplifierMagnitude · BASE_EXPOSURE_RATE · F
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
 * ── MODEL VERSIONING (#371) ─────────────────────────────────────────────────
 * `AUDIENCE_REACH_MODEL.modelVersion` stamps the coefficient set. The definition
 * workshop (#371) will retune these numbers; when it does, BUMP the version in
 * the same commit. Anything that persists or exports a reach figure (notably the
 * E10 AAR export) must record the version alongside it, so two figures computed
 * under different coefficients are never silently compared.
 *
 * ── FAIL-CLOSED INPUT HANDLING ──────────────────────────────────────────────
 * Every optional input distinguishes OMITTED from BROKEN, and they mean
 * different things:
 *   - omitted   → the documented default (no edges, no amplification, quiet
 *                 world, "fully accrued" elapsed, peer-magnitude amplifiers);
 *   - broken    → a negative / NaN / Infinite value is an upstream bug, and is
 *                 clamped to the CONSERVATIVE end, never the flattering one.
 * Concretely: a broken `elapsedScenarioMinutes` accrues NOTHING (t=0) rather
 * than reporting peak reach to an evaluator, and a broken
 * `meanAmplifierMagnitude` contributes ZERO amplified reach rather than
 * silently substituting a plausible peer default. Outputs are likewise total:
 * every returned field is a finite, non-negative number (see `clampCount`), so
 * a NaN can never reach a rendered figure.
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
  /**
   * The coefficient-set version (#371). Bump it in the SAME commit as any
   * coefficient change, and stamp it onto anything that persists or exports a
   * reach figure (E10 AAR export) so figures from different tunings are never
   * compared as if they were the same measurement.
   */
  modelVersion: 'v0',
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
   * audience. Read it from `Persona.audienceMagnitude`, NEVER from
   * `Persona.followerCount`: since backend story 07 `followerCount` is the
   * COMPOSED total (`audienceMagnitude + inbound follow edges`), so passing it
   * here alongside `followEdges` counts the real edges twice. See the module
   * header's "WHICH PERSONA FIELD IS THE MAGNITUDE" note.
   */
  readonly magnitude: number
  /** Real follow edges into the author (story 02's graph). Defaults to 0. */
  readonly followEdges?: number
  /**
   * Observed reposts + quotes of the content (E2 amplification). A COUNT —
   * floored, like every other count here, so half a repost cannot contribute
   * reach. Defaults to 0.
   */
  readonly amplifications?: number
  /**
   * The MEAN audience magnitude PER amplifying account (not the sum across
   * them). When OMITTED it defaults to the author's own `magnitude` — the
   * stated "absent data, assume amplifiers are peers" assumption, so a caller
   * that hasn't wired the amplifier set yet still gets a sane, documented
   * number rather than a silent zero. A SUPPLIED-but-broken value (negative /
   * NaN / Infinite) does NOT take that path: it clamps to 0, so a caller that
   * mis-derives its mean gets an obviously-empty amplification term instead of
   * a plausible, un-flaggable one.
   */
  readonly meanAmplifierMagnitude?: number
  /**
   * Storyline intensity 0–100 (E8 ADP-003). Clamped into range (a negative or
   * broken value reads as 0). Defaults to 0 — a quiet world, no attention lift.
   */
  readonly intensity?: number
  /**
   * SCENARIO minutes elapsed since publication (COR-053 — never wall-clock).
   * OMITTED means "fully accrued", i.e. `accruedImpressions === impressions`.
   * A SUPPLIED-but-broken value (negative — the scenario clock is behind
   * publication — or NaN/Infinite) accrues NOTHING (t=0): an upstream delta bug
   * must never render as peak reach on an evaluator's panel.
   */
  readonly elapsedScenarioMinutes?: number
}

/**
 * The shared reach/velocity result. Impression figures are whole people;
 * `velocity` and `spreadMinutes` are unrounded rates.
 *
 * ROUNDING CONTRACT (read this before rendering a breakdown, E10): the two
 * parts are ROUNDED FIRST and the total is their SUM — `impressions ===
 * organicImpressions + amplifiedImpressions` exactly, so a panel that shows the
 * split and the total can never display an off-by-one that looks like a bug.
 * The trade is that the total may differ by ±1 from rounding the unrounded sum.
 *
 * TOTALITY: every field is finite and non-negative. Absurd inputs saturate at
 * `Number.MAX_SAFE_INTEGER` rather than returning `Infinity`/`NaN` (monotonic:
 * a bigger audience never yields a smaller figure).
 */
export interface AudienceReachResult {
  /** Addressable base: magnitude + real edges (the same sum the profile shows). */
  readonly audience: number
  /** Impressions from the author's own audience (rounded). */
  readonly organicImpressions: number
  /** Additional impressions delivered by reposts/quotes (overlap-discounted, rounded). */
  readonly amplifiedImpressions: number
  /** Eventual total impressions (I∞) — exactly `organicImpressions + amplifiedImpressions`. */
  readonly impressions: number
  /**
   * Impressions accrued by `elapsedScenarioMinutes` on the saturating curve.
   * Equals `impressions` when elapsed is OMITTED; 0 when it is supplied broken.
   */
  readonly accruedImpressions: number
  /** Spread velocity: impressions per SCENARIO minute at t=0 (E8 ADP-004). */
  readonly velocity: number
  /** The curve's time constant τ in scenario minutes (shrinks as intensity rises). */
  readonly spreadMinutes: number
}

/**
 * THE one definition of "a broken count is 0". Coerces any numeric input to a
 * finite, non-negative value: a NaN, Infinite, or negative count is a caller
 * bug and must never poison a rendered figure.
 *
 * Exported so every consumer of this model (including `<FollowerList>`) guards
 * counts identically rather than re-implementing the check — one place to
 * change if the policy ever does.
 *
 * @param value    the possibly-broken count
 * @param fallback what an OMITTED (`undefined`) value means; note a broken
 *                 value does NOT use the fallback — it clamps to 0, so
 *                 "not supplied" and "supplied wrong" stay distinguishable
 */
export function safeCount(value: number | undefined, fallback = 0): number {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value < 0) return 0
  return value
}

/**
 * Clamps a COMPUTED figure into the renderable range: non-negative, finite, and
 * saturating at `Number.MAX_SAFE_INTEGER` instead of overflowing to `Infinity`
 * (which would propagate `NaN` through the accrual curve). Guarding inputs is
 * not enough — the products of guarded inputs can still overflow — and this
 * module's contract is that no caller ever receives a non-finite number.
 */
function clampCount(value: number): number {
  if (Number.isNaN(value) || value < 0) return 0
  return value > Number.MAX_SAFE_INTEGER ? Number.MAX_SAFE_INTEGER : value
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
 * Total by construction: broken inputs read as 0 and the sum saturates at
 * `Number.MAX_SAFE_INTEGER`, so a profile can never render `NaN` or `Infinity`
 * followers.
 *
 * @param magnitude   the account's audience magnitude — `Persona.audienceMagnitude`,
 *                    NOT `Persona.followerCount` (which is already this sum;
 *                    see the module header)
 * @param followEdges the count of REAL follow edges (story 02); defaults to 0
 */
export function displayedFollowerCount(magnitude: number, followEdges = 0): number {
  return clampCount(Math.floor(safeCount(magnitude)) + Math.floor(safeCount(followEdges)))
}

/**
 * Compact-form unit thresholds, largest first, each with the SPOKEN word
 * `spokenMagnitude` uses (NFR-001). One table, so the visual and the announced
 * form can never disagree about where a unit starts.
 *
 * `T` (trillion) is the top row deliberately: follower counts never approach it,
 * but E10 (EVL-012) aggregates IMPRESSIONS across a whole exercise, where 1e12
 * is reachable — and without a T row that renders as the 13-digit string
 * "1000000000000B". With it, the model's own `Number.MAX_SAFE_INTEGER`
 * saturation caps the longest possible output at "9007.1T" (see
 * `formatMagnitude`), so no input can produce an unbounded digit run.
 */
const MAGNITUDE_UNITS: readonly {
  readonly value: number
  readonly suffix: string
  readonly spoken: string
}[] = [
  { value: 1_000_000_000_000, suffix: 'T', spoken: 'trillion' },
  { value: 1_000_000_000, suffix: 'B', spoken: 'billion' },
  { value: 1_000_000, suffix: 'M', spoken: 'million' },
  { value: 1_000, suffix: 'K', spoken: 'thousand' },
]

/** Splits a guarded figure into `{ whole, tenth }` at `unit`, truncating. */
function magnitudeParts(safe: number, unit: number): { whole: number; tenth: number } {
  const tenths = Math.floor(safe / (unit / 10))
  return { whole: Math.floor(tenths / 10), tenth: tenths % 10 }
}

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
 * CEILING: units run K → M → B → **T**. The T row exists for E10 (EVL-012),
 * which aggregates impressions exercise-wide where 1e12 is reachable; combined
 * with the model's `Number.MAX_SAFE_INTEGER` saturation the longest output this
 * function can EVER return is `"9007.1T"` (9,007,199,254,740,991). There is no
 * input that renders an unbounded digit run.
 *
 * Integer arithmetic (divide by a tenth of the unit) is used deliberately:
 * float division would render 2,900,000 as "2.8M".
 */
export function formatMagnitude(value: number): string {
  const safe = Math.floor(safeCount(value))

  for (const unit of MAGNITUDE_UNITS) {
    if (safe < unit.value) continue
    const { whole, tenth } = magnitudeParts(safe, unit.value)
    return tenth === 0 ? `${whole}${unit.suffix}` : `${whole}.${tenth}${unit.suffix}`
  }

  return String(safe)
}

/**
 * The SPOKEN form of the same figure, for assistive technology (NFR-001):
 * `48200 → "48.2 thousand"`, `1500000 → "1.5 million"`, `450 → "450"`.
 *
 * Why this exists. Screen readers treat the compact suffix inconsistently —
 * "48.2K" may be announced as "forty-eight point two kay" — and, worse, the "~"
 * in the visible "…and ~48.2K others" is variously DROPPED or read as "tilde",
 * so the approximation nuance can be lost entirely and a reader may hear an
 * exact count. `<FollowerList>` pairs this with the word "approximately" to
 * build an accessible name that carries the same meaning the sighted reading
 * carries. It is a sibling of `formatMagnitude`, sharing one unit table so the
 * two forms can never disagree about where a unit starts; the truncation and
 * guard rules are identical.
 */
export function spokenMagnitude(value: number): string {
  const safe = Math.floor(safeCount(value))

  for (const unit of MAGNITUDE_UNITS) {
    if (safe < unit.value) continue
    const { whole, tenth } = magnitudeParts(safe, unit.value)
    return tenth === 0 ? `${whole} ${unit.spoken}` : `${whole}.${tenth} ${unit.spoken}`
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

  // A count, like magnitude and edges — floored, so half a repost spreads nothing.
  const amplifications = Math.floor(safeCount(input.amplifications))
  // OMITTED amplifier data assumes the amplifiers are the author's peers (see
  // `meanAmplifierMagnitude`); a SUPPLIED-but-broken value clamps to 0 instead,
  // so a mis-derived mean shows up as an empty term rather than a plausible one.
  const meanAmplifierMagnitude = safeCount(
    input.meanAmplifierMagnitude,
    safeCount(input.magnitude),
  )
  const effectiveAmplifiers = amplifications === 0
    ? 0
    : Math.pow(amplifications, amplificationExponent)
  const amplifiedRaw =
    effectiveAmplifiers * meanAmplifierMagnitude * baseExposureRate * intensityFactor

  // Parts are rounded first and the total is their sum, so the reported total
  // always equals the reported breakdown (an evaluator can add them up). Both
  // are clamped so an absurd input saturates rather than emitting Infinity/NaN.
  const organicImpressions = clampCount(Math.round(organicRaw))
  const amplifiedImpressions = clampCount(Math.round(amplifiedRaw))
  const impressions = clampCount(organicImpressions + amplifiedImpressions)

  // τ shrinks as intensity rises: a hot storyline spreads faster AND further.
  const spreadMinutes = spreadTimeConstantMinutes / intensityFactor
  const velocity = clampCount(impressions / spreadMinutes)

  // FAIL CLOSED (WR-002): only an OMITTED elapsed means "fully accrued". A
  // negative delta (scenario clock behind publication) or a NaN/Infinite one is
  // an upstream bug, and must accrue NOTHING rather than reporting peak reach.
  const elapsed = input.elapsedScenarioMinutes
  const accruedImpressions = elapsed === undefined
    ? impressions
    : clampCount(Math.round(impressions * (1 - Math.exp(-safeCount(elapsed) / spreadMinutes))))

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
