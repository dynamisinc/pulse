/**
 * features/social/components/Composer.attach.test.tsx
 * ---------------------------------------------------------------------------
 * The composer's REAL attach tray, through the rendered DOM (demo-polish F4, story
 * 13 "Attach becomes real"; SOC-001, NFR-001, NFR-004), with a controllable
 * stand-in for the upload client (`@/test/fakeMediaUploader`):
 *
 *  - up to 4 images OR 1 video: each pick becomes a tray row with a preview, a
 *    REQUIRED labelled description, a `role="progressbar"` with a live value while
 *    it uploads, "Uploaded" when done, and Cancel / Remove;
 *  - Post is disabled until every row is uploaded AND described, and a sentence says
 *    what is outstanding (a disabled button is never left unexplained);
 *  - validation: unsupported type (with the "MP4 (H.264)" hint), oversize, mixed
 *    image + video, a fifth photo, a second video — announced as alerts, tray
 *    untouched; the old "Inline video is coming soon" message is GONE;
 *  - failures are words + icon in an alert; the failed row must be removed;
 *  - publishing sends the described media and the post appears; a stored `<script>` /
 *    `<img onerror>` typed into a description stays inert text;
 *  - keyboard (NFR-001): Enter in a description field does NOT submit the form, and
 *    removing / cancelling a row moves focus to a neighbouring row's control, or the
 *    attach button once the tray is empty.
 *
 * jsdom has no `URL.createObjectURL`, so thumbnails are asserted with a stub that is
 * installed for the one test that needs it.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { MediaUploadError, MEDIA_ERROR_TEXT, uploadPickedMedia } from '@/core/media'
import { resetTelemetryBuffer } from '@/core/telemetry'
import type { ParticipantPostView } from '@/features/social'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { Composer } from './Composer'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'

vi.mock('@/core/media', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

let uploader: FakeUploader

async function renderComposer(onPosted?: (view: ParticipantPostView) => void) {
  const utils = render(
    <ExerciseContextProvider>
      <SessionProvider>
        <Composer {...(onPosted !== undefined ? { onPosted } : {})} />
      </SessionProvider>
    </ExerciseContextProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('composer')).toBeInTheDocument())
  return utils
}

/** Picks files via the hidden input, bypassing its `accept` filter (the code guard is tested). */
function pick(...files: File[]) {
  fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files } })
}

/** The sentence that says why Post is disabled while a description is missing. */
const ADD_DESCRIPTION = /add a description to every photo or video/i

const png = (name: string) => fakeFile(name, 'image/png')
const mp4 = (name: string) => fakeFile(name, 'video/mp4')

beforeEach(() => {
  resetTelemetryBuffer()
  uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetTelemetryBuffer()
})

