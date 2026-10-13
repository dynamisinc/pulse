/**
 * features/participantAdmin/pages/RosterPage.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — the roster screen, driven end to end through the
 * stateful mock backend (no `@/core/services/api` mocking; the shipped mock
 * adapter answers). `getRoster` is wrapped so a test can substitute one answer
 * (pending / empty / 500 / 401) while the rest stay real.
 *
 * Pins: loading, 403/401, error + retry, empty, populated, the summary line,
 * filter, sort + aria-sort, the join-links banner, the time zone, selection and
 * the three slots (present and absent), add-participant focus, the import
 * toggle, announcements without a URL, and an accessibility pass.
 */
import type { ReactNode } from 'react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { configure, screen, waitFor, within } from '@testing-library/react'
import { rosterQueryKey } from '../hooks/useRoster'
import {
  resetRosterMocks,
  setRosterMockAccess,
  setRosterMockJoinLinksAvailable,
} from '../mocks/rosterMocks'
import * as rosterService from '../services/rosterService'
import { renderWithProviders } from '../test/renderWithProviders'
import type { RosterListDto } from '../types'
import { RosterPage, type RosterPageProps } from './RosterPage'
import { setupUser, fill } from '../test/userEvents'

// These tests render the full COBRA page / MUI dialogs through the stateful mock
// backend. A CI box under load can take several seconds just to mount the first
// one, so give them headroom over the 10 s test default and the 5 s `findBy`/`waitFor`
// default (set in src/test/setup.ts) rather than let contention read as a regression.
// Both settings are per test file (each file runs in its own isolated worker).
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 20_000 })

vi.mock('../services/rosterService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/rosterService')>()
  return { ...actual, getRoster: vi.fn(actual.getRoster) }
})

const getRosterSpy = vi.mocked(rosterService.getRoster)

const EMPTY_LIST: RosterListDto = {
  participants: [],
  joinLinksAvailable: true,
  capabilities: { emailLinks: false },
}

/** The seeded names in default (name ascending) order. */
const NAMES_BY_NAME = [
  'Aiko Tanaka',
  'Dana Whitfield',
  'Elena Vasquez',
  'Jordan Pike',
  'Marcus Oyelaran',
  'Priya Raman',
  'Tom Becker',
]

async function renderPage(props: RosterPageProps = {}) {
  const view = renderWithProviders(<RosterPage {...props} />)
  const user = setupUser()
  await screen.findByTestId('roster-table')
  return { ...view, user }
}

/** The names in the table body, top to bottom. */
function rowNames(): string[] {
  const table = screen.getByTestId('roster-table')
  // `hidden: true`: while a modal dialog is open the table is aria-hidden.
  return within(table).getAllByRole('rowheader', { hidden: true }).map(cell => cell.textContent ?? '')
}

function rowOf(name: string): HTMLElement {
  const header = within(screen.getByTestId('roster-table')).getByRole('rowheader', { name })
  const row = header.closest('tr')
  if (row === null) throw new Error(`no row for ${name}`)
  return row
}

