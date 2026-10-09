/**
 * features/controller/media/MediaLibraryPicker.test.tsx
 * ---------------------------------------------------------------------------
 * The staff media-library picker (demo-polish C1, story 17 "Attach from the
 * library"; implementation.md section 1.11 FROZEN props), in MOCK mode through the
 * real `useMediaLibrary` (the four canned items):
 *
 *  - tiles show the thumbnail (a video its POSTER + a VIDEO badge), the file name and
 *    `uploadedAtScenario` in SCENARIO time in the exercise zone (COR-053);
 *  - the All / Images / Videos filter; `kind` locks it;
 *  - selection by click and by keyboard (roving tabindex, arrows, Home / End, Space /
 *    Enter), controlled through `selectedIds` / `onChange`, in pick order;
 *  - the limits: `max`, never mixing images and a video, at most 1 video - an
 *    unavailable tile is `aria-disabled` and its reason is spoken in the status line;
 *  - loading / empty / error states, and that no exercise id is sent on the request.
 */
import { useState, type ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosResponse } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import {
  listMockMedia,
  registerMockMedia,
  resetMockMediaRegistry,
} from '@/core/media/mockMediaRegistry'
import { MIXED_MEDIA_MESSAGE, TOO_MANY_VIDEOS_MESSAGE } from './attachmentRules'
import { MediaLibraryPicker, type MediaLibraryPickerProps } from './MediaLibraryPicker'

const FLOOD = 'mock-media-canned-flood'
const PLANT = 'mock-media-canned-plant'
const SIGN = 'mock-media-canned-sign'
const VIDEO = 'mock-media-canned-video'

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

interface HarnessProps {
  kind?: MediaLibraryPickerProps['kind']
  max?: number
  initial?: string[]
  onChange?: (ids: string[]) => void
}

/** Holds the controlled selection the way a real host (the composer) does. */
function Harness({ kind, max = 4, initial = [], onChange }: HarnessProps) {
  const [ids, setIds] = useState<string[]>(initial)
  return (
    <MediaLibraryPicker
      {...(kind !== undefined ? { kind } : {})}
      max={max}
      selectedIds={ids}
      onChange={next => {
        setIds(next)
        onChange?.(next)
      }}
    />
  )
}

async function renderPicker(props: HarnessProps = {}) {
  const utils = render(
    <Providers>
      <Harness {...props} />
    </Providers>,
  )
  await screen.findAllByRole('option')
  return utils
}

/**
 * Replaces ONLY the library request (`GET /staff/media`) - the exercise-context
 * resolver shares the same axios `get` and must keep working.
 */
function stubLibraryRequest(respond: () => Promise<AxiosResponse>) {
  const original = api.get.bind(api)
  return vi.spyOn(api, 'get').mockImplementation((url, config) =>
    url === '/staff/media' ? respond() : original(url, config),
  )
}

/** Focuses an element the way a user's Tab would (inside `act`, so `onFocus` state commits). */
function focusEl(element: HTMLElement | undefined) {
  act(() => element?.focus())
}

const tile = (id: string) => {
  const found = screen.getAllByTestId('media-tile').find(el => el.dataset.mediaId === id)
  if (found === undefined) throw new Error(`no tile for ${id}`)
  return found
}

afterEach(() => {
  resetMockMediaRegistry()
  vi.restoreAllMocks()
})

describe('MediaLibraryPicker — the frozen props (implementation.md section 1.11)', () => {
  it('is exactly { kind?, max, selectedIds, onChange }', () => {
    type Keys = keyof MediaLibraryPickerProps
    const exhaustive: Record<Keys, true> = {
      kind: true,
      max: true,
      selectedIds: true,
      onChange: true,
    }
    expect(Object.keys(exhaustive).sort()).toEqual(['kind', 'max', 'onChange', 'selectedIds'])
  })
})