describe('Composer attach — the tray row', () => {
  it('offers photos AND video in the picker, behind a labelled button', async () => {
    await renderComposer()

    expect(screen.getByRole('button', { name: 'Add photos or video' })).toBeInTheDocument()
    const input = screen.getByTestId('composer-file-input')
    expect(input).toHaveAttribute('accept', expect.stringContaining('image/png'))
    expect(input).toHaveAttribute('accept', expect.stringContaining('video/mp4'))
    expect(input).toHaveAttribute('multiple')
  })

  it('shows a row with a required, labelled description and a live progress bar while uploading', async () => {
    await renderComposer()

    pick(png('flood.png'))

    const row = await screen.findByTestId('composer-attachment')
    const alt = within(row).getByLabelText('Describe photo (required)')
    expect(alt).toBeRequired()
    expect(alt).toHaveAttribute('aria-required', 'true')

    const bar = within(row).getByRole('progressbar', { name: 'Uploading flood.png' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '0')

    uploader.byName('flood.png').progress(0.5)
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'))
    expect(within(row).getByText('50%')).toBeInTheDocument()
  })

  it('replaces the progress bar with "Uploaded" when the upload completes', async () => {
    await renderComposer()
    pick(png('flood.png'))
    const row = await screen.findByTestId('composer-attachment')

    uploader.byName('flood.png').resolve()

    await waitFor(() => expect(within(row).getByText('Uploaded')).toBeInTheDocument())
    expect(within(row).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(row).toHaveAttribute('data-status', 'ready')
  })

  it('numbers the descriptions when there are several rows', async () => {
    await renderComposer()

    pick(png('a.png'), png('b.png'))

    expect(await screen.findByLabelText('Describe photo 1 (required)')).toBeInTheDocument()
    expect(screen.getByLabelText('Describe photo 2 (required)')).toBeInTheDocument()
  })

  it('treats a video as a video: "Describe video", a Video badge, one at a time', async () => {
    await renderComposer()

    pick(mp4('clip.mp4'))

    const row = await screen.findByTestId('composer-attachment')
    expect(within(row).getByLabelText('Describe video (required)')).toBeInTheDocument()
    expect(within(row).getByText('Video')).toBeInTheDocument()
  })

  it('shows a thumbnail made from the picked file (decorative: the description is the alt)', async () => {
    const created: string[] = []
    const createObjectURL = vi.fn((_blob: Blob) => {
      const url = `blob:thumb-${created.length}`
      created.push(url)
      return url
    })
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
    try {
      await renderComposer()
      pick(png('flood.png'))
      const row = await screen.findByTestId('composer-attachment')

      const img = await waitFor(() => {
        const found = row.querySelector('img')
        if (found === null) throw new Error('no thumbnail yet')
        return found
      })
      expect(img).toHaveAttribute('src', created[0])
      // The thumbnail is decorative - the description field is the text alternative.
      expect(img).toHaveAttribute('alt', '')

      // Removing the row revokes the object URL it made.
      uploader.byName('flood.png').resolve()
      await within(row).findByText('Uploaded')
      await userEvent.setup().click(within(row).getByRole('button', { name: 'Remove flood.png' }))
      expect(revokeObjectURL).toHaveBeenCalledWith(created[0])
    } finally {
      Reflect.deleteProperty(URL, 'createObjectURL')
      Reflect.deleteProperty(URL, 'revokeObjectURL')
    }
  })
})

describe('Composer attach — Post is gated (NFR-001: alt text is mandatory)', () => {
  it('stays disabled until the upload is done AND described, saying what is missing', async () => {
    const user = userEvent.setup()
    await renderComposer()
    const post = screen.getByRole('button', { name: 'Post' })

    await user.type(screen.getByLabelText('Post text'), 'Photo from the plant.')
    expect(post).toBeEnabled()

    pick(png('plant.png'))
    await screen.findByTestId('composer-attachment')
    // Uploading: disabled, and the reason is in words.
    expect(post).toBeDisabled()
    expect(screen.getByText(/waiting for your uploads to finish/i)).toBeInTheDocument()

    uploader.byName('plant.png').resolve()
    await waitFor(() => expect(screen.getByText(ADD_DESCRIPTION)).toBeInTheDocument())
    // Uploaded but undescribed: still disabled.
    expect(post).toBeDisabled()
    expect(post).toHaveAccessibleDescription(/add a description/i)

    await user.type(screen.getByLabelText('Describe photo (required)'), 'The plant entrance')
    expect(post).toBeEnabled()
    expect(screen.queryByText(/add a description/i)).not.toBeInTheDocument()
  })

  it('marks an emptied description invalid (in words and aria), not by colour alone', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('plant.png'))
    uploader.byName('plant.png').resolve()
    const alt = await screen.findByLabelText('Describe photo (required)')

    await user.click(alt)
    await user.tab()

    expect(alt).toHaveAttribute('aria-invalid', 'true')
    expect(await screen.findByText(ADD_DESCRIPTION)).toBeInTheDocument()
  })

  it('does not accept a description that is only markup', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('plant.png'))
    uploader.byName('plant.png').resolve()
    const alt = await screen.findByLabelText('Describe photo (required)')

    await user.click(alt)
    await user.paste('<script>alert(1)</script>')

    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })
})

