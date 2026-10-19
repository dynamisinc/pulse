/**
 * features/controller/runSheet/RunSheetRow.test.tsx
 * ---------------------------------------------------------------------------
 * One run-sheet row (inject-queue story 07, AC "The list"):
 *  - the status is TEXT + an ICON for every status — never colour-only (NFR-001);
 *  - a burst in flight reads "Firing n/m"; a burst shows the first persona + "+N";
 *  - T+N, the assignee ("(you)" on mine) and the title;
 *  - a fired row shows the fired SCENARIO time (exercise time zone, via
 *    `formatScenarioTime`) with the wall-clock time as a labelled secondary, and who fired it;
 *  - a failed row shows the server's reason and a Retry;
 *  - which action buttons exist follows the state machine, each with an accessible name;
 *  - Fire is disabled while busy and, under FREEZE, with the reason "World frozen".
 *  - Demo-feedback story 23 (DF-36): "Mark fired" on pending / held / failed rows, behind a
 *    confirm; a fired item with no child post id reads "Marked fired"; an evaluator gets none.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { RunSheetRow, type RunSheetRowProps } from './RunSheetRow'
import { makeItem, makePost } from './runSheetTestHarness'
import type { InjectItemDto, InjectStatus } from './types'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is "controller" here unless a case
// flips it to an evaluator.
const access = vi.hoisted(() => ({ canControl: true, canEdit: true }))
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => access.canControl,
  useCanEditContent: () => access.canEdit,
  useCanStaffPost: () => access.canControl,
  useCanStaffPin: () => access.canControl,
}))

beforeEach(() => {
  access.canControl = true
  access.canEdit = true
})

const persona = {
  displayName: 'Fairhaven Water Utility',
  handle: 'FairhavenWater',
  initials: 'FW',
  avatarColor: '#2D9CDB',
}

function props(item: InjectItemDto, overrides: Partial<RunSheetRowProps> = {}): RunSheetRowProps {
  return {
    item,
    selected: false,
    tabStop: false,
    busy: false,
    fireDisabledReason: undefined,
    fireReasonId: 'reason',
    isMine: false,
    personaOf: () => persona,
    nameOf: id => (id === 'human-controller-02' ? 'Jordan Ames' : undefined),
    timeZone: 'America/New_York',
    canMoveUp: true,
    canMoveDown: true,
    confirmingDelete: false,
    onSelect: vi.fn(),
    onFire: vi.fn(),
    onHold: vi.fn(),
    onRelease: vi.fn(),
    onSkip: vi.fn(),
    onUnskip: vi.fn(),
    onRetry: vi.fn(),
    onMarkFired: vi.fn(),
    onOpen: vi.fn(),
    onRequestDelete: vi.fn(),
    onConfirmDelete: vi.fn(),
    onCancelDelete: vi.fn(),
    onMoveUp: vi.fn(),
    onMoveDown: vi.fn(),
    ...overrides,
  }
}

function renderRow(item: InjectItemDto, overrides: Partial<RunSheetRowProps> = {}) {
  const p = props(item, overrides)
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ul>
        <RunSheetRow {...p} />
      </ul>
    </ThemeProvider>,
  )
  return { ...utils, p }
}

const buttonNames = (): string[] =>
  screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? b.textContent ?? '')

describe('RunSheetRow — status as text + icon (NFR-001)', () => {
  const cases: { status: InjectStatus; text: string; extra?: Partial<InjectItemDto> }[] = [
    { status: 'pending', text: 'Pending' },
    { status: 'held', text: 'Held' },
    { status: 'firing', text: 'Firing 3/8', extra: { firedCount: 3, total: 8 } },
    {
      status: 'fired',
      text: 'Fired',
      extra: { posts: [makePost({ status: 'fired', firedPostId: 'post-1' })] },
    },
    { status: 'skipped', text: 'Skipped' },
    { status: 'failed', text: 'Failed' },
  ]

  it.each(cases)('$status renders the word "$text" AND an icon', ({ status, text, extra }) => {
    renderRow(makeItem({ status, ...extra }))
    const chip = screen.getByTestId('status-chip')
    expect(chip).toHaveAttribute('data-status', status)
    expect(within(chip).getByTestId('status-text')).toHaveTextContent(text)
    // An icon accompanies the text (an <svg>, decorative: aria-hidden).
    const icon = within(chip).getByTestId('status-icon')
    expect(icon.tagName.toLowerCase()).toBe('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('every status has a DISTINCT icon, so state is not carried by tone alone', () => {
    const icons = new Set<string>()
    for (const { status, extra } of cases) {
      const { unmount } = renderRow(makeItem({ status, ...extra }))
      icons.add(screen.getByTestId('status-icon').getAttribute('data-icon') ?? status)
      unmount()
    }
    expect(icons.size).toBe(cases.length)
  })
})

describe('RunSheetRow — "Marked fired" (DF-36)', () => {
  it('a fired item with no child post id reads "Marked fired" — text and its own icon', () => {
    renderRow(makeItem({ status: 'fired', posts: [makePost({ status: 'skipped' })] }))
    const chip = screen.getByTestId('status-chip')
    expect(within(chip).getByTestId('status-text')).toHaveTextContent('Marked fired')
    expect(chip).toHaveAttribute('data-status', 'fired')
    expect(chip).toHaveAttribute('data-marked-fired', 'true')
    const marked = within(chip).getByTestId('status-icon').getAttribute('data-icon')
    renderRow(makeItem({ status: 'fired', posts: [makePost({ status: 'fired', firedPostId: 'p-1' })] }))
    const posted = screen.getAllByTestId('status-icon')[1]?.getAttribute('data-icon')
    expect(marked).not.toBe(posted)
  })

  it('a fired item where any child carries a post id stays "Fired"', () => {
    renderRow(makeItem({
      kind: 'burst',
      status: 'fired',
      posts: [
        makePost({ id: 'a', status: 'fired', firedPostId: 'p-1' }),
        makePost({ id: 'b', sequence: 2, status: 'skipped' }),
      ],
    }))
    expect(screen.getByTestId('status-text')).toHaveTextContent(/^Fired$/)
    expect(screen.getByTestId('status-chip')).not.toHaveAttribute('data-marked-fired')
  })

  it.each(['pending', 'held', 'failed'] as const)('a %s row offers "Mark fired" (icon + text)', status => {
    renderRow(makeItem({ status, title: 'Item' }))
    const button = screen.getByRole('button', { name: 'Mark fired Item' })
    expect(button).toHaveTextContent('Mark fired')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it.each(['firing', 'fired', 'skipped'] as const)('a %s row has no "Mark fired"', status => {
    renderRow(makeItem({ status, title: 'Item' }))
    expect(screen.queryByRole('button', { name: 'Mark fired Item' })).toBeNull()
  })

  it('asks first; Cancel changes nothing, confirming marks it once', () => {
    const { p } = renderRow(makeItem({ title: 'Item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mark fired Item' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('Mark as fired without posting? This can\'t be undone.')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(p.onMarkFired).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Mark fired Item' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark fired' }))
    expect(p.onMarkFired).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a key press inside the confirm never reaches the run sheet shortcuts', () => {
    const onKeyDown = vi.fn()
    const p = props(makeItem({ title: 'Item' }))
    render(
      <ThemeProvider theme={cobraTheme}>
        <ul onKeyDown={onKeyDown}>
          <RunSheetRow {...p} />
        </ul>
      </ThemeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Mark fired Item' }))
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'f' })
    expect(onKeyDown).not.toHaveBeenCalled()
  })

  it('is disabled while an action on the row is in flight, and allowed under FREEZE', () => {
    const { unmount } = renderRow(makeItem({ title: 'Item' }), { busy: true })
    expect(screen.getByRole('button', { name: 'Mark fired Item' })).toBeDisabled()
    unmount()
    renderRow(makeItem({ title: 'Item' }), { fireDisabledReason: 'World frozen' })
    expect(screen.getByRole('button', { name: 'Mark fired Item' })).toBeEnabled()
  })

  it.each(['pending', 'held', 'failed'] as const)('an evaluator gets no "Mark fired" on a %s row', status => {
    access.canControl = false
    access.canEdit = false
    renderRow(makeItem({ status, title: 'Item' }))
    expect(screen.queryByRole('button', { name: 'Mark fired Item' })).toBeNull()
  })
})

describe('RunSheetRow — a planner (story 17: inject authoring is planner + controller)', () => {
  it('keeps Edit, Delete and the reorder arrows, and loses Fire, Hold, Skip and Mark fired', () => {
    access.canControl = false
    access.canEdit = true
    renderRow(makeItem({ status: 'pending', title: 'Item' }), { canMoveUp: true, canMoveDown: true })
    expect(screen.getByRole('button', { name: 'Edit Item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Item' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Item up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Item down' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Fire Item/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /^Skip Item/ })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mark fired Item' })).toBeNull()
  })

  it('an evaluator (neither) gets View only: no Edit, Delete or reorder', () => {
    access.canControl = false
    access.canEdit = false
    renderRow(makeItem({ status: 'pending', title: 'Item' }), { canMoveUp: true, canMoveDown: true })
    expect(screen.getByRole('button', { name: 'View Item' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Item' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Move Item up' })).toBeNull()
  })
})

describe('RunSheetRow — content', () => {
  it('shows T+N, the title, the first persona and the assignee', () => {
    renderRow(
      makeItem({ title: 'Boil-water advisory', plannedMinute: 15, assigneeName: 'Riley Chen' }),
    )
    expect(screen.getByTestId('planned-minute')).toHaveTextContent('T+15')
    expect(screen.getByTestId('row-title')).toHaveTextContent('Boil-water advisory')
    expect(screen.getByTestId('persona-line')).toHaveTextContent('Fairhaven Water Utility')
    expect(screen.getByTestId('persona-line')).toHaveTextContent('@FairhavenWater')
    expect(screen.getByTestId('row-assignee')).toHaveTextContent('Riley Chen')
    expect(screen.getByTestId('row-assignee')).not.toHaveTextContent('(you)')
  })

  it('marks my own items and shows "Unassigned" when nobody owns it', () => {
    const { unmount } = renderRow(makeItem({ assigneeName: 'Riley Chen' }), { isMine: true })
    expect(screen.getByTestId('row-assignee')).toHaveTextContent('Riley Chen (you)')
    unmount()
    renderRow(makeItem({ assigneeId: null }))
    expect(screen.getByTestId('row-assignee')).toHaveTextContent('Unassigned')
  })

  it('a burst shows the first post\'s persona plus "+N" (the other posts)', () => {
    const posts = [1, 2, 3, 4].map(n => makePost({ id: `p${n}`, sequence: n }))
    renderRow(makeItem({ kind: 'burst', posts, total: 4 }))
    expect(screen.getByTestId('burst-more')).toHaveTextContent('+3')
  })

  it('a single post has no "+N"; an unresolved persona reads "Unknown persona"', () => {
    renderRow(makeItem(), { personaOf: () => undefined })
    expect(screen.queryByTestId('burst-more')).toBeNull()
    expect(screen.getByTestId('persona-line')).toHaveTextContent('Unknown persona')
  })

  it('a fired row shows the fired SCENARIO time in the exercise zone, wall clock as a labelled secondary, and who fired it', () => {
    const iso = '2033-09-04T18:30:00.000Z' // 2:30 PM in America/New_York (EDT)
    renderRow(
      makeItem({
        status: 'fired',
        firedScenarioTime: iso,
        firedByHumanId: 'human-controller-02',
        posts: [
          makePost({
            status: 'fired',
            firedScenarioTime: iso,
            firedWallClock: '2026-10-08T16:05:09.000Z',
          }),
        ],
      }),
    )
    const fired = screen.getByTestId('row-fired')
    expect(within(fired).getByTestId('fired-scenario-time')).toHaveTextContent('2:30 PM')
    expect(within(fired).getByTestId('fired-scenario-time')).toHaveTextContent('Sep 4, 2033')
    expect(fired).toHaveTextContent('wall')
    expect(within(fired).getByTestId('fired-wall-time')).toBeInTheDocument()
    expect(fired).toHaveTextContent('by Jordan Ames')
  })

  it('a pending row has no fired line', () => {
    renderRow(makeItem())
    expect(screen.queryByTestId('row-fired')).toBeNull()
  })

  it('a failed row shows the server reason and a Retry; a failed burst falls back to the failed post\'s error', () => {
    const { unmount } = renderRow(makeItem({ status: 'failed', error: 'Media asset not found' }))
    expect(screen.getByTestId('row-error')).toHaveTextContent('Failed: Media asset not found')
    expect(screen.getByRole('button', { name: /^Retry/ })).toBeEnabled()
    unmount()

    renderRow(
      makeItem({
        status: 'failed',
        posts: [makePost({ status: 'failed', error: 'Fire the parent first' })],
      }),
    )
    expect(screen.getByTestId('row-error')).toHaveTextContent('Fire the parent first')
  })
})

describe('RunSheetRow — actions follow the state machine', () => {
  const offered: { status: InjectStatus; buttons: string[]; absent: string[] }[] = [
    {
      status: 'pending',
      buttons: ['Fire', 'Hold', 'Skip', 'Edit', 'Delete'],
      absent: ['Release', 'Unskip', 'Retry', 'View'],
    },
    {
      status: 'held',
      buttons: ['Release', 'Skip', 'Edit', 'Delete'],
      absent: ['Fire', 'Hold', 'Unskip', 'Retry'],
    },
    { status: 'firing', buttons: ['Hold', 'View'], absent: ['Fire', 'Skip', 'Delete', 'Edit'] },
    { status: 'fired', buttons: ['View'], absent: ['Fire', 'Hold', 'Skip', 'Delete', 'Edit'] },
    { status: 'skipped', buttons: ['Unskip', 'View', 'Delete'], absent: ['Fire', 'Hold', 'Skip'] },
    { status: 'failed', buttons: ['Retry', 'Edit'], absent: ['Fire', 'Delete', 'Skip', 'Hold'] },
  ]

  it.each(offered)('$status offers $buttons', ({ status, buttons, absent }) => {
    renderRow(makeItem({ status, title: 'Item' }))
    const names = buttonNames()
    for (const label of buttons) {
      expect(names.some(n => n.startsWith(`${label} Item`)), `${label} offered`).toBe(true)
    }
    for (const label of absent) {
      expect(names.some(n => n.startsWith(`${label} Item`)), `${label} absent`).toBe(false)
    }
  })

  it('every button has an accessible name that starts with its visible label', () => {
    renderRow(makeItem({ title: 'Boil-water advisory' }))
    const fire = screen.getByRole('button', { name: 'Fire Boil-water advisory' })
    expect(fire).toHaveTextContent('Fire')
    expect(screen.getByRole('button', { name: 'Move Boil-water advisory up' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Boil-water advisory down' })).toBeInTheDocument()
  })

  it('fires the matching callbacks', () => {
    const { p } = renderRow(makeItem({ title: 'Item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Fire Item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Hold Item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip Item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Item' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Item' }))
    expect(p.onFire).toHaveBeenCalledTimes(1)
    expect(p.onHold).toHaveBeenCalledTimes(1)
    expect(p.onSkip).toHaveBeenCalledTimes(1)
    expect(p.onOpen).toHaveBeenCalledTimes(1)
    expect(p.onRequestDelete).toHaveBeenCalledTimes(1)
  })

  it('Fire is disabled while an action on the row is in flight (so a double press fires once)', () => {
    renderRow(makeItem({ title: 'Item' }), { busy: true })
    expect(screen.getByRole('button', { name: 'Fire Item' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Hold Item' })).toBeDisabled()
  })

  it('under FREEZE, Fire and Retry are disabled with the reason "World frozen"', () => {
    const { unmount } = renderRow(makeItem({ title: 'Item' }), {
      fireDisabledReason: 'World frozen',
    })
    const fire = screen.getByRole('button', { name: 'Fire Item' })
    expect(fire).toBeDisabled()
    expect(fire).toHaveAttribute('title', 'World frozen')
    expect(fire).toHaveAttribute('aria-describedby', 'reason')
    unmount()

    renderRow(makeItem({ title: 'Item', status: 'failed' }), { fireDisabledReason: 'World frozen' })
    expect(screen.getByRole('button', { name: 'Retry Item' })).toBeDisabled()
  })

  it('Move up / down are disabled at the ends of the list', () => {
    renderRow(makeItem({ title: 'Item' }), { canMoveUp: false, canMoveDown: false })
    expect(screen.getByRole('button', { name: 'Move Item up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Item down' })).toBeDisabled()
  })

  it('Delete asks inline (not a modal), then confirms or cancels', () => {
    const { p } = renderRow(makeItem({ title: 'Item' }), { confirmingDelete: true })
    const group = screen.getByRole('group', { name: 'Confirm delete Item' })
    expect(group).toHaveTextContent('Delete "Item"?')
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Confirm delete Item' }))
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel delete Item' }))
    expect(p.onConfirmDelete).toHaveBeenCalledTimes(1)
    expect(p.onCancelDelete).toHaveBeenCalledTimes(1)
  })

  it('selection: focusing or clicking the row selects it; aria-current marks the selected one', () => {
    const { p, rerender } = renderRow(makeItem(), { selected: false })
    const row = screen.getByTestId('run-sheet-row')
    expect(row).not.toHaveAttribute('aria-current')
    fireEvent.click(row)
    fireEvent.focus(row)
    expect(p.onSelect).toHaveBeenCalledTimes(2)
    rerender(
      <ThemeProvider theme={cobraTheme}>
        <ul>
          <RunSheetRow {...p} selected tabStop />
        </ul>
      </ThemeProvider>,
    )
    expect(screen.getByTestId('run-sheet-row')).toHaveAttribute('aria-current', 'true')
    expect(screen.getByTestId('run-sheet-row')).toHaveAttribute('tabindex', '0')
  })
})
