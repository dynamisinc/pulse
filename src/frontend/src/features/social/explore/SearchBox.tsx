/**
 * features/social/explore/SearchBox.tsx
 * ---------------------------------------------------------------------------
 * The search box and its results (demo-polish F6, story 15-explore; SOC-042,
 * feeds-discovery/03 "lite", SOC-052, D1-008, NFR-001). Participant world (Pulse
 * Social skin): plain semantic elements + scoped CSS Modules + FontAwesome only —
 * NO COBRA, NO themed MUI.
 *
 * WHAT IT DOES. A search-as-you-type box that filters the loaded posts (text and
 * hashtag match) and the persona cast (name, handle) — client-side, no endpoint
 * (`search.ts` holds the pure matching/ordering). Results appear inline under the
 * box. Two sections:
 *   - PEOPLE — accounts in relevance order. A verified agency and its unverified
 *     lookalike sit side by side and render IDENTICALLY except for the seal: no
 *     "official"/"unverified" label, no machine-readable tell (SOC-052/D1-008; the
 *     rule and its enforcement live in `SearchResultRows.tsx`).
 *   - POSTS — with a Recent / Top toggle (scenario time descending / engagement
 *     descending). The toggle orders posts only; accounts have no time or
 *     engagement of their own.
 * Each section caps at 8 people / 50 posts with a "Show all" button.
 *
 * SELF-CONTAINED. Posts come from the shared, live Explore baseline
 * (`useExploreFeed` — one feed read however many boxes are mounted, kept current by
 * arrivals) and the cast from the channel's persona directory; no data props. A
 * failed read of either is reported in ITS section ("Posts aren’t available right
 * now.") while the other still works.
 *
 * `variant`: `'page'` (default) lets results flow inline; `'rail'` — the ~344px
 * right-rail slot — caps the results panel's height and scrolls it, so a long list
 * cannot push the rest of the sticky rail out of reach.
 *
 * ACCESSIBILITY (NFR-001).
 *  - A `role="search"` landmark named by its VISIBLE label ("Search posts and
 *    people", `aria-labelledby`).
 *  - A polite, atomic live region (`role="status"`), mounted from the start,
 *    announces a query-aware summary ("3 posts and 0 people for “zephyr”.") once the
 *    reader pauses (400 ms), not per keystroke. "No results" is also shown as TEXT with
 *    an icon, never colour.
 *  - Keyboard: Down or Enter in the box jumps to the first result; Up/Down move
 *    between results; Up from the first returns to the box; Escape in the results
 *    returns to the box and in the box clears it. The radios keep native arrows.
 *  - The selected sort option shows a check icon, a filled pill and bold text —
 *    never colour alone. Focus rings are a solid ink outline (>= 3:1).
 *
 * TELEMETRY (XC-004). One `search` event per SETTLED non-empty query (the same 400 ms
 * debounce as the announcement), with the query (trimmed, HTML-stripped through
 * `sanitizeText`, <= 100 chars) and the post / people counts as payload — no persona or
 * post ids. The raw query is free text a participant typed or pasted (NFR-004): it is
 * sanitized BEFORE it is truncated, so a pasted `<img onerror=…>` never reaches an event
 * sink (an AAR export, a console replay) and a cut cannot leave half a tag behind. The
 * server emits no `search` event, so the client emits in both mock and live mode. Not
 * emitted while loading or when a section failed (the counts would be wrong).
 *
 * SCENARIO TIME (COR-053): result times render from ONE `useScenarioTime` snapshot in
 * the exercise zone. The debounce is a UI timer only. CONTENT SECURITY (NFR-004): the
 * query is only compared against already-sanitized text and echoed as a React text
 * child. COR-001: no client `exerciseId` on the wire.
 */

import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faMagnifyingGlass, faXmark } from '@fortawesome/free-solid-svg-icons'
import { useSession } from '@/core/auth'
import { scenarioNow, useScenarioTime } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import { sanitizeText } from '../services/sanitize'
import { useExploreOpeners, type ExploreOpenerProps } from './exploreNavigation'
import { parseQuery, runSearch, type SearchSort } from './search'
import { PersonResultRow, PostResultRow } from './SearchResultRows'
import { useDebouncedValue } from './useDebouncedValue'
import { useExploreFeed } from './useExploreFeed'
import styles from './SearchBox.module.css'

