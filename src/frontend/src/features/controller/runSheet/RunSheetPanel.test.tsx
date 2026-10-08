/**
 * features/controller/runSheet/RunSheetPanel.test.tsx
 * ---------------------------------------------------------------------------
 * The run sheet panel end to end (inject-queue story 07, ACs "The list", "Mine / All",
 * "Author live", "Fire on cue", "Keyboard", "Live sync", "PAUSE INJECTS is live",
 * "Staff world only"). It runs against the REAL in-memory mock (`injectMock`) so the
 * state machine, the 409s and the burst runner are the genuine mock behaviour:
 *
 *  - rows: title / persona / assignee / T+N / status as text + icon;
 *  - Mine / All and open / fired / all; remembered per exercise in localStorage
 *    (try/catch — a throwing store must not break the panel); defaults to All;
 *  - Fire, Fire next (held items passed over, current filter), no confirmation dialog;
 *  - double press -> ONE request (click and keyboard); auto-repeat never repeats an action;
 *  - 409 concurrent fire -> "Already fired by {name}"; stale-version save -> "Changed by
 *    someone else. Reloaded." and the editor shows the FRESH item;
 *  - FREEZE disables Fire / Retry with the reason "World frozen"; PAUSE INJECTS shows the
 *    suspended banner while manual fire still works;
 *  - Hold / Release / Skip / Unskip / Retry / Delete (inline confirm) / Move / View read-only;
 *  - keyboard: ↑/↓, F, N, H, S, E, A; ignored while typing (input / textarea / select /
 *    contenteditable) and with modifiers; every action is also a named button;
 *  - the polite live region announces status changes (own + another controller's);
 *  - polling shows another controller's change within ~3 s; a burst's "firing n/m" advances;
 *  - no telemetry is emitted by the console for queue actions (the server is the emitter).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { RunSheetPanel } from './RunSheetPanel'
import { MOCK_ME, injectMock } from './injectMock'
import { InjectConflictError, InjectValidationError } from './injectErrors'
import { FILTERS_STORAGE_PREFIX } from './useRunSheetFilters'
import { MESSAGES } from './injectMessages'
import { renderRunSheet } from './runSheetTestHarness'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { InjectItemDto, InjectItemWrite } from './types'

const ME = MOCK_ME
const PEER = 'human-controller-02'
const STORAGE_KEY = `${FILTERS_STORAGE_PREFIX}ex-mock-0001`

const single = (title: string, extra: Partial<InjectItemWrite> = {}): InjectItemWrite => ({
  kind: 'post',
  title,
  posts: [{ personaId: 'persona-fairhavenwater', text: `${title} text` }],
  ...extra,
})

const burst = (
  title: string,
  count = 4,
  extra: Partial<InjectItemWrite> = {},
): InjectItemWrite => ({
  kind: 'burst',
  title,
  burstWindowSeconds: 60,
  posts: Array.from({ length: count }, (_, i) => ({
    personaId: 'persona-newsline7',
    text: `${title} ${i + 1}`,
  })),
  ...extra,
})

/** Alpha (mine), Bravo (peer), Charlie (peer), Delta burst of 4 (mine). */
const defaultSeed = (): InjectItemWrite[] => [
  single('Alpha', { assigneeId: ME, plannedMinute: 0 }),
  single('Bravo', { assigneeId: PEER, plannedMinute: 5 }),
  single('Charlie', { assigneeId: PEER, plannedMinute: 10 }),
  burst('Delta', 4, { assigneeId: ME, plannedMinute: 15 }),
]

const idOf = (title: string): string => {
  const found = injectMock.snapshot().items.find(i => i.title === title)
  if (!found) throw new Error(`no item ${title}`)
  return found.id
}
const itemOf = (title: string): InjectItemDto => {
  const found = injectMock.snapshot().items.find(i => i.title === title)
  if (!found) throw new Error(`no item ${title}`)
  return found
}

const rows = (): HTMLElement[] => screen.queryAllByTestId('run-sheet-row')
const rowTitles = (): string[] =>
  rows().map(row => within(row).getByTestId('row-title').textContent ?? '')
const rowOf = (title: string): HTMLElement => {
  const row = rows().find(r => within(r).getByTestId('row-title').textContent === title)
  if (!row) throw new Error(`no row ${title}`)
  return row
}
const chipOf = (title: string): string =>
  within(within(rowOf(title)).getByTestId('status-chip')).getByTestId('status-text').textContent ?? ''
const press = (name: string): void => {
  fireEvent.click(screen.getByRole('button', { name }))
}

/**
 * Lets any request a key press / click MIGHT have started actually start. A mutation's
 * `mutationFn` runs a tick after the call, so asserting "nothing was sent" synchronously
 * would pass even for a handler that does fire — always `await quiet()` first.
 */
async function quiet(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 30))
  })
}

