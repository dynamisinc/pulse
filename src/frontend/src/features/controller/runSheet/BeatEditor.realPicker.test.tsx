/**
 * features/controller/runSheet/BeatEditor.realPicker.test.tsx
 * ---------------------------------------------------------------------------
 * The beat editor against C1's REAL `MediaLibraryPicker` - nothing about the picker is
 * mocked (demo-polish Wave 3 integration, Gate-2 check 21; `BeatEditor.test.tsx` and
 * `RunSheetPanel.test.tsx` both replace the picker with a stand-in that honours the frozen
 * props). Proves the two sides of the frozen contract (implementation.md section 1.11) fit
 * once merged, and that the panel's library VIEW (`libraryView.ts`) resolves an asset picked
 * under a picker filter that the capped "All" list does not hold:
 *
 *  - STANDALONE: the editor renders the picker's own grid (the mock library's four canned
 *    items), a click on a tile attaches it, the editor shows that asset's file name and asks
 *    for alt text - the picker's `onChange(ids)` drives the editor's draft end to end;
 *  - THROUGH THE PANEL, with the "All" library omitting the video (`GET /staff/media` is
 *    stubbed per `kind`): picking the video under the editor's "One video" filter resolves
 *    through `useLibraryAssetLookup()` - no "not in this exercise's media library" note -
 *    and, saved, the row reads "1 video" and REOPENS as a video beat (the saved id is
 *    resolved, so `draftFromBeat` knows its kind).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import type { StaffMediaAssetView } from '@/core/media'
import { listMockMedia, resetMockMediaRegistry } from '@/core/media/mockMediaRegistry'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { BeatEditor } from './BeatEditor'
import { RunSheetPanel } from './RunSheetPanel'
import {
  MOCK_EXERCISE_ID,
  personaFixture,
  renderStaff,
  resetRunSheetWorld,
  seedStoredSheet,
  sheetFixture,
  useFixedClock,
} from './runSheetTestKit'

// Full-panel renders (MUI + emotion + the exercise context) are slow on a loaded CI box.
vi.setConfig({ testTimeout: 30_000 })

const FLOOD = 'mock-media-canned-flood'
const VIDEO = 'mock-media-canned-video'

beforeEach(() => {
  resetRunSheetWorld()
  useFixedClock()
  resetTelemetryBuffer()
  postStore.resetForTests()
})
afterEach(() => {
  vi.restoreAllMocks()
  resetMockMediaRegistry()
  resetRunSheetWorld()
  postStore.resetForTests()
})

describe('BeatEditor with the real MediaLibraryPicker (no mock)', () => {
  it('renders the picker\'s own grid and attaches a clicked tile through onChange', async () => {
    const user = userEvent.setup({ delay: null })
    const library = new Map<string, StaffMediaAssetView>(
      listMockMedia().map(found => [found.id, found] as const),
    )
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <ThemeProvider theme={cobraTheme}>
        <QueryClientProvider client={client}>
          <ExerciseContextProvider>
            <BeatEditor
              data={sheetFixture([])}
              personas={[personaFixture('FulcoEM')]}
              library={library}
              onSave={vi.fn()}
              onCancel={vi.fn()}
            />
          </ExerciseContextProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    )
    const dialog = await screen.findByRole('dialog', { name: 'New beat' })

    // The editor's kind is "image", so the real picker is locked to images: 3 canned tiles.
    const picker = await within(dialog).findByTestId('media-library-picker')
    const tiles = await within(picker).findAllByTestId('media-tile')
    expect(tiles).toHaveLength(3)

    const flood = tiles.find(tile => tile.dataset.mediaId === FLOOD)
    if (flood === undefined) throw new Error('the flood tile is not in the real picker')
    await user.click(flood)

    // The editor now lists the attached asset by file name and asks for its alt text.
    expect(await within(dialog).findByText(/flood-main-street\.svg \(image\)/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Description \(alt text\) for flood-main-street\.svg/))
      .toBeInTheDocument()
    expect(within(dialog).queryByTestId('media-missing-note')).toBeNull()
  })
})

describe('RunSheetPanel + the real picker: an asset the "All" list does not hold', () => {
  /** `GET /staff/media`: the "All" list omits the video; the Videos filter returns it. */
  function stubLibraryWithoutVideoInAll() {
    const original = api.get.bind(api)
    return vi.spyOn(api, 'get').mockImplementation((url, config) => {
      if (url !== '/staff/media') return original(url, config)
      const kind = (config?.params as { kind?: 'image' | 'video' } | undefined)?.kind
      const rows = kind === undefined ? listMockMedia().filter(found => found.kind !== 'video') : listMockMedia(kind)
      return Promise.resolve({ data: rows, status: 200, statusText: 'OK', headers: {}, config: config ?? {} } as never)
    })
  }

  it('resolves a video picked under the Videos filter, saves it, and reopens it as a video', async () => {
    stubLibraryWithoutVideoInAll()
    seedStoredSheet(MOCK_EXERCISE_ID, sheetFixture([]))
    const user = userEvent.setup({ delay: null })
    renderStaff(<RunSheetPanel />)
    const panel = await screen.findByTestId('run-sheet-panel')
    await waitFor(() => expect(panel).toHaveAttribute('data-personas', 'ready'))

    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    const dialog = await screen.findByRole('dialog', { name: 'New beat' })
    await user.type(within(dialog).getByLabelText(/^Title/), 'Update video')
    await user.selectOptions(within(dialog).getByLabelText(/^Persona/), 'FulcoEM')
    await user.type(within(dialog).getByLabelText('Text'), 'Watch the water update.')
    await user.click(within(dialog).getByRole('radio', { name: 'One video' }))

    // The real picker, locked to Videos: its own query (kind=video) holds the clip.
    const tile = await waitFor(() => {
      const found = within(dialog).getAllByTestId('media-tile')
        .find(candidate => candidate.dataset.mediaId === VIDEO)
      if (found === undefined) throw new Error('video tile not listed yet')
      return found
    })
    await user.click(tile)

    // Not in the panel's "All" list, yet resolved (file name + kind), with no missing note.
    expect(await within(dialog).findByText(/water-update\.mp4 \(video\)/)).toBeInTheDocument()
    expect(within(dialog).queryByTestId('media-missing-note')).toBeNull()

    await user.type(
      within(dialog).getByLabelText(/Description \(alt text\) for water-update\.mp4/),
      'A short clip of the water treatment plant',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Save beat' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

    // The row summarises it as a video, and carries no "may be refused" media warning.
    const row = screen.getAllByTestId(/^beat-row-/)
      .find(candidate => candidate.textContent?.includes('Update video'))
    if (row === undefined) throw new Error('the saved beat row is missing')
    expect(row).toHaveTextContent('1 video')
    expect(row.textContent).not.toMatch(/not in this exercise's media library/i)

    // Reopened (E on the selected row), it is still a VIDEO beat: the saved id resolved, so
    // the editor knew its kind (otherwise `draftFromBeat` would have called it images).
    await user.click(row)
    await user.keyboard('e')
    const reopened = await screen.findByRole('dialog', { name: 'Edit beat' })
    expect(within(reopened).getByRole('radio', { name: 'One video' })).toBeChecked()
    expect(within(reopened).queryByTestId('media-missing-note')).toBeNull()
  })
})
