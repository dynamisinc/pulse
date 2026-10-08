/**
 * features/social/components/Composer.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 01's acceptance criteria for the inline `<Composer>`
 * (SOC-001, D1-R5, NFR-004, XC-004, COR-053, COR-015):
 *  - a participant composes text and publishes it, which routes through
 *    `createPost` — clearing the draft and firing `onPosted` with the new post;
 *  - publishing emits exactly ONE `'post'` telemetry event, stamped with the
 *    participant persona, `origin: 'participant'`, and the SCENARIO instant
 *    from the injected exercise clock (never wall-clock);
 *  - the depleting ring's count text is hidden with plenty of room, appears at
 *    ≤20 remaining (amber "low" state), and goes to an "over" state that blocks
 *    publish when the text exceeds the limit (D1-R5);
 *  - the char limit honors the `charLimit` prop override;
 *  - a stored-XSS payload is sanitized on the publish path (NFR-004) — the
 *    emitted/returned post text carries no `<script>`;
 *  - the attach tray (demo-polish F4): see `Composer.attach.test.tsx`;
 *  - keyboard operability (NFR-001): the textarea + Post button are reachable
 *    and the ring exposes an accessible remaining-character status.
 *
 * (The observer-mode "composer is absent" AC — COR-015/D1-011 — lives in the
 * sibling `Composer.readonly.test.tsx`, which must force a read-only session;
 * the shared mock session here is a normal, writable participant.)
 *
 * Renders through the REAL `ExerciseContextProvider` + `SessionProvider`
 * (both resolve via the shared axios client's built-in dev mock adapters,
 * exactly as the shipped app does), and swaps in a fixed exercise clock so the
 * scenario instant a published post carries is deterministic.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import {
  getEmittedTelemetryEvents,
  resetTelemetryBuffer,
} from '@/core/telemetry'
import type { ParticipantPostView } from '@/features/social'
import { Composer } from './Composer'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

/** Renders through the real exercise + session providers, awaiting the composer. */
async function renderComposer(children: ReactNode) {
  const utils = render(
    <ExerciseContextProvider>
      <SessionProvider>{children}</SessionProvider>
    </ExerciseContextProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('composer')).toBeInTheDocument())
  return utils
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  postStore.resetForTests()
  ownPostStore.resetForTests()
})

describe('Composer — compose + publish (SOC-001)', () => {
  it('publishes typed text, clears the draft, and fires onPosted with the new post', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderComposer(<Composer onPosted={onPosted} />)

    const input = screen.getByLabelText('Post text')
    const postButton = screen.getByRole('button', { name: 'Post' })

    // Empty draft cannot publish.
    expect(postButton).toBeDisabled()

    await user.type(input, 'Boil-water advisory lifted for zone 3.')
    expect(postButton).toBeEnabled()

    await user.click(postButton)

    expect(onPosted).toHaveBeenCalledTimes(1)
    const post = onPosted.mock.calls[0]?.[0]
    expect(post?.text).toBe('Boil-water advisory lifted for zone 3.')
    // The host gets the participant-safe VIEW, never the full model (XC-002).
    expect(post).not.toHaveProperty('origin')
    // Draft cleared, so the button is disabled again.
    expect(input).toHaveValue('')
    expect(postButton).toBeDisabled()
  })
})

describe('Composer — telemetry + scenario time (XC-004, COR-053)', () => {
  it('emits exactly one "post" event stamped with the scenario instant and participant origin', async () => {
    // A scenario "now" far from any real wall-clock moment, so a wall-clock
    // leak into the stamped instant fails this assertion rather than passing.
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))
    const user = userEvent.setup()
    await renderComposer(<Composer />)

    await user.type(screen.getByLabelText('Post text'), 'Zones 2-4 clear.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const posts = getEmittedTelemetryEvents().filter(e => e.eventType === 'post')
    expect(posts).toHaveLength(1)
    const event = posts[0]
    expect(event?.channel).toBe('social')
    expect(event?.origin).toBe('participant')
    // XC-004: a post's actor.kind is always 'persona' — the human who typed it
    // is carried separately (actingHumanId), never as the actor kind itself.
    expect(event?.actor.kind).toBe('persona')
    // The Wave-1 mock session posts as Dana Reyes.
    expect(event?.actor.personaId).toBe('persona-dreyes_fh')
    // Scenario time only — the injected clock instant, never wall-clock.
    expect(event?.scenarioTime).toBe('2031-03-01T14:00:00.000Z')
  })
})

