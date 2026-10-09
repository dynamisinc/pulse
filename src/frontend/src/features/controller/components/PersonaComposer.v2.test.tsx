/**
 * features/controller/components/PersonaComposer.v2.test.tsx
 * ---------------------------------------------------------------------------
 * The v2 composer through the rendered DOM, in MOCK mode with the REAL providers
 * (demo-polish C1, story 17 "Post as persona v2"; CTL-001, NFR-001, NFR-004,
 * COR-053). The upload client is replaced by a controllable stand-in
 * (`@/test/fakeMediaUploader`) at `@/core/media/uploadMedia` - the module
 * `useMediaUpload` calls - so progress / completion / failure / cancel are the
 * test's to trigger; the library picker is the real one over the mock library.
 *
 *  - ATTACH BY UPLOAD: a row per file with a required alt field, a live
 *    `role="progressbar"`, Cancel / Remove; Post stays disabled (and a sentence says
 *    why) until every item is uploaded AND described; mixed / over-limit / unsupported
 *    picks are refused with an alert and leave the tray untouched;
 *  - ATTACH FROM THE LIBRARY: the "From library" panel, a keyboard-operable grid, a
 *    picked video keeps its poster, Esc closes just the picker;
 *  - REPLY: the "Replying to @handle - "excerpt"" banner, its clear (x) control,
 *    `parentPostId` on the created post, the route asked to drop the target after;
 *  - BASELINE: collapsed by default, presets, inline validation that blocks Fire,
 *    seeded counts on the post;
 *  - PREVIEW: a labelled staff frame (author, text, media, "Replying to"), not a card;
 *  - KEYBOARD: Ctrl/Cmd+Enter fires from any control, plain Enter in an input never
 *    submits; the origin line (SIMCELL - MANUAL) is unchanged.
 * Live-mode failure / Retry / single-telemetry coverage is in
 * `PersonaComposer.live.test.tsx`.
 */
import { useState, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { MediaUploadError } from '@/core/media'
import { resetMockMediaRegistry } from '@/core/media/mockMediaRegistry'
import { uploadPickedMedia } from '@/core/media/uploadMedia'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { StaffPersona } from '@/features/personas'
import type { Post, ReplyTarget } from '@/features/social'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { MIXED_MEDIA_MESSAGE, TOO_MANY_IMAGES_MESSAGE } from '../media/attachmentRules'
import { PersonaComposer, type PersonaComposerProps } from './PersonaComposer'

vi.mock('@/core/media/uploadMedia', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media/uploadMedia')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

/** The text field is named by its visible label: "Post as X" / "Reply as X". */
const POST_FIELD = /^(Post|Reply) as Fairhaven Water$/

const PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-mock-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

const REPLY_TARGET: ReplyTarget = {
  postId: 'post-seed-mvega-question',
  authorHandle: 'mvega_fh',
  authorDisplayName: 'Maria Vega',
  excerpt: 'is the water actually safe?? my kids drank tap water this morning omg',
}

const FIXED_NOW = '2033-09-04T14:00:00.000Z'
const CANNED_FLOOD = 'mock-media-canned-flood'
const CANNED_VIDEO = 'mock-media-canned-video'

let uploader: FakeUploader

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

async function renderComposer(props: Partial<PersonaComposerProps> = {}) {
  const utils = render(
    <Providers>
      <PersonaComposer
        activePersona={PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
        {...props}
      />
    </Providers>,
  )
  await waitFor(() => expect(screen.getByTestId('persona-composer')).toBeInTheDocument())
  return utils
}

/** Picks files through the hidden input, bypassing the OS dialog. */
function pick(...files: File[]) {
  fireEvent.change(screen.getByTestId('persona-composer-file-input'), { target: { files } })
}

const png = (name: string) => fakeFile(name, 'image/png')
const mp4 = (name: string) => fakeFile(name, 'video/mp4')

const postButton = () => screen.getByRole('button', { name: 'Post' })
const altField = (name: string) => screen.getByRole('textbox', { name: new RegExp(`Alt text for ${name.replace('.', '\\.')}`) })

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date(FIXED_NOW) })
  resetTelemetryBuffer()
  composeAsPersonaDraftStore.resetForTests()
  resetMockMediaRegistry()
  uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
})