describe('MediaLibraryPicker — the grid', () => {
  it('lists the library as an accessible multi-select listbox', async () => {
    await renderPicker()

    const grid = screen.getByRole('listbox', { name: 'Media library' })
    expect(grid).toHaveAttribute('aria-multiselectable', 'true')
    expect(within(grid).getAllByRole('option')).toHaveLength(4)
  })

  it('shows each tile\'s file name and its upload time in SCENARIO time in the exercise zone', async () => {
    await renderPicker()

    const flood = tile(FLOOD)
    expect(within(flood).getByText('flood-main-street.svg')).toBeInTheDocument()
    // 12:10Z on 4 Sep 2033 is 8:10 AM in America/New_York (the mock exercise zone).
    const when = within(flood).getByText('Sep 4, 2033, 8:10 AM')
    expect(when.tagName).toBe('TIME')
    expect(when).toHaveAttribute('datetime', '2033-09-04T12:10:00.000Z')
    expect(flood).toHaveAccessibleName(
      'flood-main-street.svg, image, uploaded Sep 4, 2033, 8:10 AM',
    )
  })

  it('shows a video\'s POSTER with a VIDEO badge and its length, never the video file', async () => {
    await renderPicker()

    const video = tile(VIDEO)
    expect(within(video).getByText(/VIDEO 0:04/)).toBeInTheDocument()
    const thumb = video.querySelector('img')
    expect(thumb).toHaveAttribute('src', '/mock-media/video/water-update.poster.svg')
    expect(video.querySelector('video')).toBeNull()
    expect(video).toHaveAccessibleName(/water-update\.mp4, video, 0:04, uploaded/)

    expect(tile(FLOOD).querySelector('img')).toHaveAttribute(
      'src',
      '/mock-media/photos/flood-main-street.svg',
    )
  })

  it('refuses to render an unsafe thumbnail URL (falls back to an icon tile)', async () => {
    const unsafe = {
      data: [{
        id: 'evil',
        kind: 'image',
        url: 'javascript:alert(1)',
        fileName: 'evil.png',
        uploadedAtScenario: '2033-09-04T12:10:00.000Z',
      }],
    }
    stubLibraryRequest(() => Promise.resolve(unsafe as AxiosResponse))

    await renderPicker()

    expect(tile('evil').querySelector('img')).toBeNull()
  })
})

describe('MediaLibraryPicker — the All / Images / Videos filter', () => {
  it('narrows the grid by kind and back', async () => {
    const user = userEvent.setup()
    await renderPicker()

    await user.click(screen.getByRole('radio', { name: 'Images' }))
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))
    expect(screen.getAllByRole('option').every(el => /, image,/.test(el.getAttribute('aria-label') ?? '')))
      .toBe(true)

    await user.click(screen.getByRole('radio', { name: 'Videos' }))
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    expect(screen.getByRole('option')).toHaveAccessibleName(/water-update\.mp4/)

    await user.click(screen.getByRole('radio', { name: 'All' }))
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4))
  })

  it('is locked to the `kind` prop: only that kind is listed and the other options are disabled', async () => {
    await renderPicker({ kind: 'video' })

    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('radio', { name: 'Videos' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Videos' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Images' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'All' })).toBeDisabled()
  })
})

describe('MediaLibraryPicker — selection', () => {
  it('toggles by click, reporting the ids in pick order, with a check + order number', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ onChange })

    await user.click(tile(PLANT))
    await user.click(tile(FLOOD))

    expect(onChange).toHaveBeenNthCalledWith(1, [PLANT])
    expect(onChange).toHaveBeenNthCalledWith(2, [PLANT, FLOOD])
    expect(tile(PLANT)).toHaveAttribute('aria-selected', 'true')
    expect(within(tile(PLANT)).getByTestId('media-tile-order')).toHaveTextContent('1')
    expect(within(tile(FLOOD)).getByTestId('media-tile-order')).toHaveTextContent('2')
    expect(tile(SIGN)).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByTestId('media-library-status')).toHaveTextContent('2 of 4 selected')

    await user.click(tile(PLANT))
    expect(onChange).toHaveBeenLastCalledWith([FLOOD])
    expect(within(tile(FLOOD)).getByTestId('media-tile-order')).toHaveTextContent('1')
  })

  it('reflects a selection it was handed (controlled)', async () => {
    await renderPicker({ initial: [SIGN] })
    expect(tile(SIGN)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('media-library-status')).toHaveTextContent('1 of 4 selected')
  })
})