beforeEach(() => {
  resetRosterMocks()
  getRosterSpy.mockClear()
})

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('RosterPage — states', () => {
  it('shows a loading line while the roster is in flight', async () => {
    getRosterSpy.mockReturnValueOnce(new Promise<RosterListDto>(() => {}))
    renderWithProviders(<RosterPage />)

    const loading = await screen.findByTestId('roster-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(loading).toHaveTextContent('Loading participants…')
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
    // The page owns its single h1 even while loading.
    expect(screen.getByRole('heading', { level: 1, name: 'Participants' })).toBeInTheDocument()
  })

  it.each([403, 401])('a %i renders "You don\'t have access to the roster", never a blank page', async status => {
    getRosterSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status }))
    renderWithProviders(<RosterPage />)

    const denied = await screen.findByTestId('roster-access-denied')
    expect(denied).toHaveAttribute('role', 'alert')
    expect(denied).toHaveTextContent('You don\'t have access to the roster')
    expect(denied).toHaveTextContent(/planners and controllers/i)
    // No table, no toolbar, no actions: nothing of the roster is offered.
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add participant|import csv/i })).not.toBeInTheDocument()
  })

  it('the mock\'s 403 switch drives the same state through the real service', async () => {
    setRosterMockAccess('forbidden')
    renderWithProviders(<RosterPage />)
    expect(await screen.findByTestId('roster-access-denied')).toBeInTheDocument()
  })

  it('a server error shows its reason and a Try again, never an empty-looking roster', async () => {
    getRosterSpy.mockRejectedValueOnce(
      new rosterService.RosterError('x', { status: 500, serverMessage: 'Database unavailable.' }),
    )
    renderWithProviders(<RosterPage />)
    const user = setupUser()

    const error = await screen.findByTestId('roster-load-error')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent('The roster could not be loaded')
    expect(error).toHaveTextContent('The server said: Database unavailable.')
    expect(screen.queryByTestId('roster-empty')).not.toBeInTheDocument()
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('roster-table')).toBeInTheDocument()
    expect(screen.queryByTestId('roster-load-error')).not.toBeInTheDocument()
  })

  it('an empty roster points at Import CSV and Add participant, with the import panel already open', async () => {
    getRosterSpy.mockResolvedValueOnce(EMPTY_LIST)
    renderWithProviders(<RosterPage />)

    const empty = await screen.findByTestId('roster-empty')
    expect(empty).toHaveTextContent('No participants yet')
    expect(empty).toHaveTextContent('Import CSV')
    expect(empty).toHaveTextContent('Add participant')
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('roster-summary')).not.toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Import a CSV roster' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import CSV' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('the auto-opened import panel stays open (with its result) after the first import fills the roster', async () => {
    getRosterSpy.mockResolvedValueOnce(EMPTY_LIST)
    renderWithProviders(<RosterPage />)
    const user = setupUser()
    await screen.findByTestId('roster-empty')
    const input = await screen.findByTestId('roster-import-file-input')
    await user.upload(input, new File(['name\nRiley Chen'], 'roster.csv', { type: 'text/csv' }))

    await user.click(screen.getByRole('button', { name: 'Import' }))

    // The refetch now returns people, so the empty state goes…
    await screen.findByTestId('roster-table')
    expect(screen.queryByTestId('roster-empty')).not.toBeInTheDocument()
    // …but the panel and its result stay put.
    expect(screen.getByTestId('roster-import-status')).toHaveTextContent('Imported 1 row')
    expect(screen.getByTestId('roster-import-rows')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Import CSV' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('a refresh that fails AFTER a good load keeps the rows but says they may be out of date', async () => {
    const { queryClient } = await renderPage()
    getRosterSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 500 }))

    await queryClient.refetchQueries({ queryKey: rosterQueryKey('ex-mock-0001') }).catch(() => {})

    const warning = await screen.findByTestId('roster-stale-warning')
    expect(warning).toHaveTextContent('may be out of date')
    expect(screen.getByTestId('roster-table')).toBeInTheDocument()
  })

  it('a refresh that comes back 403 hides the rows (access was withdrawn)', async () => {
    const { queryClient } = await renderPage()
    getRosterSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 403 }))

    await queryClient.refetchQueries({ queryKey: rosterQueryKey('ex-mock-0001') }).catch(() => {})

    expect(await screen.findByTestId('roster-access-denied')).toBeInTheDocument()
    expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
  })
})

