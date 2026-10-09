/**
 * features/controller/runSheet/media/InjectMediaField.test.tsx
 * ---------------------------------------------------------------------------
 * The ONE media adapter of the run-sheet editor (inject-queue story 07; C1's
 * `MediaLibraryPicker` would be imported in this module alone). It now reads F0's REAL
 * library hook (`useMediaLibrary`, answered by the mock media registry: three images and one
 * video), under the real exercise + query providers:
 *  - the LIBRARY is a compact list: thumbnail, file name, kind, an Attach button per row;
 *  - the ATTACHED list shows the thumbnail, file name, kind, the id and a REQUIRED alt field;
 *  - the RULE is enforced from the asset KIND: <= 4 images, or ONE video alone, never mixed —
 *    each blocked Attach is disabled with its reason shown as TEXT;
 *  - "Use media id" reveals the paste-an-id fallback (an unknown kind still counts to the limit);
 *  - alt text is never optional (NFR-001); removing one entry keeps the others' alt;
 *  - loading / error / empty library states; read-only hides the library and disables fields;
 *  - only safe image URLs render as thumbnails.
 */
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import type { AxiosRequestConfig } from 'axios'
import { api } from '@/core/services/api'
import {
  registerMockMedia,
  resetMockMediaRegistry,
  type StaffMediaAssetView,
} from '@/core/media'
import { InjectMediaField, type InjectMediaValue } from './InjectMediaField'
import { renderRunSheet } from '../runSheetTestHarness'

const FLOOD = 'mock-media-canned-flood'
const PLANT = 'mock-media-canned-plant'
const SIGN = 'mock-media-canned-sign'
const VIDEO = 'mock-media-canned-video'

function Harness({
  initial = [],
  disabled,
  errors,
  onValue,
}: {
  initial?: InjectMediaValue[]
  disabled?: boolean
  errors?: Record<string, string>
  onValue?: (media: InjectMediaValue[]) => void
}) {
  const [media, setMedia] = useState<InjectMediaValue[]>(initial)
  return (
    <InjectMediaField
      idPrefix="m"
      media={media}
      disabled={disabled}
      errors={errors}
      onChange={next => {
        setMedia(next)
        onValue?.(next)
      }}
    />
  )
}

async function mountField(props: Parameters<typeof Harness>[0] = {}) {
  const utils = renderRunSheet(<Harness {...props} />)
  await screen.findByTestId('media-field', undefined, { timeout: 5000 })
  return utils
}

/** Waits for the library list, then returns the row of `fileName`. */
async function libraryRow(fileName: string): Promise<HTMLElement> {
  const rows = await screen.findAllByTestId('media-library-item')
  const row = rows.find(r => within(r).queryByText(fileName) !== null)
  if (!row) throw new Error(`no library row ${fileName}`)
  return row
}

const attach = async (fileName: string): Promise<void> => {
  fireEvent.click(within(await libraryRow(fileName)).getByTestId('media-attach'))
}

/** Answers the library request (`GET /staff/media`) with `handler`; every other request is real. */
function stubLibrary(handler: (real: () => Promise<unknown>) => Promise<unknown> | unknown): void {
  const realGet = api.get.bind(api)
  vi.spyOn(api, 'get').mockImplementation((async (url: string, config?: AxiosRequestConfig) =>
    url === '/staff/media' ? handler(() => realGet(url, config)) : realGet(url, config)) as never)
}

const extraImage = (n: number): StaffMediaAssetView => ({
  id: `extra-image-${n}`,
  kind: 'image',
  url: `/mock-media/photos/extra-${n}.svg`,
  fileName: `extra-${n}.svg`,
  uploadedAtScenario: `2033-09-04T13:0${n}:00.000Z`,
})

beforeEach(() => {
  resetMockMediaRegistry()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMockMediaRegistry()
})