describe('MediaLibraryPicker — keyboard (NFR-001)', () => {
  it('is ONE tab stop (roving tabindex) that moves with the arrow keys', async () => {
    const user = userEvent.setup()
    await renderPicker()

    const options = screen.getAllByRole('option')
    expect(options.filter(el => el.getAttribute('tabindex') === '0')).toHaveLength(1)
    expect(options[0]).toHaveAttribute('tabindex', '0')

    focusEl(options[0])
    await user.keyboard('{ArrowRight}')
    expect(options[1]).toHaveFocus()
    expect(options[1]).toHaveAttribute('tabindex', '0')
    expect(options[0]).toHaveAttribute('tabindex', '-1')

    await user.keyboard('{ArrowDown}') // one row (3 columns) down from index 1 -> no row below: stays
    expect(options[1]).toHaveFocus()
    await user.keyboard('{ArrowLeft}{ArrowDown}') // 0 -> 3
    expect(options[3]).toHaveFocus()
    await user.keyboard('{ArrowUp}')
    expect(options[0]).toHaveFocus()
    await user.keyboard('{End}')
    expect(options[3]).toHaveFocus()
    await user.keyboard('{Home}')
    expect(options[0]).toHaveFocus()
  })

  it('toggles the focused tile with Space and with Enter', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ onChange })

    // Newest first: the video (12:40) leads the mock library.
    focusEl(screen.getAllByRole('option')[0])
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith([VIDEO])
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('leaves Ctrl/Cmd+Enter alone so it can fire the host form', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ onChange })

    focusEl(screen.getAllByRole('option')[0])
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('MediaLibraryPicker — limits', () => {
  it('stops at `max`: other tiles become aria-disabled and activating one says why', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ max: 2, onChange })

    await user.click(tile(FLOOD))
    await user.click(tile(PLANT))
    onChange.mockClear()

    expect(tile(SIGN)).toHaveAttribute('aria-disabled', 'true')
    await user.click(tile(SIGN))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('media-library-status')).toHaveTextContent(
      '2 of 2 selected - Limit reached (2). Deselect one to pick another.',
    )

    // A selected tile can still be deselected, which frees a slot.
    await user.click(tile(PLANT))
    expect(onChange).toHaveBeenLastCalledWith([FLOOD])
    expect(tile(SIGN)).not.toHaveAttribute('aria-disabled')
  })

  it('never mixes: with an image picked the video is unavailable, and says so', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ onChange })

    await user.click(tile(FLOOD))
    onChange.mockClear()
    expect(tile(VIDEO)).toHaveAttribute('aria-disabled', 'true')

    await user.click(tile(VIDEO))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('media-library-status')).toHaveTextContent(MIXED_MEDIA_MESSAGE)
  })

  it('takes at most 1 video: with the video picked every image is unavailable', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ onChange })

    await user.click(tile(VIDEO))
    onChange.mockClear()
    expect(tile(FLOOD)).toHaveAttribute('aria-disabled', 'true')
    await user.click(tile(FLOOD))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('media-library-status')).toHaveTextContent(MIXED_MEDIA_MESSAGE)
  })

  it('refuses a second video by the one-video rule even when the host allows more', async () => {
    registerMockMedia({
      id: 'mock-media-second-video',
      kind: 'video',
      url: '/mock-media/video/second.mp4',
      fileName: 'second.mp4',
      uploadedAtScenario: '2033-09-04T12:50:00.000Z',
    })
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ max: 4, onChange })

    await user.click(tile(VIDEO))
    onChange.mockClear()
    expect(tile('mock-media-second-video')).toHaveAttribute('aria-disabled', 'true')

    await user.click(tile('mock-media-second-video'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('media-library-status')).toHaveTextContent(TOO_MANY_VIDEOS_MESSAGE)
  })

  it('remembers the selection\'s kind when the filter hides the selected asset', async () => {
    const user = userEvent.setup()
    await renderPicker()

    await user.click(tile(VIDEO))
    await user.click(screen.getByRole('radio', { name: 'Images' }))
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(3))

    // The video is no longer listed, yet the images stay unavailable (no mixing).
    expect(tile(FLOOD)).toHaveAttribute('aria-disabled', 'true')
  })

  it('with max 1 it is SINGLE-SELECT: a new pick replaces the old one (nothing is ever "at the limit")', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ max: 1, onChange })

    await user.click(tile(FLOOD))
    expect(onChange).toHaveBeenLastCalledWith([FLOOD])
    // The other tiles are NOT unavailable.
    expect(tile(PLANT)).not.toHaveAttribute('aria-disabled')
    expect(tile(VIDEO)).not.toHaveAttribute('aria-disabled')

    await user.click(tile(PLANT))
    expect(onChange).toHaveBeenLastCalledWith([PLANT])
    expect(tile(FLOOD)).toHaveAttribute('aria-selected', 'false')
    expect(tile(PLANT)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('media-library-status')).toHaveTextContent('1 of 1 selected')

    // Replacing works across kinds too (the old selection is gone, so nothing is mixed).
    await user.click(tile(VIDEO))
    expect(onChange).toHaveBeenLastCalledWith([VIDEO])
    expect(tile(PLANT)).toHaveAttribute('aria-selected', 'false')

    // Clicking the selected tile still deselects it.
    await user.click(tile(VIDEO))
    expect(onChange).toHaveBeenLastCalledWith([])
  })

  it('with max 1, Space on another tile replaces the selection from the keyboard', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    await renderPicker({ max: 1, initial: [SIGN], onChange })

    focusEl(tile(FLOOD))
    await user.keyboard(' ')

    expect(onChange).toHaveBeenLastCalledWith([FLOOD])
  })

  it('offers nothing when max is 0 (the host has no room left)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    await renderPicker({ max: 0, onChange })

    await user.click(tile(FLOOD))

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByTestId('media-library-status')).toHaveTextContent(
      'No more media can be added to this post.',
    )
  })
})

