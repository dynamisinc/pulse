/**
 * features/social/components/ReplyComposer.test.tsx
 * ---------------------------------------------------------------------------
 * The thread's reply box on its own (demo-polish F4, story 13 "Reply composer";
 * SOC-011, D1-R5, NFR-001, NFR-004): "Replying to @handle", the 280-character ring
 * (and a `charLimit` override), the SAME attach tray as the post composer, and a
 * publish that sends `parentPostId` — handing `onPosted` a view linked to its
 * parent. Observer / persona-less absence is in `ReplyComposer.absent.test.tsx`.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRef } from 'react'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { uploadPickedMedia } from '@/core/media'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { ParticipantPostView } from '@/features/social'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { ReplyComposer } from './ReplyComposer'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'

vi.mock('@/core/media', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

const PARENT = 'post-seed-mvega-question'

let uploader: FakeUploader

async function renderReply(props: Partial<React.ComponentProps<typeof ReplyComposer>> = {}) {
  const utils = render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ReplyComposer parentPostId={PARENT} parentHandle="mvega_fh" {...props} />
      </SessionProvider>
    </ExerciseContextProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('reply-composer')).toBeInTheDocument())
  return utils
}

beforeEach(() => {
  resetTelemetryBuffer()
  uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
})

afterEach(() => {
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetTelemetryBuffer()
})

describe('ReplyComposer — what it shows', () => {
  it('names who is being answered, in a single text node', async () => {
    await renderReply()

    expect(screen.getByText('Replying to @mvega_fh')).toBeInTheDocument()
    expect(screen.getByTestId('reply-composer-context')).toHaveTextContent('Replying to @mvega_fh')
  })

  it('has the 280-character ring counter (D1-R5) and honours a charLimit override', async () => {
    const user = userEvent.setup()
    await renderReply({ charLimit: 10 })

    expect(screen.getByTestId('char-ring')).toHaveAttribute('aria-label', '10 characters remaining')

    await user.type(screen.getByLabelText('Reply text'), 'this is definitely too long')
    expect(screen.getByTestId('char-ring')).toHaveAttribute('data-state', 'over')
    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled()
  })

  it('defaults the limit to 280', async () => {
    await renderReply()

    expect(screen.getByTestId('char-ring')).toHaveAttribute(
      'aria-label',
      '280 characters remaining',
    )
  })

  it('has the same attach tray as the post composer', async () => {
    await renderReply()

    expect(screen.getByRole('button', { name: 'Add photos or video' })).toBeInTheDocument()
    expect(screen.getByTestId('composer-file-input')).toHaveAttribute(
      'accept',
      expect.stringContaining('video/mp4'),
    )
  })

  it('exposes the text area through inputRef so the thread can focus it', async () => {
    const ref = createRef<HTMLTextAreaElement>()
    await renderReply({ inputRef: ref })

    expect(ref.current).toBe(screen.getByLabelText('Reply text'))
  })
})

describe('ReplyComposer — posting a reply (mock mode)', () => {
  it('sends parentPostId: onPosted gets a view linked to the parent; ONE "reply" event', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderReply({ onPosted })

    await user.type(screen.getByLabelText('Reply text'), 'We are looking into it.')
    await user.click(screen.getByRole('button', { name: 'Reply' }))

    expect(onPosted).toHaveBeenCalledTimes(1)
    const view = onPosted.mock.calls[0]?.[0]
    expect(view?.text).toBe('We are looking into it.')
    expect(view?.inReplyTo).toEqual({ postId: PARENT, authorHandle: 'mvega_fh' })
    const events = getEmittedTelemetryEvents()
    expect(events.filter(e => e.eventType === 'reply')).toHaveLength(1)
    expect(events.filter(e => e.eventType === 'post')).toHaveLength(0)
    expect(screen.getByText('Reply published.')).toBeInTheDocument()
  })

  it('a reply with a described photo carries the media', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderReply({ onPosted })

    await user.type(screen.getByLabelText('Reply text'), 'Here is the street.')
    await user.upload(
      screen.getByTestId('composer-file-input'),
      fakeFile('street.png', 'image/png'),
    )
    uploader.byName('street.png').resolve()
    const alt = await screen.findByLabelText('Describe photo (required)')
    expect(screen.getByRole('button', { name: 'Reply' })).toBeDisabled()
    await user.type(alt, 'The street after the pump started')
    await user.click(screen.getByRole('button', { name: 'Reply' }))

    expect(onPosted.mock.calls[0]?.[0].media?.[0]).toMatchObject({
      kind: 'image',
      alt: 'The street after the pump started',
    })
    expect(within(screen.getByTestId('reply-composer')).queryByTestId('composer-media'))
      .not.toBeInTheDocument()
  })

  it('does not register a reply as an own FEED post', async () => {
    const user = userEvent.setup()
    await renderReply()

    await user.type(screen.getByLabelText('Reply text'), 'Reply only.')
    await user.click(screen.getByRole('button', { name: 'Reply' }))

    expect(ownPostStore.getAll()).toEqual([])
  })
})