describe('InjectMediaField: the library list', () => {
  it('lists the library with file name, kind and a thumbnail (a video shows its poster)', async () => {
    await mountField()
    const rows = await screen.findAllByTestId('media-library-item')
    expect(rows).toHaveLength(4)

    const flood = await libraryRow('flood-main-street.svg')
    expect(flood).toHaveTextContent('Image')
    expect(flood.querySelector('img')).toHaveAttribute('src', '/mock-media/photos/flood-main-street.svg')

    const video = await libraryRow('water-update.mp4')
    expect(video).toHaveTextContent('Video')
    expect(video.querySelector('img')).toHaveAttribute('src', '/mock-media/video/water-update.poster.svg')
    // Thumbnails are decoration: the alt text a controller writes is the one that ships.
    expect(video.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('states the rule and that alt text is required', async () => {
    await mountField()
    expect(screen.getByText(/up to 4 images or 1 video/)).toBeInTheDocument()
    expect(screen.getByText(/Alt text is required/)).toBeInTheDocument()
  })

  it('shows a loading state, then the list', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    stubLibrary(async real => {
      await gate
      return real()
    })
    await mountField()
    expect(await screen.findByTestId('media-library-loading')).toHaveTextContent('Loading the media library')
    await act(async () => release())
    expect(await screen.findAllByTestId('media-library-item')).toHaveLength(4)
  })

  it('says so when the library cannot be read, and the paste fallback still works', async () => {
    stubLibrary(() => {
      throw new Error('boom')
    })
    let latest: InjectMediaValue[] = []
    await mountField({ onValue: m => (latest = m) })
    expect(await screen.findByTestId('media-library-error')).toHaveTextContent('unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Use media id' }))
    fireEvent.change(screen.getByLabelText('Add media id'), { target: { value: 'typed-id' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add media' }))
    expect(latest).toEqual([{ mediaId: 'typed-id', alt: '' }])
  })

  it('says so when the library is empty', async () => {
    stubLibrary(() => ({ data: [] }))
    await mountField()
    expect(await screen.findByTestId('media-library-empty')).toBeInTheDocument()
  })

  it('does not render an unsafe thumbnail URL (only http(s), a same-origin path or a blob)', async () => {
    registerMockMedia({
      id: 'evil',
      kind: 'image',
      url: 'javascript:alert(1)',
      fileName: 'evil.svg',
      uploadedAtScenario: '2033-09-04T15:00:00.000Z',
    })
    await mountField()
    const row = await libraryRow('evil.svg')
    expect(row.querySelector('img')).toBeNull()
  })
})

describe('InjectMediaField: attaching from the library', () => {
  it('attaches an asset with an EMPTY alt the controller must fill (never defaulted)', async () => {
    let latest: InjectMediaValue[] = []
    await mountField({ onValue: m => (latest = m) })
    await attach('flood-main-street.svg')

    expect(latest).toEqual([{ mediaId: FLOOD, alt: '' }])
    const entry = screen.getByTestId('media-entry')
    expect(within(entry).getByTestId('media-name')).toHaveTextContent('flood-main-street.svg')
    expect(within(entry).getByTestId('media-kind')).toHaveTextContent('Image')
    expect(within(entry).getByTestId('media-id')).toHaveTextContent(FLOOD)
    expect(within(entry).getByTestId('media-thumb').querySelector('img')).not.toBeNull()
    expect(screen.getByLabelText(/^Alt text for flood-main-street.svg/)).toHaveValue('')

    fireEvent.change(screen.getByLabelText(/^Alt text for flood-main-street.svg/), {
      target: { value: 'Water over Main Street' },
    })
    expect(latest).toEqual([{ mediaId: FLOOD, alt: 'Water over Main Street' }])
  })

  it('an attached asset cannot be attached twice (its row says so)', async () => {
    await mountField({ initial: [{ mediaId: FLOOD, alt: 'x' }] })
    const row = await libraryRow('flood-main-street.svg')
    expect(within(row).getByTestId('media-attach')).toBeDisabled()
    expect(within(row).getByTestId('media-reason')).toHaveTextContent('Already attached')
  })
})

describe('InjectMediaField: the rule, from the asset kind (<= 4 images OR 1 video, never mixed)', () => {
  it('an attached VIDEO blocks everything else: "A video must be the only attachment"', async () => {
    await mountField({ initial: [{ mediaId: VIDEO, alt: 'a clip' }] })
    for (const name of ['flood-main-street.svg', 'water-plant.svg', 'boil-advisory-sign.svg']) {
      const row = await libraryRow(name)
      expect(within(row).getByTestId('media-attach')).toBeDisabled()
      expect(within(row).getByTestId('media-reason')).toHaveTextContent('A video must be the only attachment')
    }
  })

  it('an attached IMAGE blocks a video: "A video can\'t be mixed with other media"', async () => {
    await mountField({ initial: [{ mediaId: FLOOD, alt: 'x' }] })
    const video = await libraryRow('water-update.mp4')
    expect(within(video).getByTestId('media-attach')).toBeDisabled()
    expect(within(video).getByTestId('media-reason')).toHaveTextContent("can't be mixed")
    // ...while another image is still fine.
    expect(within(await libraryRow('water-plant.svg')).getByTestId('media-attach')).toBeEnabled()
  })

  it('a video can be attached when nothing else is', async () => {
    let latest: InjectMediaValue[] = []
    await mountField({ onValue: m => (latest = m) })
    await attach('water-update.mp4')
    expect(latest).toEqual([{ mediaId: VIDEO, alt: '' }])
  })

  it('stops at 4 images: the rest are disabled with "Limit of 4 reached"', async () => {
    registerMockMedia(extraImage(1))
    registerMockMedia(extraImage(2))
    await mountField({
      initial: [FLOOD, PLANT, SIGN, 'extra-image-1'].map(id => ({ mediaId: id, alt: 'a' })),
    })
    const spare = await libraryRow('extra-2.svg')
    expect(within(spare).getByTestId('media-attach')).toBeDisabled()
    expect(within(spare).getByTestId('media-reason')).toHaveTextContent('Limit of 4 reached')
  })

  it('removing an attachment frees the rule again', async () => {
    await mountField({ initial: [{ mediaId: FLOOD, alt: 'x' }] })
    const video = await libraryRow('water-update.mp4')
    expect(within(video).getByTestId('media-attach')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove media flood-main-street.svg' }))
    await waitFor(() => expect(within(video).getByTestId('media-attach')).toBeEnabled())
  })
})

describe('InjectMediaField: "Use media id" (paste an id)', () => {
  it('hides the paste box behind a toggle', async () => {
    await mountField()
    expect(screen.queryByLabelText('Add media id')).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Use media id' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Add media id')).toBeInTheDocument()
  })

  it('Enter adds a trimmed id; an id not in the library shows as "Not in the library"', async () => {
    await mountField()
    fireEvent.click(screen.getByRole('button', { name: 'Use media id' }))
    const input = screen.getByLabelText('Add media id')
    fireEvent.change(input, { target: { value: '  m-7  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getByTestId('media-id')).toHaveTextContent('m-7')
    expect(screen.getByTestId('media-kind')).toHaveTextContent('Not in the library')
    expect(screen.getByLabelText('Add media id')).toHaveValue('')
  })

  it('a pasted id that IS in the library resolves to its file name and kind', async () => {
    await mountField()
    fireEvent.click(screen.getByRole('button', { name: 'Use media id' }))
    fireEvent.change(screen.getByLabelText('Add media id'), { target: { value: PLANT } })
    fireEvent.click(screen.getByRole('button', { name: 'Add media' }))
    expect(screen.getByTestId('media-name')).toHaveTextContent('water-plant.svg')
    expect(screen.getByTestId('media-kind')).toHaveTextContent('Image')
  })

  it('an empty id cannot be added; a duplicate is refused with a message', async () => {
    await mountField({ initial: [{ mediaId: 'm1', alt: 'x' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Use media id' }))
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Add media id'), { target: { value: 'm1' } })
    expect(screen.getByText('That media is already attached')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
  })

  it('an unknown-kind id counts toward the limit and cannot sit next to a video', async () => {
    await mountField({ initial: ['a', 'b', 'c', 'd'].map(id => ({ mediaId: id, alt: 'x' })) })
    fireEvent.click(screen.getByRole('button', { name: 'Use media id' }))
    fireEvent.change(screen.getByLabelText('Add media id'), { target: { value: 'e' } })
    expect(screen.getByTestId('m-add-media-error')).toHaveTextContent('Limit of 4 reached')
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
  })

  it('an unknown-kind id cannot be pasted next to an attached video', async () => {
    await mountField({ initial: [{ mediaId: VIDEO, alt: 'a clip' }] })
    fireEvent.click(screen.getByRole('button', { name: 'Use media id' }))
    fireEvent.change(screen.getByLabelText('Add media id'), { target: { value: 'whatever' } })
    expect(screen.getByTestId('m-add-media-error')).toHaveTextContent(
      'A video must be the only attachment',
    )
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
  })
})

describe('InjectMediaField: alt text is required, removal, read-only', () => {
  it('removing one entry keeps the alt text of the others', async () => {
    let latest: InjectMediaValue[] = []
    await mountField({
      initial: [
        { mediaId: 'm1', alt: 'first alt' },
        { mediaId: 'm2', alt: 'second alt' },
      ],
      onValue: m => (latest = m),
    })
    fireEvent.click(screen.getByRole('button', { name: 'Remove media m1' }))
    expect(latest).toEqual([{ mediaId: 'm2', alt: 'second alt' }])
    expect(screen.getByLabelText(/^Alt text for m2/)).toHaveValue('second alt')
  })

  it('shows an alt error on that entry alt field, and a list-level error', async () => {
    await mountField({
      initial: [{ mediaId: 'm1', alt: '' }],
      errors: { 'media.0.alt': 'Alt text is required', media: 'At most 4 media per post' },
    })
    expect(screen.getByTestId('m-alt-0-error')).toHaveTextContent('Alt text is required')
    expect(screen.getByLabelText(/^Alt text for m1/)).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByTestId('m-media-error')).toHaveTextContent('At most 4 media per post')
  })

  it('counts the alt text in code points out of 1000', async () => {
    await mountField({ initial: [{ mediaId: 'm1', alt: 'hi \u{1F600}' }] })
    expect(screen.getByText('4/1000')).toBeInTheDocument()
  })

  it('read-only: no library, no toggle; alt and remove are disabled', async () => {
    await mountField({ disabled: true, initial: [{ mediaId: 'm1', alt: 'x' }] })
    expect(screen.queryByTestId('media-library')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Use media id' })).toBeNull()
    expect(screen.getByLabelText(/^Alt text for m1/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove media m1' })).toBeDisabled()
  })
})
