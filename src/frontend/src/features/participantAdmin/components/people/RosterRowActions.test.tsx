/**
 * features/participantAdmin/components/people/RosterRowActions.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — the per-row actions, driven end to end through the
 * stateful mock backend (the harness reads the row from the live roster query,
 * so a refetch really changes the buttons). Pins: each action and its confirm,
 * the clipboard path and fallback, NO join URL in any message or in the DOM,
 * `sessionsEnded` reporting, focus restore (same action, or the row's first
 * remaining one), and the `needsReissue` / `none` rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, screen, waitFor, within } from '@testing-library/react'
import * as rosterService from '../../services/rosterService'
import { useRoster } from '../../hooks/useRoster'
import {
  getRosterMockEntries,
  resetRosterMocks,
} from '../../mocks/rosterMocks'
import { makeEntry, makeLink } from '../../test/fixtures'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { RosterActionReport } from './rosterActions'
import { RosterRowActions } from './RosterRowActions'
import { setupUser } from '../../test/userEvents'

// These tests render the full COBRA page / MUI dialogs through the stateful mock
// backend. A CI box under load can take several seconds just to mount the first
// one, so give them headroom over the 10 s test default and the 5 s `findBy`/`waitFor`
// default (set in src/test/setup.ts) rather than let contention read as a regression.
// Both settings are per test file (each file runs in its own isolated worker).
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 20_000 })

vi.mock('../../services/rosterService', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/rosterService')>()
  return { ...actual, runRosterAction: vi.fn(actual.runRosterAction) }
})

const runAction = vi.mocked(rosterService.runRosterAction)

/** Mock seed ids (see rosterMocks). */
const DANA = 'mock-acct-001' // active link, 1 live session, org persona
const MARCUS = 'mock-acct-002' // active link, 2 live sessions
const PRIYA = 'mock-acct-003' // no link, 0 sessions
const TOM = 'mock-acct-004' // needsReissue
const ELENA = 'mock-acct-005' // revoked
const JORDAN = 'mock-acct-006' // disabled

/** The row, read from the live roster query so a refetch re-renders it. */
function LiveRow({ id, onReport }: { id: string, onReport: (r: RosterActionReport) => void }) {
  const { data } = useRoster()
  const entry = data?.participants.find(p => p.id === id)
  return entry ? <RosterRowActions entry={entry} onReport={onReport} /> : null
}

async function renderLiveRow(id: string) {
  const onReport = vi.fn<(report: RosterActionReport) => void>()
  renderWithProviders(<LiveRow id={id} onReport={onReport} />)
  await screen.findByRole('group', { name: /^actions for/i })
  return { onReport, user: setupUser() }
}

/**
 * Replaces `navigator.clipboard`. Call it AFTER `renderLiveRow()`: `setupUser()`
 * installs its own clipboard stub, which would overwrite one set earlier.
 */
function stubClipboard(value: unknown) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

async function dialogGone() {
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
}

beforeEach(() => {
  resetRosterMocks()
  runAction.mockClear()
})

afterEach(() => {
  stubClipboard(undefined)
  Object.defineProperty(document, 'execCommand', { value: undefined, configurable: true, writable: true })
})

describe('RosterRowActions — which buttons', () => {
  it('an active link offers Copy, Reissue, Revoke and Disable, each named for the person', async () => {
    await renderLiveRow(DANA)
    const group = screen.getByRole('group', { name: 'Actions for Dana Whitfield' })
    expect(within(group).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Copy link for Dana Whitfield',
      'Reissue link for Dana Whitfield',
      'Revoke link for Dana Whitfield',
      'Disable Dana Whitfield',
    ])
  })

  it('a needsReissue row offers Reissue INSTEAD of Copy', async () => {
    await renderLiveRow(TOM)
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reissue link for Tom Becker' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Revoke link for Tom Becker' })).toBeInTheDocument()
  })

  it('a row with no link offers "Issue link"', async () => {
    await renderLiveRow(PRIYA)
    expect(screen.getByRole('button', { name: 'Issue link for Priya Raman' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy link|revoke link/i })).not.toBeInTheDocument()
  })

  it('a revoked row offers Reissue; a disabled row offers only Enable', async () => {
    const revoked = await renderLiveRow(ELENA)
    expect(screen.getByRole('button', { name: 'Reissue link for Elena Vasquez' })).toBeInTheDocument()
    expect(revoked.onReport).not.toHaveBeenCalled()
  })

  it('a disabled row offers only Enable', async () => {
    await renderLiveRow(JORDAN)
    const group = screen.getByRole('group', { name: 'Actions for Jordan Pike' })
    expect(within(group).getAllByRole('button')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Enable Jordan Pike' })).toBeInTheDocument()
  })
})

