/**
 * features/participantAdmin/components/people/RosterTable.tsx
 * ---------------------------------------------------------------------------
 * The staff roster as a REAL `<table>` (feature: easy-login, story 10; COR-017,
 * NFR-001): who is on the exercise, whether they are in, and what to do about
 * the ones who are not.
 *
 * Columns: select · name · agency · role · sign-in name · persona · link ·
 * last sign-in · live sessions · access · actions.
 *
 * ## Accessibility (NFR-001)
 *  - a `<caption>` names the table and states the time zone every instant is in;
 *  - every header is `<th scope="col">`; the name is the ROW header
 *    (`<th scope="row">`) so a screen reader announces "Dana Whitfield, Link,
 *    Active" rather than reading unattached cells;
 *  - a sortable header holds a real `<button>`; the `<th>` carries `aria-sort`
 *    (`ascending` / `descending` on the active column, `none` elsewhere);
 *  - statuses are icon + text (`RosterBadges`), never colour alone;
 *  - each row has a labelled checkbox, and the header has a select-all that is
 *    `indeterminate` when only some shown rows are selected.
 *
 * ## Time
 * Last sign-in and link-issued/revoked instants render in the EXERCISE time zone
 * with the zone named ("Oct 13, 9:05 AM EDT"), in a `<time dateTime>` element.
 * The scenario-time-only rule (COR-053) binds the participant world, not this
 * screen.
 *
 * ## Secrets
 * Rows receive the list entries (which carry `joinUrl`) only to pass them to
 * `RosterRowActions`; nothing here renders a URL.
 *
 * ## Focus
 * `focusRowRequest` lets the page move keyboard focus to a row once it exists
 * (the participant just added). The row is focusable but not a tab stop.
 *
 * World: STAFF (COBRA theme). FontAwesome only; MUI 9 `sx`-only system props.
 */

import { memo, useEffect, useRef } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faSort, faSortDown, faSortUp } from '@fortawesome/free-solid-svg-icons'
import type { RosterEntryDto } from '../../types'
import { AccessBadge, EntryLinkBadge, PersonaCell } from './RosterBadges'
import { RosterRowActions } from './RosterRowActions'
import type { RosterActionReport } from './rosterActions'
import {
  formatInstant,
  linkDisplayState,
  type RosterSortKey,
  type SortDirection,
} from './rosterDisplay'
import { CELL_SX, FOCUS_RING, MUTED_TEXT } from './rosterStyles'

/** A request to focus one row once it is in the table. `token` makes repeats distinct. */
export interface RowFocusRequest {
  readonly participantId: string
  readonly token: number
}

export interface RosterTableProps {
  /** The rows to show: already filtered and sorted by the page. */
  readonly entries: readonly RosterEntryDto[]
  /** How many people are on the roster before the filter (for the empty message). */
  readonly totalCount: number
  readonly filterActive: boolean
  /** IANA time zone every instant is shown in. */
  readonly timeZone: string
  readonly sortKey: RosterSortKey
  readonly sortDirection: SortDirection
  readonly onSort: (key: RosterSortKey) => void
  readonly selectedIds: ReadonlySet<string>
  readonly onToggleOne: (participantId: string) => void
  /** Select (`true`) or clear (`false`) every SHOWN row. */
  readonly onToggleAllShown: (checked: boolean) => void
  readonly onReport: (report: RosterActionReport) => void
  readonly focusRowRequest: RowFocusRequest | null
  readonly onFocusRowHandled: (token: number) => void
}

interface ColumnDef {
  readonly key: RosterSortKey
  readonly label: string
}

const COLUMNS: readonly ColumnDef[] = [
  { key: 'name', label: 'Name' },
  { key: 'agency', label: 'Agency' },
  { key: 'role', label: 'Role' },
  { key: 'signInName', label: 'Sign-in name' },
  { key: 'persona', label: 'Persona' },
  { key: 'link', label: 'Link' },
  { key: 'lastSignIn', label: 'Last sign-in' },
  { key: 'sessions', label: 'Live sessions' },
  { key: 'access', label: 'Access' },
]

/** select + the sortable columns + actions */
const COLUMN_COUNT = COLUMNS.length + 2

const HEADER_CELL_SX = {
  ...CELL_SX,
  fontWeight: 700,
  fontSize: 12.5,
  whiteSpace: 'nowrap',
  backgroundColor: 'grid.light',
} as const