afterEach(() => {
  resetExerciseClock()
})

describe('PersonaComposer v2 — the text field is named by its visible label', () => {
  it('is "Post as <name>" - no aria-label override hiding the visible text', async () => {
    await renderComposer()
    const field = screen.getByRole('textbox', { name: 'Post as Fairhaven Water' })
    expect(field).not.toHaveAttribute('aria-label')
    expect(screen.queryByLabelText('Post text')).not.toBeInTheDocument()
  })

  it('is "Reply as <name>" while a reply target is held', async () => {
    await renderComposer({ replyTo: REPLY_TARGET })
    expect(screen.getByRole('textbox', { name: 'Reply as Fairhaven Water' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Post as Fairhaven Water' })).not.toBeInTheDocument()
  })
})

describe('PersonaComposer v2 — attach by upload', () => {
  it('offers Upload and From library, accepts images AND video, and names the video format', async () => {
    await renderComposer()

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'From library' })).toHaveAttribute('aria-expanded', 'false')
    const input = screen.getByTestId('persona-composer-file-input')
    expect(input).toHaveAttribute('accept', expect.stringContaining('image/png'))
    expect(input).toHaveAttribute('accept', expect.stringContaining('video/mp4'))
    expect(input).toHaveAttribute('multiple')
    expect(screen.getByText(/Video: MP4 \(H\.264\)/)).toBeInTheDocument()
  })

  it('shows a row with a REQUIRED alt field and a live progress bar while uploading', async () => {
    await renderComposer()

    pick(png('flood.png'))

    // Generous: this is the first async wait of a heavy file and the box may be loaded.
    const row = await screen.findByTestId('attachment', undefined, { timeout: 8000 })
    expect(altField('flood.png')).toBeRequired()
    const bar = within(row).getByRole('progressbar', { name: 'Uploading flood.png' })
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    expect(bar).toHaveAttribute('aria-valuenow', '0')

    uploader.byName('flood.png').progress(0.5)
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'))
    expect(within(row).getByText('50%')).toBeInTheDocument()
    expect(within(row).getByText('IMAGE')).toBeInTheDocument()
  })

  it('Cancel aborts the upload, removes the row and returns focus to Upload', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('flood.png'))
    const row = await screen.findByTestId('attachment')

    await user.click(within(row).getByRole('button', { name: 'Cancel upload of flood.png' }))

    expect(uploader.byName('flood.png').aborted).toBe(true)
    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveFocus()
  })

  it('keeps Post disabled - and says why - until every item is uploaded AND described', async () => {
    const user = userEvent.setup()
    await renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Flooding on Main Street.')
    expect(postButton()).toBeEnabled()

    pick(png('flood.png'))
    await screen.findByTestId('attachment')
    expect(postButton()).toBeDisabled()
    expect(screen.getByTestId('publish-blockers')).toHaveTextContent('Wait for the upload to finish.')
    expect(postButton()).toHaveAccessibleDescription(/Wait for the upload to finish/)

    uploader.byName('flood.png').resolve()
    const row = screen.getByTestId('attachment')
    await waitFor(() => expect(within(row).getByText('Uploaded')).toBeInTheDocument())
    expect(within(row).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(postButton()).toBeDisabled()
    expect(screen.getByTestId('publish-blockers')).toHaveTextContent(
      'Add alt text to every image or video.',
    )

    await user.type(altField('flood.png'), 'Water over the curb on Main Street')
    expect(postButton()).toBeEnabled()
    expect(screen.queryByTestId('publish-blockers')).not.toBeInTheDocument()
  })

  it('posts the described upload: media on the post, tray cleared, "Posted" with the scenario time', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Flooding on Main Street.')
    pick(png('flood.png'))
    await screen.findByTestId('attachment')
    const asset = uploader.byName('flood.png').resolve()
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())
    await user.type(altField('flood.png'), '  Water over the curb  ')

    await user.click(postButton())

    expect(onPublished).toHaveBeenCalledTimes(1)
    const post = onPublished.mock.calls[0]?.[0]
    expect(post?.media).toMatchObject([{ id: asset.id, kind: 'image', alt: 'Water over the curb' }])
    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()
    expect(screen.getByLabelText(POST_FIELD)).toHaveValue('')
    // Success: "Posted" + the post's SCENARIO time (14:00Z is 10:00 AM in the exercise zone).
    expect(screen.getByTestId('publish-success')).toHaveTextContent('Posted')
    expect(screen.getByTestId('publish-success-time')).toHaveTextContent('Sep 4, 2033, 10:00 AM')
    // Post disabled itself with the draft: focus moves to the text field for the next post.
    expect(screen.getByLabelText(POST_FIELD)).toHaveFocus()
    expect(screen.queryByTestId('publish-error')).not.toBeInTheDocument()
    // The R-003 origin line is unchanged.
    expect(screen.getByTestId('origin-label')).toHaveTextContent('SIMCELL · MANUAL')
  })

  it('uploads up to four images in parallel, each with its own progress, and refuses a fifth', async () => {
    await renderComposer()

    pick(png('1.png'), png('2.png'), png('3.png'), png('4.png'))
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(4))
    expect(screen.getAllByRole('progressbar')).toHaveLength(4)
    uploader.byName('2.png').progress(0.25)
    await waitFor(() =>
      expect(screen.getByRole('progressbar', { name: 'Uploading 2.png' })).toHaveAttribute('aria-valuenow', '25'),
    )
    expect(screen.getByRole('progressbar', { name: 'Uploading 1.png' })).toHaveAttribute('aria-valuenow', '0')

    pick(png('5.png'))

    expect(screen.getByTestId('attach-error')).toHaveTextContent(TOO_MANY_IMAGES_MESSAGE)
    expect(screen.getAllByTestId('attachment')).toHaveLength(4)
    expect(uploader.pending).toHaveLength(4)
  })

  it('refuses a mixed image + video pick with an alert and leaves the tray untouched', async () => {
    await renderComposer()
    pick(png('flood.png'))
    await screen.findByTestId('attachment')

    pick(mp4('clip.mp4'))

    expect(screen.getByRole('alert')).toHaveTextContent(MIXED_MEDIA_MESSAGE)
    expect(screen.getAllByTestId('attachment')).toHaveLength(1)
    expect(uploader.pending).toHaveLength(1)
  })

  it('refuses an unsupported file with the "MP4 (H.264)" hint, an oversize image, and clears on the next good pick', async () => {
    await renderComposer()

    pick(fakeFile('notes.pdf', 'application/pdf'))
    expect(screen.getByTestId('attach-error')).toHaveTextContent('notes.pdf')
    expect(screen.getByTestId('attach-error')).toHaveTextContent('MP4 (H.264)')

    pick(fakeFile('huge.png', 'image/png', 6 * 1024 * 1024))
    expect(screen.getByTestId('attach-error')).toHaveTextContent(/too large/i)
    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()

    pick(png('ok.png'))
    await screen.findByTestId('attachment')
    expect(screen.queryByTestId('attach-error')).not.toBeInTheDocument()
  })

  it('accepts one video and refuses a second', async () => {
    await renderComposer()
    pick(mp4('a.mp4'))
    const row = await screen.findByTestId('attachment')
    expect(within(row).getByText('VIDEO')).toBeInTheDocument()

    pick(mp4('b.mp4'))

    expect(screen.getByTestId('attach-error')).toHaveTextContent(/only 1 video/i)
    expect(screen.getAllByTestId('attachment')).toHaveLength(1)
  })

  it('shows a failed upload as words + icon in an alert; the row must be removed before posting', async () => {
    const user = userEvent.setup()
    await renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Text.')
    pick(png('flood.png'))
    const row = await screen.findByTestId('attachment')

    uploader.byName('flood.png').fail(new MediaUploadError('Uploads are not available right now.', 503))

    await waitFor(() => expect(within(row).getByRole('alert')).toHaveTextContent('Uploads are not available right now.'))
    expect(row).toHaveAttribute('data-status', 'failed')
    expect(postButton()).toBeDisabled()
    expect(screen.getByTestId('publish-blockers')).toHaveTextContent('Remove the failed upload before posting.')

    await user.click(within(row).getByRole('button', { name: 'Remove flood.png' }))
    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()
    expect(postButton()).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Upload' })).toHaveFocus()
  })

  it('moves focus to a neighbouring row when one of several is removed', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('1.png'), png('2.png'))
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(2))
    uploader.byName('1.png').resolve()
    uploader.byName('2.png').resolve()
    await waitFor(() => expect(screen.getAllByText('Uploaded')).toHaveLength(2))

    await user.click(screen.getByRole('button', { name: 'Remove 1.png' }))

    expect(screen.getByRole('button', { name: 'Remove 2.png' })).toHaveFocus()
  })

  it('keeps a stored <script> typed into alt text inert text in the field and the preview', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('flood.png'))
    await screen.findByTestId('attachment')
    uploader.byName('flood.png').resolve()
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())

    await user.type(altField('flood.png'), 'Water <script>alert(1)</script>on the road')

    const preview = screen.getByTestId('persona-preview')
    expect(preview).toHaveTextContent('Water on the road')
    expect(preview.querySelector('script')).toBeNull()
  })
})

