/**
 * features/controller/runSheet/RunSheetPanel.test.tsx
 * ---------------------------------------------------------------------------
 * The run-sheet PANEL end to end in MOCK mode (the default under Vitest), through the
 * real exercise context, personas, media library and `postStore` - demo-polish C3 (#438).
 * Covers the story's acceptance criteria that are visible in the UI:
 *   - Author beats: add / edit / duplicate / delete / reorder, the 280-char counter, media
 *     from the library through C1's `MediaLibraryPicker` (mocked here at its FROZEN props),
 *     required alt text, "T+14m", reply-to;
 *   - Persisted per exercise: reload, storage failure warning, an unreadable saved sheet;
 *   - JSON import / export: export carries no status, import fails closed with a readable
 *     message and never partially applies, replace needs confirmation, missing-media warning,
 *     export -> import round trip;
 *   - Fire / Fire next / Skip: statuses are TEXT + icon, firing records `firedPostId` and the
 *     SCENARIO time, a double-press fires once, reply gating ("Fire the parent first"), an
 *     unknown persona blocks, failed vs unconfirmed (Retry vs a confirmed "Fire again");
 *   - Keyboard: arrows / F / N / S / E, ignored while typing, a visible legend.
 *
 * LIVE-mode behaviour (the wire body, a request in flight, failures from a real response) is
 * in `RunSheetPanel.live.test.tsx`; the exercise switch is in
 * `RunSheetPanel.exerciseSwitch.test.tsx`.
 */
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import type { MediaKind } from '@/core/media'

// C1's picker, replaced by a fake that honours the FROZEN props (implementation.md §1.11):
// { kind?, max, selectedIds, onChange(ids) }. It records every render's props so the tests can
// assert exactly what the editor hands the picker. (The prop shape is restated here on purpose:
// these tests depend on the frozen contract, not on how C1 declares its types.)
interface PickerProps {
  kind?: MediaKind
  max: number
  selectedIds: string[]
  onChange(ids: string[]): void
}
const picker = vi.hoisted(() => ({ renders: [] as unknown[] }))
vi.mock('@/features/controller/media/MediaLibraryPicker', async () => {
  const React = await import('react')
  const ids = [
    'mock-media-canned-flood',
    'mock-media-canned-plant',
    'mock-media-canned-sign',
    'mock-media-canned-video',
  ]
  return {
    MediaLibraryPicker: (props: PickerProps) => {
      picker.renders.push(props)
      return React.createElement(
        'div',
        { 'data-testid': 'mock-picker' },
        ids.map(id =>
          React.createElement(
            'button',
            {
              key: id,
              type: 'button',
              onClick: () =>
                props.onChange(
                  props.selectedIds.includes(id)
                    ? props.selectedIds.filter(other => other !== id)
                    : [...props.selectedIds, id],
                ),
            },
            `Pick ${id}`,
          ),
        ),
      )
    },
  }
})

vi.mock('./runSheetFileIO', async importOriginal => ({
  ...(await importOriginal<typeof import('./runSheetFileIO')>()),
  downloadTextFile: vi.fn(),
}))

import { downloadTextFile } from './runSheetFileIO'
import { RunSheetPanel } from './RunSheetPanel'
import {
  readStoredSheet,
  runSheetBackupKey,
  runSheetStorageKey,
  writeStoredSheet,
} from './runSheetStorage'
import { resetRunSheetStoreForTests } from './runSheetStore'
import { runtimeOf, type RunSheetData } from './runSheetModel'
import { parseRunSheetFile, serializeRunSheetFile } from './runSheetSchema'
import {
  MOCK_ACTING_HUMAN_ID,
  MOCK_EXERCISE_ID,
  beatFixture,
  contrastRatio,
  renderStaff,
  resetRunSheetWorld,
  seedStoredSheet,
  sheetFixture,
  useFixedClock,
} from './runSheetTestKit'

const TWO_BEATS = (): RunSheetData => sheetFixture([
  beatFixture({ id: 'b1', order: 1, title: 'Boil notice', scenarioMinute: 14 }),
  beatFixture({
    id: 'b2',
    order: 2,
    title: 'Citizen pile-on',
    scenarioMinute: 20,
    persona: { handle: 'tbrandt41' },
    text: 'Mine has been brown since noon.',
  }),
])

async function mountPanel(seed?: RunSheetData) {
  if (seed !== undefined) seedStoredSheet(MOCK_EXERCISE_ID, seed)
  const user = userEvent.setup({ delay: null })
  renderStaff(<RunSheetPanel />)
  const panel = await screen.findByTestId('run-sheet-panel')
  // The persona read is async; a fire before it lands is (correctly) refused as "still loading".
  await waitFor(() => expect(panel).toHaveAttribute('data-personas', 'ready'))
  return { user, panel }
}

const row = (id: string) => screen.getByTestId(`beat-row-${id}`)
const statusOf = (id: string) => within(row(id)).getByTestId('beat-status')
const liveStatus = () => screen.getByTestId('run-sheet-status')

async function selectRow(user: ReturnType<typeof userEvent.setup>, id: string) {
  await user.click(row(id))
  expect(row(id)).toHaveAttribute('aria-current', 'true')
  return row(id)
}

function storedData(): RunSheetData {
  const read = readStoredSheet(MOCK_EXERCISE_ID)
  if (read.kind !== 'ok') throw new Error(`expected a stored sheet, got ${read.kind}`)
  return read.data
}

// Full-panel renders (MUI + emotion + the exercise context) are slow on a loaded CI box:
// give each test a generous budget instead of the 10s default.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  resetRunSheetWorld()
  useFixedClock()
  resetTelemetryBuffer()
  postStore.resetForTests()
  picker.renders.length = 0
  vi.mocked(downloadTextFile).mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetRunSheetWorld()
  postStore.resetForTests()
})

