/**
 * features/social/explore/trending.ts
 * ---------------------------------------------------------------------------
 * ORGANIC TRENDING (demo-polish F6, story 15-explore; SOC-041 client-side,
 * hashtags-trending/02 "lite", D1-R5). Participant world — a PURE, UI-free module:
 * no React, no clock read, no network.
 *
 * WHAT IT COMPUTES. Given the posts the client has loaded (the live Explore
 * baseline: newest-200 top-level posts), it ranks hashtags by RECENT activity and
 * returns the top N as `TrendingTopic`s for `TrendingPanel`.
 *
 * NOTHING IS DECLARED. There is no list of "official" or "pinned" trends and no input
 * that can set one: a tag appears only because posts carry it, ranked by their volume
 * and recency. (The controller boost-weight lever, SOC-041's other half, is out of
 * scope.) The category line is cosmetic, derived from the tag's own text
 * (`categoryFor`), and never authority-bearing (D1-R1/R5).
 *
 * THE SCORE (scenario time, COR-053):
 *   - A post counts if it is VISIBLE (a soft-deleted / taken-down post never
 *     contributes — `visibility.ts`) and its `scenarioTime` is within `windowMs`
 *     BEFORE `now` (default 12 scenario hours). `now` is a REQUIRED input — the caller
 *     passes the scenario "now"; this module reads no clock, so it is deterministic.
 *   - A post stamped up to `futureToleranceMs` AHEAD of `now` (default 15 minutes:
 *     skew, a feed a tick ahead of the local clock) is treated as brand new (age 0);
 *     one stamped further ahead is skipped — it is not recent activity.
 *   - Each qualifying post adds `0.5 ^ (age / halfLifeMs)` (default half-life 3 hours)
 *     to every DISTINCT hashtag it carries; a tag repeated in one post counts once.
 *   - `postCount` is the number of qualifying posts carrying the tag ("N posts").
 *
 * DETERMINISTIC TIE-BREAK. A total order, so the same posts always give the same list
 * whatever order they arrive in: score (exact fixed-point integers in units of 1e-9,
 * so summation order cannot change it) descending, then `postCount` descending, then
 * the newest post's time descending, then the tag in code-unit order (never
 * locale-dependent).
 *
 * DISPLAY CASING comes from the data: the most-used authored casing (ties: most recent,
 * then code-unit order), so `#WaterIssues` shows as written, not the lowercase routing
 * key. `pickDisplayCasing` exposes the same rule to the hashtag page.
 *
 * MEMOIZED. `trendingTopics` is what components call: results are cached per `posts`
 * array identity (a `WeakMap`, collected with the array) and per resolved options, so
 * the same loaded posts and the same scenario minute return the SAME array. It treats
 * `posts` as immutable; the Explore baseline publishes a new array per batch.
 * `computeTrending` is the uncached pure function it wraps.
 */

import { parseHashtags } from '../utils/hashtags'
import { isVisiblePost, type VisibilityMarked } from './visibility'

/** How far back (scenario time) a post still counts: 12 scenario hours. */
export const TRENDING_WINDOW_MS = 12 * 60 * 60 * 1000
/** The decay half-life: a post this old counts half as much as a fresh one. */
export const TRENDING_HALF_LIFE_MS = 3 * 60 * 60 * 1000
/** The most trends ever returned (the Explore page shows up to this many). */
export const TRENDING_MAX_LIMIT = 10
/** A tag needs at least this many qualifying posts to be listed. */
export const TRENDING_MIN_POSTS = 1
/**
 * How far AHEAD of `now` a post may be stamped and still count (15 scenario
 * minutes: clock skew, a feed a tick ahead of the local clock). A post further in
 * the future is not "recent activity" and is skipped.
 */
export const TRENDING_FUTURE_TOLERANCE_MS = 15 * 60 * 1000