describe('PersonaComposer v2 — attach from the library', () => {
  it('opens the picker (aria-expanded), lands focus inside it, and lists the library', async () => {
    const user = userEvent.setup()
    await renderComposer()

    await user.click(screen.getByRole('button', { name: 'From library' }))

    expect(screen.getByRole('button', { name: 'From library' })).toHaveAttribute('aria-expanded', 'true')
    expect(await screen.findAllByRole('option')).toHaveLength(4)
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus()
  })

  it('a picked asset becomes a "library" row needing alt text; unpicking removes it', async () => {
    const user = userEvent.setup()
    await renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Photo.')
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')

    await user.click(within(screen.getByTestId('library-panel')).getByRole('option', { name: /flood-main-street\.svg/ }))

    const row = screen.getByTestId('attachment')
    expect(row).toHaveAttribute('data-source', 'library')
    expect(within(row).getByText('flood-main-street.svg')).toBeInTheDocument()
    expect(within(row).getByText('LIBRARY')).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
    expect(screen.getByTestId('publish-blockers')).toHaveTextContent('Add alt text to every image or video.')

    await user.click(within(screen.getByTestId('library-panel')).getByRole('option', { name: /flood-main-street\.svg/ }))
    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()
    expect(postButton()).toBeEnabled()
  })

  it('a picked VIDEO keeps its poster: the row, the preview and the posted media all carry it', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')

    await user.click(within(screen.getByTestId('library-panel')).getByRole('option', { name: /water-update\.mp4/ }))

    const row = screen.getByTestId('attachment')
    expect(within(row).getByText('VIDEO')).toBeInTheDocument()
    expect(row.querySelector('img')).toHaveAttribute('src', '/mock-media/video/water-update.poster.svg')
    expect(screen.getByTestId('persona-preview').querySelector('img'))
      .toHaveAttribute('src', '/mock-media/video/water-update.poster.svg')

    await user.type(altField('water-update.mp4'), 'Briefing from the plant')
    await user.click(postButton())

    const media = onPublished.mock.calls[0]?.[0]?.media
    expect(media).toMatchObject([
      {
        id: CANNED_VIDEO,
        kind: 'video',
        alt: 'Briefing from the plant',
        posterUrl: '/mock-media/video/water-update.poster.svg',
      },
    ])
  })

  it('refuses to pick an asset that is ALREADY an upload row (no duplicate mediaId)', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('just-uploaded.png'))
    await screen.findByTestId('attachment')
    uploader.byName('just-uploaded.png').resolve()
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: 'From library' }))
    const panel = within(screen.getByTestId('library-panel'))
    // The uploaded file is in the library too (the upload registered it there).
    const tile = await panel.findByRole('option', { name: /just-uploaded\.png/ })

    await user.click(tile)

    expect(screen.getByTestId('attach-error')).toHaveTextContent(
      'That file is already attached to this post.',
    )
    expect(screen.getAllByTestId('attachment')).toHaveLength(1)
    expect(tile).toHaveAttribute('aria-selected', 'false')
  })

  it('locks the picker to the tray\'s kind and spends the capacity uploads already use', async () => {
    const user = userEvent.setup()
    await renderComposer()
    pick(png('a.png'), png('b.png'), png('c.png'))
    await waitFor(() => expect(screen.getAllByTestId('attachment')).toHaveLength(3))
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')

    // Images only (the tray holds images), room for exactly one more.
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Videos' })).toBeDisabled()
    expect(screen.getByTestId('media-library-status')).toHaveTextContent('0 of 1 selected')

    const panel = within(screen.getByTestId('library-panel'))
    await user.click(panel.getByRole('option', { name: /flood-main-street\.svg/ }))
    expect(screen.getAllByTestId('attachment')).toHaveLength(4)

    // One slot left means the picker is single-select: the next pick REPLACES the library
    // row (the tray stays at four) instead of hitting a dead "limit reached" tile.
    await user.click(panel.getByRole('option', { name: /water-plant\.svg/ }))
    const rows = screen.getAllByTestId('attachment')
    expect(rows).toHaveLength(4)
    expect(rows.filter(row => row.dataset.source === 'library')).toHaveLength(1)
    expect(within(screen.getByTestId('attachments')).getByText('water-plant.svg')).toBeInTheDocument()
    expect(within(screen.getByTestId('attachments')).queryByText('flood-main-street.svg'))
      .not.toBeInTheDocument()
  })

  it('keeps the picked tile (and keyboard focus) when the host narrows the picker to its kind', async () => {
    const user = userEvent.setup()
    await renderComposer()
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')
    const panel = within(screen.getByTestId('library-panel'))

    // The first pick makes the tray an image tray, so the composer re-queries the picker as
    // images-only. The grid must not be torn down and rebuilt around the focused tile.
    const flood = panel.getByRole('option', { name: /flood-main-street\.svg/ })
    await user.click(flood)

    await waitFor(() => expect(screen.getByRole('radio', { name: 'Videos' })).toBeDisabled())
    expect(panel.getByRole('option', { name: /flood-main-street\.svg/ })).toBe(flood)
    expect(flood).toHaveFocus()
    expect(flood).toHaveAttribute('aria-selected', 'true')
    // Never a loading state in between.
    expect(screen.queryByTestId('media-library-loading')).not.toBeInTheDocument()
    // Settled: the images-only list is the server's (3 canned images).
    await waitFor(() => expect(panel.getAllByRole('option')).toHaveLength(3))
  })

  it('Esc inside the picker closes only the picker (focus back on its button); the next Esc reaches the dock', async () => {
    const onDockKey = vi.fn()
    const user = userEvent.setup()
    render(
      <Providers>
        <div onKeyDown={event => onDockKey(event.key)}>
          <PersonaComposer activePersona={PERSONA} actingHumanId="human-ctl-7" callSign="SIMCELL-3" />
        </div>
      </Providers>,
    )
    await screen.findByTestId('persona-composer')
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')
    onDockKey.mockClear()

    await user.keyboard('{Escape}')

    expect(screen.queryByTestId('library-panel')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'From library' })).toHaveFocus()
    expect(onDockKey).not.toHaveBeenCalled()

    // Panel closed: Esc is not intercepted, so the dock's handler gets it (closing the dock).
    await user.click(screen.getByLabelText(POST_FIELD))
    await user.keyboard('{Escape}')
    expect(onDockKey).toHaveBeenCalledWith('Escape')
  })
})