async function mountPanel() {
  const utils = renderRunSheet(<RunSheetPanel />)
  await screen.findAllByTestId('run-sheet-row')
  return utils
}

beforeEach(() => {
  window.localStorage.clear()
  resetTelemetryBuffer()
  injectMock.reset({ seed: defaultSeed() })
})

afterEach(() => {
  injectMock.dispose()
  vi.restoreAllMocks()
})

describe('RunSheetPanel — the list', () => {
  it('lists the items in order with title, persona, assignee, T+N and a status chip', async () => {
    await mountPanel()
    expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    expect(within(rowOf('Alpha')).getByTestId('planned-minute')).toHaveTextContent('T+0')
    expect(within(rowOf('Delta')).getByTestId('planned-minute')).toHaveTextContent('T+15')
    expect(within(rowOf('Bravo')).getByTestId('row-assignee')).toHaveTextContent('Jordan Ames')
    expect(within(rowOf('Alpha')).getByTestId('row-assignee')).toHaveTextContent('Riley Chen (you)')
    expect(within(rowOf('Delta')).getByTestId('burst-more')).toHaveTextContent('+3')
    expect(screen.getByTestId('run-sheet-count')).toHaveTextContent('4 of 4 shown')
    // Persona names resolve from the staff persona list.
    await within(rowOf('Alpha')).findByText('Fairhaven Water Utility')
  })

  it('shows status as text + icon on every row (never colour alone)', async () => {
    await mountPanel()
    await act(async () => {
      await injectMock.hold(idOf('Bravo'))
    })
    press('Skip Charlie')
    await waitFor(() => expect(chipOf('Charlie')).toBe('Skipped'))
    expect(chipOf('Alpha')).toBe('Pending')
    for (const row of rows()) {
      const chip = within(row).getByTestId('status-chip')
      expect(within(chip).getByTestId('status-text').textContent).not.toBe('')
      expect(within(chip).getByTestId('status-icon')).toBeInTheDocument()
    }
  })

  it('an empty sheet says so and offers Add', async () => {
    injectMock.reset({ seed: [] })
    renderRunSheet(<RunSheetPanel />)
    expect(await screen.findByTestId('run-sheet-empty')).toHaveTextContent('The run sheet is empty')
    expect(screen.getByRole('button', { name: 'Add item' })).toBeEnabled()
  })

  it('a failed first read is a visible, retryable banner — never an empty sheet that reads as "nothing scripted"', async () => {
    vi.spyOn(injectMock, 'list').mockRejectedValue(new Error('Network Error'))
    renderRunSheet(<RunSheetPanel />)
    expect(await screen.findByTestId('banner-load-failed')).toHaveTextContent(MESSAGES.loadFailed)
    expect(screen.queryByTestId('run-sheet-empty')).toBeNull()
    expect(screen.getByRole('button', { name: 'Try loading the run sheet now' })).toBeEnabled()
  })

  it('a later failed poll keeps the last good rows and says contact was lost', async () => {
    const { queryClient } = await mountPanel()
    vi.spyOn(injectMock, 'list').mockRejectedValue(new Error('Network Error'))
    await act(async () => {
      await queryClient.invalidateQueries()
    })
    expect(await screen.findByTestId('banner-connection')).toHaveTextContent('Lost contact')
    expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
  })

  it('keys its server state by the exercise (a cache key only — never sent)', async () => {
    const { queryClient } = await mountPanel()
    const keys = queryClient.getQueryCache().getAll().map(q => q.queryKey)
    expect(keys).toContainEqual(['injects', 'ex-mock-0001', 'queue'])
  })
})