const CHECKBOX_SX = {
  width: 16,
  height: 16,
  margin: 0,
  accentColor: '#0020c2',
  cursor: 'pointer',
  '&:focus-visible': FOCUS_RING,
} as const

/** "Not set", spoken; "—", shown. */
function Dash() {
  return <Box component="span" role="img" aria-label="Not set" sx={{ color: MUTED_TEXT }}>—</Box>
}

function Text({ value }: { readonly value: string | undefined }) {
  return value !== undefined && value.length > 0 ? <>{value}</> : <Dash />
}

interface InstantProps {
  readonly iso: string
  readonly timeZone: string
}

/** An instant in the exercise zone, zone named, in a `<time>` element. */
function Instant({ iso, timeZone }: InstantProps) {
  const text = formatInstant(iso, timeZone)
  if (text === undefined) return <Dash />
  return <time dateTime={iso}>{text}</time>
}

interface SortHeaderProps {
  readonly column: ColumnDef
  readonly active: boolean
  readonly direction: SortDirection
  readonly onSort: (key: RosterSortKey) => void
}

function SortHeader({ column, active, direction, onSort }: SortHeaderProps) {
  const ariaSort = active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
  const icon = active ? (direction === 'asc' ? faSortUp : faSortDown) : faSort
  return (
    <Box
      component="th"
      scope="col"
      aria-sort={ariaSort}
      data-testid={`roster-header-${column.key}`}
      sx={HEADER_CELL_SX}
    >
      <Box
        component="button"
        type="button"
        onClick={() => onSort(column.key)}
        sx={{
          all: 'unset',
          boxSizing: 'border-box',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          cursor: 'pointer',
          fontWeight: 700,
          fontSize: 12.5,
          padding: '2px 4px',
          borderRadius: '3px',
          '&:hover': { backgroundColor: 'grid.main' },
          '&:focus-visible': FOCUS_RING,
        }}
      >
        <span>{column.label}</span>
        <Box component="span" sx={{ color: active ? 'info.main' : MUTED_TEXT }}>
          <FontAwesomeIcon icon={icon} aria-hidden />
        </Box>
      </Box>
    </Box>
  )
}

interface RosterRowProps {
  readonly entry: RosterEntryDto
  readonly selected: boolean
  readonly timeZone: string
  readonly onToggleOne: (participantId: string) => void
  readonly onReport: (report: RosterActionReport) => void
}

const RosterRow = memo(function RosterRow(
  { entry, selected, timeZone, onToggleOne, onReport }: RosterRowProps,
) {
  const state = linkDisplayState(entry)
  const linkTime = state === 'revoked' ? entry.link.revokedAt : entry.link.issuedAt
  const linkTimeLabel = state === 'revoked' ? 'Revoked' : 'Issued'

  return (
    <Box
      component="tr"
      tabIndex={-1}
      data-participant-id={entry.id}
      data-testid={`roster-row-${entry.id}`}
      sx={{
        backgroundColor: entry.access === 'disabled' ? 'action.hover' : 'transparent',
        // `:focus`, not `:focus-visible`: focus is moved here by script (the person just
        // added), and the row must show it however it got there.
        '&:focus': { ...FOCUS_RING, outlineOffset: -2 },
        '&:hover': { backgroundColor: 'grid.light' },
      }}
    >
      <Box component="td" sx={CELL_SX}>
        <Box
          component="input"
          type="checkbox"
          checked={selected}
          aria-label={`Select ${entry.name}`}
          onChange={() => onToggleOne(entry.id)}
          sx={CHECKBOX_SX}
        />
      </Box>
      <Box component="th" scope="row" sx={{ ...CELL_SX, fontWeight: 700 }}>
        {entry.name}
      </Box>
      <Box component="td" sx={CELL_SX}><Text value={entry.agency} /></Box>
      <Box component="td" sx={CELL_SX}><Text value={entry.role} /></Box>
      <Box component="td" sx={{ ...CELL_SX, fontFamily: 'monospace', fontSize: 12.5 }}>
        {entry.signInName}
      </Box>
      <Box component="td" sx={CELL_SX}><PersonaCell persona={entry.persona} /></Box>
      <Box component="td" sx={CELL_SX}>
        <Stack sx={{ gap: '2px', alignItems: 'flex-start' }}>
          <EntryLinkBadge entry={entry} />
          {state === 'needsReissue'
            ? (
              <Typography component="span" sx={{ fontSize: 12, color: MUTED_TEXT }}>
                The stored link can&rsquo;t be recovered. Reissue it.
              </Typography>
            )
            : null}
          {linkTime !== undefined && state !== 'none'
            ? (
              <Typography component="span" sx={{ fontSize: 12, color: MUTED_TEXT }}>
                {linkTimeLabel} <Instant iso={linkTime} timeZone={timeZone} />
              </Typography>
            )
            : null}
        </Stack>
      </Box>
      <Box component="td" sx={CELL_SX}>
        {entry.lastSignInAt !== undefined
          ? <Instant iso={entry.lastSignInAt} timeZone={timeZone} />
          : <Box component="span" sx={{ color: MUTED_TEXT }}>Never</Box>}
      </Box>
      <Box component="td" sx={{ ...CELL_SX, textAlign: 'right' }}>{entry.liveSessions}</Box>
      <Box component="td" sx={CELL_SX}><AccessBadge access={entry.access} /></Box>
      <Box component="td" sx={CELL_SX}>
        <RosterRowActions entry={entry} onReport={onReport} />
      </Box>
    </Box>
  )
})

