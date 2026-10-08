/**
 * features/social/explore/SearchBox.tsx
 * ---------------------------------------------------------------------------
 * The search box and its results (demo-polish F6, story 15-explore; SOC-042,
 * feeds-discovery/03 "lite", SOC-052, D1-008, NFR-001). Participant world (Pulse
 * Social skin): plain semantic elements + scoped CSS Modules + FontAwesome only —
 * NO COBRA, NO themed MUI, NO `@mui/icons-material`.
 *
 * WHAT IT DOES. A search-as-you-type box that filters the LOADED posts (text and
 * hashtag match) and the persona cast (name, handle) — all client-side, no
 * endpoint (`search.ts` holds the pure matching/ordering). Results appear inline
 * directly under the box, so it works the same in the ~344px right rail and in
 * the 600px Explore column. Two sections:
 *   - PEOPLE — accounts, in relevance order. A verified agency and its unverified
 *     lookalike sit side by side and render IDENTICALLY except for the seal: no
 *     "official"/"unverified" label, no machine-readable tell (SOC-052/D1-008 —
 *     the rule and its enforcement live in `SearchResultRows.tsx`).
 *   - POSTS — with a Recent / Top toggle (Recent = scenario time descending,
 *     Top = engagement descending). The toggle orders posts only; accounts have no
 *     time or engagement of their own.
 *
 * SELF-CONTAINED. It reads the feed (`useFeed`) and the cast (`usePersonas`)
 * itself — no data props — so the orchestrator mounts `<SearchBox />` into F1's
 * right-rail `searchSlot` as-is. The optional `onOpen*` callbacks
 * (`exploreNavigation.ts`) navigate in-app; without them rows are real links.
 *
 * ACCESSIBILITY (NFR-001).
 *  - The box is a `role="search"` landmark named by its VISIBLE label
 *    ("Search posts and people", `aria-labelledby`).
 *  - A polite, atomic live region (`role="status"`) is mounted from the start and
 *    announces the result counts ("12 posts, 2 people.") — debounced, so a reader
 *    typing hears one summary when they pause, not one per keystroke. "No
 *    results" is announced and also shown as TEXT with an icon (never colour).
 *  - Keyboard: Tab reaches the box, the Recent/Top radios and each result row (one
 *    stop per row). Down-arrow (or Enter) in the box jumps to the first result;
 *    Up/Down move between results; Up from the first result returns to the box;
 *    Escape in the results returns to the box, and in the box clears it. The
 *    radios use native arrow-key selection.
 *  - The selected sort option is marked by a check icon, a filled pill and bold
 *    text as well as `checked` — never colour alone.
 *  - Focus rings are a solid ink outline (>= 3:1).
 *
 * SCENARIO TIME (COR-053): every result time renders from ONE `useScenarioTime`
 * snapshot in the exercise zone; wall-clock is never shown. The announcement
 * debounce is a UI timer only.
 *
 * CONTENT SECURITY (NFR-004): the query is only ever compared against already
 * sanitized text and echoed as a React text child (never as HTML).
 *
 * COR-001: the data comes from `useFeed`/`usePersonas`, which take no client
 * `exerciseId`; search cannot see another exercise's content.
 */

