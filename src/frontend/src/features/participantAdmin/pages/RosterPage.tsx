/**
 * features/participantAdmin/pages/RosterPage.tsx
 * ---------------------------------------------------------------------------
 * The staff PARTICIPANTS screen (feature: easy-login, story 10; COR-011,
 * COR-017, COR-018, NFR-001) — where a controller or planner adds people to the
 * exercise, sees at a glance who is in, and fixes whoever is not. The first 30
 * minutes of StartEx is login triage; this is the page that makes it a
 * non-event.
 *
 *   Participants                                 [Import CSV] [Add participant]
 *   42 participants · 38 signed in · 3 with no link
 *   Filter … | name | agency | role | sign-in | persona | link | last sign-in | …
 *
 * It composes, and owns no logic of its own beyond composition:
 *   - `RosterTable` — the table, sorting, selection and per-row actions;
 *   - `RosterImportPanel` — CSV validate/import;
 *   - `AddParticipantDialog` — add one person;
 *   - the data hooks (`useRoster`, `useRosterMutations`).
 * Keep it that way: the planner page's header explains why a composition point
 * should stay thin.
 *
 * ## Slots (the orchestrator composes these; frozen props)
 *   dayWordSlot                 ReactNode, ABOVE the table (story 11). Independent of the
 *                               roster: shown while loading, on a roster error and when
 *                               loaded; hidden only on a 401/403
 *   renderCardsAction(sel)      ReactNode, in the toolbar (story 12)
 *   renderEmailAction(sel)      ReactNode, in the toolbar (story 13)
 * `sel` is the selected participant ids (`readonly string[]`, in roster order).
 * With a slot absent nothing renders in its place. This file imports nothing from
 * `dayWord/` or `cards/`; the slot props ARE the seam.
 *
 * ## The states, all real (never a blank page)
 *  - loading   a `role="status"` line;
 *  - 401/403   "You don't have access to the roster" (evaluators and org admins
 *              never reach this route; the registry's `allowedRoles` is the only
 *              gate, so this is the belt to that suspender). The rows are hidden;
 *  - error     the reason, and a Try again;
 *  - empty     points at Import CSV and Add participant;
 *  - populated the summary line, the filter, the table.
 * A refresh that fails AFTER a good load keeps the rows but says they may be out
 * of date.
 *
 * ## Isolation + secrets (XC-001, story 10)
 * No request here carries an exercise id; the cache key does (`useRoster`), and the
 * page body is keyed on it so NO page state (selection, filter, announcement,
 * dialogs, import result) survives an exercise switch.
 * Participant ids come only from the list response. `joinUrl` lives in query
 * data only and is never rendered.
 *
 * ## Announcements
 * Results and errors from row actions, copy and add go to ONE pair of persistent
 * live regions (`role="status"` / `role="alert"`), so a screen reader hears each
 * once. None of them contains a join URL.
 *
 * World: STAFF (COBRA). Mounted by `ParticipantAdminRoute` inside
 * `StaffShellFrame`, but testable without the frame (needs only a React Query
 * client, an `ExerciseContextProvider` and the COBRA theme).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box, Divider, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowsRotate,
  faCircleCheck,
  faFileCsv,
  faLock,
  faSpinner,
  faTriangleExclamation,
  faUserPlus,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
  CobraTextField,
} from '@/theme/styledComponents'
import { useExerciseContext } from '@/core/exerciseContext'
import { AddParticipantDialog } from '../components/people/AddParticipantDialog'
import { RosterImportPanel } from '../components/people/RosterImportPanel'
import { RosterTable, type RowFocusRequest } from '../components/people/RosterTable'
import type { RosterActionReport } from '../components/people/rosterActions'
import {
  filterRoster,
  formatSummary,
  sortRoster,
  summarizeRoster,
  type RosterSortKey,
  type SortDirection,
} from '../components/people/rosterDisplay'
import { MUTED_TEXT } from '../components/people/rosterStyles'
import { useRoster } from '../hooks/useRoster'
import { isRosterAccessDenied } from '../services/rosterService'
import type { RosterEntryDto } from '../types'

/**
 * The frozen slot contract. The orchestrator fills these after stories 11, 12
 * and 13 land; this page renders whatever it is given and nothing if absent.
 */