describe('RosterPage — populated', () => {
  it('lists everyone, by name, with the summary line', async () => {
    await renderPage()
    expect(rowNames()).toEqual(NAMES_BY_NAME)
    expect(screen.getByTestId('roster-summary'))
      .toHaveTextContent('7 participants · 4 signed in · 2 with no link')
  })

  it('shows the columns the story names, as real column headers', async () => {
    await renderPage()
    const headers = within(screen.getByTestId('roster-table')).getAllByRole('columnheader')
    expect(headers.map(h => h.textContent?.trim())).toEqual([
      '',
      'Name',
      'Agency',
      'Role',
      'Sign-in name',
      'Persona',
      'Link',
      'Last sign-in',
      'Live sessions',
      'Access',
      'Actions',
    ])
  })

  it('shows name, agency, role, sign-in name and live sessions per row', async () => {
    await renderPage()
    const dana = rowOf('Dana Whitfield')
    expect(dana).toHaveTextContent('Fulco County EM')
    expect(dana).toHaveTextContent('EOC Liaison')
    expect(dana).toHaveTextContent('dwhitfield')
    const cells = within(dana).getAllByRole('cell')
    expect(cells.some(cell => cell.textContent === '1')).toBe(true)
  })

  it('persona: @handle with Org / Auto citizen / no badge / "No persona"', async () => {
    await renderPage()
    const dana = within(rowOf('Dana Whitfield'))
    expect(dana.getByText('@FulcoEM')).toBeInTheDocument()
    expect(dana.getByTestId('persona-badge-org')).toHaveTextContent('Org')

    const marcus = within(rowOf('Marcus Oyelaran'))
    expect(marcus.getByText('@marcus_oyelaran')).toBeInTheDocument()
    expect(marcus.getByTestId('persona-badge-auto')).toHaveTextContent('Auto citizen')

    const jordan = within(rowOf('Jordan Pike'))
    expect(jordan.getByText('@jpike_utilities')).toBeInTheDocument()
    expect(jordan.queryByTestId('persona-badge-org')).not.toBeInTheDocument()
    expect(jordan.queryByTestId('persona-badge-auto')).not.toBeInTheDocument()

    expect(rowOf('Aiko Tanaka')).toHaveTextContent('No persona')
  })

  it('link status: Active, Needs reissue, Revoked, None — each text plus icon', async () => {
    await renderPage()
    expect(within(rowOf('Dana Whitfield')).getByTestId('link-status-active')).toHaveTextContent('Active')
    expect(within(rowOf('Tom Becker')).getByTestId('link-status-needsReissue')).toHaveTextContent('Needs reissue')
    expect(within(rowOf('Elena Vasquez')).getByTestId('link-status-revoked')).toHaveTextContent('Revoked')
    expect(within(rowOf('Priya Raman')).getByTestId('link-status-none')).toHaveTextContent('None')
    // A needsReissue row says so in words, too.
    expect(rowOf('Tom Becker')).toHaveTextContent(/can.t be recovered/)
  })

  it('access: Enabled / Disabled', async () => {
    await renderPage()
    expect(within(rowOf('Dana Whitfield')).getByTestId('access-enabled')).toHaveTextContent('Enabled')
    expect(within(rowOf('Jordan Pike')).getByTestId('access-disabled')).toHaveTextContent('Disabled')
  })

  it('shows instants in the EXERCISE time zone with the zone named, and "Never" for no sign-in', async () => {
    await renderPage()
    const dana = rowOf('Dana Whitfield')
    // 2026-10-13T13:05:00Z in America/New_York (the mock exercise) is 9:05 AM EDT.
    const lastSignIn = within(dana).getAllByText('Oct 13, 9:05 AM EDT')
    expect(lastSignIn.length).toBeGreaterThan(0)
    expect(lastSignIn[0]?.tagName).toBe('TIME')
    expect(lastSignIn[0]).toHaveAttribute('datetime', '2026-10-13T13:05:00.000Z')
    expect(dana).toHaveTextContent('Issued Oct 13, 8:30 AM EDT')

    expect(rowOf('Elena Vasquez')).toHaveTextContent('Revoked Oct 13, 7:45 AM EDT')
    expect(rowOf('Priya Raman')).toHaveTextContent('Never')
    // And the table says which zone every time is in.
    expect(screen.getByRole('table')).toHaveAccessibleName(/times are shown in america\/new_york/i)
  })

  it('never renders a join URL anywhere in the page', async () => {
    await renderPage()
    expect(document.body.innerHTML).not.toContain('MOCK-TOKEN')
    expect(document.body.innerHTML).not.toContain('pulse.example.test')
  })
})