describe('RunSheetPanel - authoring (AC "Author beats")', () => {
  it('starts empty, then adds a beat through the editor and shows it Pending at T+14m', async () => {
    const { user } = await mountPanel()
    expect(screen.getByTestId('run-sheet-empty')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog', { name: 'New beat' })
    await user.type(within(dialog).getByLabelText(/^Title/), 'Brown tap photo')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'tbrandt41')
    const minute = within(dialog).getByLabelText(/^Intended minute/)
    await user.clear(minute)
    await user.type(minute, '14')
    await user.type(within(dialog).getByLabelText('Text'), 'Look at this water!')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(within(row('beat-1')).getByTestId('beat-minute')).toHaveTextContent('T+14m')
    expect(statusOf('beat-1')).toHaveTextContent('Pending')
    expect(liveStatus()).toHaveTextContent('Added "Brown tap photo".')
    // Persisted under the per-exercise key, as the definition the file format describes.
    expect(window.localStorage.getItem(runSheetStorageKey(MOCK_EXERCISE_ID))).not.toBeNull()
    expect(storedData().beats[0]).toEqual({
      id: 'beat-1',
      order: 1,
      title: 'Brown tap photo',
      scenarioMinute: 14,
      persona: { handle: 'tbrandt41' },
      text: 'Look at this water!',
    })
  })

  it('shows a 280-character counter, flags the overflow in words, and blocks saving', async () => {
    const { user } = await mountPanel()
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Title/), 'Too long')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'FulcoEM')
    const text = within(dialog).getByLabelText('Text')
    expect(within(dialog).getByTestId('beat-text-counter')).toHaveTextContent('0 / 280')

    fireEvent.change(text, { target: { value: 'a'.repeat(285) } })
    expect(within(dialog).getByTestId('beat-text-counter')).toHaveTextContent(
      '285 / 280 - 5 over the limit',
    )

    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Fix 1 problem before saving.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(readStoredSheet(MOCK_EXERCISE_ID).kind).toBe('empty')

    fireEvent.change(text, { target: { value: 'a'.repeat(280) } })
    expect(within(dialog).getByTestId('beat-text-counter')).toHaveTextContent('280 / 280')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(storedData().beats[0]?.text).toHaveLength(280)
  })

  it('tells the controller what is wrong, field by field, in words', async () => {
    const { user } = await mountPanel()
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    expect(await within(dialog).findByText('Title must not be empty')).toBeInTheDocument()
    expect(within(dialog).getByText('Choose the persona that posts this.')).toBeInTheDocument()
    expect(within(dialog).getByText(/nothing to post/)).toBeInTheDocument()
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Fix 3 problems before saving.')
  })

  it('attaches library media through the picker at its frozen props, and requires alt text', async () => {
    const { user } = await mountPanel()
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog')

    // Frozen props: kind, max, selectedIds, onChange.
    const first = picker.renders.at(-1) as PickerProps
    expect(first).toMatchObject({ kind: 'image', max: 4, selectedIds: [] })
    expect(typeof first.onChange).toBe('function')

    await user.type(within(dialog).getByLabelText(/^Title/), 'Photo beat')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'tbrandt41')
    await user.click(within(dialog).getByRole('button', { name: 'Pick mock-media-canned-flood' }))
    await user.click(within(dialog).getByRole('button', { name: 'Pick mock-media-canned-plant' }))
    expect(picker.renders.at(-1)).toMatchObject({
      kind: 'image',
      max: 4,
      selectedIds: ['mock-media-canned-flood', 'mock-media-canned-plant'],
    })

    // Each item shows its library file name and an alt field; saving without alt is refused.
    expect(await within(dialog).findByText('flood-main-street.svg (image)')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    expect(
      (await within(dialog).findAllByText(/Describe this media for people who cannot see it/)),
    ).toHaveLength(2)
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    fireEvent.change(
      within(dialog).getByLabelText(/Description \(alt text\) for flood-main-street\.svg/),
      { target: { value: 'Brown water running from a kitchen tap' } },
    )
    fireEvent.change(
      within(dialog).getByLabelText(/Description \(alt text\) for water-plant\.svg/),
      { target: { value: 'The Fairhaven water treatment plant' } },
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(storedData().beats[0]?.media).toEqual([
      { mediaId: 'mock-media-canned-flood', alt: 'Brown water running from a kitchen tap' },
      { mediaId: 'mock-media-canned-plant', alt: 'The Fairhaven water treatment plant' },
    ])
    expect(within(row('beat-1')).getByText('2 images')).toBeInTheDocument()
  })

  it('offers one video as an alternative, and locks the type once media is attached', async () => {
    const { user } = await mountPanel()
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'One video' }))
    expect(picker.renders.at(-1)).toMatchObject({ kind: 'video', max: 1, selectedIds: [] })

    await user.click(within(dialog).getByRole('button', { name: 'Pick mock-media-canned-video' }))
    expect(within(dialog).getByRole('radio', { name: 'Images (up to 4)' })).toBeDisabled()
    expect(await within(dialog).findByText(/water-update\.mp4 \(video\)/)).toBeInTheDocument()

    // A video cannot be swapped for a second one: the picker is told max 1.
    expect(picker.renders.at(-1)).toMatchObject({ kind: 'video', max: 1 })
  })

  it('edits a beat with E, prefilled, and keeps its place and status', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    const r = await selectRow(user, 'b2')
    await user.keyboard('e')
    const dialog = await screen.findByRole('dialog', { name: 'Edit beat' })
    expect(within(dialog).getByLabelText(/^Title/)).toHaveValue('Citizen pile-on')
    expect(within(dialog).getByLabelText(/^Persona/)).toHaveValue('tbrandt41')
    expect(within(dialog).getByLabelText(/^Intended minute/)).toHaveValue('20')

    const title = within(dialog).getByLabelText(/^Title/)
    await user.clear(title)
    await user.type(title, 'Citizens pile on')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    expect(within(r).getByText('Citizens pile on')).toBeInTheDocument()
    expect(storedData().beats.map(b => [b.id, b.order, b.title])).toEqual([
      ['b1', 1, 'Boil notice'],
      ['b2', 2, 'Citizens pile on'],
    ])
  })

  it('duplicates a beat as a fresh pending copy right after it', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    await selectRow(user, 'b1')
    await user.click(within(row('b1')).getByRole('button', { name: 'Duplicate' }))
    const titles = within(screen.getByRole('list', { name: 'Beats' }))
      .getAllByRole('group', { name: /^Beat \d+:/ })
      .map(group => group.getAttribute('aria-label'))
    expect(titles).toEqual([
      'Beat 1: Boil notice, Pending',
      'Beat 2: Boil notice (copy), Pending',
      'Beat 3: Citizen pile-on, Pending',
    ])
  })

  it('deletes only after a confirm whose default focus is Cancel', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    await selectRow(user, 'b1')
    await user.click(within(row('b1')).getByRole('button', { name: 'Delete' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete this beat?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(storedData().beats).toHaveLength(2)

    await user.click(within(row('b1')).getByRole('button', { name: 'Delete' }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete beat' }),
    )
    await waitFor(() => expect(screen.queryByTestId('beat-row-b1')).toBeNull())
    expect(storedData().beats.map(b => [b.id, b.order])).toEqual([['b2', 1]])
    expect(liveStatus()).toHaveTextContent('Deleted "Boil notice"')
  })

  it('will not delete a beat that un-fired replies depend on, and says why', async () => {
    const { user } = await mountPanel(sheetFixture([
      beatFixture({ id: 'p', order: 1, title: 'Parent' }),
      beatFixture({ id: 'c', order: 2, title: 'Child', replyTo: { beatId: 'p' } }),
    ]))
    await selectRow(user, 'p')
    await user.click(within(row('p')).getByRole('button', { name: 'Delete' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(liveStatus()).toHaveTextContent('A beat replies to this one ("Child")')
    expect(storedData().beats).toHaveLength(2)
  })

  it('reorders with Move up / Move down and with Sort by T+, as a sort hint only', async () => {
    const { user } = await mountPanel(sheetFixture([
      beatFixture({ id: 'a', order: 1, title: 'A', scenarioMinute: 30 }),
      beatFixture({ id: 'b', order: 2, title: 'B', scenarioMinute: 10 }),
      beatFixture({ id: 'c', order: 3, title: 'C', scenarioMinute: 20 }),
    ]))
    await selectRow(user, 'a')
    expect(within(row('a')).getByRole('button', { name: 'Move up' })).toBeDisabled()
    await user.click(within(row('a')).getByRole('button', { name: 'Move down' }))
    expect(storedData().beats.map(b => b.id)).toEqual(['b', 'a', 'c'])

    await user.click(screen.getByRole('button', { name: 'Sort by T+' }))
    expect(storedData().beats.map(b => [b.id, b.order])).toEqual([['b', 1], ['c', 2], ['a', 3]])
    expect(storedData().runtime).toEqual({})
  })

  it('offers only beats that cannot form a loop as the parent of a reply', async () => {
    const { user } = await mountPanel(sheetFixture([
      beatFixture({ id: 'p', order: 1, title: 'Parent' }),
      beatFixture({ id: 'c', order: 2, title: 'Child', replyTo: { beatId: 'p' } }),
      beatFixture({ id: 'o', order: 3, title: 'Other' }),
    ]))
    await selectRow(user, 'p')
    await user.keyboard('e')
    const dialog = await screen.findByRole('dialog', { name: 'Edit beat' })
    await user.selectOptions(within(dialog).getByLabelText('Reply to'), 'beat')
    const parent = within(dialog).getByLabelText('Parent beat')
    const options = within(parent).getAllByRole('option').map(option => option.textContent)
    // Not itself (#1) and not its own reply (#2): only "Other".
    expect(options).toEqual(['Choose a beat...', '#3 Other'])
  })

  it('takes a starting-engagement baseline, validating whole numbers 0 to 1,000,000', async () => {
    const { user } = await mountPanel()
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Title/), 'Seeded')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'Newsline7')
    await user.type(within(dialog).getByLabelText('Text'), 'Breaking.')
    await user.click(within(dialog).getByRole('button', { name: 'Starting engagement' }))
    await user.type(within(dialog).getByLabelText('Likes'), '1000001')
    await user.type(within(dialog).getByLabelText('Reposts'), '40')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    expect(await within(dialog).findByText(/Likes .*between 0 and 1,000,000/)).toBeInTheDocument()

    await user.clear(within(dialog).getByLabelText('Likes'))
    await user.type(within(dialog).getByLabelText('Likes'), '1200')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(storedData().beats[0]?.engagementBaseline).toEqual({ like: 1200, repost: 40 })
    expect(within(row('beat-1')).getByText(/Starting engagement: 1,200 likes, 40 reposts/)).toBeInTheDocument()
  })
})

describe('RunSheetPanel - persistence (AC "Persisted per exercise")', () => {
  it('survives a reload with beats, order, name and status', async () => {
    const seeded = TWO_BEATS()
    const data: RunSheetData = {
      ...seeded,
      name: 'Saved sheet',
      runtime: { b1: { status: 'fired', firedPostId: 'post-1', firedAtScenario: '2033-09-04T14:00:00.000Z' } },
    }
    await mountPanel(data)
    expect(screen.getByLabelText('Sheet name')).toHaveValue('Saved sheet')
    expect(statusOf('b1')).toHaveTextContent('Fired')
    expect(statusOf('b2')).toHaveTextContent('Pending')
    expect(screen.getByTestId('run-sheet-counts')).toHaveTextContent('1 of 2 fired · 1 pending')
  })

  it('renames the sheet on blur and rejects a blank name in words', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    const name = screen.getByLabelText('Sheet name')
    await user.clear(name)
    await user.tab()
    expect(await screen.findByText(/Sheet name must not be empty/)).toBeInTheDocument()
    expect(storedData().name).toBe('Water crisis')

    await user.clear(name)
    await user.type(name, 'Demo script')
    await user.tab()
    await waitFor(() => expect(storedData().name).toBe('Demo script'))
  })

  it('shows a visible warning, and keeps the edit, when storage refuses the write', async () => {
    const { user } = await mountPanel()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog')
    await user.type(within(dialog).getByLabelText(/^Title/), 'Unsaved but kept')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'FulcoEM')
    await user.type(within(dialog).getByLabelText('Text'), 'Hello')
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))

    const warning = await screen.findByTestId('run-sheet-storage-warning')
    expect(warning).toHaveAttribute('role', 'alert')
    expect(warning).toHaveTextContent(/could not be saved to browser storage/)
    // Honest about what Export carries: beats, not fired status (Gate-1 L-3).
    expect(warning).toHaveTextContent('Export keeps your beats but NOT which have been fired')
    expect(warning).toHaveTextContent('every beat shows as Pending')
    expect(within(row('beat-1')).getByText('Unsaved but kept')).toBeInTheDocument()
  })

  it('refuses to overwrite an unreadable saved sheet until the controller starts over', async () => {
    window.localStorage.setItem(runSheetStorageKey(MOCK_EXERCISE_ID), '{ broken')
    const { user } = await mountPanel()
    const alert = await screen.findByTestId('run-sheet-unreadable')
    expect(alert).toHaveTextContent(/could not be read/)
    expect(alert).toHaveTextContent(/has not been changed or deleted/)
    expect(screen.queryByRole('button', { name: 'Add beat' })).toBeNull()
    expect(window.localStorage.getItem(runSheetStorageKey(MOCK_EXERCISE_ID))).toBe('{ broken')

    await user.click(screen.getByRole('button', { name: 'Start a new sheet...' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start a new sheet?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Start new sheet' }))

    await screen.findByTestId('run-sheet-empty')
    expect(window.localStorage.getItem(runSheetBackupKey(MOCK_EXERCISE_ID))).toBe('{ broken')
    expect(screen.getByRole('button', { name: 'Add beat' })).toBeInTheDocument()
  })
})

describe('RunSheetPanel - import / export (AC "JSON import/export (pulse.runsheet.v1)")', () => {
  const importFile = (text: string, name = 'demo.runsheet.json') =>
    fireEvent.change(screen.getByTestId('run-sheet-import-input'), {
      target: { files: [new File([text], name, { type: 'application/json' })] },
    })

  it('exports the definition file with no status, named after the sheet', async () => {
    const data: RunSheetData = {
      ...TWO_BEATS(),
      runtime: { b1: { status: 'fired', firedPostId: 'post-1', firedAtScenario: '2033-09-04T14:00:00.000Z' } },
    }
    const { user } = await mountPanel(data)
    await user.click(screen.getByRole('button', { name: 'Export' }))

    expect(downloadTextFile).toHaveBeenCalledTimes(1)
    const [filename, text] = vi.mocked(downloadTextFile).mock.calls[0] ?? []
    expect(filename).toBe('water-crisis.runsheet.json')
    const file: unknown = JSON.parse(String(text))
    expect(file).toMatchObject({ schema: 'pulse.runsheet.v1', name: 'Water crisis' })
    expect(Object.keys(file as object).sort()).toEqual(['beats', 'exportedAt', 'name', 'schema'])
    expect(String(text)).not.toMatch(/status|firedPostId|fired|post-1/)
    const parsed = parseRunSheetFile(String(text))
    expect(parsed.ok && parsed.sheet.beats).toEqual(TWO_BEATS().beats)
    expect(liveStatus()).toHaveTextContent('Exported 2 beats to water-crisis.runsheet.json')
  })

  it('imports a valid file onto an empty sheet, every beat pending', async () => {
    await mountPanel()
    importFile(serializeRunSheetFile({ name: 'From file', beats: TWO_BEATS().beats }))
    expect(await screen.findByTestId('run-sheet-import-notice')).toHaveTextContent(
      'Imported "From file" from demo.runsheet.json: 2 beats, all pending.',
    )
    expect(statusOf('b1')).toHaveTextContent('Pending')
    expect(screen.getByLabelText('Sheet name')).toHaveValue('From file')
    expect(storedData().beats).toEqual(TWO_BEATS().beats)
  })

  it('shows imported text as plain text: markup in a file never becomes elements', async () => {
    await mountPanel()
    importFile(serializeRunSheetFile({
      name: 'Hostile <b>sheet</b>',
      beats: [beatFixture({
        id: 'x',
        order: 1,
        title: '<img src=x onerror=alert(1)> title',
        text: '<script>alert(1)</script> plain',
        notes: '<i>notes</i>',
      })],
    }))
    await screen.findByTestId('beat-row-x')
    const r = row('x')
    expect(within(r).getByText('<img src=x onerror=alert(1)> title')).toBeInTheDocument()
    expect(within(r).getByTestId('beat-text')).toHaveTextContent('<script>alert(1)</script> plain')
    expect(r.querySelector('img')).toBeNull()
    expect(r.querySelector('script')).toBeNull()
    expect(screen.getByLabelText('Sheet name')).toHaveValue('Hostile <b>sheet</b>')
  })

  it('refuses a file over 2 MB without reading it', async () => {
    await mountPanel(TWO_BEATS())
    const big = new File(['{}'], 'huge.json', { type: 'application/json' })
    Object.defineProperty(big, 'size', { value: 3 * 1024 * 1024 })
    fireEvent.change(screen.getByTestId('run-sheet-import-input'), { target: { files: [big] } })
    expect(await screen.findByTestId('run-sheet-import-error')).toHaveTextContent('too large')
    expect(storedData().beats.map(b => b.id)).toEqual(['b1', 'b2'])
  })

  it('rejects the WHOLE file with a readable message on the first violation and applies nothing', async () => {
    await mountPanel(TWO_BEATS())
    const bad = {
      schema: 'pulse.runsheet.v1',
      name: 'Bad',
      beats: [
        beatFixture({ id: 'x1', order: 1 }),
        beatFixture({ id: 'x2', order: 2, text: 'a'.repeat(281) }),
      ],
    }
    importFile(JSON.stringify(bad))
    const alert = await screen.findByTestId('run-sheet-import-error')
    expect(alert).toHaveTextContent('Import refused, nothing was changed.')
    expect(alert).toHaveTextContent('beats[1].text is 281 characters; the limit is 280')
    // Nothing was applied - not even the valid first beat.
    expect(screen.queryByTestId('beat-row-x1')).toBeNull()
    expect(storedData().beats.map(b => b.id)).toEqual(['b1', 'b2'])
    expect(liveStatus()).toHaveTextContent('Import refused')
  })

  it.each([
    ['a wrong schema id', { schema: 'pulse.runsheet.v2', name: 'x', beats: [] }, 'schema must be "pulse.runsheet.v1"'],
    ['duplicate ids', {
      schema: 'pulse.runsheet.v1',
      name: 'x',
      beats: [beatFixture({ id: 'd', order: 1 }), beatFixture({ id: 'd', order: 2 })],
    }, 'beats[1].id is a duplicate'],
    ['duplicate orders', {
      schema: 'pulse.runsheet.v1',
      name: 'x',
      beats: [beatFixture({ id: 'a', order: 1 }), beatFixture({ id: 'b', order: 1 })],
    }, 'beats[1].order is a duplicate'],
    ['more than 4 media', {
      schema: 'pulse.runsheet.v1',
      name: 'x',
      beats: [beatFixture({
        media: [1, 2, 3, 4, 5].map(n => ({ mediaId: `m${n}`, alt: `photo ${n}` })),
      })],
    }, 'too many media items'],
    ['a bad baseline', {
      schema: 'pulse.runsheet.v1',
      name: 'x',
      beats: [beatFixture({ engagementBaseline: { like: -5 } })],
    }, 'engagementBaseline.like must be between 0 and 1,000,000'],
  ])('refuses %s', async (_name, file, message) => {
    await mountPanel(TWO_BEATS())
    importFile(JSON.stringify(file))
    expect(await screen.findByTestId('run-sheet-import-error')).toHaveTextContent(message)
    expect(storedData().beats.map(b => b.id)).toEqual(['b1', 'b2'])
  })

  it('refuses text that is not JSON at all', async () => {
    await mountPanel()
    importFile('this is not json')
    expect(await screen.findByTestId('run-sheet-import-error')).toHaveTextContent(
      'That file is not valid JSON',
    )
  })

  it('asks before replacing a non-empty sheet, and Cancel keeps it', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    importFile(serializeRunSheetFile({
      name: 'Replacement',
      beats: [beatFixture({ id: 'only', order: 1, title: 'Only beat' })],
    }))
    const dialog = await screen.findByRole('dialog', { name: 'Replace the current run sheet?' })
    expect(dialog).toHaveTextContent('replaces the 2 beats in this sheet')
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(storedData().beats.map(b => b.id)).toEqual(['b1', 'b2'])

    importFile(serializeRunSheetFile({
      name: 'Replacement',
      beats: [beatFixture({ id: 'only', order: 1, title: 'Only beat' })],
    }))
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace sheet' }),
    )
    await screen.findByTestId('beat-row-only')
    expect(storedData().beats.map(b => b.id)).toEqual(['only'])
    expect(storedData().name).toBe('Replacement')
  })

  it('warns, without blocking, about media ids missing from the library', async () => {
    await mountPanel()
    importFile(serializeRunSheetFile({
      name: 'Media sheet',
      beats: [
        beatFixture({
          id: 'm1',
          order: 1,
          media: [
            { mediaId: 'mock-media-canned-flood', alt: 'Flooded street' },
            { mediaId: 'ghost-media-id', alt: 'A photo that is not in the library' },
          ],
        }),
        beatFixture({ id: 'm2', order: 2, title: 'No media' }),
      ],
    }))
    const notice = await screen.findByTestId('run-sheet-import-notice')
    await waitFor(() => expect(notice).toHaveTextContent('Warning: 1 beat uses media that is not'))
    // Imported all the same.
    expect(storedData().beats).toHaveLength(2)
    expect(within(row('m1')).getByTestId('beat-media-warning')).toHaveTextContent(
      'Warning: 1 of this beat\'s media item is not in this exercise\'s media library',
    )
    expect(within(row('m2')).queryByTestId('beat-media-warning')).toBeNull()
  })

  it('round trips: export, clear, import gives back the same definition', async () => {
    const original = sheetFixture([
      beatFixture({ id: 'a', order: 1, title: 'First', notes: 'Note' }),
      beatFixture({
        id: 'b',
        order: 2,
        title: 'Reply',
        replyTo: { beatId: 'a' },
        media: [{ mediaId: 'mock-media-canned-flood', alt: 'Flood' }],
        engagementBaseline: { like: 9 },
      }),
      beatFixture({
        id: 'c',
        order: 3,
        title: 'Post reply',
        replyTo: { postId: 'post-x' },
        text: '',
        media: [{ mediaId: 'mock-media-canned-plant', alt: 'Plant' }],
      }),
    ], {}, 'Round trip')
    const { user } = await mountPanel(original)
    await user.click(screen.getByRole('button', { name: 'Export' }))
    const exported = String(vi.mocked(downloadTextFile).mock.calls[0]?.[1])

    // A fresh browser: nothing stored, a new page.
    cleanup()
    window.localStorage.clear()
    resetRunSheetStoreForTests()
    await mountPanel()
    importFile(exported)
    await screen.findByTestId('run-sheet-import-notice')
    expect(storedData().name).toBe(original.name)
    expect(storedData().beats).toEqual(original.beats)
  })
})