export interface RosterPageProps {
  /** The day-word panel, rendered above the table. */
  dayWordSlot?: ReactNode
  /** The print-cards action, rendered in the toolbar with the selected ids. */
  renderCardsAction?: (selection: readonly string[]) => ReactNode
  /** The email-links action, rendered in the toolbar with the selected ids. */
  renderEmailAction?: (selection: readonly string[]) => ReactNode
}

/** How long a success announcement stays on screen. Errors stay until replaced. */
const SUCCESS_VISIBLE_MS = 10_000

interface Announcement extends RosterActionReport {
  readonly id: number
}

/** The loading line. */
function LoadingState() {
  return (
    <Stack
      role="status"
      direction="row"
      data-testid="roster-loading"
      sx={{ alignItems: 'center', gap: 1, color: MUTED_TEXT, padding: '16px 0' }}
    >
      <FontAwesomeIcon icon={faSpinner} spin aria-hidden />
      <Typography variant="body2">Loading participants…</Typography>
    </Stack>
  )
}

/** The 401/403 state: a plain statement, never a blank page. */
function AccessDeniedState() {
  return (
    <Stack
      role="alert"
      data-testid="roster-access-denied"
      sx={{
        gap: 0.75,
        padding: '16px 18px',
        border: '1px solid',
        borderColor: 'notifications.errorText',
        borderRadius: 1,
        maxWidth: 720,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, color: 'notifications.errorText' }}>
        <FontAwesomeIcon icon={faLock} aria-hidden />
        <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 700 }}>
          You don't have access to the roster
        </Typography>
      </Stack>
      <Typography variant="body2">
        The roster is for planners and controllers assigned to this exercise. If you should have
        access, ask an exercise administrator to check your role.
      </Typography>
    </Stack>
  )
}

interface ErrorStateProps {
  readonly message: string | undefined
  readonly onRetry: () => void
}

function LoadErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <Stack
      role="alert"
      data-testid="roster-load-error"
      sx={{
        gap: 1,
        alignItems: 'flex-start',
        padding: '12px 14px',
        border: '1px solid',
        borderColor: 'notifications.errorText',
        borderRadius: 1,
        color: 'notifications.errorText',
        maxWidth: 720,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box component="span" sx={{ mt: '2px' }}>
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
        </Box>
        <Typography variant="body2">
          The roster could not be loaded, so this is not a record of who is on the exercise.
          {message !== undefined ? ` The server said: ${message}` : ''}
        </Typography>
      </Stack>
      <CobraSecondaryButton
        type="button"
        onClick={onRetry}
        startIcon={<FontAwesomeIcon icon={faArrowsRotate} />}
      >
        Try again
      </CobraSecondaryButton>
    </Stack>
  )
}

/** The empty roster: says what this page is for and points at the two ways in. */
function EmptyState() {
  return (
    <Stack
      data-testid="roster-empty"
      sx={{
        alignItems: 'center',
        gap: 1,
        padding: '32px 16px',
        border: '1px dashed',
        borderColor: 'grid.main',
        borderRadius: 1,
        textAlign: 'center',
      }}
    >
      <Box sx={{ fontSize: 24, color: MUTED_TEXT }}>
        <FontAwesomeIcon icon={faUsers} aria-hidden />
      </Box>
      <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
        No participants yet
      </Typography>
      <Typography variant="body2" sx={{ color: MUTED_TEXT, maxWidth: 560 }}>
        Use Import CSV to add a whole roster at once, or Add participant to add one person. Each
        person gets a sign-in name, a persona and a personal link.
      </Typography>
    </Stack>
  )
}