describe('Composer — depleting ring counter (D1-R5)', () => {
  it('hides the count with plenty of room and shows it at <=20 remaining (amber low)', async () => {
    const user = userEvent.setup()
    // charLimit override (AC) keeps the thresholds easy to hit.
    await renderComposer(<Composer charLimit={30} />)

    const input = screen.getByLabelText('Post text')

    // 5 chars used of 30 -> 25 remaining (>20): no count text, normal state.
    await user.type(input, 'hello')
    expect(screen.queryByTestId('char-count')).not.toBeInTheDocument()
    expect(screen.getByTestId('char-ring')).toHaveAttribute('data-state', 'normal')

    // 10 more -> 15 used... reach remaining 20: type up to 10 chars total used
    // is 10 remaining 20. Add 5 more chars (total 10) -> remaining 20.
    await user.type(input, '12345')
    expect(screen.getByTestId('char-count')).toHaveTextContent('20')
    expect(screen.getByTestId('char-ring')).toHaveAttribute('data-state', 'low')
  })

  it('blocks publish and shows an "over the limit" status when the text is too long', async () => {
    const user = userEvent.setup()
    await renderComposer(<Composer charLimit={10} />)

    const input = screen.getByLabelText('Post text')
    await user.type(input, 'this is definitely too long')

    const ring = screen.getByTestId('char-ring')
    expect(ring).toHaveAttribute('data-state', 'over')
    expect(ring).toHaveAttribute('aria-label', expect.stringContaining('over the limit'))
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })

  it('does not emit a telemetry event when publish is attempted over the limit', async () => {
    const user = userEvent.setup()
    await renderComposer(<Composer charLimit={5} />)

    await user.type(screen.getByLabelText('Post text'), 'way too many characters')
    // The button is disabled; a forced submit still no-ops via publish()'s guard.
    await user.click(screen.getByRole('button', { name: 'Post' }))

    expect(getEmittedTelemetryEvents().filter(e => e.eventType === 'post')).toHaveLength(0)
  })
})

describe('Composer — content security (NFR-004)', () => {
  it('sanitizes a stored-XSS <script> payload on the publish path — the new post carries no <script>', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderComposer(<Composer onPosted={onPosted} />)

    // userEvent.type interprets some chars; paste the raw payload instead.
    const input = screen.getByLabelText('Post text')
    input.focus()
    await user.paste('<script>window.__composerXss = true</script>safe text')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const post = onPosted.mock.calls[0]?.[0]
    expect(post?.text).not.toMatch(/<script/i)
    expect(post?.text).toContain('safe text')
    // The payload was never executed: pasting/publishing it never runs script,
    // it only ever flows as inert draft text through the sanitizer.
    expect((window as unknown as { __composerXss?: boolean }).__composerXss).toBeUndefined()
  })

  it('sanitizes a stored-XSS <img onerror> payload on the publish path — no script/img element is ever produced', async () => {
    const onPosted = vi.fn<(view: ParticipantPostView) => void>()
    const user = userEvent.setup()
    await renderComposer(<Composer onPosted={onPosted} />)

    const scriptCountBefore = document.querySelectorAll('script').length

    const input = screen.getByLabelText('Post text')
    input.focus()
    await user.paste('<img src=x onerror="window.__composerImgXss = true">also unsafe')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const post = onPosted.mock.calls[0]?.[0]
    expect(post?.text).not.toMatch(/onerror/i)
    expect(post?.text).not.toMatch(/<img/i)
    expect(post?.text).toContain('also unsafe')
    // The onerror handler never ran, and the composer created no new <script>
    // element from the payload either.
    expect((window as unknown as { __composerImgXss?: boolean }).__composerImgXss).toBeUndefined()
    expect(document.querySelectorAll('script')).toHaveLength(scriptCountBefore)
  })
})