describe('Composer attach — cancel, remove, failure', () => {
  it('Cancel aborts an upload in flight and removes the row', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('flood.png'))
    const row = await screen.findByTestId('composer-attachment')

    await user.click(within(row).getByRole('button', { name: 'Cancel upload of flood.png' }))

    expect(uploader.byName('flood.png').aborted).toBe(true)
    expect(screen.queryByTestId('composer-media')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('Remove drops an uploaded row', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('a.png'), png('b.png'))
    uploader.byName('a.png').resolve()
    uploader.byName('b.png').resolve()
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Remove a.png' }))

    expect(screen.getAllByTestId('composer-attachment')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Remove a.png' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove b.png' })).toBeInTheDocument()
  })

  it('a failed upload is announced with its in-fiction message and blocks Post until removed', async () => {
    const user = userEvent.setup()
    await renderComposer()
    await user.type(screen.getByLabelText('Post text'), 'Words are ready.')
    pick(png('flood.png'))
    const row = await screen.findByTestId('composer-attachment')

    uploader.byName('flood.png').fail(new MediaUploadError(MEDIA_ERROR_TEXT.rateLimited, 429))

    const alert = await within(row).findByRole('alert')
    expect(alert).toHaveTextContent(MEDIA_ERROR_TEXT.rateLimited)
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByText(/remove the attachment that failed/i)).toBeInTheDocument()

    await user.click(within(row).getByRole('button', { name: 'Remove flood.png' }))
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
  })
})