describe('RunSheetPanel — Mine / All and status filters', () => {
  it('defaults to All / all, with the choice shown as pressed state', async () => {
    await mountPanel()
    expect(screen.getByRole('button', { name: 'Assigned to: All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Assigned to: Mine' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Status: All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('Mine shows only my items; All brings the rest back ("Mine" is a filter, not a lock)', async () => {
    await mountPanel()
    press('Assigned to: Mine')
    await waitFor(() => expect(rowTitles()).toEqual(['Alpha', 'Delta']))
    expect(screen.getByTestId('run-sheet-count')).toHaveTextContent('2 of 4 shown')
    // Not a lock: I can still fire a colleague's item once I switch back to All.
    press('Assigned to: All')
    expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    press('Fire Bravo')
    await waitFor(() => expect(chipOf('Bravo')).toBe('Fired'))
    expect(itemOf('Bravo').firedByHumanId).toBe(ME)
  })

  it('open / fired / all filter by status', async () => {
    await mountPanel()
    press('Fire Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    press('Status: Fired')
    expect(rowTitles()).toEqual(['Alpha'])
    press('Status: Open')
    expect(rowTitles()).toEqual(['Bravo', 'Charlie', 'Delta'])
    press('Status: All')
    expect(rowTitles()).toHaveLength(4)
  })

  it('an empty filtered view explains itself and offers a way back', async () => {
    await mountPanel()
    press('Status: Fired')
    expect(await screen.findByTestId('run-sheet-filtered-empty')).toHaveTextContent('Nothing matches')
    press('Show everything: all items, all statuses')
    expect(rowTitles()).toHaveLength(4)
  })

  it('remembers the choice per exercise in localStorage and restores it on the next mount', async () => {
    const first = await mountPanel()
    press('Assigned to: Mine')
    press('Status: Open')
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')).toEqual({
      scope: 'mine',
      status: 'open',
    })
    first.unmount()

    await mountPanel()
    expect(screen.getByRole('button', { name: 'Assigned to: Mine' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Status: Open' })).toHaveAttribute('aria-pressed', 'true')
    expect(rowTitles()).toEqual(['Alpha', 'Delta'])
  })

  it('another exercise\'s stored choice is not applied here', async () => {
    window.localStorage.setItem(
      `${FILTERS_STORAGE_PREFIX}some-other-exercise`,
      JSON.stringify({ scope: 'mine', status: 'fired' }),
    )
    await mountPanel()
    expect(screen.getByRole('button', { name: 'Assigned to: All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a corrupt stored value falls back to All', async () => {
    window.localStorage.setItem(STORAGE_KEY, '{not json')
    await mountPanel()
    expect(screen.getByRole('button', { name: 'Assigned to: All' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a throwing localStorage (private mode / blocked) never breaks the panel', async () => {
    // Only the run sheet's own key is blocked (the session store must keep working).
    const getItem = Storage.prototype.getItem
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith(FILTERS_STORAGE_PREFIX)) throw new Error('denied')
      return getItem.call(this, key)
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string,
    ) {
      if (key.startsWith(FILTERS_STORAGE_PREFIX)) throw new Error('quota')
      setItem.call(this, key, value)
    })
    await mountPanel()
    press('Assigned to: Mine')
    await waitFor(() => expect(rowTitles()).toEqual(['Alpha', 'Delta']))
  })
})

describe('RunSheetPanel — Fire, Fire next', () => {
  it('Fire publishes the item with NO confirmation dialog', async () => {
    await mountPanel()
    press('Fire Alpha')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    expect(itemOf('Alpha').firedByHumanId).toBe(ME)
    // The fired scenario time shows on the row.
    expect(within(rowOf('Alpha')).getByTestId('fired-scenario-time').textContent).not.toBe('')
  })

  it('Fire next fires the first PENDING item; held items are passed over', async () => {
    await act(async () => {
      await injectMock.hold(idOf('Alpha'))
    })
    await mountPanel()
    expect(chipOf('Alpha')).toBe('Held')
    expect(screen.getByTestId('next-target')).toHaveTextContent('Next: Bravo')
    press('Fire next pending item')
    await waitFor(() => expect(chipOf('Bravo')).toBe('Fired'))
    expect(chipOf('Alpha')).toBe('Held')
    expect(chipOf('Charlie')).toBe('Pending')
    expect(screen.getByTestId('next-target')).toHaveTextContent('Next: Charlie')
  })

  it('Fire next respects the CURRENT filter (Mine)', async () => {
    await mountPanel()
    press('Assigned to: Mine')
    press('Fire next pending item')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    // Bravo/Charlie (the peer's) are untouched even though Bravo is earlier than Delta.
    expect(itemOf('Bravo').status).toBe('pending')
    press('Fire next pending item')
    await waitFor(() => expect(chipOf('Delta')).toMatch(/^Firing|^Fired/))
    expect(itemOf('Bravo').status).toBe('pending')
  })

  it('Fire next is disabled with nothing pending in the view', async () => {
    injectMock.reset({ seed: [single('Only')] })
    await mountPanel()
    press('Fire Only')
    await waitFor(() => expect(chipOf('Only')).toBe('Fired'))
    expect(screen.getByRole('button', { name: 'Fire next pending item' })).toBeDisabled()
    expect(screen.queryByTestId('next-target')).toBeNull()
  })

  it('a double press fires ONCE (the second click lands on the in-flight request)', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    const button = screen.getByRole('button', { name: 'Fire Alpha' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('a double press of Fire next fires ONCE', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    const button = screen.getByRole('button', { name: 'Fire next pending item' })
    fireEvent.click(button)
    fireEvent.click(button)
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('the Fire button is disabled while the request is in flight', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const real = injectMock.as(ME).fire
    vi.spyOn(injectMock, 'fire').mockImplementation(async id => {
      await gate
      return real(id)
    })
    await mountPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Fire Alpha' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fire Alpha' })).toBeDisabled())
    release()
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
  })

  it('a concurrent fire by another controller reads "Already fired by {name}" and refreshes the row', async () => {
    await mountPanel()
    // The peer fires Alpha; this console has not polled yet and still shows Pending.
    await act(async () => {
      await injectMock.as(PEER).fire(idOf('Alpha'))
    })
    expect(chipOf('Alpha')).toBe('Pending')
    press('Fire Alpha')
    expect(await screen.findByText('Already fired by Jordan Ames')).toBeInTheDocument()
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
  })

  it('an unknown firer falls back to "another controller"', async () => {
    await mountPanel()
    await act(async () => {
      await injectMock.as('someone-not-assigned').fire(idOf('Alpha'))
    })
    press('Fire Alpha')
    expect(await screen.findByText('Already fired by another controller')).toBeInTheDocument()
  })

  it('a 409 for any other reason shows the server\'s own detail', async () => {
    await mountPanel()
    vi.spyOn(injectMock, 'fire').mockRejectedValue(new InjectConflictError('Fire the parent first'))
    press('Fire Alpha')
    expect(await screen.findByText('Fire the parent first')).toBeInTheDocument()
  })

  it('the message can be dismissed', async () => {
    await mountPanel()
    vi.spyOn(injectMock, 'fire').mockRejectedValue(new InjectConflictError('Nope'))
    press('Fire Alpha')
    await screen.findByText('Nope')
    press('Dismiss message')
    expect(screen.queryByText('Nope')).toBeNull()
  })
})

describe('RunSheetPanel — pause tiers', () => {
  it('FREEZE disables Fire, Fire next and Retry with the reason "World frozen"', async () => {
    injectMock.setPauseTier('freeze')
    await mountPanel()
    const banner = await screen.findByTestId('banner-frozen')
    expect(banner).toHaveTextContent('World frozen')

    const fire = screen.getByRole('button', { name: 'Fire Alpha' })
    expect(fire).toBeDisabled()
    expect(fire).toHaveAccessibleDescription('World frozen')
    expect(screen.getByRole('button', { name: 'Fire next pending item' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Fire next pending item' }))
      .toHaveAccessibleDescription('World frozen')
  })

  it('FREEZE also disables Retry on a failed item', async () => {
    injectMock.failNextPublish('Boom')
    await act(async () => {
      await injectMock.fire(idOf('Alpha'))
    })
    injectMock.setPauseTier('freeze')
    await mountPanel()
    const retry = screen.getByRole('button', { name: 'Retry Alpha' })
    expect(retry).toBeDisabled()
    expect(retry).toHaveAccessibleDescription('World frozen')
  })

  it('pressing F or N under FREEZE sends nothing and says why', async () => {
    injectMock.setPauseTier('freeze')
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    const row = rowOf('Alpha')
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'f' })
    fireEvent.keyDown(row, { key: 'n' })
    await quiet()
    expect(fire).not.toHaveBeenCalled()
    expect(await screen.findByTestId('run-sheet-notice')).toHaveTextContent('World frozen')
  })

  it('shows no frozen banner and enables Fire when the world is running', async () => {
    await mountPanel()
    expect(screen.queryByTestId('banner-frozen')).toBeNull()
    expect(screen.getByRole('button', { name: 'Fire Alpha' })).toBeEnabled()
  })

  it('PAUSE INJECTS shows the suspended banner, and manual fire still works', async () => {
    injectMock.setPauseTier('injects')
    await mountPanel()
    expect(await screen.findByTestId('banner-injects-paused')).toHaveTextContent(
      'Injects paused: bursts are suspended; manual fire still works',
    )
    expect(screen.queryByTestId('banner-frozen')).toBeNull()
    press('Fire Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
  })
})

describe('RunSheetPanel — hold, skip, retry, delete, move, view', () => {
  it('Hold then Release moves pending -> held -> pending', async () => {
    await mountPanel()
    press('Hold Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Held'))
    expect(screen.queryByRole('button', { name: 'Fire Alpha' })).toBeNull() // release first
    press('Release Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Pending'))
  })

  it('Skip then Unskip', async () => {
    await mountPanel()
    press('Skip Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Skipped'))
    press('Unskip Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Pending'))
  })

  it('a failed fire shows the server reason on the row; Retry re-fires it', async () => {
    await mountPanel()
    injectMock.failNextPublish('Media asset not found')
    press('Fire Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Failed'))
    expect(within(rowOf('Alpha')).getByTestId('row-error')).toHaveTextContent('Media asset not found')
    press('Retry Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
  })

  it('Delete asks inline, Cancel keeps the row, Confirm removes it (no modal, no window.confirm)', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    await mountPanel()
    press('Delete Charlie')
    const group = screen.getByRole('group', { name: 'Confirm delete Charlie' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(within(group).getByRole('button', { name: 'Cancel delete Charlie' }))
    expect(rowTitles()).toContain('Charlie')

    press('Delete Charlie')
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Charlie' }))
    await waitFor(() => expect(rowTitles()).not.toContain('Charlie'))
    expect(confirm).not.toHaveBeenCalled()
  })

  it('Delete is not offered for a fired item', async () => {
    await mountPanel()
    press('Fire Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    expect(screen.queryByRole('button', { name: 'Delete Alpha' })).toBeNull()
  })

  it('Move down / up reorders through the server', async () => {
    await mountPanel()
    press('Move Alpha down')
    await waitFor(() => expect(rowTitles()).toEqual(['Bravo', 'Alpha', 'Charlie', 'Delta']))
    press('Move Alpha up')
    await waitFor(() => expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']))
    expect(screen.getByRole('button', { name: 'Move Alpha up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move Delta down' })).toBeDisabled()
  })

  it('a fired item opens READ-ONLY: no Save, every field disabled', async () => {
    await mountPanel()
    press('Fire Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    press('View Alpha')
    const editor = await screen.findByTestId('inject-editor')
    expect(editor).toHaveAttribute('data-mode', 'view')
    expect(within(editor).getByTestId('editor-readonly-note')).toHaveTextContent('fired')
    expect(within(editor).queryByTestId('editor-save')).toBeNull()
    expect(within(editor).getByLabelText(/^Title/)).toBeDisabled()
    expect(within(editor).getByLabelText(/^Text/)).toBeDisabled()
  })

  it('a burst in flight opens read-only too', async () => {
    await mountPanel()
    press('Fire Delta')
    await waitFor(() => expect(chipOf('Delta')).toMatch(/^Firing/))
    press('View Delta')
    expect((await screen.findByTestId('inject-editor'))).toHaveAttribute('data-mode', 'view')
  })
})

describe('RunSheetPanel — authoring (inline editor, never a modal)', () => {
  it('Add opens an inline editor in the panel; saving adds the row and closes it', async () => {
    await mountPanel()
    press('Add item')
    const editor = await screen.findByTestId('inject-editor')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('run-sheet-panel')).toContainElement(editor)
    expect(editor).toHaveAttribute('data-mode', 'create')

    fireEvent.change(within(editor).getByLabelText(/^Title/), { target: { value: 'Echo' } })
    await within(editor).findByRole('option', { name: /Fairhaven Water Utility/ })
    fireEvent.change(within(editor).getByLabelText(/^Persona/), {
      target: { value: 'persona-fairhavenwater' },
    })
    fireEvent.change(within(editor).getByLabelText(/^Text/), { target: { value: 'Echo text' } })
    fireEvent.click(within(editor).getByTestId('editor-save'))

    await waitFor(() => expect(screen.queryByTestId('inject-editor')).toBeNull())
    expect(rowTitles()).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])
    expect(itemOf('Echo').assigneeId).toBe(ME) // a new item defaults to me
  })

  it('Edit saves at the version it was opened at and updates the row', async () => {
    await mountPanel()
    press('Edit Alpha')
    const editor = await screen.findByTestId('inject-editor')
    expect(editor).toHaveAttribute('data-mode', 'edit')
    fireEvent.change(within(editor).getByLabelText(/^Title/), { target: { value: 'Alpha v2' } })
    fireEvent.click(within(editor).getByTestId('editor-save'))
    await waitFor(() => expect(screen.queryByTestId('inject-editor')).toBeNull())
    expect(rowTitles()).toContain('Alpha v2')
  })

  it('a stale-version save says "Changed by someone else. Reloaded." and shows the FRESH item', async () => {
    await mountPanel()
    press('Edit Alpha')
    const editor = await screen.findByTestId('inject-editor')
    // Meanwhile another controller edits the same item.
    await act(async () => {
      const current = itemOf('Alpha')
      await injectMock.as(PEER).update(
        current.id,
        { ...single('Alpha (peer edit)'), assigneeId: ME },
        current.version,
      )
    })
    fireEvent.change(within(editor).getByLabelText(/^Title/), { target: { value: 'Mine' } })
    fireEvent.click(within(editor).getByTestId('editor-save'))

    expect(await screen.findByText('Changed by someone else. Reloaded.')).toBeInTheDocument()
    // The form is re-seeded with the fresh item (the peer's title, not mine).
    await waitFor(() =>
      expect(within(screen.getByTestId('inject-editor')).getByLabelText(/^Title/))
        .toHaveValue('Alpha (peer edit)'),
    )
    expect(injectMock.snapshot().items[0]?.title).toBe('Alpha (peer edit)')
  })

  it('saving an item another controller fired meanwhile reloads it READ-ONLY', async () => {
    await mountPanel()
    press('Edit Alpha')
    await screen.findByTestId('inject-editor')
    await act(async () => {
      await injectMock.as(PEER).fire(idOf('Alpha'))
    })
    fireEvent.click(screen.getByTestId('editor-save'))
    expect(await screen.findByText('Changed by someone else. Reloaded.')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByTestId('inject-editor')).toHaveAttribute('data-mode', 'view'),
    )
  })

  /** Fills a valid single post in the open editor and presses Save. */
  async function fillAndSave(): Promise<HTMLElement> {
    const editor = await screen.findByTestId('inject-editor')
    fireEvent.change(within(editor).getByLabelText(/^Title/), { target: { value: 'Echo' } })
    await within(editor).findByRole('option', { name: /Fairhaven Water Utility/ })
    fireEvent.change(within(editor).getByLabelText(/^Persona/), {
      target: { value: 'persona-fairhavenwater' },
    })
    fireEvent.change(within(editor).getByLabelText(/^Text/), { target: { value: 'Echo text' } })
    fireEvent.click(within(editor).getByTestId('editor-save'))
    return editor
  }

  it('server validation messages (a 400) land on the field AND the form; the editor stays open', async () => {
    await mountPanel()
    vi.spyOn(injectMock, 'create').mockRejectedValue(
      new InjectValidationError('One or more validation errors occurred.', {
        'posts.0.personaId': 'Persona is not in this exercise',
      }),
    )
    press('Add item')
    const editor = await fillAndSave()
    expect(await within(editor).findByTestId('inject-editor-post-0-persona-error'))
      .toHaveTextContent('Persona is not in this exercise')
    expect(within(editor).getByTestId('editor-form-error'))
      .toHaveTextContent('One or more validation errors occurred.')
    expect(screen.getByTestId('inject-editor')).toBeInTheDocument()
    expect(injectMock.snapshot().items).toHaveLength(4) // nothing was added
  })

  it('a generic failure shows a form-level save message and keeps what was typed', async () => {
    await mountPanel()
    vi.spyOn(injectMock, 'create').mockRejectedValue(new Error('Network Error'))
    press('Add item')
    const editor = await fillAndSave()
    expect(await within(editor).findByTestId('editor-form-error'))
      .toHaveTextContent("Couldn't save: Network Error")
    expect(within(editor).getByLabelText(/^Title/)).toHaveValue('Echo')
  })

  it('Cancel closes the editor without saving', async () => {
    await mountPanel()
    press('Add item')
    await screen.findByTestId('inject-editor')
    press('Cancel editing')
    expect(screen.queryByTestId('inject-editor')).toBeNull()
    expect(rowTitles()).toHaveLength(4)
  })

  it('an item deleted by another controller while it is open closes the editor with a notice', async () => {
    const { queryClient } = await mountPanel()
    press('Edit Charlie')
    await screen.findByTestId('inject-editor')
    await act(async () => {
      const current = itemOf('Charlie')
      await injectMock.as(PEER).remove(current.id, current.version)
      await queryClient.invalidateQueries()
    })
    await waitFor(() => expect(screen.queryByTestId('inject-editor')).toBeNull())
    expect(screen.getByTestId('run-sheet-notice')).toHaveTextContent(MESSAGES.notFound)
  })
})

describe('RunSheetPanel — keyboard', () => {
  const selectedTitle = (): string | undefined => {
    const row = rows().find(r => r.getAttribute('aria-current') === 'true')
    return row ? within(row).getByTestId('row-title').textContent ?? undefined : undefined
  }
  const panel = (): HTMLElement => screen.getByTestId('run-sheet-panel')

  it('↑/↓ select, clamped at both ends', async () => {
    await mountPanel()
    expect(selectedTitle()).toBeUndefined()
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    expect(selectedTitle()).toBe('Alpha')
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    expect(selectedTitle()).toBe('Bravo')
    fireEvent.keyDown(panel(), { key: 'ArrowUp' })
    fireEvent.keyDown(panel(), { key: 'ArrowUp' })
    expect(selectedTitle()).toBe('Alpha')
    for (let i = 0; i < 6; i++) fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    expect(selectedTitle()).toBe('Delta')
  })

  it('↑ with nothing selected starts at the last item; focus follows selection', async () => {
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'ArrowUp' })
    expect(selectedTitle()).toBe('Delta')
    expect(document.activeElement).toBe(rowOf('Delta'))
  })

  it('F fires the selected item', async () => {
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    fireEvent.keyDown(panel(), { key: 'f' })
    await waitFor(() => expect(chipOf('Bravo')).toBe('Fired'))
    expect(chipOf('Alpha')).toBe('Pending')
  })

  it('N fires the next pending item (held skipped) without any selection', async () => {
    await act(async () => {
      await injectMock.hold(idOf('Alpha'))
    })
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'N' })
    await waitFor(() => expect(chipOf('Bravo')).toBe('Fired'))
    expect(chipOf('Alpha')).toBe('Held')
  })

  it('H toggles hold / release; S toggles skip / unskip', async () => {
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    fireEvent.keyDown(panel(), { key: 'h' })
    await waitFor(() => expect(chipOf('Alpha')).toBe('Held'))
    fireEvent.keyDown(panel(), { key: 'h' })
    await waitFor(() => expect(chipOf('Alpha')).toBe('Pending'))
    fireEvent.keyDown(panel(), { key: 's' })
    await waitFor(() => expect(chipOf('Alpha')).toBe('Skipped'))
    fireEvent.keyDown(panel(), { key: 's' })
    await waitFor(() => expect(chipOf('Alpha')).toBe('Pending'))
  })

  it('E edits the selected item (read-only once fired); A adds', async () => {
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    fireEvent.keyDown(panel(), { key: 'e' })
    expect(await screen.findByTestId('inject-editor')).toHaveAttribute('data-mode', 'edit')
    fireEvent.keyDown(screen.getByTestId('inject-editor'), { key: 'Escape' })
    expect(screen.queryByTestId('inject-editor')).toBeNull()

    fireEvent.keyDown(panel(), { key: 'a' })
    expect(await screen.findByTestId('inject-editor')).toHaveAttribute('data-mode', 'create')
  })

  it('E on a fired item opens it read-only', async () => {
    await mountPanel()
    press('Fire Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    fireEvent.click(rowOf('Alpha'))
    fireEvent.keyDown(panel(), { key: 'e' })
    expect(await screen.findByTestId('inject-editor')).toHaveAttribute('data-mode', 'view')
  })

  it('a double press of F fires once', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'ArrowDown' })
    fireEvent.keyDown(panel(), { key: 'f' })
    fireEvent.keyDown(panel(), { key: 'f' })
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    expect(fire).toHaveBeenCalledTimes(1)
  })

  it('auto-repeat never repeats an action (holding N cannot march through the script)', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'n', repeat: true })
    fireEvent.keyDown(panel(), { key: 'f', repeat: true })
    await quiet()
    expect(fire).not.toHaveBeenCalled()
  })

  it('modified keys (Ctrl/Cmd/Alt + letter) are left to the browser', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    fireEvent.keyDown(panel(), { key: 'n', ctrlKey: true })
    fireEvent.keyDown(panel(), { key: 'n', metaKey: true })
    fireEvent.keyDown(panel(), { key: 'n', altKey: true })
    await quiet()
    expect(fire).not.toHaveBeenCalled()
  })

  it.each([
    ['input', () => document.createElement('input')],
    ['textarea', () => document.createElement('textarea')],
    ['select', () => document.createElement('select')],
    [
      'contenteditable',
      () => {
        const div = document.createElement('div')
        div.setAttribute('contenteditable', 'true')
        return div
      },
    ],
  ])('shortcuts are IGNORED while focus is in a %s', async (_name, make) => {
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    const field = make()
    panel().appendChild(field)
    for (const key of ['n', 'f', 'h', 's', 'e', 'a', 'ArrowDown']) {
      fireEvent.keyDown(field, { key })
    }
    await quiet()
    expect(fire).not.toHaveBeenCalled()
    expect(screen.queryByTestId('inject-editor')).toBeNull()
    expect(selectedTitle()).toBeUndefined()
    field.remove()
  })

  it('typing in the editor never triggers an action (the editor owns the keyboard)', async () => {
    const fire = vi.spyOn(injectMock, 'fire')
    await mountPanel()
    press('Add item')
    const title = await screen.findByLabelText(/^Title/)
    for (const key of ['n', 'f', 'h', 's', 'e', 'a']) fireEvent.keyDown(title, { key })
    await quiet()
    expect(fire).not.toHaveBeenCalled()
    expect(screen.getAllByTestId('inject-editor')).toHaveLength(1)
  })

  it('focusing a control inside a row selects that row, so shortcuts act on the row you are in', async () => {
    await mountPanel()
    fireEvent.focus(screen.getByRole('button', { name: 'Hold Charlie' }))
    expect(selectedTitle()).toBe('Charlie')
    fireEvent.keyDown(panel(), { key: 'h' })
    await waitFor(() => expect(chipOf('Charlie')).toBe('Held'))
  })

  it('has a visible "Keyboard" help that lists every shortcut', async () => {
    await mountPanel()
    expect(screen.queryByTestId('keyboard-help')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Keyboard shortcuts' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    const help = screen.getByTestId('keyboard-help')
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    for (const text of ['↑ / ↓', 'F', 'N', 'H', 'S', 'E', 'A']) {
      expect(within(help).getAllByText(text).length).toBeGreaterThan(0)
    }
    expect(help).toHaveTextContent('ignored while you are typing')
    fireEvent.click(toggle)
    expect(screen.queryByTestId('keyboard-help')).toBeNull()
  })

  it('every action is also a named button', async () => {
    await mountPanel()
    const names = screen.getAllByRole('button').map(b => b.getAttribute('aria-label') ?? '')
    for (const expected of [
      'Fire next pending item',
      'Add item',
      'Keyboard shortcuts',
      'Fire Alpha',
      'Hold Alpha',
      'Skip Alpha',
      'Edit Alpha',
      'Delete Alpha',
    ]) {
      expect(names).toContain(expected)
    }
  })
})

