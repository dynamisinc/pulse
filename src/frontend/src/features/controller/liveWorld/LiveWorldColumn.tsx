/**
 * features/controller/liveWorld/LiveWorldColumn.tsx
 * ---------------------------------------------------------------------------
 * The console's LIVE WORLD column (demo-polish C2,
 * docs/features/demo-polish/18-live-world-column.md; CTL-030, CTL-031 lite,
 * CTL-001, NFR-001, NFR-002 / SOC-071, COR-001, COR-053; demo beat 2). STAFF
 * world (COBRA) showing PARTICIPANT CONTENT: the controller watches what
 * participants see, and reacts to it, without opening a second participant tab.
 *
 * ## It must never be confusable with a participant view
 * A navy title bar reading "LIVE WORLD" with a visible transport status
 * ("REALTIME" / "POLLING" / "CONNECTING" as text), a bordered panel on the
 * console surface, MONOSPACED metadata, tight hairline rows, COBRA controls — and
 * no `PostCard`, no participant skin, no avatar photos. `liveWorldTwoWorlds.test`
 * asserts the module graph imports no participant post component and no
 * `social.module.css`. See `liveWorldStyles.ts` for the tokens and `LiveWorldRow`
 * for the row anatomy.
 *
 * ## Data (see `useLiveWorldFeed`)
 * The baseline is `resolveFeed('all', { includeReplies: true })` (replies
 * included); new posts arrive on the SHARED realtime transport
 * (`defaultArrivalSource` — one connection, polling fallback). A staff session
 * reads the same participant-safe payload a participant does, so no provenance is
 * ever on screen and no `exerciseId` is ever sent (COR-001). A failed read is an
 * inline error with Retry — never an empty "all quiet". The panel is keyed by the
 * session's exercise, so switching exercise mounts a fresh column with nothing of
 * the old one left in it.
 *
 * ## Real time without disorientation (burst legibility)
 * Arrivals are batched. While the controller is READING — the list is scrolled
 * down, or keyboard focus is on a row below the top — arrivals are held behind a
 * visible, keyboard-reachable "N new" control instead of shifting the list; at
 * the top they insert in place. Activating "N new" (or scrolling back to the top
 * / leaving the list) merges them and returns to the top. The list is bounded
 * (see `liveWorldModel`), rows are memoized, and the log region is
 * `role="log"` with `aria-live="off"`: a dense staff surface gets a button, not a
 * chatty live region. Only a CHANGE of filter (and the first load) is announced,
 * politely, as a count of matching rows.
 *
 * ## Filters
 * One picker: All posts (default), a hashtag chosen from the tags seen, or a
 * persona chosen from `usePersonas()`. The choice is component state (it
 * survives re-renders and arrivals), shows an active-filter chip with a clear
 * control, and the matching-row count is announced politely. "N new" counts only
 * arrivals that match the active filter, so the control never promises rows the
 * filter then hides.
 *
 * ## Row actions and the keyboard
 * Each row has **Reply as…** (`onReplyAs(ReplyTarget)`, excerpt <= 140) and the
 * optional `renderRowActions(post)` slot — C5 mounts **Take down** through it
 * (absent, not disabled, for non-controllers; that decision is C5's). Keyboard:
 * Tab reaches the list (one roving stop) and every row's controls; with focus in
 * the list `J` moves to the next (older) row, `K` to the previous (newer), `R`
 * runs Reply as… for the focused row, and `N` activates "N new" (the control sits
 * before the rows in tab order, so without `N` a keyboard user inside the list would
 * have to Shift+Tab back through every row's controls to reach it; focus never
 * leaves the list for it, and the control is never merged away while it has focus).
 * Keys typed in a popover opened from a row
 * action are ignored (a React portal's events bubble through the React tree, so
 * the handler checks the target is really inside the list's DOM).
 *
 * ## Props (implementation.md §1.11)
 * `onReplyAs(target: ReplyTarget)` — the orchestrator maps it to
 * `ctx.openComposer({ replyTo })`. `renderRowActions?(post: LiveWorldPost)`.
 * `source?` is a test seam (an injectable arrival source); the console never
 * passes it. Wrap `renderRowActions` in `useCallback` for the best performance:
 * rows are memoized and a new function identity re-renders them.
 *
 * Time on the column is scenario time in the exercise zone (COR-053); the zone is
 * named in the toolbar. No wall-clock is shown.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsRotate,
  faArrowUp,
  faBolt,
  faEllipsis,
  faTowerBroadcast,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { useExerciseContext } from '@/core/exerciseContext'
import type { Persona } from '@/features/personas'
import { invalidatePersonas, usePersonas } from '@/features/personas/personaService'
import type { ReplyTarget } from '@/features/social'
import type {
  FeedStreamSource,
  FeedTransportMode,
} from '@/features/social/services/feedStreamSource'
import { CobraPrimaryButton, CobraSecondaryButton, CobraTextField } from '@/theme/styledComponents'
import { LiveWorldRow } from './LiveWorldRow'
import {
  ALL_POSTS_FILTER,
  collectTags,
  decodeFilter,
  encodeFilter,
  matchesFilter,
  MAX_PENDING,
  toLiveWorldPost,
  toReplyTarget,
  type LiveWorldEntry,
  type LiveWorldFilter,
  type LiveWorldPost,
} from './liveWorldModel'
import { liveWorldTokens, monoMeta, srOnly } from './liveWorldStyles'
import { useLiveWorldFeed } from './useLiveWorldFeed'

/** A scroll offset (px) at or below which the list counts as "at the top". */
const TOP_THRESHOLD_PX = 4