describe('PersonaComposer v2 — reply as persona', () => {
  it('shows "Replying to @handle - "excerpt"" with a clear control, and relabels the field', async () => {
    const onClearReply = vi.fn()
    const user = userEvent.setup()
    await renderComposer({ replyTo: REPLY_TARGET, onClearReply })

    const banner = screen.getByTestId('reply-banner')
    expect(banner).toHaveAttribute('role', 'status')
    expect(banner).toHaveTextContent(
      'Replying to @mvega_fh — "is the water actually safe?? my kids drank tap water this morning omg"',
    )
    // The field label (MUI renders it twice: the label and the outline legend).
    expect(screen.getAllByText('Reply as Fairhaven Water').length).toBeGreaterThan(0)
    expect(screen.queryByText('Post as Fairhaven Water')).not.toBeInTheDocument()

    await user.click(within(banner).getByRole('button', { name: 'Clear reply target' }))
    expect(onClearReply).toHaveBeenCalledTimes(1)
  })

  it('normalizes a handle that already has a leading @', async () => {
    await renderComposer({ replyTo: { ...REPLY_TARGET, authorHandle: '@mvega_fh' } })
    expect(screen.getByTestId('reply-banner')).toHaveTextContent('Replying to @mvega_fh —')
    expect(screen.getByTestId('reply-banner')).not.toHaveTextContent('@@')
  })

  it('without a reply target there is no banner, and it is a normal post', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    expect(screen.queryByTestId('reply-banner')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(POST_FIELD), 'Normal post.')
    await user.click(postButton())

    expect(onPublished.mock.calls[0]?.[0]?.parentPostId).toBeUndefined()
    expect(getEmittedTelemetryEvents().map(e => e.eventType)).toEqual(['post'])
  })

  it('posts with parentPostId, emits one reply event, and asks the route to clear the target', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const onClearReply = vi.fn()
    const user = userEvent.setup()
    await renderComposer({ replyTo: REPLY_TARGET, onClearReply, onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Yes - the advisory is lifted.')

    await user.click(postButton())

    expect(onPublished.mock.calls[0]?.[0]?.parentPostId).toBe('post-seed-mvega-question')
    expect(onClearReply).toHaveBeenCalledTimes(1)
    expect(getEmittedTelemetryEvents().map(e => e.eventType)).toEqual(['reply'])
  })

  it('offers no clear control when the route supplied no onClearReply', async () => {
    await renderComposer({ replyTo: REPLY_TARGET })
    expect(screen.getByTestId('reply-banner')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear reply target' })).not.toBeInTheDocument()
  })
})

describe('PersonaComposer v2 — starting engagement', () => {
  const openBaseline = async (user: ReturnType<typeof userEvent.setup>) =>
    user.click(screen.getByRole('button', { name: /Starting engagement/ }))

  it('is collapsed with "none" by default - no baseline is sent', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })

    const toggle = screen.getByRole('button', { name: /Starting engagement/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('baseline-summary')).toHaveTextContent('none')
    expect(screen.queryByRole('textbox', { name: 'Like' })).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(POST_FIELD), 'No baseline.')
    await user.click(postButton())
    expect(onPublished.mock.calls[0]?.[0]?.counts).toEqual({ reply: 0, repost: 0, like: 0 })
  })

  it('takes Like / Repost / Reply with quick presets, summarizes while collapsed, and seeds the post', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Trending.')
    await openBaseline(user)

    expect(screen.getByRole('button', { name: /Starting engagement/ })).toHaveAttribute('aria-expanded', 'true')
    await user.click(screen.getByRole('button', { name: 'Set Like to 1.2K' }))
    await user.click(screen.getByRole('button', { name: 'Set Repost to 2.3K' }))
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '86')
    expect(screen.getByRole('textbox', { name: 'Like' })).toHaveValue('1200')
    expect(screen.getByRole('textbox', { name: 'Repost' })).toHaveValue('2300')

    await openBaseline(user) // collapse
    expect(screen.getByTestId('baseline-summary')).toHaveTextContent('Like 1.2K | Repost 2.3K | Reply 86')

    await user.click(postButton())

    expect(onPublished.mock.calls[0]?.[0]?.counts)
      .toMatchObject({ like: 1200, repost: 2300, reply: 86 })
    // Reset to "none" for the next post.
    expect(screen.getByTestId('baseline-summary')).toHaveTextContent('none')
  })

  it('an invalid value shows an inline message, blocks Fire (and says so), even while collapsed', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Blocked.')
    await openBaseline(user)

    await user.type(screen.getByRole('textbox', { name: 'Like' }), '1000001')

    const like = screen.getByRole('textbox', { name: 'Like' })
    expect(like).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Enter a whole number from 0 to 1,000,000.')).toBeInTheDocument()
    expect(postButton()).toBeDisabled()
    expect(screen.getByTestId('publish-blockers')).toHaveTextContent('Fix the Starting engagement values')

    await openBaseline(user) // collapse: the problem stays visible
    expect(screen.getByTestId('baseline-summary')).toHaveTextContent('needs fixing')
    expect(postButton()).toBeDisabled()
    fireEvent.submit(screen.getByTestId('persona-composer'))
    expect(onPublished).not.toHaveBeenCalled()

    await openBaseline(user)
    await user.clear(screen.getByRole('textbox', { name: 'Like' }))
    await user.type(screen.getByRole('textbox', { name: 'Like' }), '1000000')
    expect(postButton()).toBeEnabled()
  })

  it.each(['-3', '4.5', '1e3', 'many'])('rejects %s', async value => {
    const user = userEvent.setup()
    await renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Text.')
    await openBaseline(user)

    await user.type(screen.getByRole('textbox', { name: 'Repost' }), value)

    expect(screen.getByRole('textbox', { name: 'Repost' })).toHaveAttribute('aria-invalid', 'true')
    expect(postButton()).toBeDisabled()
  })
})

