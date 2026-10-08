/**
 * features/social/explore/search.ts
 * ---------------------------------------------------------------------------
 * CLIENT-SIDE SEARCH over the loaded posts and the persona cast (demo-polish F6,
 * story 15-explore; SOC-042, feeds-discovery/03 "lite", SOC-052/D1-008).
 * Participant world — PURE, UI-free, COBRA-free: no React, no clock, no network.
 *
 * SCOPE. Everything here runs over data the client ALREADY has — the newest-200
 * top-level feed (`useFeed`) and the participant-projection persona cast
 * (`usePersonas`). There is no search endpoint, no index, no recents. A match
 * therefore means "in what is loaded", and nothing in this module can reach
 * another exercise's content (COR-001).
 *
 * QUERY GRAMMAR (deliberately tiny; "advanced operators" are out of scope):
 *   - Trimmed, case-insensitive, whitespace-separated TERMS that must ALL appear
 *     (AND). A leading `@` is ignored ("@fairhaven" searches "fairhaven").
 *   - A query that STARTS with `#` is a hashtag search: it matches posts that
 *     carry a hashtag beginning with that text (`#water` finds `#WaterIssues`),
 *     and finds no people (a persona name is never a hashtag).
 *   - Nothing searchable after trimming (empty, or just `#`/`@`) is the `empty`
 *     query: no results, and the UI shows no results section at all.
 *
 * POSTS match on their text and hashtags (not on author names — that is what the
 * People section is for). Soft-deleted / taken-down posts never match
 * (`visibility.ts`). Two orders (the Top/Recent toggle):
 *   - `recent`: scenario time descending (COR-053), tie → id.
 *   - `top`: engagement (reply + repost + like [+ share]) descending, tie →
 *     recent, tie → id.
 * Both are total orders, so the same input always yields the same list.
 *
 * PEOPLE match on display name or handle. Their order is RELEVANCE, then handle:
 * exact handle, then handle prefix, then display-name prefix, then any other
 * containment. THE ORDER NEVER CONSULTS `verified`, `kind`, follower counts or
 * any other trust signal (SOC-052 / D1-008): a verified agency and its unverified
 * lookalike match a query the same way, so they land next to each other, and the
 * platform neither promotes the real one nor demotes the fake. (`Persona` — the
 * participant projection — does not even carry `personaType`, so the archetype
 * cannot leak in by accident; `search.test.ts` pins the order as independent of
 * the `verified` flag.) The Top/Recent toggle applies to POSTS only; accounts
 * have no post time or engagement of their own to sort by.
 */

import type { Persona } from '@/features/personas'
import type { PostView } from '../components/post/types'
import { extractHashtags } from '../utils/hashtags'
import { isVisiblePost } from './visibility'

/** The two post orders behind the Top/Recent toggle. */
export type SearchSort = 'top' | 'recent'

/** A parsed query. `empty` means "do not search". */
export type ParsedQuery =
  | { readonly kind: 'empty' }
  | { readonly kind: 'hashtag'; readonly needle: string }
  | { readonly kind: 'text'; readonly needle: string; readonly terms: readonly string[] }

export interface SearchInput {
  readonly posts: readonly PostView[]
  readonly personas: readonly Persona[]
  readonly query: string
  readonly sort: SearchSort
}

export interface SearchResults {
  readonly query: ParsedQuery
  readonly posts: readonly PostView[]
  readonly people: readonly Persona[]
}

const NO_RESULTS: Pick<SearchResults, 'posts' | 'people'> = Object.freeze({
  posts: Object.freeze([]) as readonly PostView[],
  people: Object.freeze([]) as readonly Persona[],
})

/** Parses the raw input into a {@link ParsedQuery}. See the module header. */
export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim()
  if (trimmed === '') return { kind: 'empty' }

  if (trimmed.startsWith('#')) {
    const needle = (trimmed.slice(1).split(/\s+/)[0] ?? '').toLowerCase()
    return needle === '' ? { kind: 'empty' } : { kind: 'hashtag', needle }
  }

  const withoutAt = trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
  const terms = withoutAt.toLowerCase().split(/\s+/).filter(term => term !== '')
  return terms.length === 0
    ? { kind: 'empty' }
    : { kind: 'text', needle: terms.join(' '), terms }
}