describe('RunSheetPanel - firing (AC "Fire / Fire next / Skip")', () => {
  it('fires the selected beat as controller-as-persona, recording the post id and SCENARIO time', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    await selectRow(user, 'b1')
    await user.click(within(row('b1')).getByRole('button', { name: 'Fire' }))

    await waitFor(() => expect(statusOf('b1')).toHaveTextContent('Fired'))
    // Scenario time in the exercise zone (America/New_York): 14:00Z = 10:00 AM EDT.
    expect(within(row('b1')).getByTestId('beat-fired-at')).toHaveTextContent('Sep 4, 2033, 10:00 AM')
    expect(liveStatus()).toHaveTextContent(
      'Fired "Boil notice" as @FulcoEM at Sep 4, 2033, 10:00 AM.',
    )

    const record = runtimeOf(storedData(), 'b1')
    expect(record.status).toBe('fired')
    expect(record.firedAtScenario).toBe('2033-09-04T14:00:00.000Z')
    const post = postStore.getPosts().find(candidate => candidate.id === record.firedPostId)
    expect(post).toMatchObject({
      origin: 'controller-as-persona',
      actingHumanId: MOCK_ACTING_HUMAN_ID,
      text: TWO_BEATS().beats[0]?.text,
      scenarioTime: '2033-09-04T14:00:00.000Z',
    })
    // The beat is spent: no Fire button, no second post.
    expect(within(row('b1')).queryByRole('button', { name: 'Fire' })).toBeNull()
    expect(within(row('b1')).queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('shows the controller the wall clock nowhere in a fired stamp (scenario time only)', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    await selectRow(user, 'b1')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('b1')).toHaveTextContent('Fired'))
    const stamp = within(row('b1')).getByTestId('beat-fired-at').textContent ?? ''
    expect(stamp).toContain('2033')
    expect(stamp).not.toContain(String(new Date().getFullYear()))
  })

  it('a double-press fires ONCE (the fire slot is claimed synchronously)', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    const r = await selectRow(user, 'b1')
    const before = postStore.getPosts().length
    fireEvent.keyDown(r, { key: 'f' })
    fireEvent.keyDown(r, { key: 'f' })
    fireEvent.keyDown(r, { key: 'F' })
    await waitFor(() => expect(statusOf('b1')).toHaveTextContent('Fired'))
    expect(postStore.getPosts().length).toBe(before + 1)
    expect(storedData().runtime.b1?.status).toBe('fired')
  })

  it('a double Fire next fires one beat, not two', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    const r = await selectRow(user, 'b1')
    const before = postStore.getPosts().length
    fireEvent.keyDown(r, { key: 'n' })
    fireEvent.keyDown(r, { key: 'n' })
    await waitFor(() => expect(statusOf('b1')).toHaveTextContent('Fired'))
    expect(statusOf('b2')).toHaveTextContent('Pending')
    expect(postStore.getPosts().length).toBe(before + 1)
  })

  it('blocks an unknown persona handle with a message, and posts nothing', async () => {
    const { user } = await mountPanel(sheetFixture([
      beatFixture({ id: 'g', order: 1, title: 'Ghost post', persona: { handle: 'nobody_here' } }),
    ]))
    await selectRow(user, 'g')
    expect(within(row('g')).getByTestId('beat-blocked')).toHaveTextContent(
      'Unknown persona @nobody_here',
    )
    expect(within(row('g')).getByRole('button', { name: 'Fire' })).toBeDisabled()

    const before = postStore.getPosts().length
    await user.keyboard('f')
    expect(liveStatus()).toHaveTextContent('Cannot fire "Ghost post": Unknown persona @nobody_here')
    expect(postStore.getPosts().length).toBe(before)
    expect(statusOf('g')).toHaveTextContent('Pending')
  })

  it('resolves the persona handle case-insensitively', async () => {
    const { user } = await mountPanel(sheetFixture([
      beatFixture({ id: 'x', order: 1, persona: { handle: 'FULCOEM' } }),
    ]))
    await selectRow(user, 'x')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('x')).toHaveTextContent('Fired'))
  })

  describe('reply beats (AC "Reply beats")', () => {
    const chain = () => sheetFixture([
      beatFixture({ id: 'p', order: 1, title: 'Impersonator photo', persona: { handle: 'tbrandt41' } }),
      beatFixture({
        id: 'c',
        order: 2,
        title: 'Citizen reply',
        persona: { handle: 'mvega_fh' },
        text: 'That is not from us!',
        replyTo: { beatId: 'p' },
      }),
    ])

    it('is disabled with "Fire the parent first" until the parent is fired, then replies to its post', async () => {
      const { user } = await mountPanel(chain())
      await selectRow(user, 'c')
      expect(within(row('c')).getByTestId('beat-blocked')).toHaveTextContent('Fire the parent first')
      expect(within(row('c')).getByRole('button', { name: 'Fire' })).toBeDisabled()
      expect(within(row('c')).getByText(/Replies to #1 "Impersonator photo"/)).toBeInTheDocument()

      await user.keyboard('f')
      expect(liveStatus()).toHaveTextContent('Cannot fire "Citizen reply": Fire the parent first')
      expect(statusOf('c')).toHaveTextContent('Pending')

      await selectRow(user, 'p')
      await user.keyboard('f')
      await waitFor(() => expect(statusOf('p')).toHaveTextContent('Fired'))
      const parentPostId = storedData().runtime.p?.firedPostId

      await selectRow(user, 'c')
      await waitFor(() => expect(within(row('c')).queryByTestId('beat-blocked')).toBeNull())
      await user.click(within(row('c')).getByRole('button', { name: 'Fire' }))
      await waitFor(() => expect(statusOf('c')).toHaveTextContent('Fired'))

      const childPostId = storedData().runtime.c?.firedPostId
      const child = postStore.getPosts().find(post => post.id === childPostId)
      expect(parentPostId).toBeDefined()
      expect(child?.parentPostId).toBe(parentPostId)
      expect(child?.inReplyTo?.postId).toBe(parentPostId)
    })

    it('replies to an existing post id for replyTo.postId, with no parent beat needed', async () => {
      const target = postStore.getPosts()[0]
      if (target === undefined) throw new Error('the store should hold seeded posts')
      const { user } = await mountPanel(sheetFixture([
        beatFixture({ id: 'r', order: 1, title: 'Reply to existing', replyTo: { postId: target.id } }),
      ]))
      await selectRow(user, 'r')
      expect(within(row('r')).queryByTestId('beat-blocked')).toBeNull()
      await user.keyboard('f')
      await waitFor(() => expect(statusOf('r')).toHaveTextContent('Fired'))
      const firedId = storedData().runtime.r?.firedPostId
      const posted = postStore.getPosts().find(post => post.id === firedId)
      expect(posted?.parentPostId).toBe(target.id)
    })

    it('stays blocked, with context, while the parent is skipped', async () => {
      const { user } = await mountPanel(chain())
      await selectRow(user, 'p')
      await user.keyboard('s')
      await selectRow(user, 'c')
      expect(within(row('c')).getByTestId('beat-blocked')).toHaveTextContent(
        /^Fire the parent first \("Impersonator photo" was skipped/,
      )
    })
  })

  describe('Fire next', () => {
    it('fires the first pending beat, whichever beat is selected', async () => {
      const { user } = await mountPanel(TWO_BEATS())
      await selectRow(user, 'b2')
      expect(screen.getByTestId('run-sheet-next-up')).toHaveTextContent(
        'Next up: #1 T+14m "Boil notice" as @FulcoEM',
      )
      await user.click(screen.getByRole('button', { name: /^Fire next/ }))
      await waitFor(() => expect(statusOf('b1')).toHaveTextContent('Fired'))
      expect(statusOf('b2')).toHaveTextContent('Pending')
      expect(screen.getByTestId('run-sheet-next-up')).toHaveTextContent('"Citizen pile-on"')
    })

    it('passes over skipped, failed and unconfirmed beats: it never re-fires them', async () => {
      const data = sheetFixture([
        beatFixture({ id: 's', order: 1, title: 'Skipped one' }),
        beatFixture({ id: 'f', order: 2, title: 'Failed one' }),
        beatFixture({ id: 'u', order: 3, title: 'Unconfirmed one' }),
        beatFixture({ id: 'n', order: 4, title: 'Next pending' }),
      ], {
        s: { status: 'skipped', skippedFrom: 'pending' },
        f: { status: 'failed', failure: { kind: 'failed', message: 'refused' } },
        u: { status: 'failed', failure: { kind: 'unconfirmed', message: 'maybe live' } },
      })
      const { user } = await mountPanel(data)
      await user.click(screen.getByRole('button', { name: /^Fire next/ }))
      await waitFor(() => expect(statusOf('n')).toHaveTextContent('Fired'))
      expect(statusOf('f')).toHaveTextContent('Failed')
      expect(statusOf('u')).toHaveTextContent('Unconfirmed')
      expect(statusOf('s')).toHaveTextContent('Skipped')
      expect(screen.getByRole('button', { name: /^Fire next/ })).toBeDisabled()
    })

    it('reports a blocked next beat instead of firing a later one out of turn', async () => {
      const { user } = await mountPanel(sheetFixture([
        beatFixture({ id: 'a', order: 1, title: 'Blocked first', persona: { handle: 'nobody_here' } }),
        beatFixture({ id: 'b', order: 2, title: 'Fine second' }),
      ]))
      await user.click(screen.getByRole('button', { name: /^Fire next/ }))
      await waitFor(() =>
        expect(liveStatus()).toHaveTextContent('Cannot fire "Blocked first": Unknown persona'))
      expect(statusOf('b')).toHaveTextContent('Pending')
    })

    it('says so when nothing is left to fire', async () => {
      const { user } = await mountPanel(sheetFixture([beatFixture({ id: 'a', order: 1 })], {
        a: { status: 'fired', firedPostId: 'p', firedAtScenario: '2033-09-04T14:00:00.000Z' },
      }))
      expect(screen.getByRole('button', { name: /^Fire next/ })).toBeDisabled()
      await selectRow(user, 'a')
      await user.keyboard('n')
      expect(liveStatus()).toHaveTextContent('No pending beats left to fire.')
    })
  })

  describe('Skip (undo-able)', () => {
    it('skips a pending beat and undoes it, by key and by button', async () => {
      const { user } = await mountPanel(TWO_BEATS())
      await selectRow(user, 'b1')
      await user.click(within(row('b1')).getByRole('button', { name: 'Skip' }))
      expect(statusOf('b1')).toHaveTextContent('Skipped')
      expect(liveStatus()).toHaveTextContent('Skipped "Boil notice". Press S again to undo.')
      expect(within(row('b1')).queryByRole('button', { name: 'Fire' })).toBeNull()

      // The Skip button was replaced by "Undo skip"; focus comes back to the row so the
      // keyboard carries on working.
      await waitFor(() => expect(row('b1')).toHaveFocus())
      await user.keyboard('s')
      expect(statusOf('b1')).toHaveTextContent('Pending')
      expect(liveStatus()).toHaveTextContent('Skip undone for "Boil notice".')

      await user.click(within(row('b1')).getByRole('button', { name: 'Skip' }))
      await user.click(within(row('b1')).getByRole('button', { name: 'Undo skip' }))
      expect(statusOf('b1')).toHaveTextContent('Pending')
    })

    it('does not skip or edit a fired beat', async () => {
      const { user } = await mountPanel(sheetFixture([beatFixture({ id: 'a', order: 1 })], {
        a: { status: 'fired', firedPostId: 'p', firedAtScenario: '2033-09-04T14:00:00.000Z' },
      }))
      await selectRow(user, 'a')
      await user.keyboard('s')
      expect(statusOf('a')).toHaveTextContent('Fired')
      await user.keyboard('e')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(liveStatus()).toHaveTextContent('already live and cannot be edited')
      expect(within(row('a')).getByRole('button', { name: 'Edit' })).toBeDisabled()
    })
  })

  describe('failed vs unconfirmed (POST /api/posts is not idempotent: never a blind retry)', () => {
    const failed = () => sheetFixture([beatFixture({ id: 'f', order: 1, title: 'Refused' })], {
      f: {
        status: 'failed',
        failure: { kind: 'failed', message: 'The server refused this post (HTTP 400). Nothing was posted.' },
      },
    })
    const unconfirmed = () => sheetFixture([beatFixture({ id: 'u', order: 1, title: 'Maybe live' })], {
      u: {
        status: 'failed',
        failure: { kind: 'unconfirmed', message: 'No response from the server. The post may already be live.' },
      },
    })

    it('a FAILED beat shows its error and a Retry that fires directly', async () => {
      const { user } = await mountPanel(failed())
      await selectRow(user, 'f')
      expect(statusOf('f')).toHaveTextContent('Failed')
      expect(within(row('f')).getByTestId('beat-failure')).toHaveTextContent(
        'Failed - The server refused this post (HTTP 400). Nothing was posted.',
      )
      await user.click(within(row('f')).getByRole('button', { name: 'Retry' }))
      await waitFor(() => expect(statusOf('f')).toHaveTextContent('Fired'))
      expect(within(row('f')).queryByTestId('beat-failure')).toBeNull()
    })

    it('an UNCONFIRMED beat says the post may be live and offers no Retry, only a confirmed re-fire', async () => {
      const { user } = await mountPanel(unconfirmed())
      await selectRow(user, 'u')
      expect(statusOf('u')).toHaveTextContent('Unconfirmed')
      expect(within(row('u')).getByTestId('beat-failure')).toHaveTextContent(
        'Unconfirmed - No response from the server. The post may already be live.',
      )
      expect(within(row('u')).queryByRole('button', { name: 'Retry' })).toBeNull()

      const before = postStore.getPosts().length
      await user.click(within(row('u')).getByRole('button', { name: 'Fire again...' }))
      const dialog = await screen.findByRole('dialog', { name: 'Fire again?' })
      expect(dialog).toHaveTextContent('may already be live')
      expect(dialog).toHaveTextContent('Check the Live world first')
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(postStore.getPosts().length).toBe(before)
      expect(statusOf('u')).toHaveTextContent('Unconfirmed')

      await user.click(within(row('u')).getByRole('button', { name: 'Fire again...' }))
      await user.click(
        within(await screen.findByRole('dialog')).getByRole('button', { name: 'Fire again' }),
      )
      await waitFor(() => expect(statusOf('u')).toHaveTextContent('Fired'))
      expect(postStore.getPosts().length).toBe(before + 1)
    })

    it('pressing F on an unconfirmed beat asks first instead of firing', async () => {
      const { user } = await mountPanel(unconfirmed())
      await selectRow(user, 'u')
      const before = postStore.getPosts().length
      await user.keyboard('f')
      expect(await screen.findByRole('dialog', { name: 'Fire again?' })).toBeInTheDocument()
      expect(postStore.getPosts().length).toBe(before)
    })

    it('shows a beat that was in flight when the page was closed as Unconfirmed, never Pending', async () => {
      await mountPanel(sheetFixture([beatFixture({ id: 'i', order: 1, title: 'Was firing' })], {
        i: { status: 'pending', inFlight: true },
      }))
      expect(statusOf('i')).toHaveTextContent('Unconfirmed')
      expect(screen.getByRole('button', { name: /^Fire next/ })).toBeDisabled()
    })

    it('puts a mock-mode rejection (unknown media) on the row as FAILED, never as fired', async () => {
      const { user } = await mountPanel(sheetFixture([
        beatFixture({ id: 'm', order: 1, title: 'Bad media', media: [{ mediaId: 'nope', alt: 'A photo' }] }),
      ]))
      await selectRow(user, 'm')
      await user.keyboard('f')
      await waitFor(() => expect(statusOf('m')).toHaveTextContent('Failed'))
      expect(within(row('m')).getByTestId('beat-failure')).toHaveTextContent('Not posted')
      expect(screen.getByTestId('run-sheet-alert')).toHaveTextContent('Failed: "Bad media"')
      expect(within(row('m')).getByRole('button', { name: 'Retry' })).toBeInTheDocument()
    })
  })

  it('shows every status as TEXT beside an icon, never colour alone', async () => {
    await mountPanel(sheetFixture([
      beatFixture({ id: 'p', order: 1 }),
      beatFixture({ id: 'f', order: 2 }),
      beatFixture({ id: 's', order: 3 }),
      beatFixture({ id: 'x', order: 4 }),
      beatFixture({ id: 'u', order: 5 }),
    ], {
      f: { status: 'fired', firedPostId: 'p1', firedAtScenario: '2033-09-04T14:00:00.000Z' },
      s: { status: 'skipped', skippedFrom: 'pending' },
      x: { status: 'failed', failure: { kind: 'failed', message: 'refused' } },
      u: { status: 'failed', failure: { kind: 'unconfirmed', message: 'maybe live' } },
    }))
    const expected: Record<string, string> = {
      p: 'Pending',
      f: 'Fired',
      s: 'Skipped',
      x: 'Failed',
      u: 'Unconfirmed',
    }
    for (const [id, label] of Object.entries(expected)) {
      const chip = statusOf(id)
      expect(chip).toHaveTextContent(label)
      // Every chip carries an icon (FontAwesome renders an svg) hidden from assistive tech.
      const icon = chip.querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
      // The row's accessible name carries the status as well.
      expect(row(id)).toHaveAccessibleName(new RegExp(`, ${label}$`))
    }
    expect(screen.getByTestId('run-sheet-counts')).toHaveTextContent(
      '1 of 5 fired · 1 pending · 1 skipped · 1 failed · 1 unconfirmed',
    )
  })
})

describe('RunSheetPanel - keyboard (AC "Keyboard (NFR-001)")', () => {
  it('lists the shortcuts in a visible "Keyboard" legend', async () => {
    await mountPanel(TWO_BEATS())
    const legend = screen.getByRole('group', { name: 'Keyboard' })
    expect(legend).toBeVisible()
    expect(legend).toHaveTextContent('Keyboard')
    expect(legend).toHaveTextContent('select a beat')
    expect(legend).toHaveTextContent('fire the selected beat')
    expect(legend).toHaveTextContent('fire the next pending beat')
    expect(legend).toHaveTextContent('skip the selected beat')
    expect(legend).toHaveTextContent('edit the selected beat')
  })

  it('moves the selection, and the focus, with the arrow keys', async () => {
    const { user } = await mountPanel(sheetFixture([
      beatFixture({ id: 'a', order: 1, title: 'A' }),
      beatFixture({ id: 'b', order: 2, title: 'B' }),
      beatFixture({ id: 'c', order: 3, title: 'C' }),
    ]))
    // Roving tabindex: only the selected row is in the tab order.
    expect(row('a')).toHaveAttribute('tabindex', '0')
    expect(row('b')).toHaveAttribute('tabindex', '-1')

    await selectRow(user, 'a')
    await user.keyboard('{ArrowDown}')
    await waitFor(() => expect(row('b')).toHaveFocus())
    expect(row('b')).toHaveAttribute('aria-current', 'true')
    expect(row('a')).not.toHaveAttribute('aria-current')
    await user.keyboard('{ArrowDown}{ArrowDown}')
    await waitFor(() => expect(row('c')).toHaveFocus())
    await user.keyboard('{ArrowUp}')
    await waitFor(() => expect(row('b')).toHaveFocus())
    await user.keyboard('{ArrowUp}{ArrowUp}')
    await waitFor(() => expect(row('a')).toHaveFocus())
  })

  it('F fires the selected beat, N the next pending, S skips, E edits', async () => {
    const { user } = await mountPanel(sheetFixture([
      beatFixture({ id: 'a', order: 1, title: 'A' }),
      beatFixture({ id: 'b', order: 2, title: 'B' }),
      beatFixture({ id: 'c', order: 3, title: 'C' }),
    ]))
    await selectRow(user, 'b')
    await user.keyboard('f')
    await waitFor(() => expect(statusOf('b')).toHaveTextContent('Fired'))

    await user.keyboard('n')
    await waitFor(() => expect(statusOf('a')).toHaveTextContent('Fired'))
    // N moved the selection to the beat it fired, so the stamp is in view.
    await waitFor(() => expect(row('a')).toHaveAttribute('aria-current', 'true'))

    await user.keyboard('{ArrowDown}{ArrowDown}')
    await waitFor(() => expect(row('c')).toHaveFocus())
    await user.keyboard('s')
    expect(statusOf('c')).toHaveTextContent('Skipped')
    await user.keyboard('s')
    expect(statusOf('c')).toHaveTextContent('Pending')

    await user.keyboard('e')
    expect(await screen.findByRole('dialog', { name: 'Edit beat' })).toBeInTheDocument()
  })

  it('ignores the shortcuts while typing in a field', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    await selectRow(user, 'b1')
    const name = screen.getByLabelText('Sheet name')
    await user.click(name)
    await user.keyboard('fnse')
    expect(name).toHaveValue('Water crisisfnse')
    expect(statusOf('b1')).toHaveTextContent('Pending')
    expect(statusOf('b2')).toHaveTextContent('Pending')
    expect(screen.queryByRole('dialog')).toBeNull()
    const byController = postStore
      .getPosts()
      .filter(post => post.actingHumanId === MOCK_ACTING_HUMAN_ID)
    expect(byController).toEqual([])
  })

  it('ignores the shortcuts while a dialog is open, even from a button inside it', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    await selectRow(user, 'b1')
    await user.keyboard('e')
    const dialog = await screen.findByRole('dialog', { name: 'Edit beat' })
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' })
    cancel.focus()
    await user.keyboard('fns')
    expect(statusOf('b1')).toHaveTextContent('Pending')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('does not let a held key repeat an action (holding N never fires a string of posts)', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    const r = await selectRow(user, 'b1')
    fireEvent.keyDown(r, { key: 'n', repeat: true })
    fireEvent.keyDown(r, { key: 'f', repeat: true })
    expect(statusOf('b1')).toHaveTextContent('Pending')
    expect(statusOf('b2')).toHaveTextContent('Pending')
  })

  it('leaves Ctrl/Cmd combinations to the browser and the console', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    const r = await selectRow(user, 'b1')
    fireEvent.keyDown(r, { key: 'f', ctrlKey: true })
    fireEvent.keyDown(r, { key: 'n', metaKey: true })
    expect(statusOf('b1')).toHaveTextContent('Pending')
  })

  it('makes every action reachable as a button', async () => {
    const { user } = await mountPanel(TWO_BEATS())
    await selectRow(user, 'b1')
    const actions = within(screen.getByRole('group', { name: 'Actions for Boil notice' }))
    for (const name of ['Fire', 'Skip', 'Edit', 'Duplicate', 'Move up', 'Move down', 'Delete']) {
      expect(actions.getByRole('button', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /^Fire next/ })).toBeInTheDocument()
    for (const name of ['Add beat', 'Import', 'Export', 'Sort by T+']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument()
    }
  })
})