describe('RosterPage — join links not configured', () => {
  it('shows the warning banner and offers no Copy link', async () => {
    setRosterMockJoinLinksAvailable(false)
    await renderPage()

    const banner = screen.getByTestId('roster-join-links-banner')
    expect(banner).toHaveTextContent('Personal links are not configured on this server')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument()
  })

  it('shows no banner when links are configured', async () => {
    await renderPage()
    expect(screen.queryByTestId('roster-join-links-banner')).not.toBeInTheDocument()
  })
})

describe('RosterPage — filter', () => {
  it('filters by name, agency and sign-in name, and says how many are shown', async () => {
    const { user } = await renderPage()
    const filter = screen.getByRole('searchbox', { name: 'Filter participants' })

    await fill(user, filter, 'health')
    expect(rowNames()).toEqual(['Marcus Oyelaran'])
    expect(screen.getByTestId('roster-filter-status')).toHaveTextContent('Showing 1 of 7 participants')
    // The summary always describes the whole roster.
    expect(screen.getByTestId('roster-summary')).toHaveTextContent('7 participants')

    await user.clear(filter)
    await fill(user, filter, 'praman')
    expect(rowNames()).toEqual(['Priya Raman'])

    await user.clear(filter)
    await fill(user, filter, 'DANA')
    expect(rowNames()).toEqual(['Dana Whitfield'])
  })

  it('says so when nothing matches, and restores everyone when cleared', async () => {
    const { user } = await renderPage()
    const filter = screen.getByRole('searchbox', { name: 'Filter participants' })

    await fill(user, filter, 'zzzz')
    expect(screen.getByTestId('roster-no-matches')).toHaveTextContent('No participants match your filter.')

    await user.clear(filter)
    expect(rowNames()).toEqual(NAMES_BY_NAME)
    expect(screen.getByTestId('roster-filter-status')).toBeEmptyDOMElement()
  })
})

describe('RosterPage — sort', () => {
  const headerOf = (label: string) => screen.getByRole('columnheader', { name: label })

  it('starts sorted by name ascending, with aria-sort only on that header', async () => {
    await renderPage()
    expect(headerOf('Name')).toHaveAttribute('aria-sort', 'ascending')
    expect(headerOf('Agency')).toHaveAttribute('aria-sort', 'none')
    expect(headerOf('Link')).toHaveAttribute('aria-sort', 'none')
  })

  it('a header is a real button: click sorts ascending, click again descending', async () => {
    const { user } = await renderPage()

    await user.click(within(headerOf('Name')).getByRole('button', { name: 'Name' }))
    expect(headerOf('Name')).toHaveAttribute('aria-sort', 'descending')
    expect(rowNames()).toEqual([...NAMES_BY_NAME].reverse())

    await user.click(within(headerOf('Agency')).getByRole('button', { name: 'Agency' }))
    expect(headerOf('Agency')).toHaveAttribute('aria-sort', 'ascending')
    expect(headerOf('Name')).toHaveAttribute('aria-sort', 'none')
    // Agency ascending: "City of Fulco" first; Aiko (no agency) is last.
    expect(rowNames()[0]).toBe('Elena Vasquez')
    expect(rowNames().at(-1)).toBe('Aiko Tanaka')

    await user.click(within(headerOf('Agency')).getByRole('button', { name: 'Agency' }))
    expect(headerOf('Agency')).toHaveAttribute('aria-sort', 'descending')
    // Still last: a missing value never sorts "first".
    expect(rowNames().at(-1)).toBe('Aiko Tanaka')
  })

  it('is operable from the keyboard', async () => {
    const { user } = await renderPage()
    const button = within(headerOf('Sign-in name')).getByRole('button', { name: 'Sign-in name' })
    button.focus()
    await user.keyboard('{Enter}')
    expect(headerOf('Sign-in name')).toHaveAttribute('aria-sort', 'ascending')
    await user.keyboard(' ')
    expect(headerOf('Sign-in name')).toHaveAttribute('aria-sort', 'descending')
  })

  it('sorts the link column and last sign-in (never-signed-in last)', async () => {
    const { user } = await renderPage()

    await user.click(within(headerOf('Last sign-in')).getByRole('button', { name: 'Last sign-in' }))
    // Oldest first among those who have signed in; the two with no sign-in…
    const names = rowNames()
    expect(names.slice(0, 4)).toEqual(['Jordan Pike', 'Elena Vasquez', 'Marcus Oyelaran', 'Dana Whitfield'])
    expect(names.slice(4).sort()).toEqual(['Aiko Tanaka', 'Priya Raman', 'Tom Becker'])

    await user.click(within(headerOf('Link')).getByRole('button', { name: 'Link' }))
    // Active < Needs reissue < None < Revoked
    expect(rowNames().at(-1)).toBe('Elena Vasquez')
  })
})