import {
  useDeferredValue,
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
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { usePersonas } from '@/features/personas'
import { useFeed } from '../hooks/useFeed'
import { useExploreOpeners, type ExploreOpenerProps } from './exploreNavigation'
import { parseQuery, runSearch, type SearchSort } from './search'
import { PersonResultRow, PostResultRow } from './SearchResultRows'
import { useDebouncedValue } from './useDebouncedValue'
import styles from './SearchBox.module.css'

/** How long the query must rest before the live region announces counts. */
const ANNOUNCE_DELAY_MS = 400
/** Display caps (the true totals are still shown/announced). */
const MAX_PEOPLE = 8
const MAX_POSTS = 50

const SORT_OPTIONS: ReadonlyArray<{ readonly value: SearchSort; readonly label: string }> = [
  { value: 'recent', label: 'Recent' },
  { value: 'top', label: 'Top' },
]

export interface SearchBoxProps extends ExploreOpenerProps {
  /**
   * Fires when a search starts or ends (the query becomes / stops being
   * searchable). `ExplorePage` uses it to swap Trending for the results.
   */
  readonly onSearchingChange?: (searching: boolean) => void
}

function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

export function SearchBox({ onSearchingChange, ...openerProps }: SearchBoxProps) {
  const { onOpenPost, onOpenProfile } = useExploreOpeners(openerProps)
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)
  const feed = useFeed()
  const cast = usePersonas()

  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<SearchSort>('recent')
  // Typing stays instant; matching 200 posts per keystroke runs at lower priority.
  const deferredQuery = useDeferredValue(query)

  const inputRef = useRef<HTMLInputElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const searchingRef = useRef(false)

  const baseId = useId()
  const labelId = `${baseId}-label`
  const inputId = `${baseId}-input`
  const peopleHeadingId = `${baseId}-people`
  const postsHeadingId = `${baseId}-posts`

  const loading = feed.loading || cast.loading
  const failed =
    (feed.error !== undefined || cast.error !== undefined) &&
    feed.posts.length === 0 &&
    cast.personas.length === 0

  const results = useMemo(
    () => runSearch({ posts: feed.posts, personas: cast.personas, query: deferredQuery, sort }),
    [feed.posts, cast.personas, deferredQuery, sort],
  )
  const searching = results.query.kind !== 'empty'
  const noResults = results.posts.length === 0 && results.people.length === 0

  // The text the live region will announce (settled by the debounce below).
  const summary = useMemo(() => {
    if (!searching || loading) return ''
    if (failed) return 'Search isn’t available right now.'
    if (noResults) return `No results for “${deferredQuery.trim()}”.`
    return `${plural(results.posts.length, 'post', 'posts')}, ${plural(
      results.people.length,
      'person',
      'people',
    )}.`
  }, [
    searching,
    loading,
    failed,
    noResults,
    deferredQuery,
    results.posts.length,
    results.people.length,
  ])
  const announcement = useDebouncedValue(summary, ANNOUNCE_DELAY_MS)

  const updateQuery = (next: string) => {
    setQuery(next)
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

  const visiblePeople = results.people.slice(0, MAX_PEOPLE)
  const visiblePosts = results.posts.slice(0, MAX_POSTS)

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
        {announcement}
      </div>

      {searching && (
        <div
          ref={resultsRef}
          className={styles.results}
          data-testid="search-results"
          onKeyDown={handleResultsKeyDown}
        >
          {loading && <p className={styles.state}>Searching…</p>}
          {!loading && failed && (
            <p className={styles.state}>Search isn’t available right now.</p>
          )}
          {!loading && !failed && noResults && (
            <p className={styles.state} data-testid="search-empty">
              <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
              {` No results for “${deferredQuery.trim()}”.`}
            </p>
          )}

          {visiblePeople.length > 0 && (
            <section
              className={styles.section}
              aria-labelledby={peopleHeadingId}
              data-testid="search-people"
            >
              <div className={styles.sectionHead}>
                <h2 id={peopleHeadingId} className={styles.sectionTitle}>People</h2>
                <span className={styles.sectionCount}>
                  {plural(results.people.length, 'result', 'results')}
                </span>
              </div>
              <ul className={styles.list} role="list">
                {visiblePeople.map(persona => (
                  <PersonResultRow
                    key={persona.id}
                    persona={persona}
                    onOpenProfile={onOpenProfile}
                  />
                ))}
              </ul>
              {results.people.length > visiblePeople.length && (
                <p className={styles.note}>
                  {`Showing the first ${visiblePeople.length} of ${results.people.length} people.`}
                </p>
              )}
            </section>
          )}

          {visiblePosts.length > 0 && (
            <section
              className={styles.section}
              aria-labelledby={postsHeadingId}
              data-testid="search-posts"
            >
              <div className={styles.sectionHead}>
                <h2 id={postsHeadingId} className={styles.sectionTitle}>Posts</h2>
                <span className={styles.sectionCount}>
                  {plural(results.posts.length, 'result', 'results')}
                </span>
                <fieldset className={styles.sort}>
                  <legend className={styles.srOnly}>Sort posts by</legend>
                  {SORT_OPTIONS.map(option => {
                    const selected = sort === option.value
                    return (
                      <label
                        key={option.value}
                        className={
                          selected ? `${styles.sortOption} ${styles.sortOptionOn}` : styles.sortOption
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
              </div>
              <ul className={styles.list} role="list">
                {visiblePosts.map(post => (
                  <PostResultRow
                    key={post.id}
                    post={post}
                    relativeTime={format(post.scenarioTime, { format: 'relative' })}
                    absoluteTime={format(post.scenarioTime, { format: 'absolute' })}
                    onOpenPost={onOpenPost}
                  />
                ))}
              </ul>
              {results.posts.length > visiblePosts.length && (
                <p className={styles.note}>
                  {`Showing the first ${visiblePosts.length} of ${results.posts.length} posts.`}
                </p>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