export interface LiveWorldColumnProps {
  /** Called with the target when a controller chooses Reply as… on a row. */
  onReplyAs(target: ReplyTarget): void
  /** Optional per-row action slot (C5's Take down). Absent = nothing rendered. */
  renderRowActions?(post: LiveWorldPost): ReactNode
  /** TEST SEAM: an injectable arrival source (defaults to the shared transport). */
  source?: FeedStreamSource
}

interface TransportDisplay {
  readonly label: string
  readonly icon: IconDefinition
  readonly hint: string
}

const TRANSPORT_DISPLAY: Readonly<Record<FeedTransportMode, TransportDisplay>> = {
  realtime: {
    label: 'REALTIME',
    icon: faBolt,
    hint: 'New posts arrive over the live connection.',
  },
  polling: {
    label: 'POLLING',
    icon: faArrowsRotate,
    hint: 'The live connection is unavailable; checking for new posts every few seconds.',
  },
  connecting: {
    label: 'CONNECTING',
    icon: faEllipsis,
    hint: 'Connecting to the live feed.',
  },
}

/** A row resolved against the persona directory. */
interface ResolvedRow {
  readonly entry: LiveWorldEntry
  readonly persona: Persona
}

const ROW_SELECTOR = '[data-live-world-row]'

/** True when `target` is somewhere keys should type text (never steal `j`/`k`/`r`). */
function isTextEntry(target: HTMLElement): boolean {
  return target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')
    !== null
}

/** The Live world column: the exercise's posts as dense staff rows. See the module header. */
export function LiveWorldColumn(props: LiveWorldColumnProps) {
  // `exerciseId` is read ONLY as a React key (never sent anywhere): a switch of
  // the session's exercise remounts the panel, dropping every row, the buffer and
  // the filter of the old exercise (COR-001).
  const { exerciseId, timeZone } = useExerciseContext()
  return <LiveWorldPanel key={exerciseId} timeZone={timeZone} {...props} />
}

interface LiveWorldPanelProps extends LiveWorldColumnProps {
  readonly timeZone: string
}