describe('RosterPage — selection and slots', () => {
  it('renders no slot content when the slots are absent', async () => {
    await renderPage()
    const toolbar = screen.getByTestId('roster-toolbar')
    expect(within(toolbar).queryByTestId('cards-slot')).not.toBeInTheDocument()
    expect(within(toolbar).queryByTestId('email-slot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-word-slot')).not.toBeInTheDocument()
  })

  it('renders dayWordSlot ABOVE the table', async () => {
    await renderPage({ dayWordSlot: <div data-testid="day-word-slot">Today&apos;s word</div> })
    const slot = screen.getByTestId('day-word-slot')
    const table = screen.getByTestId('roster-table')
    expect(slot.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  describe('dayWordSlot is independent of the roster GET', () => {
    const slot = <div data-testid="day-word-slot">Today&apos;s word</div>

    it('still renders when the roster GET fails (staff need the word most then)', async () => {
      getRosterSpy.mockRejectedValueOnce(
        new rosterService.RosterError('x', { status: 500, serverMessage: 'Database unavailable.' }),
      )
      renderWithProviders(<RosterPage dayWordSlot={slot} />)

      expect(await screen.findByTestId('roster-load-error')).toBeInTheDocument()
      expect(screen.getByTestId('day-word-slot')).toBeInTheDocument()
      expect(screen.queryByTestId('roster-table')).not.toBeInTheDocument()
    })

    it('renders while the roster is still loading', async () => {
      getRosterSpy.mockReturnValueOnce(new Promise<RosterListDto>(() => {}))
      renderWithProviders(<RosterPage dayWordSlot={slot} />)

      expect(await screen.findByTestId('roster-loading')).toBeInTheDocument()
      expect(screen.getByTestId('day-word-slot')).toBeInTheDocument()
    })

    it('renders for an empty roster', async () => {
      getRosterSpy.mockResolvedValueOnce(EMPTY_LIST)
      renderWithProviders(<RosterPage dayWordSlot={slot} />)

      expect(await screen.findByTestId('roster-empty')).toBeInTheDocument()
      expect(screen.getByTestId('day-word-slot')).toBeInTheDocument()
    })

    it.each([403, 401])('is hidden on a %i (the same role gate refuses it too)', async status => {
      getRosterSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status }))
      renderWithProviders(<RosterPage dayWordSlot={slot} />)

      expect(await screen.findByTestId('roster-access-denied')).toBeInTheDocument()
      expect(screen.queryByTestId('day-word-slot')).not.toBeInTheDocument()
    })

    it('stays above the table once loaded, and above the error state when the load fails', async () => {
      getRosterSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 500 }))
      renderWithProviders(<RosterPage dayWordSlot={slot} />)
      const error = await screen.findByTestId('roster-load-error')
      expect(
        screen.getByTestId('day-word-slot').compareDocumentPosition(error)
          & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    })
  })

  it('calls renderCardsAction and renderEmailAction with the selected ids, in roster order', async () => {
    const cards = vi.fn((selection: readonly string[]): ReactNode => (
      <button type="button" data-testid="cards-slot">Cards {selection.length}</button>
    ))
    const email = vi.fn((selection: readonly string[]): ReactNode => (
      <button type="button" data-testid="email-slot">Email {selection.length}</button>
    ))
    const { user } = await renderPage({ renderCardsAction: cards, renderEmailAction: email })

    // With nothing selected, both slots get an empty selection.
    expect(cards).toHaveBeenLastCalledWith([])
    expect(email).toHaveBeenLastCalledWith([])
    const toolbar = screen.getByTestId('roster-toolbar')
    expect(within(toolbar).getByTestId('cards-slot')).toHaveTextContent('Cards 0')

    // Select Marcus THEN Dana: the ids still arrive in roster (name) order.
    await user.click(screen.getByRole('checkbox', { name: 'Select Marcus Oyelaran' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Dana Whitfield' }))

    expect(cards).toHaveBeenLastCalledWith(['mock-acct-001', 'mock-acct-002'])
    expect(email).toHaveBeenLastCalledWith(['mock-acct-001', 'mock-acct-002'])
    expect(within(toolbar).getByTestId('cards-slot')).toHaveTextContent('Cards 2')
    expect(within(toolbar).getByTestId('email-slot')).toHaveTextContent('Email 2')
    expect(screen.getByTestId('roster-selected-count')).toHaveTextContent('2 selected')
  })

  it('select-all selects every shown row and shows the indeterminate state for a partial selection', async () => {
    const cards = vi.fn((_selection: readonly string[]): ReactNode => null)
    const { user } = await renderPage({ renderCardsAction: cards })
    const all = screen.getByRole('checkbox', { name: 'Select all shown participants' }) as HTMLInputElement

    await user.click(screen.getByRole('checkbox', { name: 'Select Dana Whitfield' }))
    expect(all.indeterminate).toBe(true)
    expect(all.checked).toBe(false)

    await user.click(all)
    expect(all.indeterminate).toBe(false)
    expect(all.checked).toBe(true)
    expect(cards.mock.lastCall?.[0]).toHaveLength(7)

    await user.click(all)
    expect(cards.mock.lastCall?.[0]).toEqual([])
    expect(all.checked).toBe(false)
  })

  it('select-all applies to the FILTERED rows only', async () => {
    const cards = vi.fn((_selection: readonly string[]): ReactNode => null)
    const { user } = await renderPage({ renderCardsAction: cards })

    await fill(user, screen.getByRole('searchbox', { name: 'Filter participants' }), 'health')
    await user.click(screen.getByRole('checkbox', { name: 'Select all shown participants' }))

    expect(cards.mock.lastCall?.[0]).toEqual(['mock-acct-002'])
  })

  it('Clear selection empties it', async () => {
    const cards = vi.fn((_selection: readonly string[]): ReactNode => null)
    const { user } = await renderPage({ renderCardsAction: cards })
    await user.click(screen.getByRole('checkbox', { name: 'Select Dana Whitfield' }))
    expect(screen.getByTestId('roster-selected-count')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear selection' }))

    expect(screen.queryByTestId('roster-selected-count')).not.toBeInTheDocument()
    expect(cards.mock.lastCall?.[0]).toEqual([])
    expect(screen.getByRole('checkbox', { name: 'Select Dana Whitfield' })).not.toBeChecked()
  })

  it('a selected person who leaves the roster is dropped from the selection', async () => {
    const cards = vi.fn((_selection: readonly string[]): ReactNode => null)
    const { user, queryClient } = await renderPage({ renderCardsAction: cards })
    await user.click(screen.getByRole('checkbox', { name: 'Select Dana Whitfield' }))
    expect(cards.mock.lastCall?.[0]).toEqual(['mock-acct-001'])

    const data = queryClient.getQueryData<RosterListDto>(rosterQueryKey('ex-mock-0001'))
    if (data === undefined) throw new Error('no roster data')
    queryClient.setQueryData(rosterQueryKey('ex-mock-0001'), {
      ...data,
      participants: data.participants.filter(p => p.id !== 'mock-acct-001'),
    })

    await waitFor(() => expect(cards.mock.lastCall?.[0]).toEqual([]))
  })
})

describe('RosterPage — import toggle', () => {
  it('is closed by default for a populated roster; the button opens it and moves focus in', async () => {
    const { user } = await renderPage()
    const toggle = screen.getByRole('button', { name: 'Import CSV' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('roster-import-panel')).not.toBeInTheDocument()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(toggle).toHaveAttribute('aria-controls', 'roster-import-panel')
    const panel = await screen.findByRole('region', { name: 'Import a CSV roster' })
    await waitFor(() => expect(panel).toHaveFocus())

    await user.click(toggle)
    expect(screen.queryByTestId('roster-import-panel')).not.toBeInTheDocument()
  })

  it('a real import through the page refetches and the new people appear', async () => {
    const { user } = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Import CSV' }))
    const input = await screen.findByTestId('roster-import-file-input')
    await user.upload(input, new File(['name,agency\nRiley Chen,Fulco Fire'], 'roster.csv', { type: 'text/csv' }))

    await user.click(screen.getByRole('button', { name: 'Import' }))

    await waitFor(() => expect(rowNames()).toContain('Riley Chen'))
    expect(screen.getByTestId('roster-summary')).toHaveTextContent('8 participants')
  })
})

describe('RosterPage — add participant', () => {
  it('adds a person: the dialog closes, the list refetches, the new row is focused and announced', async () => {
    const { user } = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add participant' })
    await fill(user, within(dialog).getByLabelText(/^name/i), 'Zed Zimmer')
    await user.click(within(dialog).getByRole('button', { name: 'Add participant' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const row = rowOf('Zed Zimmer')
    await waitFor(() => expect(row).toHaveFocus())
    expect(row).toHaveTextContent('zzimmer')
    expect(screen.getByTestId('roster-announcement'))
      .toHaveTextContent('Added Zed Zimmer. Their sign-in name is zzimmer.')
    expect(screen.getByTestId('roster-summary')).toHaveTextContent('8 participants')
  })

  it('clears an active filter so the new row can be seen and focused', async () => {
    const { user } = await renderPage()
    await fill(user, screen.getByRole('searchbox', { name: 'Filter participants' }), 'dana')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add participant' })
    await fill(user, within(dialog).getByLabelText(/^name/i), 'Zed Zimmer')
    await user.click(within(dialog).getByRole('button', { name: 'Add participant' }))

    await waitFor(() => expect(rowOf('Zed Zimmer')).toHaveFocus())
    expect(screen.getByRole('searchbox', { name: 'Filter participants' })).toHaveValue('')
  })

  it('Cancel returns focus to the Add participant button', async () => {
    const { user } = await renderPage()
    const add = screen.getByRole('button', { name: 'Add participant' })
    await user.click(add)
    await screen.findByRole('dialog', { name: 'Add participant' })

    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(add).toHaveFocus())
  })

  it('a duplicate shows "already on the roster" inline and does not add a row', async () => {
    const { user } = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add participant' })
    await fill(user, within(dialog).getByLabelText(/^name/i), 'Someone Else')
    await fill(user, within(dialog).getByLabelText(/^sign-in name/i), 'dwhitfield')
    await user.click(within(dialog).getByRole('button', { name: 'Add participant' }))

    expect(await within(dialog).findByTestId('add-participant-error'))
      .toHaveTextContent('already on the roster')
    expect(rowNames()).toEqual(NAMES_BY_NAME)
  })
})

describe('RosterPage — row actions through the page', () => {
  it('Copy link announces "Link copied" in the live region, with no URL', async () => {
    const { user } = await renderPage()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await user.click(within(rowOf('Dana Whitfield')).getByRole('button', { name: 'Copy link for Dana Whitfield' }))

    const region = screen.getByTestId('roster-announcement')
    await waitFor(() => expect(region).toHaveTextContent('Link copied for Dana Whitfield.'))
    expect(region).toHaveAttribute('role', 'status')
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/join/'))
    expect(document.body.innerHTML).not.toContain('MOCK-TOKEN')
  })

  it('a failed copy is announced as an error (role="alert"), still with no URL', async () => {
    const { user } = await renderPage()
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })

    await user.click(within(rowOf('Dana Whitfield')).getByRole('button', { name: 'Copy link for Dana Whitfield' }))

    const region = screen.getByTestId('roster-announcement-error')
    await waitFor(() =>
      expect(region).toHaveTextContent(/could not copy the link for dana whitfield/i),
    )
    expect(region).toHaveAttribute('role', 'alert')
    expect(region).not.toHaveTextContent('pulse.example.test')
  })

  it('Disable (confirmed) reports sessionsEnded and the row flips to Disabled', async () => {
    const { user } = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Disable Marcus Oyelaran' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Disable Marcus Oyelaran?' })
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }))

    await waitFor(() =>
      expect(screen.getByTestId('roster-announcement'))
        .toHaveTextContent('Marcus Oyelaran disabled. 2 sessions ended.'),
    )
    await waitFor(() =>
      expect(within(rowOf('Marcus Oyelaran')).getByTestId('access-disabled')).toBeInTheDocument(),
    )
  })
})