/** The slice of a post trending reads (a `PostView` satisfies it structurally). */
export interface TrendingPostInput extends VisibilityMarked {
  readonly id: string
  readonly text: string
  /** Scenario-time ISO instant (COR-053). */
  readonly scenarioTime: string
}

export interface TrendingOptions {
  /** The scenario-time "now" the window is measured from (`scenarioNow()`). */
  readonly now: Date | number
  /** Window length in ms. Default {@link TRENDING_WINDOW_MS}. */
  readonly windowMs?: number
  /** Decay half-life in ms. Default {@link TRENDING_HALF_LIFE_MS}. */
  readonly halfLifeMs?: number
  /** Max topics returned (1..{@link TRENDING_MAX_LIMIT}). Default the max. */
  readonly limit?: number
  /** Minimum qualifying posts for a tag to be listed. Default 1. */
  readonly minPosts?: number
  /**
   * How far ahead of `now` a post may be stamped and still count; later posts are
   * skipped. Default {@link TRENDING_FUTURE_TOLERANCE_MS}. `Infinity` disables the
   * check (the dev mock, whose fixtures are dated 2033 against a wall-clock mock
   * clock, passes it).
   */
  readonly futureToleranceMs?: number
}

export interface TrendingTopic {
  /** The normalized routing key: lowercase, no leading `#`. */
  readonly tag: string
  /** The display form, including `#`, in the casing authors used most. */
  readonly display: string
  /** Qualifying posts in the window that carry the tag. */
  readonly postCount: number
  /** The recency-weighted activity score (higher ranks first). */
  readonly score: number
  /** A cosmetic, varied category line, e.g. "Public safety · Trending". */
  readonly category: string
  /** Scenario-time ISO instant of the newest qualifying post carrying the tag. */
  readonly latestScenarioTime: string
}

interface ResolvedOptions {
  readonly nowMs: number
  readonly windowMs: number
  readonly halfLifeMs: number
  readonly limit: number
  readonly minPosts: number
  readonly futureToleranceMs: number
}

const EMPTY: readonly TrendingTopic[] = Object.freeze([])

function resolveOptions(options: TrendingOptions): ResolvedOptions | undefined {
  const nowMs = options.now instanceof Date ? options.now.getTime() : options.now
  if (!Number.isFinite(nowMs)) return undefined
  const windowMs = options.windowMs ?? TRENDING_WINDOW_MS
  const halfLifeMs = options.halfLifeMs ?? TRENDING_HALF_LIFE_MS
  if (!(windowMs > 0) || !(halfLifeMs > 0)) return undefined
  const limit = Math.min(
    TRENDING_MAX_LIMIT,
    Math.max(1, Math.floor(options.limit ?? TRENDING_MAX_LIMIT)),
  )
  const minPosts = Math.max(1, Math.floor(options.minPosts ?? TRENDING_MIN_POSTS))
  const futureToleranceMs = Math.max(
    0,
    options.futureToleranceMs ?? TRENDING_FUTURE_TOLERANCE_MS,
  )
  return { nowMs, windowMs, halfLifeMs, limit, minPosts, futureToleranceMs }
}

// -----------------------------------------------------------------------------
// Category label (cosmetic, deterministic, derived from the tag text only)
// -----------------------------------------------------------------------------

/**
 * Keyword → category. The first rule whose pattern appears in the tag wins, so
 * the order is the priority. Only LONG, distinctive stems are listed: tags are
 * a single lowercased run, so a short stem would match inside unrelated words.
 */
const CATEGORY_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly label: string }> = [
  {
    pattern: /water|boil|evacuat|shelter|safety|advisory|emergency|rescue|hazard|police|alert/,
    label: 'Public safety',
  },
  { pattern: /weather|storm|rain|snow|wind|tornado|hurricane|flood|forecast|lightning/, label: 'Weather' },
  { pattern: /road|traffic|detour|bridge|highway|closure|transit/, label: 'Traffic' },
  { pattern: /power|outage|electric|utility|utilities/, label: 'Utilities' },
  { pattern: /volunteer|donat|relief|school|church|neighbor|community/, label: 'Community' },
]

