/**
 * features/social/pages/Profile.engagement.test.tsx
 * ---------------------------------------------------------------------------
 * "No dead buttons anywhere" (demo-polish F3, DP-14): a post card on the PROFILE
 * page has live like and repost with no per-page wiring. Before F0/F3 the profile
 * rendered `<PostCard>` with dead buttons; `PostActions` now self-wires, so a tap
 * must reach the reactions endpoint:
 *   `PUT /posts/{id}/reactions/like` (and `.../repost`), and flip the control.
 *
 * Renders the REAL page through the real provider stack in mock mode; `api.put` /
 * `api.delete` are spied (pass-through), so the request is observed at the shared
 * client — the same seam a live deployment uses.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellContextProvider } from '@/features/participant-shell/mountContract'
import { resetMockReactions } from '../services/reactionService'
import { SocialDirectoryProvider } from '../layout/SocialDirectoryProvider'
import { Profile } from './Profile'

const FW_ID = 'persona-fairhavenwater'

function renderProfile() {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <SocialDirectoryProvider>
            <Profile personaId={FW_ID} />
          </SocialDirectoryProvider>
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockReactions()
})

afterEach(() => {
  vi.restoreAllMocks()
  resetMockReactions()
  resetTelemetryBuffer()
})

describe('Profile — post cards have live like and repost', () => {
  it('a like on a profile card fires PUT /posts/{id}/reactions/like and turns the heart on', async () => {
    const putSpy = vi.spyOn(api, 'put')
    const user = userEvent.setup()
    renderProfile()

    const [card] = await screen.findAllByTestId('post-card')
    if (!card) throw new Error('expected at least one post card on the profile')
    const postId = card.getAttribute('data-post-id')
    const like = within(card).getByRole('button', { name: /^like, /i })
    expect(like).toHaveAttribute('aria-pressed', 'false')

    await user.click(like)

    expect(putSpy).toHaveBeenCalledTimes(1)
    expect(putSpy.mock.calls[0]?.[0]).toBe(`/posts/${postId}/reactions/like`)
    expect(within(card).getByRole('button', { name: /^like, .*, liked$/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('a repost on a profile card fires PUT .../reactions/repost, and undoing fires DELETE', async () => {
    const putSpy = vi.spyOn(api, 'put')
    const deleteSpy = vi.spyOn(api, 'delete')
    const user = userEvent.setup()
    renderProfile()

    const [card] = await screen.findAllByTestId('post-card')
    if (!card) throw new Error('expected at least one post card on the profile')
    const postId = card.getAttribute('data-post-id')

    await user.click(within(card).getByRole('button', { name: /^repost, /i }))
    expect(putSpy.mock.calls[0]?.[0]).toBe(`/posts/${postId}/reactions/repost`)

    await user.click(within(card).getByRole('button', { name: /^repost, .*, reposted$/i }))
    expect(deleteSpy.mock.calls[0]?.[0]).toBe(`/posts/${postId}/reactions/repost`)
  })

  it('shows no Quote or Share control on a profile card', async () => {
    renderProfile()

    const [card] = await screen.findAllByTestId('post-card')
    if (!card) throw new Error('expected at least one post card on the profile')

    expect(within(card).queryByRole('button', { name: /quote|share/i })).not.toBeInTheDocument()
    expect(within(card).queryByTestId('post-quote-trigger')).not.toBeInTheDocument()
  })
})