function LiveWorldPanel({ timeZone, onReplyAs, renderRowActions, source }: LiveWorldPanelProps) {
  const { personas, loading: personasLoading, error: personasError } = usePersonas()
  const personaById = useMemo(
    () => new Map<string, Persona>(personas.map(persona => [persona.id, persona])),
    [personas],
  )

  const [filter, setFilter] = useState<LiveWorldFilter>(ALL_POSTS_FILTER)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [topRequest, setTopRequest] = useState(0)
  const [announcement, setAnnouncement] = useState('')

  const listRef = useRef<HTMLDivElement>(null)
  const filterInputRef = useRef<HTMLSelectElement>(null)
  const newButtonRef = useRef<HTMLButtonElement>(null)
  // "Reading" = the controller is not looking at the top of the list. Refs, not
  // state: they are read at arrival time and must not re-render the list.
  const scrolledRef = useRef(false)
  const focusBelowTopRef = useRef(false)
  const isReading = useCallback(() => scrolledRef.current || focusBelowTopRef.current, [])

  const feed = useLiveWorldFeed({ isReading, ...(source !== undefined ? { source } : {}) })
  const { showPending } = feed

  // The latest `onReplyAs`, behind a stable callback, so rows (memoized) never
  // re-render just because the parent passed a fresh function.
  const onReplyAsRef = useRef(onReplyAs)
  useLayoutEffect(() => {
    onReplyAsRef.current = onReplyAs
  })
  const handleReply = useCallback((post: LiveWorldPost) => {
    onReplyAsRef.current(toReplyTarget(post))
  }, [])

  // --- derived collections ---------------------------------------------------
  const visible = useMemo<readonly ResolvedRow[]>(() => {
    const rows: ResolvedRow[] = []
    for (const entry of feed.rows) {
      const persona = personaById.get(entry.view.authorPersonaId)
      if (persona !== undefined && matchesFilter(entry, filter)) rows.push({ entry, persona })
    }
    return rows
  }, [feed.rows, personaById, filter])

  const pendingCount = useMemo(
    () => feed.pending.filter(entry =>
      personaById.has(entry.view.authorPersonaId) && matchesFilter(entry, filter)).length,
    [feed.pending, personaById, filter],
  )

  const tagOptions = useMemo(() => {
    const tags = collectTags([...feed.rows, ...feed.pending])
    // Keep an active tag selectable even after its posts have scrolled out.
    return filter.kind === 'hashtag' && !tags.includes(filter.tag) ? [filter.tag, ...tags] : tags
  }, [feed.rows, feed.pending, filter])

  const personaOptions = useMemo(
    () => [...personas].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [personas],
  )

  const hasRows = visible.length > 0
  const effectiveActiveId = visible.some(row => row.entry.view.id === activeId)
    ? activeId
    : visible[0]?.entry.view.id ?? null

  // --- announcements (polite, on filter change + first load only) ------------
  const visibleCountRef = useRef(0)
  useLayoutEffect(() => {
    visibleCountRef.current = visible.length
  })
  const filterKey = encodeFilter(filter)
  const loaded = feed.status === 'ready' && !personasLoading
  useEffect(() => {
    if (!loaded) return
    const count = visibleCountRef.current
    const noun = count === 1 ? 'post' : 'posts'
    if (filter.kind === 'hashtag') {
      setAnnouncement(`${count} ${noun} ${count === 1 ? 'matches' : 'match'} #${filter.tag}`)
    } else if (filter.kind === 'persona') {
      const handle = personaById.get(filter.personaId)?.handle
      setAnnouncement(`${count} ${noun} by ${handle !== undefined ? `@${handle}` : 'this persona'}`)
    } else {
      setAnnouncement(`${count} ${noun} shown`)
    }
    // Deliberately keyed on the filter and load state only: arrivals must NOT
    // re-announce (the log stays aria-live="off").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, loaded])

  // The list unmounts when nothing is visible; a fresh list starts "at the top".
  useEffect(() => {
    if (!hasRows) {
      scrolledRef.current = false
      focusBelowTopRef.current = false
    }
  }, [hasRows])

  // A focused row that is removed (evicted from the bounded list, or filtered
  // out) does not reliably fire `blur`: without this, "reading by focus" could
  // stay latched and hold every future arrival behind "N new" forever.
  useLayoutEffect(() => {
    const list = listRef.current
    if (list === null || !list.contains(document.activeElement)) {
      focusBelowTopRef.current = false
    }
  }, [visible])

  // "N new" → return to the top and put focus on the newest row.
  useLayoutEffect(() => {
    if (topRequest === 0) return
    const list = listRef.current
    if (list === null) return
    list.scrollTop = 0
    scrolledRef.current = false
    list.querySelector<HTMLElement>(ROW_SELECTOR)?.focus()
  }, [topRequest])

  const showNew = useCallback(() => {
    showPending()
    setTopRequest(count => count + 1)
  }, [showPending])

  // --- list event handlers ----------------------------------------------------
  const handleScroll = useCallback(() => {
    const list = listRef.current
    if (list === null) return
    scrolledRef.current = list.scrollTop > TOP_THRESHOLD_PX
    // Back at the top and not reading by focus: the held arrivals may land. Not
    // while the "N new" control itself has focus — it would vanish under the user.
    if (
      !scrolledRef.current &&
      !focusBelowTopRef.current &&
      document.activeElement !== newButtonRef.current
    ) {
      showPending()
    }
  }, [showPending])

  const handleFocus = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const list = listRef.current
    const target = event.target
    if (list === null || !(target instanceof HTMLElement)) return
    const row = target.closest<HTMLElement>(ROW_SELECTOR)
    if (row === null || !list.contains(row)) return
    setActiveId(row.dataset.postId ?? null)
    focusBelowTopRef.current = Array.from(list.querySelectorAll(ROW_SELECTOR)).indexOf(row) > 0
  }, [])

  const handleBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && listRef.current?.contains(next)) return
    focusBelowTopRef.current = false
    // Moving to the "N new" control must not merge (and so remove) it: the
    // controller is on their way to activate it.
    if (!scrolledRef.current && next !== newButtonRef.current) showPending()
  }, [showPending])

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.repeat) return
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const list = listRef.current
    const target = event.target
    // `contains` (DOM) — not the React tree — so a popover portalled out of a
    // row action never triggers J/K/R.
    if (list === null || !(target instanceof HTMLElement) || !list.contains(target)) return
    if (isTextEntry(target)) return
    const row = target.closest<HTMLElement>(ROW_SELECTOR)
    if (row === null) return

    const key = event.key.toLowerCase()
    if (key === 'j' || key === 'k') {
      const rows = Array.from(list.querySelectorAll<HTMLElement>(ROW_SELECTOR))
      const next = rows[rows.indexOf(row) + (key === 'j' ? 1 : -1)]
      event.preventDefault()
      next?.focus()
    } else if (key === 'r') {
      const found = visible.find(item => item.entry.view.id === row.dataset.postId)
      if (found === undefined) return
      event.preventDefault()
      handleReply(toLiveWorldPost(found.entry.view, found.persona))
    } else if (key === 'n' && pendingCount > 0) {
      // The "N new" control, from the list: it precedes the rows in tab order, so
      // Shift+Tab would otherwise walk back through every row's controls to reach it.
      event.preventDefault()
      showNew()
    }
  }, [visible, handleReply, pendingCount, showNew])

  const clearFilter = useCallback(() => {
    setFilter(ALL_POSTS_FILTER)
    filterInputRef.current?.focus()
  }, [])

  // --- render ------------------------------------------------------------------
  const transport = TRANSPORT_DISPLAY[feed.mode]
  const filtered = filter.kind !== 'all'
  const filterLabel = filter.kind === 'hashtag'
    ? `#${filter.tag}`
    : filter.kind === 'persona'
      ? `@${personaById.get(filter.personaId)?.handle ?? 'unknown'}`
      : ''
  const countLabel = `${visible.length}${filtered ? ` of ${feed.rows.length}` : ''} ${
    visible.length === 1 && !filtered ? 'post' : 'posts'
  }`

  const feedFailed = feed.status === 'error'
  const personasFailed = !feedFailed && personasError !== undefined && personas.length === 0
  const loading = !feedFailed && !personasFailed && (feed.status === 'loading' || personasLoading)

  return (
    <Box
      data-testid="live-world-column"
      sx={{
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: liveWorldTokens.surface,
        border: `1px solid ${liveWorldTokens.panelBorder}`,
        borderRadius: '4px',
        overflow: 'hidden',
      }}
    >
      {/* Title bar: unmistakably the machine, never the fiction. */}
      <Stack
        component="header"
        direction="row"
        sx={{
          flex: 'none',
          alignItems: 'center',
          gap: 1.5,
          px: '10px',
          py: '6px',
          bgcolor: liveWorldTokens.barBackground,
          borderBottom: `1px solid ${liveWorldTokens.barBorder}`,
          color: liveWorldTokens.barText,
        }}
      >
        <FontAwesomeIcon icon={faTowerBroadcast} aria-hidden="true" />
        <Typography
          component="h2"
          sx={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.12em' }}
        >
          LIVE WORLD
        </Typography>
        <Box
          role="status"
          data-testid="live-world-transport"
          data-mode={feed.mode}
          title={transport.hint}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '5px',
            px: '7px',
            py: '1px',
            border: `1px solid ${liveWorldTokens.barTextMuted}`,
            borderRadius: '3px',
            fontFamily: liveWorldTokens.mono,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.08em',
          }}
        >
          <FontAwesomeIcon icon={transport.icon} aria-hidden="true" />
          {transport.label}
          <Box component="span" sx={srOnly}>{`. ${transport.hint}`}</Box>
        </Box>
        <Box sx={{ flex: 1 }} />
        <Box
          data-testid="live-world-count"
          sx={{
            fontFamily: liveWorldTokens.mono,
            fontSize: 11,
            color: liveWorldTokens.barTextMuted,
          }}
        >
          {countLabel}
        </Box>
      </Stack>

      {/* Toolbar: filter, active-filter chip, scenario-time zone, key hints. */}
      <Stack
        direction="row"
        sx={{
          flex: 'none',
          alignItems: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
          px: '10px',
          py: '6px',
          bgcolor: liveWorldTokens.toolbar,
          borderBottom: `1px solid ${liveWorldTokens.hairline}`,
        }}
      >
        <CobraTextField
          select
          size="small"
          id="live-world-filter"
          label="Filter"
          value={filterKey}
          onChange={event => setFilter(decodeFilter(event.target.value))}
          inputRef={filterInputRef}
          slotProps={{
            select: { native: true },
            htmlInput: { 'data-testid': 'live-world-filter' },
          }}
          sx={{ minWidth: 190, '& .MuiInputBase-root': { fontSize: 12 } }}
        >
          <option value="all">All posts</option>
          {tagOptions.length > 0 && (
            <optgroup label="Hashtag">
              {tagOptions.map(tag => (
                <option key={tag} value={encodeFilter({ kind: 'hashtag', tag })}>
                  {`#${tag}`}
                </option>
              ))}
            </optgroup>
          )}
          {personaOptions.length > 0 && (
            <optgroup label="Persona">
              {personaOptions.map(persona => (
                <option
                  key={persona.id}
                  value={encodeFilter({ kind: 'persona', personaId: persona.id })}
                >
                  {`${persona.displayName} (@${persona.handle})`}
                </option>
              ))}
            </optgroup>
          )}
        </CobraTextField>

        {filtered && (
          <Box
            data-testid="live-world-filter-chip"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              pl: '8px',
              pr: '2px',
              py: '1px',
              border: `1px solid ${liveWorldTokens.focus}`,
              borderRadius: '3px',
              bgcolor: liveWorldTokens.surface,
              fontFamily: liveWorldTokens.mono,
              fontSize: 11,
              fontWeight: 700,
              color: liveWorldTokens.focus,
            }}
          >
            <span>{`FILTER: ${filterLabel}`}</span>
            <Box
              component="button"
              type="button"
              aria-label={`Clear filter ${filterLabel}`}
              data-testid="live-world-filter-clear"
              onClick={clearFilter}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 20,
                height: 20,
                p: 0,
                border: 0,
                borderRadius: '2px',
                bgcolor: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
                '&:hover': { bgcolor: liveWorldTokens.surfaceHover },
                '&:focus-visible': {
                  outline: `2px solid ${liveWorldTokens.focus}`,
                  outlineOffset: '1px',
                },
              }}
            >
              <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            </Box>
          </Box>
        )}

        <Box sx={{ flex: 1 }} />
        <Box sx={{ ...monoMeta, display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span data-testid="live-world-zone">{`SCENARIO TIME · ${timeZone}`}</span>
          <span aria-hidden="true">
            <Box component="kbd" sx={kbdSx}>J</Box>
            <Box component="kbd" sx={kbdSx}>K</Box>
            {' move · '}
            <Box component="kbd" sx={kbdSx}>R</Box>
            {' reply · '}
            <Box component="kbd" sx={kbdSx}>N</Box>
            {' new'}
          </span>
          <Box component="span" sx={srOnly}>
            Keyboard, with focus in the list: J and K move between posts, R replies as a
            persona, N shows new posts.
          </Box>
        </Box>
      </Stack>

      {/* Errors: inline, with Retry — a failure is never "all quiet". */}
      {(feedFailed || personasFailed) && (
        <Stack
          role="alert"
          data-testid="live-world-error"
          direction="row"
          sx={{
            flex: 'none',
            alignItems: 'center',
            gap: 1,
            px: '10px',
            py: '8px',
            borderBottom: `1px solid ${liveWorldTokens.hairline}`,
            borderLeft: `4px solid ${liveWorldTokens.danger}`,
            color: liveWorldTokens.ink,
            fontSize: 12.5,
          }}
        >
          <Box component="span" sx={{ color: liveWorldTokens.danger, display: 'inline-flex' }}>
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          </Box>
          <span>
            {feedFailed
              ? 'The live world feed could not be loaded.'
              : 'The persona directory could not be loaded, so posts cannot be shown.'}
          </span>
          <Box sx={{ flex: 1 }} />
          <CobraSecondaryButton
            size="small"
            data-testid="live-world-retry"
            onClick={feedFailed ? feed.retry : invalidatePersonas}
            sx={{ py: '1px', px: '12px', fontSize: 12 }}
          >
            Retry
          </CobraSecondaryButton>
        </Stack>
      )}

      {/* The list area. The "N new" control precedes the list in DOM order, so a
          keyboard user (Shift+Tab from a row, or Tab from the toolbar) reaches it
          without walking every row. It overlays the list, so it never moves it. */}
      <Box
        sx={{
          position: 'relative',
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {pendingCount > 0 && (
          <Box
            sx={{
              position: 'absolute',
              top: 8,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 2,
            }}
          >
            <CobraPrimaryButton
              ref={newButtonRef}
              size="small"
              data-testid="live-world-new"
              aria-label={`Show ${pendingCount >= MAX_PENDING ? `${MAX_PENDING}+` : pendingCount} new ${
                pendingCount === 1 ? 'post' : 'posts'}`}
              onClick={showNew}
              sx={{
                py: '2px',
                px: '12px',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: liveWorldTokens.mono,
                gap: '6px',
                boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
              }}
            >
              <FontAwesomeIcon icon={faArrowUp} aria-hidden="true" />
              {`${pendingCount >= MAX_PENDING ? `${MAX_PENDING}+` : pendingCount} new`}
            </CobraPrimaryButton>
          </Box>
        )}

        {hasRows ? (
          <Box
            ref={listRef}
            role="log"
            aria-live="off"
            aria-label="Live world posts, newest first"
            aria-busy={loading}
            data-testid="live-world-list"
            onScroll={handleScroll}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            sx={{ flex: 1, minHeight: 0, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}
          >
            {visible.map(row => (
              <LiveWorldRow
                key={row.entry.view.id}
                entry={row.entry}
                persona={row.persona}
                timeZone={timeZone}
                active={row.entry.view.id === effectiveActiveId}
                onReply={handleReply}
                {...(renderRowActions !== undefined ? { renderRowActions } : {})}
              />
            ))}
          </Box>
        ) : (
          <Box
            role={loading ? 'status' : undefined}
            data-testid="live-world-empty"
            sx={{ flex: 1, p: '14px 12px', ...monoMeta, fontSize: 12 }}
          >
            {loading
              ? 'Loading the live world…'
              : feedFailed || personasFailed
                ? ''
                : filtered
                  ? 'No posts match this filter.'
                  : 'No posts in this exercise yet.'}
          </Box>
        )}
      </Box>

      {/* Polite count of matching rows — announced on filter change / first load. */}
      <Box
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="live-world-announcer"
        sx={srOnly}
      >
        {announcement}
      </Box>
    </Box>
  )
}

/** A keycap in the toolbar hint (mono, bordered — staff chrome, like the console's own). */
const kbdSx = {
  fontFamily: liveWorldTokens.mono,
  fontSize: 10,
  fontWeight: 700,
  color: liveWorldTokens.focus,
  border: `1px solid ${liveWorldTokens.panelBorder}`,
  borderRadius: '3px',
  bgcolor: liveWorldTokens.surface,
  px: '4px',
  mx: '1px',
} as const