/** The persistent warning when no join URL can be built (EL-6). */
function JoinLinksBanner() {
  return (
    <Stack
      role="alert"
      direction="row"
      data-testid="roster-join-links-banner"
      sx={{
        gap: 1,
        alignItems: 'flex-start',
        padding: '10px 14px',
        border: '1px solid',
        borderColor: 'notifications.warningText',
        borderRadius: 1,
        backgroundColor: 'notifications.warning',
        color: 'notifications.warningText',
      }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Typography variant="body2">
        <strong>Personal links are not configured on this server.</strong> People can still be
        added and can sign in with today's word, but there are no links to copy or print until an
        administrator sets the site address.
      </Typography>
    </Stack>
  )
}

/**
 * The roster page. See the module header.
 *
 * The body is KEYED on the exercise id (as the day-word panel is): the staff
 * switcher re-resolves the scope WITHOUT remounting the tree, so without the key
 * the previous exercise's selection, filter, sort, open dialogs, import result and
 * announcement ("Link copied for Jane") would survive into the next exercise. A
 * different `key` is a fresh mount with fresh state.
 */
export function RosterPage(props: RosterPageProps) {
  const { exerciseId } = useExerciseContext()
  return <RosterPageBody key={exerciseId} {...props} />
}

function RosterPageBody({
  dayWordSlot,
  renderCardsAction,
  renderEmailAction,
}: RosterPageProps) {
  const { timeZone } = useExerciseContext()
  const roster = useRoster()
  const { refetch } = roster

  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<{ key: RosterSortKey, direction: SortDirection }>({
    key: 'name',
    direction: 'asc',
  })
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())

  // `null` = automatic: the import panel opens by itself while the roster is empty.
  const [importOpen, setImportOpen] = useState<boolean | null>(null)
  const [focusImport, setFocusImport] = useState(false)
  const importPanelRef = useRef<HTMLElement>(null)

  const [addOpen, setAddOpen] = useState(false)
  const [restoreAddFocus, setRestoreAddFocus] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)

  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const announcementCounter = useRef(0)
  const [rowFocus, setRowFocus] = useState<RowFocusRequest | null>(null)
  const rowFocusCounter = useRef(0)

  const entries: readonly RosterEntryDto[] = useMemo(
    () => roster.data?.participants ?? [],
    [roster.data],
  )
  const shown = useMemo(
    () => sortRoster(filterRoster(entries, filter), sort.key, sort.direction),
    [entries, filter, sort],
  )
  const summary = useMemo(() => summarizeRoster(entries), [entries])

  // Only ids that are still on the roster count as selected (roster order).
  const selection = useMemo(
    () => entries.filter(entry => selectedIds.has(entry.id)).map(entry => entry.id),
    [entries, selectedIds],
  )

  // A success announcement fades from view; an error stays until replaced.
  useEffect(() => {
    if (announcement === null || announcement.tone !== 'success') return
    const timer = setTimeout(() => setAnnouncement(null), SUCCESS_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [announcement])

  // While the roster is empty the import panel is open by default. That default
  // LATCHES the moment it applies: the first import refetches the roster, and the
  // panel (with its result table) must not vanish because the list is no longer empty.
  const emptyRoster = roster.isSuccess && entries.length === 0
  const importVisible = importOpen ?? emptyRoster
  useEffect(() => {
    if (importOpen === null && emptyRoster) setImportOpen(true)
  }, [importOpen, emptyRoster])

  // Move focus into the import panel after the staff member opens it.
  useEffect(() => {
    if (focusImport && importVisible) {
      importPanelRef.current?.focus()
      setFocusImport(false)
    }
  }, [focusImport, importVisible])

  // Cancelling "Add participant" returns focus to the button that opened it.
  useEffect(() => {
    if (restoreAddFocus && !addOpen) {
      addButtonRef.current?.focus()
      setRestoreAddFocus(false)
    }
  }, [restoreAddFocus, addOpen])

  const announce = useCallback((report: RosterActionReport) => {
    announcementCounter.current += 1
    setAnnouncement({ ...report, id: announcementCounter.current })
  }, [])

  // A new column sorts ascending; the same column flips direction.
  const handleSort = useCallback((key: RosterSortKey) => {
    setSort(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }))
  }, [])

  const handleToggleOne = useCallback((participantId: string) => {
    setSelectedIds(current => {
      const next = new Set(current)
      if (next.has(participantId)) next.delete(participantId)
      else next.add(participantId)
      return next
    })
  }, [])

  const shownIds = useMemo(() => shown.map(entry => entry.id), [shown])
  const handleToggleAllShown = useCallback((checked: boolean) => {
    setSelectedIds(current => {
      const next = new Set(current)
      for (const id of shownIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })
  }, [shownIds])

  const handleRowFocusHandled = useCallback((token: number) => {
    setRowFocus(current => (current?.token === token ? null : current))
  }, [])

  const handleAdded = (entry: RosterEntryDto) => {
    setAddOpen(false)
    // The new person must be visible to be focused, so a filter would hide them.
    setFilter('')
    rowFocusCounter.current += 1
    setRowFocus({ participantId: entry.id, token: rowFocusCounter.current })
    announce({
      tone: 'success',
      message: `Added ${entry.name}. Their sign-in name is ${entry.signInName}.`,
    })
  }

  const handleAddCancelled = () => {
    setAddOpen(false)
    setRestoreAddFocus(true)
  }

  const toggleImport = () => {
    const opening = !importVisible
    setImportOpen(opening)
    if (opening) setFocusImport(true)
  }

  const denied = roster.isError && isRosterAccessDenied(roster.error)
  const loaded = roster.data !== undefined && !denied
  const filterActive = filter.trim().length > 0

  return (
    <Box
      data-testid="roster-page"
      sx={{
        padding: CobraStyles.Padding.MainWindow,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <Box>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <FontAwesomeIcon icon={faUsers} aria-hidden />
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Participants
          </Typography>
        </Stack>
        <Typography variant="body2" sx={{ color: MUTED_TEXT, mt: 0.5, maxWidth: 860 }}>
          Everyone who can sign in to this exercise. Add people, see who is in, and fix whoever is
          not.
        </Typography>
        <Divider sx={{ mt: 2 }} />
      </Box>

      {/*
        The day-word panel is INDEPENDENT of the roster (its own endpoint), and a failed
        roster GET is exactly when staff most need it at StartEx. So it renders while
        loading, on a roster error and when loaded; only a 401/403 hides it (the same
        role gate would refuse it too). Absent slot = nothing.
      */}
      {!denied ? dayWordSlot : null}

      {roster.isPending ? <LoadingState /> : null}
      {denied ? <AccessDeniedState /> : null}
      {roster.isError && !denied && roster.data === undefined
        ? (
          <LoadErrorState
            message={roster.error.serverMessage}
            onRetry={() => { void refetch() }}
          />
        )
        : null}

      {loaded && roster.data !== undefined
        ? (
          <>
            {!roster.data.joinLinksAvailable ? <JoinLinksBanner /> : null}

            {roster.isError
              ? (
                <Stack
                  role="alert"
                  direction="row"
                  data-testid="roster-stale-warning"
                  sx={{ gap: 1, alignItems: 'flex-start', color: 'notifications.errorText' }}
                >
                  <Box component="span" sx={{ mt: '2px' }}>
                    <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
                  </Box>
                  <Typography variant="body2">
                    The roster could not be refreshed, so what you see may be out of date.
                  </Typography>
                  <CobraLinkButton type="button" onClick={() => { void refetch() }}>
                    Try again
                  </CobraLinkButton>
                </Stack>
              )
              : null}

            <Stack
              direction="row"
              data-testid="roster-toolbar"
              sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}
            >
              <CobraTextField
                type="search"
                label="Filter participants"
                placeholder="Name, agency or sign-in name"
                value={filter}
                onChange={event => setFilter(event.target.value)}
                sx={{ width: 320 }}
                slotProps={{ htmlInput: { 'aria-controls': 'roster-table' } }}
              />
              <Box sx={{ flexGrow: 1 }} />
              {selection.length > 0
                ? (
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="body2" data-testid="roster-selected-count" sx={{ fontWeight: 600 }}>
                      {selection.length} selected
                    </Typography>
                    <CobraLinkButton type="button" onClick={() => setSelectedIds(new Set())}>
                      Clear selection
                    </CobraLinkButton>
                  </Stack>
                )
                : null}
              {renderCardsAction?.(selection)}
              {renderEmailAction?.(selection)}
              <CobraSecondaryButton
                type="button"
                aria-expanded={importVisible}
                aria-controls="roster-import-panel"
                startIcon={<FontAwesomeIcon icon={faFileCsv} />}
                onClick={toggleImport}
              >
                Import CSV
              </CobraSecondaryButton>
              <CobraPrimaryButton
                type="button"
                ref={addButtonRef}
                startIcon={<FontAwesomeIcon icon={faUserPlus} />}
                onClick={() => setAddOpen(true)}
              >
                Add participant
              </CobraPrimaryButton>
            </Stack>

            {/* Two persistent live regions: announced once, never racing each other. */}
            <Box role="status" aria-live="polite" data-testid="roster-announcement">
              {announcement?.tone === 'success'
                ? (
                  <Stack
                    key={announcement.id}
                    direction="row"
                    sx={{ gap: 1, alignItems: 'flex-start', color: 'success.main' }}
                  >
                    <Box component="span" sx={{ mt: '2px' }}>
                      <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {announcement.message}
                    </Typography>
                  </Stack>
                )
                : null}
            </Box>
            <Box role="alert" data-testid="roster-announcement-error">
              {announcement?.tone === 'error'
                ? (
                  <Stack
                    key={announcement.id}
                    direction="row"
                    sx={{ gap: 1, alignItems: 'flex-start', color: 'notifications.errorText' }}
                  >
                    <Box component="span" sx={{ mt: '2px' }}>
                      <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {announcement.message}
                    </Typography>
                  </Stack>
                )
                : null}
            </Box>

            {importVisible ? <RosterImportPanel ref={importPanelRef} /> : null}

            {entries.length === 0
              ? <EmptyState />
              : (
                <Box component="section" aria-label="Roster">
                  <Typography
                    variant="body2"
                    data-testid="roster-summary"
                    sx={{ fontWeight: 600, mb: 0.5 }}
                  >
                    {formatSummary(summary)}
                  </Typography>
                  <Box role="status" aria-live="polite" data-testid="roster-filter-status" sx={{ mb: 0.5 }}>
                    {filterActive
                      ? (
                        <Typography variant="body2" sx={{ color: MUTED_TEXT }}>
                          Showing {shown.length} of {entries.length} participants
                        </Typography>
                      )
                      : null}
                  </Box>
                  <RosterTable
                    entries={shown}
                    totalCount={entries.length}
                    filterActive={filterActive}
                    timeZone={timeZone}
                    sortKey={sort.key}
                    sortDirection={sort.direction}
                    onSort={handleSort}
                    selectedIds={selectedIds}
                    onToggleOne={handleToggleOne}
                    onToggleAllShown={handleToggleAllShown}
                    onReport={announce}
                    focusRowRequest={rowFocus}
                    onFocusRowHandled={handleRowFocusHandled}
                  />
                </Box>
              )}

            <AddParticipantDialog
              open={addOpen}
              onClose={handleAddCancelled}
              onAdded={handleAdded}
            />
          </>
        )
        : null}
    </Box>
  )
}
