/**
 * features/social/explore/trending.ts
 * ---------------------------------------------------------------------------
 * ORGANIC TRENDING (demo-polish F6, story 15-explore; SOC-041 client-side half,
 * hashtags-trending/02 "lite", D1-R5). Participant world — a PURE, UI-free,
 * COBRA-free module: no React, no clock read, no network.
 *
 * WHAT IT COMPUTES. Given the posts the client has already loaded (the newest-200
 * top-level feed — see `useFeed`), it ranks hashtags by how much RECENT activity
 * they carry and returns the top N as `TrendingTopic`s for the Trending panel
 * (`TrendingPanel`) and the Explore page.
 *
 * NOTHING IS DECLARED. There is no list of "official" or "pinned" trends and no
 * input that can set one: a tag appears only because posts in the feed carry it,
 * and it ranks by their volume and recency. (The controller boost-weight lever,
 * SOC-041's other half, is out of scope for this story — when it lands it biases
 * this score and still renders as an ordinary organic trend.) The category label
 * is purely cosmetic and derived from the tag's own text (`categoryFor`); it
 * never says "official", "recommended" or anything authority-bearing (D1-R1/R5).
 *
 * THE SCORE (recency-weighted, in SCENARIO time — COR-053):
 *   - A post is considered only if it is VISIBLE (a soft-deleted / taken-down
 *     post never contributes — `visibility.ts`) and its `scenarioTime` is within
 *     `windowMs` BEFORE `now` (default 12 scenario hours). `now` is a REQUIRED
 *     input — the caller passes `scenarioNow()`; this module never reads any
 *     clock, wall or scenario, so it is deterministic and trivially testable.
 *   - Each qualifying post adds `0.5 ^ (age / halfLifeMs)` to every DISTINCT
 *     hashtag it carries (an exponential decay: default half-life 3 scenario
 *     hours — a post from three hours ago counts half as much as one that just
 *     landed). A hashtag repeated within one post counts once for that post.
 *   - A post stamped AFTER `now` (clock skew, or a feed that is a tick ahead of
 *     the local clock) is not dropped: the feed has already decided it is
 *     visible, so its age is clamped to 0 and it counts at full weight.
 *   - `postCount` is the number of qualifying posts carrying the tag — the
 *     "N posts" line on the panel.
 *
 * DETERMINISTIC TIE-BREAK. Ranking is a total order, so the same feed always
 * produces the same list regardless of input order: score (accumulated as exact
 * fixed-point integers in units of 1e-9, so summation order cannot change it or
 * reorder equals) descending, then
 * `postCount` descending, then the most recent post's time descending, then the
 * tag in plain code-unit order (never locale-dependent).
 *
 * DISPLAY CASING comes from the data too: the most-used authored casing of the
 * tag (ties: most recent, then code-unit order), so `#WaterIssues` is shown as
 * written rather than the lowercased routing key (`tag`).
 *
 * MEMOIZED. `trendingTopics` is the memoized entry point: results are cached per
 * `posts` array identity (a `WeakMap`, so a discarded feed array is collected)
 * and per resolved options, so re-rendering with the same loaded feed and the
 * same scenario minute returns the SAME array reference. It therefore treats
 * `posts` as immutable — `useFeed` hands out a stable, memoized array and never
 * mutates it. `computeTrending` is the uncached pure function it wraps.
 *
 * COR-001: this module only ever sees the already exercise-scoped feed the
 * caller hands it; it has no way to fetch or widen the set.
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
  return { nowMs, windowMs, halfLifeMs, limit, minPosts }
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
  const { nowMs, windowMs, halfLifeMs, limit, minPosts } = options
  const tags = new Map<string, TagAccumulator>()

  for (const post of posts) {
    if (!isVisiblePost(post)) continue
    const postMs = Date.parse(post.scenarioTime)
    if (Number.isNaN(postMs)) continue
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

      const tally = entry.casings.get(token.raw)
      if (tally === undefined) entry.casings.set(token.raw, { count: 1, latestMs: postMs })
      else {
        tally.count += 1
        if (postMs > tally.latestMs) tally.latestMs = postMs
      }
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

  const key = `${resolved.nowMs}|${resolved.windowMs}|${resolved.halfLifeMs}|${resolved.limit}|${resolved.minPosts}`
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