describe('RosterRowActions — Copy link', () => {
  it('writes the join URL to the clipboard in the click and announces "Link copied" with NO URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    const { onReport, user } = await renderLiveRow(DANA)
    stubClipboard({ writeText })

    await user.click(screen.getByRole('button', { name: 'Copy link for Dana Whitfield' }))

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith('https://pulse.example.test/join/MOCK-TOKEN-dana-whitfield')
    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(1))
    const report = onReport.mock.calls[0]?.[0]
    expect(report).toEqual({ tone: 'success', message: 'Link copied for Dana Whitfield.' })
    expect(JSON.stringify(report)).not.toContain('pulse.example.test')
    expect(JSON.stringify(report)).not.toContain('MOCK-TOKEN')
  })

  it('never renders the URL anywhere in the DOM (text, title, aria-label, href)', async () => {
    const { user } = await renderLiveRow(DANA)
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })
    await user.click(screen.getByRole('button', { name: 'Copy link for Dana Whitfield' }))

    expect(document.body.innerHTML).not.toContain('MOCK-TOKEN')
    expect(document.body.innerHTML).not.toContain('pulse.example.test')
  })

  it('falls back to execCommand("copy") when there is no clipboard API', async () => {
    const execCommand = vi.fn().mockReturnValue(true)
    Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true, writable: true })
    const { onReport, user } = await renderLiveRow(DANA)
    stubClipboard(undefined)

    await user.click(screen.getByRole('button', { name: 'Copy link for Dana Whitfield' }))

    await waitFor(() => expect(onReport).toHaveBeenCalled())
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(onReport.mock.calls[0]?.[0]).toEqual({ tone: 'success', message: 'Link copied for Dana Whitfield.' })
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('reports a clear error (still no URL) when nothing could copy', async () => {
    const { onReport, user } = await renderLiveRow(DANA)
    stubClipboard(undefined)

    await user.click(screen.getByRole('button', { name: 'Copy link for Dana Whitfield' }))

    await waitFor(() => expect(onReport).toHaveBeenCalled())
    const report = onReport.mock.calls[0]?.[0]
    expect(report?.tone).toBe('error')
    expect(report?.message).toMatch(/could not copy the link for dana whitfield/i)
    expect(report?.message).not.toContain('pulse.example.test')
  })

  it('does not call the network: the URL comes from data already in memory', async () => {
    const { user } = await renderLiveRow(DANA)
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) })
    await user.click(screen.getByRole('button', { name: 'Copy link for Dana Whitfield' }))
    expect(runAction).not.toHaveBeenCalled()
  })
})