/** The fallback pool for tags no rule recognises, picked by a stable string hash. */
const FALLBACK_CATEGORIES: readonly string[] = ['Trending', 'Local · Trending']

/** A tiny, stable (not cryptographic) string hash: djb2 over UTF-16 code units. */
function stableHash(value: string): number {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) >>> 0
  }
  return hash
}

/**
 * The varied category line for a trend ("Trending", "Public safety · Trending",
 * "Local · Trending", …). Deterministic: the same tag always gets the same line.
 * Never an authority label (D1-R1/R5).
 */
export function categoryFor(tag: string): string {
  const key = tag.toLowerCase()
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(key)) return `${rule.label} · Trending`
  }
  const pick = FALLBACK_CATEGORIES[stableHash(key) % FALLBACK_CATEGORIES.length]
  return pick ?? 'Trending'
}

// -----------------------------------------------------------------------------
// The computation
// -----------------------------------------------------------------------------

interface CasingTally {
  count: number
  latestMs: number
}

interface TagAccumulator {
  count: number
  /** The score in fixed-point units (see {@link SCORE_UNITS}). */
  units: number
  latestMs: number
  casings: Map<string, CasingTally>
}

/** Plain code-unit comparison (never `localeCompare`) for a deterministic order. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/** Records one use of the authored casing `raw` at `ms`. */
function tallyCasing(casings: Map<string, CasingTally>, raw: string, ms: number): void {
  const tally = casings.get(raw)
  if (tally === undefined) casings.set(raw, { count: 1, latestMs: ms })
  else {
    tally.count += 1
    if (ms > tally.latestMs) tally.latestMs = ms
  }
}

/** Picks the display casing: most used, then most recent, then code-unit order. */
function pickDisplay(casings: ReadonlyMap<string, CasingTally>): string {
  let best: { raw: string; tally: CasingTally } | undefined
  for (const [raw, tally] of casings) {
    if (
      best === undefined ||
      tally.count > best.tally.count ||
      (tally.count === best.tally.count && tally.latestMs > best.tally.latestMs) ||
      (tally.count === best.tally.count &&
        tally.latestMs === best.tally.latestMs &&
        compareText(raw, best.raw) < 0)
    ) {
      best = { raw, tally }
    }
  }
  return best?.raw ?? ''
}

/**
 * Scores accumulate as integers in units of 1e-9. A float sum depends on the
 * order of its terms in the last bits; an integer sum does not, so equal sets of
 * posts always produce byte-identical scores and an exact, order-independent tie.
 */
const SCORE_UNITS = 1e9

function computeResolved(
  posts: readonly TrendingPostInput[],
  options: ResolvedOptions,
): readonly TrendingTopic[] {
  const { nowMs, windowMs, halfLifeMs, limit, minPosts, futureToleranceMs } = options
  const tags = new Map<string, TagAccumulator>()

  for (const post of posts) {
    if (!isVisiblePost(post)) continue
    const postMs = Date.parse(post.scenarioTime)
    if (Number.isNaN(postMs)) continue
    if (postMs - nowMs > futureToleranceMs) continue // stamped too far ahead to be "recent"
    const age = Math.max(0, nowMs - postMs)
    if (age > windowMs) continue
    // Fixed-point: integer sums are exact, so the score (and the ranking) cannot
    // depend on the order the posts arrive in.
    const weight = Math.round(0.5 ** (age / halfLifeMs) * SCORE_UNITS)

    // One contribution per DISTINCT tag per post, however often it is repeated.
    const seen = new Set<string>()
    for (const token of parseHashtags(post.text)) {
      if (token.type !== 'hashtag' || seen.has(token.tag)) continue
      seen.add(token.tag)

      let entry = tags.get(token.tag)
      if (entry === undefined) {
        entry = { count: 0, units: 0, latestMs: postMs, casings: new Map() }
        tags.set(token.tag, entry)
      }
      entry.count += 1
      entry.units += weight
      if (postMs > entry.latestMs) entry.latestMs = postMs

      tallyCasing(entry.casings, token.raw, postMs)
    }
  }

  const ranked = [...tags.entries()]
    .filter(([, entry]) => entry.count >= minPosts)
    .sort(([tagA, a], [tagB, b]) =>
      b.units - a.units ||
      b.count - a.count ||
      b.latestMs - a.latestMs ||
      compareText(tagA, tagB),
    )
    .slice(0, limit)

  return ranked.map(([tag, entry]) => ({
    tag,
    display: pickDisplay(entry.casings),
    postCount: entry.count,
    score: entry.units / SCORE_UNITS,
    category: categoryFor(tag),
    latestScenarioTime: new Date(entry.latestMs).toISOString(),
  }))
}