/** How long the query must rest before it is announced and recorded. */
const SETTLE_DELAY_MS = 400
/** Display caps; "Show all" lifts them. */
const MAX_PEOPLE = 8
const MAX_POSTS = 50
/** The longest query recorded in telemetry. */
const MAX_TELEMETRY_QUERY = 100

const SORT_OPTIONS: ReadonlyArray<{ readonly value: SearchSort; readonly label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'top', label: 'Top' },
]

export interface SearchBoxProps extends ExploreOpenerProps {
  /**
   * Fires when a search starts or ends (the query becomes / stops being
   * searchable). `ExplorePage` uses it to hide Trending behind the results.
   */
  readonly onSearchingChange?: (searching: boolean) => void
  /** `'page'` (default) = inline results; `'rail'` = height-capped, scrolling results. */
  readonly variant?: 'page' | 'rail'
}

/** What the box has settled on: drives the announcement and the telemetry event. */
interface Settled {
  readonly query: string
  readonly text: string
  readonly ready: boolean
  readonly postCount: number
  readonly peopleCount: number
}

const NOT_SEARCHING: Settled = {
  query: '',
  text: '',
  ready: false,
  postCount: 0,
  peopleCount: 0,
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

interface SummaryInput {
  readonly echoed: string
  readonly loading: boolean
  readonly postsFailed: boolean
  readonly peopleFailed: boolean
  readonly postCount: number
  readonly peopleCount: number
}

/** The query-aware summary the live region announces. Empty while loading. */
function summaryText(input: SummaryInput): string {
  const { echoed, loading, postsFailed, peopleFailed, postCount, peopleCount } = input
  if (loading) return ''
  if (postsFailed && peopleFailed) return 'Search isn’t available right now.'
  const tail = `for “${echoed}”.`
  const posts = plural(postCount, 'post', 'posts')
  const people = plural(peopleCount, 'person', 'people')
  if (postsFailed) return `${people} ${tail} Posts aren’t available right now.`
  if (peopleFailed) return `${posts} ${tail} People aren’t available right now.`
  if (postCount === 0 && peopleCount === 0) return `No results ${tail}`
  return `${posts} and ${people} ${tail}`
}

export function SearchBox({
  onSearchingChange,
  variant = 'page',
  ...openerProps
}: SearchBoxProps) {
  const { onOpenPost, onOpenProfile } = useExploreOpeners(openerProps)
  const { exerciseId, timeZone } = useExerciseContext()
  const session = useSession()
  const { format } = useScenarioTime(timeZone)
  const feed = useExploreFeed()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SearchSort>('recent')
  const [showAll, setShowAll] = useState({ people: false, posts: false })
  // Typing stays instant; matching up to 200 posts per keystroke runs at lower priority.
  const deferredQuery = useDeferredValue(query)

  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchingRef = useRef(false)

  const baseId = useId()
  const labelId = `${baseId}-label`
  const inputId = `${baseId}-input`
  const peopleHeadingId = `${baseId}-people`
  const postsHeadingId = `${baseId}-posts`

  // Posts need their authors, so they wait for the cast as well as the feed.
  const postsLoading = feed.loading || feed.peopleLoading
  const peopleLoading = feed.peopleLoading
  const postsFailed = feed.failed
  const peopleFailed = feed.peopleFailed

  const results = useMemo(
    () =>
      runSearch({ posts: feed.views, personas: feed.personas, query: deferredQuery, sort }),
    [feed.views, feed.personas, deferredQuery, sort],
  )
  const searching = results.query.kind !== 'empty'
  const loading = postsLoading || peopleLoading
  const noResults = results.posts.length === 0 && results.people.length === 0

  const visiblePeople = useMemo(
    () => (showAll.people ? results.people : results.people.slice(0, MAX_PEOPLE)),
    [results.people, showAll.people],
  )
  const visiblePosts = useMemo(
    () => (showAll.posts ? results.posts : results.posts.slice(0, MAX_POSTS)),
    [results.posts, showAll.posts],
  )

  // Result times: one `format` snapshot for the whole list, recomputed only when the
  // visible posts or the clock snapshot change (not on every keystroke elsewhere).
  const times = useMemo(
    () =>
      visiblePosts.map(post => ({
        relative: format(post.scenarioTime, { format: 'relative' }),
        absolute: format(post.scenarioTime, { format: 'absolute' }),
      })),
    [visiblePosts, format],
  )

  // The query as it is echoed (announcement, "no results") and recorded.
  const echoed = deferredQuery.trim().replace(/\s+/g, ' ')

  const current = useMemo<Settled>(() => {
    if (!searching) return NOT_SEARCHING
    const postCount = results.posts.length
    const peopleCount = results.people.length
    const text = summaryText({
      echoed,
      loading,
      postsFailed,
      peopleFailed,
      postCount,
      peopleCount,
    })
    return {
      query: echoed,
      text,
      ready: !loading && !postsFailed && !peopleFailed,
      postCount,
      peopleCount,
    }
  }, [
    searching,
    loading,
    postsFailed,
    peopleFailed,
    echoed,
    results.posts.length,
    results.people.length,
  ])
  const settled = useDebouncedValue(current, SETTLE_DELAY_MS)

  // XC-004: one `search` event per settled, non-empty query (re-typing the same
  // query after clearing the box is a new search).
  const recordedQueryRef = useRef('')
  useEffect(() => {
    if (settled.query === '') {
      recordedQueryRef.current = ''
      return
    }
    if (!settled.ready || recordedQueryRef.current === settled.query) return
    recordedQueryRef.current = settled.query
    buildAndEmit({
      exerciseId,
      eventType: 'search',
      channel: 'social',
      actor: { kind: 'participant', participantId: session.accountId },
      wallClockTime: wallClockNowIso(),
      scenarioTime: scenarioNow().toISOString(),
      timeZone,
      payload: {
        query: sanitizeText(settled.query).slice(0, MAX_TELEMETRY_QUERY),
        postCount: settled.postCount,
        peopleCount: settled.peopleCount,
      },
    })
  }, [settled, exerciseId, timeZone, session.accountId])

  const updateQuery = (next: string) => {
    setQuery(next)
    setShowAll(previous =>
      previous.people || previous.posts ? { people: false, posts: false } : previous,
    )
    const active = parseQuery(next).kind !== 'empty'
    if (active !== searchingRef.current) {
      searchingRef.current = active
      onSearchingChange?.(active)
    }
  }

  const resultLinks = (): HTMLAnchorElement[] =>
    Array.from(resultsRef.current?.querySelectorAll<HTMLAnchorElement>('a[data-result-link]') ?? [])

  const focusFirstResult = (): boolean => {
    const first = resultLinks()[0]
    first?.focus()
    return first !== undefined
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    focusFirstResult()
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      if (focusFirstResult()) event.preventDefault()
    } else if (event.key === 'Escape' && query !== '') {
      event.preventDefault()
      updateQuery('')
    }
  }

  const handleResultsKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      inputRef.current?.focus()
      return
    }
    const target = event.target
    if (!(target instanceof HTMLAnchorElement) || !target.hasAttribute('data-result-link')) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return

    event.preventDefault()
    const links = resultLinks()
    const index = links.indexOf(target)
    if (event.key === 'ArrowDown') {
      links[index + 1]?.focus()
    } else if (index <= 0) {
      inputRef.current?.focus()
    } else {
      links[index - 1]?.focus()
    }
  }

  const bothFailed = postsFailed && peopleFailed
  const showPeople = peopleFailed || visiblePeople.length > 0
  const showPosts = postsFailed || visiblePosts.length > 0
  const resultsClass = variant === 'rail' ? `${styles.results} ${styles.resultsRail}` : styles.results

  return (
    <div className={styles.root} data-testid="search-box">
      <form className={styles.form} role="search" aria-labelledby={labelId} onSubmit={handleSubmit}>
        <label id={labelId} htmlFor={inputId} className={styles.label}>
          Search posts and people
        </label>
        <div className={styles.field}>
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            className={styles.searchIcon}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            id={inputId}
            type="search"
            className={styles.input}
            value={query}
            placeholder="Search"
            autoComplete="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(event: ChangeEvent<HTMLInputElement>) => updateQuery(event.target.value)}
            onKeyDown={handleInputKeyDown}
          />
          {query !== '' && (
            <button
              type="button"
              className={styles.clear}
              aria-label="Clear search"
              onClick={() => {
                updateQuery('')
                inputRef.current?.focus()
              }}
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </button>
          )}
        </div>
      </form>

      {/* Always mounted so assistive tech registers it before the first announcement. */}
      <div
        className={styles.srOnly}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="search-live"
      >
        {settled.text}
      </div>

      {searching && (
        <div
          ref={resultsRef}
          className={resultsClass}
          data-testid="search-results"
          onKeyDown={handleResultsKeyDown}
        >
          {loading && <p className={styles.state}>Searching…</p>}
          {!loading && bothFailed && (
            <p className={styles.state}>Search isn’t available right now.</p>
          )}
          {!loading && !postsFailed && !peopleFailed && noResults && (
            <p className={styles.state} data-testid="search-empty">
              <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
              {` No results for “${echoed}”.`}
            </p>
          )}

          {!loading && !bothFailed && showPeople && (
            <section
              className={styles.section}
              aria-labelledby={peopleHeadingId}
              data-testid="search-people"
            >
              <div className={styles.sectionHead}>
                <h2 id={peopleHeadingId} className={styles.sectionTitle}>People</h2>
                {!peopleFailed && (
                  <span className={styles.sectionCount}>
                    {plural(results.people.length, 'result', 'results')}
                  </span>
                )}
              </div>
              {peopleFailed
                ? <p className={styles.state}>People aren’t available right now.</p>
                : (
                  <ul className={styles.list} role="list">
                    {visiblePeople.map(persona => (
                      <PersonResultRow
                        key={persona.id}
                        persona={persona}
                        onOpenProfile={onOpenProfile}
                      />
                    ))}
                  </ul>
                )}
              {!peopleFailed && results.people.length > MAX_PEOPLE && (
                <button
                  type="button"
                  className={styles.showAll}
                  aria-expanded={showAll.people}
                  onClick={() =>
                    setShowAll(previous => ({ ...previous, people: !previous.people }))}
                >
                  {showAll.people ? 'Show fewer' : `Show all ${results.people.length} people`}
                </button>
              )}
            </section>
          )}

          {!loading && !bothFailed && showPosts && (
            <section
              className={styles.section}
              aria-labelledby={postsHeadingId}
              data-testid="search-posts"
            >
              <div className={styles.sectionHead}>
                <h2 id={postsHeadingId} className={styles.sectionTitle}>Posts</h2>
                {!postsFailed && (
                  <span className={styles.sectionCount}>
                    {plural(results.posts.length, 'result', 'results')}
                  </span>
                )}
                {!postsFailed && (
                  <fieldset className={styles.sort}>
                    <legend className={styles.srOnly}>Sort posts by</legend>
                    {SORT_OPTIONS.map(option => {
                      const selected = sort === option.value
                      return (
                        <label
                          key={option.value}
                          className={
                            selected
                              ? `${styles.sortOption} ${styles.sortOptionOn}`
                              : styles.sortOption
                          }
                        >
                          <input
                            type="radio"
                            name={`${baseId}-sort`}
                            value={option.value}
                            checked={selected}
                            className={styles.sortInput}
                            onChange={() => setSort(option.value)}
                          />
                          {selected && (
                            <FontAwesomeIcon
                              icon={faCheck}
                              className={styles.sortCheck}
                              aria-hidden="true"
                            />
                          )}
                          <span>{option.label}</span>
                        </label>
                      )
                    })}
                  </fieldset>
                )}
              </div>
              {postsFailed
                ? <p className={styles.state}>Posts aren’t available right now.</p>
                : (
                  <ul className={styles.list} role="list">
                    {visiblePosts.map((post, index) => (
                      <PostResultRow
                        key={post.id}
                        post={post}
                        relativeTime={times[index]?.relative ?? ''}
                        absoluteTime={times[index]?.absolute ?? ''}
                        onOpenPost={onOpenPost}
                      />
                    ))}
                  </ul>
                )}
              {!postsFailed && results.posts.length > MAX_POSTS && (
                <button
                  type="button"
                  className={styles.showAll}
                  aria-expanded={showAll.posts}
                  onClick={() =>
                    setShowAll(previous => ({ ...previous, posts: !previous.posts }))}
                >
                  {showAll.posts ? 'Show fewer' : `Show all ${results.posts.length} posts`}
                </button>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