// -----------------------------------------------------------------------------
// Ordering
// -----------------------------------------------------------------------------

/** Plain code-unit comparison (never `localeCompare`) for a deterministic order. */
function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function timeMs(post: Pick<PostView, 'scenarioTime'>): number {
  const ms = Date.parse(post.scenarioTime)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Engagement for the Top order: every interaction counts once. Shared with the
 * hashtag page so "Top" means the same thing on both surfaces.
 */
export function engagementScore(post: Pick<PostView, 'counts'>): number {
  const { reply, repost, like, share } = post.counts
  return reply + repost + like + (share ?? 0)
}

/** Recent: scenario time descending (COR-053), tie → id. */
export function compareRecent(a: PostView, b: PostView): number {
  return timeMs(b) - timeMs(a) || compareText(a.id, b.id)
}

/** Top: engagement descending, tie → recent. */
export function compareTop(a: PostView, b: PostView): number {
  return engagementScore(b) - engagementScore(a) || compareRecent(a, b)
}

/** A sorted COPY of `posts` in the requested order (the input is not mutated). */
export function sortPosts(posts: readonly PostView[], sort: SearchSort): PostView[] {
  return [...posts].sort(sort === 'top' ? compareTop : compareRecent)
}

// -----------------------------------------------------------------------------
// Matching
// -----------------------------------------------------------------------------

function postMatches(post: PostView, query: ParsedQuery): boolean {
  if (query.kind === 'empty' || !isVisiblePost(post)) return false
  if (query.kind === 'hashtag') {
    return extractHashtags(post.text).some(tag => tag.startsWith(query.needle))
  }
  const haystack = post.text.toLowerCase()
  return query.terms.every(term => haystack.includes(term))
}

/** Posts matching `query`, in the requested order. */
export function searchPosts(
  posts: readonly PostView[],
  query: ParsedQuery,
  sort: SearchSort,
): PostView[] {
  return sortPosts(
    posts.filter(post => postMatches(post, query)),
    sort,
  )
}

/** Lower is more relevant. `undefined` = not a match. Reads name and handle ONLY. */
function personaRank(persona: Persona, query: ParsedQuery): number | undefined {
  if (query.kind !== 'text') return undefined
  const handle = persona.handle.toLowerCase()
  const name = persona.displayName.toLowerCase()
  const haystack = `${name} ${handle}`
  if (!query.terms.every(term => haystack.includes(term))) return undefined

  if (handle === query.needle) return 0
  if (handle.startsWith(query.needle)) return 1
  if (name.startsWith(query.needle)) return 2
  return 3
}

/**
 * People matching `query` (name or handle), by relevance then handle. Never
 * ordered or filtered by `verified`/`kind` (SOC-052/D1-008 — see the header).
 */
export function searchPeople(personas: readonly Persona[], query: ParsedQuery): Persona[] {
  const ranked: Array<{ persona: Persona; rank: number }> = []
  for (const persona of personas) {
    const rank = personaRank(persona, query)
    if (rank !== undefined) ranked.push({ persona, rank })
  }
  return ranked
    .sort((a, b) =>
      a.rank - b.rank ||
      compareText(a.persona.handle.toLowerCase(), b.persona.handle.toLowerCase()) ||
      compareText(a.persona.id, b.persona.id),
    )
    .map(entry => entry.persona)
}

/** Runs the whole search: parse, match posts and people, order posts. */
export function runSearch(input: SearchInput): SearchResults {
  const query = parseQuery(input.query)
  if (query.kind === 'empty') return { query, ...NO_RESULTS }
  return {
    query,
    posts: searchPosts(input.posts, query, input.sort),
    people: searchPeople(input.personas, query),
  }
}