describe('Composer attach — validation messages (NFR-004)', () => {
  it('refuses an unsupported type, naming the file and the "MP4 (H.264)" hint', async () => {
    await renderComposer()

    pick(fakeFile('notes.pdf', 'application/pdf'))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('notes.pdf')
    expect(alert).toHaveTextContent('MP4 (H.264)')
    expect(screen.queryByTestId('composer-media')).not.toBeInTheDocument()
    expect(uploader.pending).toHaveLength(0)
  })

  it('refuses an oversized image and video with the limit in the message', async () => {
    await renderComposer()

    pick(fakeFile('huge.png', 'image/png', 6 * 1024 * 1024))
    expect(await screen.findByRole('alert')).toHaveTextContent(/too large \(5 MB max\)/i)

    pick(fakeFile('huge.mp4', 'video/mp4', 101 * 1024 * 1024))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/too large \(100 MB max\)/i))
    expect(uploader.pending).toHaveLength(0)
  })

  it('refuses a mixed image + video pick with a clear message and attaches nothing', async () => {
    await renderComposer()

    pick(png('a.png'), mp4('clip.mp4'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/up to 4 photos or 1 video, not both/i)
    expect(screen.queryByTestId('composer-media')).not.toBeInTheDocument()
    expect(uploader.pending).toHaveLength(0)
  })

  it('refuses a video when photos are already attached, and a fifth photo, and a second video', async () => {
    await renderComposer()
    pick(png('1.png'), png('2.png'), png('3.png'), png('4.png'))
    await waitFor(() => expect(screen.getAllByTestId('composer-attachment')).toHaveLength(4))

    pick(png('5.png'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/up to 4 photos/i)

    pick(mp4('clip.mp4'))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/not both/i))
    expect(screen.getAllByTestId('composer-attachment')).toHaveLength(4)
  })

  it('refuses a second video', async () => {
    await renderComposer()
    pick(mp4('a.mp4'))
    await screen.findByTestId('composer-attachment')

    pick(mp4('b.mp4'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/only 1 video/i)
  })

  it('no longer says video is "coming soon" anywhere', async () => {
    await renderComposer()
    pick(mp4('clip.mp4'))
    await screen.findByTestId('composer-attachment')

    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/isn.t available yet/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('Composer attach — publishing media (mock mode)', () => {
  it('publishes the described photo; the post carries it and the draft + tray clear', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderComposer(onPosted)

    await user.type(screen.getByLabelText('Post text'), 'Water is clear at the plant.')
    pick(png('plant.png'))
    uploader.byName('plant.png').resolve()
    await user.type(await screen.findByLabelText('Describe photo (required)'), 'The plant entrance')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    expect(onPosted).toHaveBeenCalledTimes(1)
    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.media?.[0]).toMatchObject({ kind: 'image', alt: 'The plant entrance' })
    expect(screen.queryByTestId('composer-media')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Post text')).toHaveValue('')
    // A polite status announces it to assistive tech.
    expect(screen.getByText('Post published.')).toBeInTheDocument()
  })

  it('a <script>/<img onerror> typed into a description stays inert text and never ships', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderComposer(onPosted)

    pick(png('plant.png'))
    uploader.byName('plant.png').resolve()
    const alt = await screen.findByLabelText('Describe photo (required)')
    await user.click(alt)
    await user.paste('<img src=x onerror="window.__altXss = true">Plant <script>window.__altXss2 = 1</script>gate')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    expect(onPosted.mock.calls[0]?.[0].media?.[0]?.alt).toBe('Plant gate')
    expect((window as unknown as { __altXss?: boolean }).__altXss).toBeUndefined()
    expect((window as unknown as { __altXss2?: number }).__altXss2).toBeUndefined()
    // The field itself never rendered the markup as elements.
    expect(document.querySelector('img[onerror]')).toBeNull()
  })
})

describe('Composer attach — keyboard (NFR-001)', () => {
  it('Enter in a description field does not submit the form', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderComposer(onPosted)
    await user.type(screen.getByLabelText('Post text'), 'Ready to go.')
    pick(png('plant.png'))
    uploader.byName('plant.png').resolve()
    const alt = await screen.findByLabelText('Describe photo (required)')

    // A complete, publishable draft: Enter in the description must still not post it.
    await user.type(alt, 'The plant entrance{Enter}')

    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    expect(onPosted).not.toHaveBeenCalled()
    expect(alt).toHaveValue('The plant entrance')
    expect(screen.getByTestId('composer-media')).toBeInTheDocument()
  })

  it('removing a row moves focus to the NEXT row\'s control', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('a.png'), png('b.png'), png('c.png'))
    for (const name of ['a.png', 'b.png', 'c.png']) uploader.byName(name).resolve()
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(3))

    await user.click(screen.getByRole('button', { name: 'Remove a.png' }))

    expect(screen.getByRole('button', { name: 'Remove b.png' })).toHaveFocus()
  })

  it('removing the LAST row moves focus to the previous row\'s control', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('a.png'), png('b.png'))
    uploader.byName('a.png').resolve()
    uploader.byName('b.png').resolve()
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Remove b.png' }))

    expect(screen.getByRole('button', { name: 'Remove a.png' })).toHaveFocus()
  })

  it('removing the only row moves focus to the attach button', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('a.png'))
    uploader.byName('a.png').resolve()
    await screen.findByText('Uploaded')

    await user.click(screen.getByRole('button', { name: 'Remove a.png' }))

    expect(screen.queryByTestId('composer-media')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add photos or video' })).toHaveFocus()
  })

  it('cancelling an upload in flight also re-homes focus', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('a.png'))
    await screen.findByTestId('composer-attachment')

    await user.click(screen.getByRole('button', { name: 'Cancel upload of a.png' }))

    expect(screen.getByRole('button', { name: 'Add photos or video' })).toHaveFocus()
  })

  it('does not move focus when a row changes for any other reason (upload completes)', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('a.png'))
    const alt = await screen.findByLabelText('Describe photo (required)')
    await user.click(alt)

    uploader.byName('a.png').resolve()
    await screen.findByText('Uploaded')

    expect(alt).toHaveFocus()
  })
})