/**
 * The display casing for `tag` among `posts`: the casing authors used most (ties:
 * the most recent, then code-unit order), e.g. `#WaterIssues` for the routing key
 * `waterissues`. The hashtag page's header uses this so it reads like the posts do;
 * returns `undefined` when no post carries the tag. Takes no clock and ignores
 * soft-deleted posts, like the ranking.
 */
export function pickDisplayCasing(
  posts: readonly TrendingPostInput[],
  tag: string,
): string | undefined {
  const casings = new Map<string, CasingTally>()
  for (const post of posts) {
    if (!isVisiblePost(post)) continue
    const postMs = Date.parse(post.scenarioTime)
    const ms = Number.isNaN(postMs) ? 0 : postMs
    for (const token of parseHashtags(post.text)) {
      if (token.type === 'hashtag' && token.tag === tag) tallyCasing(casings, token.raw, ms)
    }
  }
  return casings.size === 0 ? undefined : pickDisplay(casings)
}

/**
 * The PURE, uncached trending computation (see the module header). Returns a
 * fresh array every call. Invalid options (non-finite `now`, non-positive
 * window/half-life) yield an empty list rather than throwing into a render.
 */
export function computeTrending(
  posts: readonly TrendingPostInput[],
  options: TrendingOptions,
): readonly TrendingTopic[] {
  const resolved = resolveOptions(options)
  if (resolved === undefined) return EMPTY
  return computeResolved(posts, resolved)
}

// -----------------------------------------------------------------------------
// Memoization
// -----------------------------------------------------------------------------

/** Per-feed-array cache: resolved-options key → result. Collected with the array. */
const cache = new WeakMap<readonly TrendingPostInput[], Map<string, readonly TrendingTopic[]>>()
/** Bound on distinct option sets cached per feed array (a ticking `now` makes more). */
const MAX_VARIANTS_PER_FEED = 8

/**
 * The MEMOIZED trending computation — what components call. Same `posts` array
 * (by identity) and same resolved options return the SAME result array
 * reference, so a re-render that changes nothing does no work and hands React a
 * stable value. Treats `posts` as immutable (see the module header).
 */
export function trendingTopics(
  posts: readonly TrendingPostInput[],
  options: TrendingOptions,
): readonly TrendingTopic[] {
  const resolved = resolveOptions(options)
  if (resolved === undefined) return EMPTY

  const key = [
    resolved.nowMs,
    resolved.windowMs,
    resolved.halfLifeMs,
    resolved.limit,
    resolved.minPosts,
    resolved.futureToleranceMs,
  ].join('|')
  let variants = cache.get(posts)
  if (variants === undefined) {
    variants = new Map()
    cache.set(posts, variants)
  }
  const hit = variants.get(key)
  if (hit !== undefined) return hit

  const result = computeResolved(posts, resolved)
  if (variants.size >= MAX_VARIANTS_PER_FEED) variants.clear()
  variants.set(key, result)
  return result
}