describe('MediaLibraryPicker — states and scope', () => {
  it('announces loading, then renders', async () => {
    let release: () => void = () => undefined
    stubLibraryRequest(() => new Promise<AxiosResponse>(resolve => {
      release = () => resolve({ data: listMockMedia() } as AxiosResponse)
    }))
    render(
      <Providers>
        <Harness />
      </Providers>,
    )

    expect(await screen.findByTestId('media-library-loading')).toHaveAttribute('role', 'status')
    release()
    await screen.findAllByRole('option')
    expect(screen.queryByTestId('media-library-loading')).not.toBeInTheDocument()
    // An explicit, generous budget (Gate-2 A L-10): this is the first render in the file to pay
    // for the picker's cold imports, and it timed out at the 5 s default under a loaded full run
    // (it passes alone). 30 s matches the other full-render suites.
  }, 30_000)

  it('says the library is empty', async () => {
    stubLibraryRequest(() => Promise.resolve({ data: [] } as AxiosResponse))
    render(
      <Providers>
        <Harness />
      </Providers>,
    )

    expect(await screen.findByTestId('media-library-empty')).toHaveTextContent(
      'The library is empty. Upload a file to add it here.',
    )
  })

  it('shows an alert with a working Retry when the library cannot be loaded', async () => {
    const user = userEvent.setup()
    const get = stubLibraryRequest(() => Promise.reject(new Error('boom')))
    render(
      <Providers>
        <Harness />
      </Providers>,
    )

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The media library could not be loaded.')

    get.mockRestore()
    await user.click(within(alert).getByRole('button', { name: 'Retry' }))

    expect(await screen.findAllByRole('option')).toHaveLength(4)
  })

  it('sends NO exercise id on the request (scope is the staff session\'s, COR-001)', async () => {
    const get = vi.spyOn(api, 'get')
    await renderPicker()

    const call = get.mock.calls.find(([url]) => url === '/staff/media')
    expect(call).toBeDefined()
    expect(call?.[1]?.params).toEqual({ take: 100 })
    expect(JSON.stringify(call)).not.toMatch(/exerciseId/i)
  })
})