describe('PersonaComposer v2 — preview before Fire', () => {
  it('is a labelled STAFF frame showing author, text, media, "Replying to" and the start engagement', async () => {
    const user = userEvent.setup()
    await renderComposer({ replyTo: REPLY_TARGET, onClearReply: () => undefined })
    await user.type(screen.getByLabelText(POST_FIELD), 'Hello & welcome <b>team</b>')
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')
    await user.click(within(screen.getByTestId('library-panel')).getByRole('option', { name: /flood-main-street\.svg/ }))
    await user.type(altField('flood-main-street.svg'), 'Main Street under water')
    await user.click(screen.getByRole('button', { name: /Starting engagement/ }))
    await user.click(screen.getByRole('button', { name: 'Set Like to 2.3K' }))

    const preview = screen.getByRole('region', { name: 'Post preview' })
    expect(within(preview).getByText('PREVIEW')).toBeInTheDocument()
    expect(within(preview).getByText('STAFF VIEW - NOT SENT')).toBeInTheDocument()
    expect(within(preview).getByTestId('preview-author')).toHaveTextContent('@FairhavenWater (Fairhaven Water)')
    expect(within(preview).getByTestId('preview-replying-to')).toHaveTextContent('@mvega_fh')
    // The SANITIZED text (markup stripped, `&` kept) - what the ingest path will keep.
    expect(within(preview).getByTestId('preview-text')).toHaveTextContent('Hello & welcome team')
    const media = within(preview).getByTestId('preview-media')
    expect(media).toHaveTextContent('IMAGE')
    expect(media).toHaveTextContent('Main Street under water')
    expect(media.querySelector('img')).toHaveAttribute('src', '/mock-media/photos/flood-main-street.svg')
    expect(within(preview).getByTestId('preview-engagement')).toHaveTextContent('LIKE 2.3K')
  })

  it('says so when there is nothing to preview, and flags missing alt text in words', async () => {
    const user = userEvent.setup()
    await renderComposer()
    expect(screen.getByText('Nothing to preview yet.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')
    await user.click(within(screen.getByTestId('library-panel')).getByRole('option', { name: /water-plant\.svg/ }))

    expect(within(screen.getByTestId('persona-preview')).getByText('ALT TEXT MISSING')).toBeInTheDocument()
  })

  it('is never a participant post card: no article, no avatar, no like / repost row', async () => {
    const user = userEvent.setup()
    await renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Text.')

    const preview = screen.getByTestId('persona-preview')
    expect(within(preview).queryByRole('article')).not.toBeInTheDocument()
    expect(within(preview).queryByRole('img')).not.toBeInTheDocument()
    expect(within(preview).queryByRole('button')).not.toBeInTheDocument()
    expect(preview.tagName).toBe('SECTION')
  })
})

describe('PersonaComposer v2 — keyboard (NFR-001)', () => {
  it('Ctrl+Enter fires from the alt field and from a baseline field; Cmd+Enter works too', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'First.')
    await user.click(screen.getByRole('button', { name: /Starting engagement/ }))
    await user.type(screen.getByRole('textbox', { name: 'Like' }), '5')

    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(onPublished).toHaveBeenCalledTimes(1)

    await user.type(screen.getByLabelText(POST_FIELD), 'Second.')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(onPublished).toHaveBeenCalledTimes(2)
  })

  it('a plain Enter in an input (alt text, baseline) never submits the post', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Ready to go.')
    await user.click(screen.getByRole('button', { name: /Starting engagement/ }))

    await user.type(screen.getByRole('textbox', { name: 'Like' }), '12{Enter}')
    pick(png('a.png'))
    await screen.findByTestId('attachment')
    uploader.byName('a.png').resolve()
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())
    await user.type(altField('a.png'), 'A picture{Enter}')

    expect(onPublished).not.toHaveBeenCalled()
    expect(altField('a.png')).toHaveValue('A picture')
  })

  it('every control is reachable by Tab, in order, ending at Post', async () => {
    const user = userEvent.setup()
    await renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Tab order.')

    const reached: string[] = []
    for (let i = 0; i < 6; i += 1) {
      await user.tab()
      const active = document.activeElement
      reached.push(active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? '')
    }

    expect(reached).toEqual(
      expect.arrayContaining(['Upload', 'From library', 'Post']),
    )
    expect(reached.indexOf('Upload')).toBeLessThan(reached.indexOf('From library'))
    expect(reached.indexOf('From library')).toBeLessThan(reached.indexOf('Post'))
  })
})

describe('PersonaComposer v2 — the library asset in the mock registry is what the post resolves', () => {
  it('posts a canned library photo end to end', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Photo.')
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await screen.findAllByRole('option')
    await user.click(within(screen.getByTestId('library-panel')).getByRole('option', { name: /flood-main-street\.svg/ }))
    await user.type(altField('flood-main-street.svg'), 'Flooded street')

    await user.click(postButton())

    expect(onPublished.mock.calls[0]?.[0]?.media).toMatchObject([
      { id: CANNED_FLOOD, kind: 'image', url: '/mock-media/photos/flood-main-street.svg', alt: 'Flooded street' },
    ])
    expect(screen.getByTestId('publish-success')).toBeInTheDocument()
  })
})
