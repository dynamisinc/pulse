/**
 * features/controller/components/PersonaComposer.upload.test.tsx
 * ---------------------------------------------------------------------------
 * The composer wired to the REAL upload client in MOCK mode (demo-polish C1, story
 * 17 "Attach by upload"; implementation.md section 5 "mock upload adapter"). Where
 * `PersonaComposer.v2.test.tsx` stands in for the client, this file lets the real
 * chain run - `useMediaUpload` -> `uploadPickedMedia` -> (video) `uploadVideoWithPoster`
 * -> `uploadMedia` -> the in-memory mock registry - so we know the wiring, not just the
 * view, is right:
 *
 *  - an image uploads with simulated progress and registers in the library;
 *  - a VIDEO goes poster-first through `uploadVideoWithPoster` (two uploads), and the
 *    post that carries it has the poster; the poster image itself is hidden from the
 *    library listing;
 *  - cancelling mid-upload registers nothing;
 *  - every successful upload invalidates the library query (`['staff','media']`), so an
 *    already-open picker shows the new file at once.
 *
 * jsdom has no `URL.createObjectURL`, no image decode and no `<video>` decode, so the
 * object-URL factory is stubbed and the two decode helpers are stood in for (they have
 * their own suites in `core/media`).
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { MEDIA_LIBRARY_QUERY_KEY } from '@/core/media'
import { listMockMedia, resetMockMediaRegistry } from '@/core/media/mockMediaRegistry'
import { queryClient } from '@/core/services/queryClient'
import { resetTelemetryBuffer } from '@/core/telemetry'
import type { StaffPersona } from '@/features/personas'
import type { Post } from '@/features/social'
import { fakeFile } from '@/test/fakeMediaUploader'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer } from './PersonaComposer'

vi.mock('@/core/media/captureVideoPoster', () => ({
  POSTER_CAPTURE_TIMEOUT_MS: 8000,
  captureVideoPoster: vi.fn().mockResolvedValue({
    poster: new Blob(['poster'], { type: 'image/jpeg' }),
    width: 1280,
    height: 720,
    posterWidth: 640,
    posterHeight: 360,
    durationSec: 12.5,
  }),
}))
vi.mock('@/core/media/readImageSize', () => ({
  readImageSize: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
}))

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

let objectUrlSeq = 0

function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

async function renderComposer(onPublished?: (post: Post) => void) {
  render(
    <Providers>
      <PersonaComposer
        activePersona={PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
        {...(onPublished !== undefined ? { onPublished } : {})}
      />
    </Providers>,
  )
  await screen.findByTestId('persona-composer')
}

function pick(...files: File[]) {
  fireEvent.change(screen.getByTestId('persona-composer-file-input'), { target: { files } })
}

beforeEach(() => {
  objectUrlSeq = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => {
      objectUrlSeq += 1
      return `blob:upload-test-${objectUrlSeq}`
    }),
  })
  resetMockMediaRegistry()
  resetTelemetryBuffer()
  composeAsPersonaDraftStore.resetForTests()
  queryClient.clear()
})

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL')
  queryClient.clear()
  vi.restoreAllMocks()
})

describe('PersonaComposer (real mock upload client)', () => {
  it('uploads an image with simulated progress, then it is "Uploaded" and in the library', async () => {
    await renderComposer()

    pick(fakeFile('new-photo.png', 'image/png'))

    const row = await screen.findByTestId('attachment')
    expect(within(row).getByRole('progressbar', { name: 'Uploading new-photo.png' })).toBeInTheDocument()
    await waitFor(() => expect(within(row).getByText('Uploaded')).toBeInTheDocument())

    const uploaded = listMockMedia('image').find(asset => asset.fileName === 'new-photo.png')
    expect(uploaded).toMatchObject({ kind: 'image', width: 800, height: 600 })
  })

  it('uploads a VIDEO poster-first via uploadVideoWithPoster; the post carries the poster', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer(onPublished)
    await user.type(screen.getByLabelText('Post text'), 'Briefing.')

    pick(fakeFile('briefing.mp4', 'video/mp4'))

    const row = await screen.findByTestId('attachment')
    await waitFor(() => expect(within(row).getByText('Uploaded')).toBeInTheDocument(), {
      timeout: 5000,
    })

    // Two uploads happened: the poster JPEG (hidden from the library) and the video.
    const library = listMockMedia()
    expect(library.some(asset => asset.fileName === 'briefing.poster.jpg')).toBe(false)
    const video = library.find(asset => asset.fileName === 'briefing.mp4')
    expect(video).toMatchObject({ kind: 'video', durationSec: 12.5, width: 1280, height: 720 })
    expect(video?.posterUrl).toMatch(/^blob:upload-test-/)

    await user.type(screen.getByRole('textbox', { name: /Alt text for briefing\.mp4/ }), 'Plant briefing')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const media = onPublished.mock.calls[0]?.[0]?.media
    expect(media).toMatchObject([{ kind: 'video', alt: 'Plant briefing', durationSec: 12.5 }])
    expect(media?.[0]?.posterUrl).toBe(video?.posterUrl)
  })

  it('cancelling mid-upload registers nothing in the library', async () => {
    const user = userEvent.setup()
    await renderComposer()
    const before = listMockMedia().length

    pick(fakeFile('abort-me.png', 'image/png'))
    const row = await screen.findByTestId('attachment')
    await user.click(within(row).getByRole('button', { name: 'Cancel upload of abort-me.png' }))
    // Let any (cancelled) simulated tick settle.
    await new Promise(resolve => setTimeout(resolve, 500))

    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()
    expect(listMockMedia()).toHaveLength(before)
  })

  it('invalidates the library after an upload, so an already-open picker shows the new file', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const user = userEvent.setup()
    await renderComposer()
    await user.click(screen.getByRole('button', { name: 'From library' }))
    expect(await screen.findAllByRole('option')).toHaveLength(4)

    pick(fakeFile('just-uploaded.png', 'image/png'))
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())

    expect(invalidate).toHaveBeenCalledWith({ queryKey: MEDIA_LIBRARY_QUERY_KEY })
    // The tray now holds an image, so the picker narrowed to images - and lists the new one.
    const panel = within(screen.getByTestId('library-panel'))
    await waitFor(() =>
      expect(panel.getByRole('option', { name: /just-uploaded\.png/ })).toBeInTheDocument(),
    )
  })
})
