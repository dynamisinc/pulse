/**
 * features/social/components/FollowButton.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story-02 ACs for the standalone follow/unfollow control (SOC-051,
 * NFR-001):
 *   - renders "Follow {name}" initially, and toggles to "Following" on
 *     activation, with `aria-pressed` reflecting the state (never color
 *     alone);
 *   - calls `onFollowerCountChange` with the running optimistic count;
 *   - a rejected write rolls the button (and the reported count) back to
 *     "Follow".
 *
 * (Observer/no-persona "control absent" ACs live in the sibling
 * `FollowButton.readonly.test.tsx` / `FollowButton.noPersona.test.tsx`, which
 * mock a read-only / personaless session — same file-split rationale as
 * `useReaction`'s specs.)
 *
 * Runs through the REAL `SessionProvider` (a normal, writable participant —
 * mirrors `useFollow.test.ts`), with `followService` mocked so this file
 * exercises ONLY the component's own render/interaction contract.
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { FollowButton } from './FollowButton'
import { followPersona, unfollowPersona } from '../services/followService'

vi.mock('../services/followService', () => ({
  followPersona: vi.fn(),
  unfollowPersona: vi.fn(),
}))

function withSession(children: ReactNode) {
  return render(<SessionProvider>{children}</SessionProvider>)
}

beforeEach(() => {
  // Resolves with the server's authoritative `following` value (SG-001) —
  // `true` for a follow, `false` for an unfollow.
  vi.mocked(followPersona).mockResolvedValue(true)
  vi.mocked(unfollowPersona).mockResolvedValue(false)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('FollowButton — toggle + accessible state (SOC-051, NFR-001)', () => {
  it('renders "Follow" with aria-pressed=false, then toggles to "Following" with aria-pressed=true', async () => {
    withSession(
      <FollowButton
        personaId="persona-fairhavenwater"
        displayName="Fairhaven Water"
        initialFollowerCount={120}
      />,
    )

    const button = await screen.findByTestId('follow-button')
    expect(button).toHaveTextContent('Follow')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(button).toHaveAttribute('aria-label', 'Follow Fairhaven Water')

    fireEvent.click(button)

    expect(button).toHaveTextContent('Following')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAttribute('aria-label', 'Unfollow Fairhaven Water')

    await waitFor(() => expect(followPersona).toHaveBeenCalledWith('persona-fairhavenwater'))
  })

  it('reports the running optimistic follower count via onFollowerCountChange', async () => {
    const onFollowerCountChange = vi.fn()
    withSession(
      <FollowButton
        personaId="persona-x"
        displayName="X Persona"
        initialFollowerCount={10}
        onFollowerCountChange={onFollowerCountChange}
      />,
    )

    const button = await screen.findByTestId('follow-button')
    await waitFor(() => expect(onFollowerCountChange).toHaveBeenCalledWith(10))

    fireEvent.click(button)
    expect(onFollowerCountChange).toHaveBeenCalledWith(11)
  })

  it('rolls back to "Follow" when the write is rejected — never stuck showing Following', async () => {
    vi.mocked(followPersona).mockRejectedValue(new Error('server refused'))

    withSession(
      <FollowButton personaId="persona-x" displayName="X Persona" initialFollowerCount={5} />,
    )

    const button = await screen.findByTestId('follow-button')
    fireEvent.click(button)
    expect(button).toHaveTextContent('Following')

    await waitFor(() => expect(button).toHaveTextContent('Follow'))
    expect(button).not.toHaveTextContent('Following')
    expect(button).toHaveAttribute('aria-pressed', 'false')
  })

  it('marks the button aria-busy + disabled while the write is pending', async () => {
    let releaseWrite: (() => void) | undefined
    vi.mocked(followPersona).mockImplementation(
      () => new Promise<boolean>(resolve => { releaseWrite = () => resolve(true) }),
    )

    withSession(
      <FollowButton personaId="persona-x" displayName="X Persona" initialFollowerCount={5} />,
    )

    const button = await screen.findByTestId('follow-button')
    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toBeDisabled()

    releaseWrite?.()
    await waitFor(() => expect(button).not.toBeDisabled())
  })
})