describe('RosterRowActions — confirmed actions', () => {
  it('Reissue opens a role="alertdialog" that says plainly what happens, focused on Cancel', async () => {
    const { user } = await renderLiveRow(DANA)
    await user.click(screen.getByRole('button', { name: 'Reissue link for Dana Whitfield' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Reissue the link for Dana Whitfield?' })
    expect(dialog).toHaveAccessibleDescription(
      /This signs Dana Whitfield out everywhere and the old link stops working\./,
    )
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    // Nothing happened yet.
    expect(runAction).not.toHaveBeenCalled()
  })

  it('Cancel closes without acting and returns focus to the button that opened it', async () => {
    const { user } = await renderLiveRow(DANA)
    const trigger = screen.getByRole('button', { name: 'Revoke link for Dana Whitfield' })
    await user.click(trigger)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await dialogGone()
    expect(runAction).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('Escape cancels the same way', async () => {
    const { user } = await renderLiveRow(DANA)
    const trigger = screen.getByRole('button', { name: 'Disable Dana Whitfield' })
    await user.click(trigger)
    await screen.findByRole('alertdialog')
    await user.keyboard('{Escape}')

    await dialogGone()
    expect(runAction).not.toHaveBeenCalled()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('confirming Reissue calls the action, reports sessionsEnded, refetches, and focus returns to Reissue', async () => {
    const before = getRosterMockEntries().find(e => e.id === MARCUS)?.link.joinUrl
    const { onReport, user } = await renderLiveRow(MARCUS)

    await user.click(screen.getByRole('button', { name: 'Reissue link for Marcus Oyelaran' }))
    await user.click(await screen.findByRole('button', { name: 'Reissue link' }))

    await waitFor(() => expect(onReport).toHaveBeenCalledTimes(1))
    expect(runAction).toHaveBeenCalledWith('reissue', MARCUS)
    expect(onReport.mock.calls[0]?.[0]).toEqual({
      tone: 'success',
      message: 'New link issued for Marcus Oyelaran. 2 sessions ended.',
    })
    // The backend rotated the token, and the report carries none of it.
    const after = getRosterMockEntries().find(e => e.id === MARCUS)?.link.joinUrl
    expect(after).not.toBe(before)
    expect(onReport.mock.calls[0]?.[0].message).not.toContain('MOCK-TOKEN')

    await dialogGone()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reissue link for Marcus Oyelaran' })).toHaveFocus(),
    )
  })

  it('confirming Revoke ends sessions; the row now offers Reissue, and focus lands on the row\'s first action', async () => {
    const { onReport, user } = await renderLiveRow(DANA)

    await user.click(screen.getByRole('button', { name: 'Revoke link for Dana Whitfield' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Revoke the link for Dana Whitfield?' })
    await user.click(within(dialog).getByRole('button', { name: 'Revoke link' }))

    await waitFor(() => expect(onReport).toHaveBeenCalled())
    expect(onReport.mock.calls[0]?.[0]).toEqual({
      tone: 'success',
      message: 'Link revoked for Dana Whitfield. 1 session ended.',
    })
    // The refetched row is revoked: no Copy, no Revoke.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /revoke link for/i })).not.toBeInTheDocument(),
    )
    expect(screen.queryByRole('button', { name: /copy link/i })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Reissue link for Dana Whitfield' })).toHaveFocus(),
    )
  })

  it('confirming Disable signs them out; the row becomes Enable and focus lands on Enable', async () => {
    const { onReport, user } = await renderLiveRow(MARCUS)

    await user.click(screen.getByRole('button', { name: 'Disable Marcus Oyelaran' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Disable Marcus Oyelaran?' })
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }))

    await waitFor(() => expect(onReport).toHaveBeenCalled())
    expect(onReport.mock.calls[0]?.[0].message).toBe('Marcus Oyelaran disabled. 2 sessions ended.')
    const enable = await screen.findByRole('button', { name: 'Enable Marcus Oyelaran' })
    await waitFor(() => expect(enable).toHaveFocus())
  })

  it('Enable needs no confirm, restores access, and focus moves to the row\'s first action', async () => {
    const { onReport, user } = await renderLiveRow(JORDAN)

    await user.click(screen.getByRole('button', { name: 'Enable Jordan Pike' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(onReport).toHaveBeenCalled())
    expect(onReport.mock.calls[0]?.[0]).toEqual({ tone: 'success', message: 'Jordan Pike enabled.' })
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Copy link for Jordan Pike' })).toHaveFocus(),
    )
  })

  it('"Issue link" on a no-link row with no live sessions goes straight through (nothing to lose)', async () => {
    const { onReport, user } = await renderLiveRow(PRIYA)

    await user.click(screen.getByRole('button', { name: 'Issue link for Priya Raman' }))

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    await waitFor(() => expect(onReport).toHaveBeenCalled())
    expect(onReport.mock.calls[0]?.[0]).toEqual({
      tone: 'success',
      message: 'New link issued for Priya Raman. No live sessions to end.',
    })
    // She now has a link: Copy is offered.
    expect(await screen.findByRole('button', { name: 'Copy link for Priya Raman' })).toBeInTheDocument()
  })

  it('a needsReissue row is fixed by Reissue: afterwards it offers Copy', async () => {
    const { user } = await renderLiveRow(TOM)
    await user.click(screen.getByRole('button', { name: 'Reissue link for Tom Becker' }))
    await user.click(await screen.findByRole('button', { name: 'Reissue link' }))

    expect(await screen.findByRole('button', { name: 'Copy link for Tom Becker' })).toBeInTheDocument()
  })
})

describe('RosterRowActions — failures', () => {
  it('keeps the dialog open with the server\'s reason inline (role="alert") so a retry is one click', async () => {
    runAction.mockRejectedValueOnce(
      new rosterService.RosterError('x', { status: 500, serverMessage: 'The database is on fire.' }),
    )
    const { onReport, user } = await renderLiveRow(DANA)

    await user.click(screen.getByRole('button', { name: 'Disable Dana Whitfield' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }))

    const alert = await within(dialog).findByRole('alert')
    expect(alert).toHaveTextContent('Could not disable Dana Whitfield: The database is on fire.')
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(onReport).not.toHaveBeenCalled()

    // Retry succeeds (the mock is real again).
    await user.click(within(dialog).getByRole('button', { name: 'Disable' }))
    await waitFor(() => expect(onReport).toHaveBeenCalled())
    await dialogGone()
  })

  it('a 404 closes the dialog and reports the person is no longer on the roster', async () => {
    // A row the mock backend has never heard of, as a cross-exercise id would be.
    const onReport = vi.fn<(report: RosterActionReport) => void>()
    renderWithProviders(
      <RosterRowActions entry={makeEntry({ id: 'ghost', link: makeLink({ status: 'revoked' }) })} onReport={onReport} />,
    )
    const user = setupUser()

    await user.click(await screen.findByRole('button', { name: 'Disable Jane Smith' }))
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Disable' }))

    await waitFor(() => expect(onReport).toHaveBeenCalled())
    expect(onReport.mock.calls[0]?.[0]).toEqual({
      tone: 'error',
      message: 'Jane Smith is no longer on this roster. The list has been refreshed.',
    })
    await dialogGone()
  })

  it('reports a failed Enable (no dialog involved) through onReport', async () => {
    runAction.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 403 }))
    const { onReport, user } = await renderLiveRow(JORDAN)

    await user.click(screen.getByRole('button', { name: 'Enable Jordan Pike' }))

    await waitFor(() => expect(onReport).toHaveBeenCalled())
    expect(onReport.mock.calls[0]?.[0]).toEqual({
      tone: 'error',
      message: 'You don\'t have access to change this roster.',
    })
  })
})