describe('RunSheetPanel — live region + staff-world rules', () => {
  const announcer = (): HTMLElement => screen.getByTestId('run-sheet-announcer')

  it('has a polite, atomic live region', async () => {
    await mountPanel()
    expect(announcer()).toHaveAttribute('role', 'status')
    expect(announcer()).toHaveAttribute('aria-live', 'polite')
    expect(announcer()).toHaveAttribute('aria-atomic', 'true')
  })

  it('announces nothing for the initial load', async () => {
    await mountPanel()
    expect(announcer()).toHaveTextContent('')
  })

  it('announces a status change from this console\'s own action', async () => {
    await mountPanel()
    press('Fire Alpha')
    await waitFor(() => expect(announcer()).toHaveTextContent('Alpha: Fired'))
  })

  it('announces another controller\'s change when it is picked up', async () => {
    const { queryClient } = await mountPanel()
    await act(async () => {
      await injectMock.as(PEER).hold(idOf('Charlie'))
      await injectMock.as(PEER).skip(idOf('Bravo'))
      await queryClient.invalidateQueries()
    })
    await waitFor(() => expect(announcer()).toHaveTextContent('Bravo: Skipped'))
    expect(announcer()).toHaveTextContent('Charlie: Held')
  })

  it('announces an item another controller adds or removes', async () => {
    const { queryClient } = await mountPanel()
    await act(async () => {
      await injectMock.as(PEER).create(single('Echo'))
      await queryClient.invalidateQueries()
    })
    await waitFor(() => expect(announcer()).toHaveTextContent('Added: Echo'))
  })

  it('emits NO telemetry for queue actions (the server is the single inject_action emitter)', async () => {
    await mountPanel()
    press('Fire Alpha')
    await waitFor(() => expect(chipOf('Alpha')).toBe('Fired'))
    press('Hold Bravo')
    await waitFor(() => expect(chipOf('Bravo')).toBe('Held'))
    press('Skip Charlie')
    await waitFor(() => expect(chipOf('Charlie')).toBe('Skipped'))
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('renders as a labelled region with no participant chrome', async () => {
    await mountPanel()
    expect(screen.getByRole('region', { name: 'Run sheet' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Run sheet items' })).toBeInTheDocument()
  })
})

describe('RunSheetPanel — live sync (fake timers)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2033-09-04T14:00:00.000Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const flush = async (ms = 0): Promise<void> => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms)
    })
  }
  const settle = async (): Promise<void> => {
    await flush(10)
    await flush(10)
    await flush(10)
  }
  const mountFake = async (): Promise<void> => {
    await act(async () => {
      renderRunSheet(<RunSheetPanel />)
    })
    await settle()
  }

  it('another controller\'s fire shows in this console within ~3 s, and is announced', async () => {
    await mountFake()
    expect(chipOf('Alpha')).toBe('Pending')

    await act(async () => {
      await injectMock.as(PEER).fire(idOf('Alpha'))
    })
    await flush(1000)
    expect(chipOf('Alpha')).toBe('Pending') // not polled yet

    await flush(2600)
    expect(chipOf('Alpha')).toBe('Fired')
    expect(within(rowOf('Alpha')).getByTestId('row-fired')).toHaveTextContent('by Jordan Ames')
    expect(screen.getByTestId('run-sheet-announcer')).toHaveTextContent('Alpha: Fired')
  })

  it('another controller\'s hold, skip and edit show up on the next poll', async () => {
    await mountFake()
    await act(async () => {
      const peer = injectMock.as(PEER)
      await peer.hold(idOf('Bravo'))
      await peer.skip(idOf('Charlie'))
      const alpha = itemOf('Alpha')
      await peer.update(alpha.id, { ...single('Alpha renamed'), assigneeId: ME }, alpha.version)
    })
    await flush(3100)
    expect(chipOf('Bravo')).toBe('Held')
    expect(chipOf('Charlie')).toBe('Skipped')
    expect(rowTitles()).toContain('Alpha renamed')
  })

  it('a burst\'s "firing n/m" advances live and ends Fired', async () => {
    await mountFake()
    fireEvent.click(screen.getByRole('button', { name: 'Fire Delta' }))
    await flush(10)
    const seen: string[] = [chipOf('Delta')]
    for (let second = 0; second < 150; second++) {
      await flush(1000)
      const text = chipOf('Delta')
      if (seen[seen.length - 1] !== text) seen.push(text)
    }
    expect(seen[0]).toBe('Firing 1/4')
    expect(seen.some(text => /^Firing [23]\/4$/.test(text))).toBe(true)
    expect(seen[seen.length - 1]).toBe('Fired')
  })
})