describe('RunSheetPanel - Gate-1 folds', () => {
  const importFile = (text: string, name = 'demo.runsheet.json') =>
    fireEvent.change(screen.getByTestId('run-sheet-import-input'), {
      target: { files: [new File([text], name, { type: 'application/json' })] },
    })

  describe('contrast (H-1, H-2), measured on the rendered DOM', () => {
    it('the "N" hint inside Fire next takes the button\'s colours, not the grey keycap surface', async () => {
      await mountPanel(TWO_BEATS())
      const button = screen.getByRole('button', { name: /^Fire next/ })
      const hint = button.querySelector('kbd')
      expect(hint).not.toBeNull()
      if (hint === null) return
      const hintStyle = getComputedStyle(hint)
      const buttonStyle = getComputedStyle(button)
      // Transparent, so the cobalt button shows through; the text is the button's own white.
      expect(hintStyle.backgroundColor).toBe('rgba(0, 0, 0, 0)')
      expect(hintStyle.color).toBe(buttonStyle.color)
      expect(contrastRatio(hintStyle.color, buttonStyle.backgroundColor))
        .toBeGreaterThanOrEqual(4.5)
      // The bug it replaces: that text on the #f8f8f8 keycap surface was 1.06:1.
      expect(contrastRatio(hintStyle.color, '#f8f8f8')).toBeLessThan(1.2)
    })

    it('the Skipped chip is #4a4f55: AA on the white panel and on the selected row', async () => {
      const { user } = await mountPanel(sheetFixture([
        beatFixture({ id: 'a', order: 1 }),
        beatFixture({ id: 'b', order: 2 }),
      ], { a: { status: 'skipped', skippedFrom: 'pending' } }))
      const chip = statusOf('a')
      expect(getComputedStyle(chip).color).toBe('rgb(74, 79, 85)')
      expect(contrastRatio(getComputedStyle(chip).color, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      await selectRow(user, 'a')
      expect(contrastRatio(getComputedStyle(statusOf('a')).color, getComputedStyle(row('a')).backgroundColor))
        .toBeGreaterThanOrEqual(4.5)
    })

    it('small informational text (counts, next up, legend) is the AA muted colour', async () => {
      await mountPanel(TWO_BEATS())
      for (const element of [
        screen.getByTestId('run-sheet-counts'),
        screen.getByTestId('run-sheet-next-up'),
        screen.getByTestId('run-sheet-keyboard-help'),
      ]) {
        expect(getComputedStyle(element).color).toBe('rgb(74, 79, 85)')
      }
      expect(getComputedStyle(within(row('b1')).getByTestId('beat-minute')).color).not.toBe('rgb(132, 132, 130)')
    })
  })

  describe('M-1: a new beat goes at the end of an imported sheet', () => {
    it('after importing orders 10 and 20, an added beat is last and Fire next still fires the first', async () => {
      const { user } = await mountPanel()
      importFile(serializeRunSheetFile({
        name: 'Sparse orders',
        beats: [
          beatFixture({ id: 'x10', order: 10, title: 'Ten' }),
          beatFixture({ id: 'x20', order: 20, title: 'Twenty' }),
        ],
      }))
      await screen.findByTestId('beat-row-x10')

      await user.click(screen.getByRole('button', { name: 'Add beat' }))
      const dialog = await screen.findByRole('dialog')
      await user.type(within(dialog).getByLabelText(/^Title/), 'Added later')
      await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'FulcoEM')
      await user.type(within(dialog).getByLabelText('Text'), 'Late addition.')
      await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

      expect(storedData().beats.map(b => [b.title, b.order])).toEqual([
        ['Ten', 1],
        ['Twenty', 2],
        ['Added later', 3],
      ])
      await user.click(screen.getByRole('button', { name: /^Fire next/ }))
      await waitFor(() => expect(statusOf('x10')).toHaveTextContent('Fired'))
      const added = storedData().beats[2]?.id ?? ''
      expect(statusOf(added)).toHaveTextContent('Pending')
    })
  })

  describe('M-2: a fire in flight blocks replacing the sheet', () => {
    it('refuses the replace if a fire started elsewhere between choosing the file and confirming', async () => {
      const { user } = await mountPanel(TWO_BEATS())
      importFile(serializeRunSheetFile({
        name: 'Replacement',
        beats: [beatFixture({ id: 'only', order: 1, title: 'Only beat' })],
      }))
      const dialog = await screen.findByRole('dialog', { name: 'Replace the current run sheet?' })

      // Another tab claims the fire slot while the dialog is open.
      writeStoredSheet(MOCK_EXERCISE_ID, {
        ...TWO_BEATS(),
        runtime: { b1: { status: 'pending', inFlight: true, attemptId: 'other-tab' } },
      })
      await user.click(within(dialog).getByRole('button', { name: 'Replace sheet' }))

      const alert = await screen.findByTestId('run-sheet-import-error')
      expect(alert).toHaveTextContent('Import refused: A beat is firing right now.')
      expect(alert).toHaveTextContent('Nothing was changed.')
      expect(storedData().beats.map(b => b.id)).toEqual(['b1', 'b2'])
      expect(storedData().runtime.b1?.inFlight).toBe(true)
    })

    it('disables Import while a beat is firing here', async () => {
      await mountPanel(sheetFixture([beatFixture({ id: 'a', order: 1 })], {
        a: { status: 'pending', inFlight: true, attemptId: 'other-tab' },
      }))
      // A marker left by a dead page is settled on load; a LIVE marker from another tab is not.
      writeStoredSheet(MOCK_EXERCISE_ID, sheetFixture([beatFixture({ id: 'a', order: 1 })], {
        a: { status: 'pending', inFlight: true, attemptId: 'live-elsewhere' },
      }))
      fireEvent(window, new StorageEvent('storage', { key: runSheetStorageKey(MOCK_EXERCISE_ID) }))
      await waitFor(() => expect(screen.getByRole('button', { name: 'Import' })).toBeDisabled())
    })
  })

  describe('M-6: telemetry', () => {
    it('a mock-mode fire emits exactly ONE event (the post), and a reply fire one more', async () => {
      const { user } = await mountPanel(sheetFixture([
        beatFixture({ id: 'p', order: 1, title: 'Parent', persona: { handle: 'tbrandt41' } }),
        beatFixture({
          id: 'c',
          order: 2,
          title: 'Child',
          persona: { handle: 'mvega_fh' },
          replyTo: { beatId: 'p' },
        }),
      ]))
      expect(getEmittedTelemetryEvents()).toHaveLength(0)
      await selectRow(user, 'p')
      await user.keyboard('f')
      await waitFor(() => expect(statusOf('p')).toHaveTextContent('Fired'))
      expect(getEmittedTelemetryEvents()).toHaveLength(1)
      expect(getEmittedTelemetryEvents()[0]).toMatchObject({
        eventType: 'post',
        origin: 'controller-as-persona',
      })

      await selectRow(user, 'c')
      await user.keyboard('f')
      await waitFor(() => expect(statusOf('c')).toHaveTextContent('Fired'))
      expect(getEmittedTelemetryEvents()).toHaveLength(2)
      expect(getEmittedTelemetryEvents()[1]).toMatchObject({ eventType: 'reply' })
    })

    it('authoring, skipping, importing and exporting emit no telemetry', async () => {
      const { user } = await mountPanel(TWO_BEATS())
      await selectRow(user, 'b1')
      await user.keyboard('s')
      await user.keyboard('s')
      await user.click(screen.getByRole('button', { name: 'Export' }))
      await user.click(within(row('b1')).getByRole('button', { name: 'Duplicate' }))
      expect(getEmittedTelemetryEvents()).toHaveLength(0)
    })
  })

  describe('M-4 / L-6 wiring', () => {
    it('announces a failure ONCE: the alert carries it and the polite status region is cleared', async () => {
      const { user } = await mountPanel(sheetFixture([
        beatFixture({ id: 'm', order: 1, title: 'Bad media', media: [{ mediaId: 'nope', alt: 'A photo' }] }),
      ]))
      await selectRow(user, 'm')
      await user.keyboard('f')
      await waitFor(() => expect(statusOf('m')).toHaveTextContent('Failed'))
      expect(screen.getByTestId('run-sheet-alert')).toHaveTextContent('Failed: "Bad media"')
      expect(liveStatus()).toHaveTextContent('')
      expect(liveStatus().textContent).toBe('')
    })
  })
})