/** The roster table. See the module header. */
export function RosterTable({
  entries,
  totalCount,
  filterActive,
  timeZone,
  sortKey,
  sortDirection,
  onSort,
  selectedIds,
  onToggleOne,
  onToggleAllShown,
  onReport,
  focusRowRequest,
  onFocusRowHandled,
}: RosterTableProps) {
  const tableRef = useRef<HTMLTableElement>(null)
  const selectAllRef = useRef<HTMLInputElement>(null)

  const shownSelected = entries.filter(entry => selectedIds.has(entry.id)).length
  const allShownSelected = entries.length > 0 && shownSelected === entries.length
  const someShownSelected = shownSelected > 0 && !allShownSelected

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someShownSelected
  }, [someShownSelected])

  // Move focus to the requested row as soon as it is rendered. If the row is not
  // there yet (the list is still refetching) this waits for `entries` to change.
  useEffect(() => {
    if (focusRowRequest === null) return
    const row = Array.from(
      tableRef.current?.querySelectorAll<HTMLElement>('tr[data-participant-id]') ?? [],
    ).find(element => element.dataset.participantId === focusRowRequest.participantId)
    if (row === undefined) return
    row.focus()
    if (typeof row.scrollIntoView === 'function') row.scrollIntoView({ block: 'nearest' })
    onFocusRowHandled(focusRowRequest.token)
  }, [focusRowRequest, entries, onFocusRowHandled])

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'grid.main',
        borderRadius: 1,
        overflowX: 'auto',
        backgroundColor: 'background.paper',
      }}
    >
      <Box
        component="table"
        ref={tableRef}
        id="roster-table"
        data-testid="roster-table"
        sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 1180 }}
      >
        <Box
          component="caption"
          sx={{ textAlign: 'left', padding: '8px 10px', fontSize: 12.5, color: MUTED_TEXT }}
        >
          Participants on this exercise. Times are shown in {timeZone}.
        </Box>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" scope="col" sx={{ ...HEADER_CELL_SX, width: 36 }}>
              <Box
                component="input"
                type="checkbox"
                ref={selectAllRef}
                checked={allShownSelected}
                disabled={entries.length === 0}
                aria-label="Select all shown participants"
                onChange={event => onToggleAllShown(event.target.checked)}
                sx={CHECKBOX_SX}
              />
            </Box>
            {COLUMNS.map(column => (
              <SortHeader
                key={column.key}
                column={column}
                active={column.key === sortKey}
                direction={sortDirection}
                onSort={onSort}
              />
            ))}
            <Box component="th" scope="col" sx={HEADER_CELL_SX}>Actions</Box>
          </Box>
        </Box>
        <Box component="tbody">
          {entries.length === 0
            ? (
              <Box component="tr">
                <Box
                  component="td"
                  colSpan={COLUMN_COUNT}
                  data-testid="roster-no-matches"
                  sx={{ ...CELL_SX, textAlign: 'center', padding: '20px 10px' }}
                >
                  {filterActive && totalCount > 0
                    ? 'No participants match your filter.'
                    : 'No participants to show.'}
                </Box>
              </Box>
            )
            : entries.map(entry => (
              <RosterRow
                key={entry.id}
                entry={entry}
                selected={selectedIds.has(entry.id)}
                timeZone={timeZone}
                onToggleOne={onToggleOne}
                onReport={onReport}
              />
            ))}
        </Box>
      </Box>
    </Box>
  )
}