describe('RosterPage — accessibility (NFR-001)', () => {
  it('has one h1, a captioned table, scoped headers and a row header per participant', async () => {
    await renderPage()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)

    const table = screen.getByTestId('roster-table')
    expect(table.querySelector('caption')).not.toBeNull()
    for (const header of within(table).getAllByRole('columnheader')) {
      expect(header).toHaveAttribute('scope', 'col')
    }
    const rowHeaders = within(table).getAllByRole('rowheader')
    expect(rowHeaders).toHaveLength(7)
    for (const header of rowHeaders) expect(header).toHaveAttribute('scope', 'row')
  })

  it('every sortable header holds a real <button> and carries aria-sort', async () => {
    await renderPage()
    const sortable = ['Name', 'Agency', 'Role', 'Sign-in name', 'Persona', 'Link', 'Last sign-in', 'Live sessions', 'Access']
    for (const label of sortable) {
      const header = screen.getByRole('columnheader', { name: label })
      expect(header).toHaveAttribute('aria-sort')
      expect(within(header).getByRole('button', { name: label }).tagName).toBe('BUTTON')
    }
    // Select and Actions are not sortable.
    expect(screen.getByRole('columnheader', { name: 'Actions' })).not.toHaveAttribute('aria-sort')
  })

  it('every status mark is an icon AND a word (never colour alone)', async () => {
    await renderPage()
    const marks = [
      ...screen.getAllByTestId(/^link-status-/),
      ...screen.getAllByTestId(/^access-/),
      ...screen.getAllByTestId(/^persona-badge-/),
    ]
    expect(marks.length).toBeGreaterThan(10)
    for (const mark of marks) {
      expect(mark.textContent?.trim().length).toBeGreaterThan(0)
      const icon = mark.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('every checkbox and every action button has an accessible name that names the person', async () => {
    await renderPage()
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect(checkbox).toHaveAccessibleName(/^select /i)
    }
    const table = screen.getByTestId('roster-table')
    for (const group of within(table).getAllByRole('group')) {
      const person = /^Actions for (.+)$/.exec(group.getAttribute('aria-label') ?? '')?.[1]
      expect(person).toBeTruthy()
      for (const button of within(group).getAllByRole('button')) {
        expect(button.getAttribute('aria-label')).toContain(person)
      }
    }
  })

  it('has persistent polite and assertive live regions for results and errors', async () => {
    await renderPage()
    const status = screen.getByTestId('roster-announcement')
    const alert = screen.getByTestId('roster-announcement-error')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(alert).toHaveAttribute('role', 'alert')
  })

  it('confirm dialogs are alertdialogs with a focus trap: Tab stays inside', async () => {
    const { user } = await renderPage()
    await user.click(screen.getByRole('button', { name: 'Revoke link for Dana Whitfield' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Revoke the link for Dana Whitfield?')

    for (let i = 0; i < 4; i += 1) {
      await user.tab()
      expect(dialog.contains(document.activeElement)).toBe(true)
    }
  })

  it('the toolbar controls are reachable and operable by keyboard alone', async () => {
    const { user } = await renderPage()
    const filter = screen.getByRole('searchbox', { name: 'Filter participants' })
    filter.focus()
    await user.keyboard('dana')
    expect(rowNames()).toEqual(['Dana Whitfield'])

    screen.getByRole('button', { name: 'Add participant' }).focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Add participant' })).toBeInTheDocument()
  })
})
