/**
 * features/social/pages/Profile.follow.test.tsx
 * ---------------------------------------------------------------------------
 * THE INTEGRATED follow specs for the profile page (feature:
 * profiles-social-graph, story 02 AC1 + story 05; SOC-051, SOC-054, NFR-001).
 * Sibling of `Profile.test.tsx`, split out because this file needs a DIFFERENT
 * fixture posture: it drives the REAL mock follow-edge store end to end
 * (`followEdgeStore` <- `followService`'s mock adapters -> `personaService`'s
 * mock adapter) instead of stubbing the write, and it resets that store per
 * test.
 *
 * WHY THIS FILE EXISTS — the two Gate-2 Criticals it pins:
 *
 *  - CR-002: `useFollow` seeds `isFollowing` from `initiallyFollowing = false`,
 *    and until this pass NOTHING passed that prop. On the profile of an account
 *    the viewer ALREADY follows, the button therefore read "Follow" /
 *    `aria-pressed="false"` — and tapping it ran the optimistic `+1` path
 *    against an idempotent server response (`{ following: true, changed:
 *    false }`: no edge written, no telemetry), settling on `previousCount + 1`.
 *    The client displayed a follower gain that never happened. Story 02 AC1
 *    ("the follow button reflects state") was ticked but untrue once integrated.
 *
 *  - CR-003: the header rendered `formatMagnitude(persona.followerCount)` off
 *    the persona object, which never changes, while `<FollowButton>` adjusted
 *    its OWN copy ±1 — so after a follow the button said "Following" and the
 *    header sat still. `onFollowerCountChange`, the escape hatch `FollowButton`
 *    documents for exactly this host, was not passed.
 *
 * WHY NANO BAND. `formatMagnitude` truncates, so a ±1 is invisible on the
 * mid/large-band personas the existing suite renders (50,232 and 50,233 both
 * read "50.2K") — which is precisely why no test caught CR-003. The seeded
 * nano-band accounts sit below 1,000 and render as EXACT integers, so the
 * count genuinely moves on screen. `tbrandt41` is nano (568); the specs assert
 * that precondition rather than assume it.
 *
 * TELEMETRY SEND. `api.post` is spied to swallow ONLY the `/telemetry` sink
 * call (a rejected fire-and-forget POST can otherwise race worker teardown);
 * every other POST — notably the follow write — is delegated to the real
 * client, so the mock adapter round trip stays intact.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { api } from '@/core/services/api'
import { personaById } from '@/features/personas'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import {
  MOCK_VIEWER_PERSONA_ID,
  resetMockFollowEdges,
  setMockFollowedSetForTests,
} from '../services/followEdgeStore'
import { Profile } from './Profile'

/** Verified mid-band org (50,232) — magnitude-formatted, so a ±1 is invisible. */
const FW_ID = 'persona-fairhavenwater'
/** NANO-band citizen (568) — renders as an exact integer, so a ±1 is visible. */
const TBRANDT_ID = 'persona-tbrandt41'

/** Captured BEFORE any spy so the follow write can be delegated to the real client. */
const realPost = api.post.bind(api)

function renderProfile(personaId: string, variant: ShellVariant = 'full') {
  return render(
    <ExerciseContextProvider>
      <SessionProvider>
        <ShellContextProvider
          value={{ variant, scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
        >
          <Profile personaId={personaId} />
        </ShellContextProvider>
      </SessionProvider>
    </ExerciseContextProvider>,
  )
}

/**
 * Records every distinct `data-following` value the follow button ever renders.
 *
 * A `findBy`-style assertion only samples the END state, so it would pass just
 * as happily against the CR-002 bug's "Follow" -> "Following" flip. This
 * observer sees each committed frame, so a transient wrong-state paint shows up
 * as a leading `'false'` in the recorded sequence.
 */
function recordFollowStates(): { readonly states: string[]; stop: () => void } {
  const states: string[] = []
  const sample = () => {
    const value = document.body
      .querySelector('[data-testid="follow-button"]')
      ?.getAttribute('data-following')
    if (typeof value === 'string' && states[states.length - 1] !== value) states.push(value)
  }
  const observer = new MutationObserver(sample)
  observer.observe(document.body, { subtree: true, childList: true, attributes: true })
  sample()
  return { states, stop: () => observer.disconnect() }
}

/** The seeded (pre-edge) count for a persona, guarded rather than `!`-asserted. */
function seededFollowerCount(personaId: string): number {
  const persona = personaById(personaId)
  if (!persona) throw new Error(`expected seeded persona fixture: ${personaId}`)
  return persona.followerCount
}

/**
 * Asserts the button's follow state.
 *
 * Deliberately NOT `toHaveTextContent('Follow')`: that matcher is a SUBSTRING
 * match, so "Follow" also matches "Following" and an assertion written that way
 * passes against a button stuck in the wrong state. `aria-pressed` is the
 * unambiguous signal (and the one assistive tech reports, NFR-001); the exact
 * trimmed label is checked alongside it.
 */
function expectFollowState(button: HTMLElement, following: boolean) {
  expect(button).toHaveAttribute('aria-pressed', String(following))
  expect(button).toHaveAttribute('data-following', String(following))
  expect(button.textContent?.trim()).toBe(following ? 'Following' : 'Follow')
}

beforeEach(() => {
  resetTelemetryBuffer()
  // A genuinely empty follow graph; each spec states the edges it needs.
  resetMockFollowEdges()
  vi.spyOn(api, 'post').mockImplementation((url, data, config) => (
    url === '/telemetry'
      ? Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config: {} })
      : realPost(url, data, config)
  ))
})

afterEach(() => {
  resetMockFollowEdges()
  vi.restoreAllMocks()
})

describe('Profile — follow button reflects PERSISTED state (CR-002, story 02 AC1)', () => {
  it('renders "Following" on an account the viewer already follows, with no wrong-state frame', async () => {
    setMockFollowedSetForTests(MOCK_VIEWER_PERSONA_ID, [FW_ID])
    const recorder = recordFollowStates()

    renderProfile(FW_ID)

    // The control is WITHHELD while the viewer's following set resolves, rather
    // than mounted in a placeholder state `useFollow` could never correct
    // (it seeds `isFollowing` once, via `useState`).
    expect(screen.queryByTestId('follow-button')).toBeNull()

    const button = await screen.findByTestId('follow-button')
    // NFR-001: state is carried by text + aria-pressed + a distinct icon, never
    // by color alone — `expectFollowState` checks two of the three.
    expectFollowState(button, true)
    expect(button).toHaveAttribute('aria-label', 'Unfollow Fairhaven Water Utility')

    recorder.stop()
    // The load-bearing assertion: 'true' was the button's FIRST and only painted
    // state. A leading 'false' here is the CR-002 regression.
    expect(recorder.states).toEqual(['true'])
  })

  it('renders "Follow" on an account the viewer does NOT follow', async () => {
    renderProfile(TBRANDT_ID)

    const button = await screen.findByTestId('follow-button')
    expectFollowState(button, false)
  })

  it('tapping an already-followed account UNFOLLOWS it — never a phantom +1', async () => {
    // The CR-002 consequence, at the band where it is actually visible: with the
    // button seeded 'Follow' by mistake, this tap ran the optimistic +1, the
    // server answered the idempotent `{ following: true, changed: false }`, and
    // the count settled on 569 -> 570 — a follower gain that never happened.
    setMockFollowedSetForTests(MOCK_VIEWER_PERSONA_ID, [TBRANDT_ID])
    const magnitude = seededFollowerCount(TBRANDT_ID)

    renderProfile(TBRANDT_ID)

    const header = await screen.findByTestId('follower-count')
    const button = await screen.findByTestId('follow-button')
    expectFollowState(button, true)
    // WR-005: the mock persona read composes magnitude + real mock edges, exactly
    // as the live server does — the viewer's own edge is already counted here.
    await waitFor(() => expect(header).toHaveTextContent(`${magnitude + 1} Followers`))

    fireEvent.click(button)

    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'))
    expectFollowState(button, false)
    await waitFor(() => expect(header).toHaveTextContent(`${magnitude} Followers`))
    expect(header).not.toHaveTextContent(`${magnitude + 2} Followers`)
  })

  it('does not carry follow state across a re-point to a DIFFERENT persona', async () => {
    setMockFollowedSetForTests(MOCK_VIEWER_PERSONA_ID, [FW_ID])
    const utils = renderProfile(FW_ID)

    await waitFor(() => expect(screen.getByTestId('follow-button'))
      .toHaveAttribute('aria-pressed', 'true'))

    // Profile-to-profile navigation reuses this mounted page (no unmount).
    utils.rerender(
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider
            value={{ variant: 'full', scenarioNow: new Date('2033-09-04T15:00:00.000Z') }}
          >
            <Profile personaId={TBRANDT_ID} />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>,
    )

    await screen.findByRole('heading', { name: 'Tom Brandt' })
    await waitFor(() => expect(screen.getByTestId('follow-button'))
      .toHaveAttribute('aria-pressed', 'false'))
    expectFollowState(screen.getByTestId('follow-button'), false)
    expect(screen.getByTestId('follower-count'))
      .toHaveTextContent(`${seededFollowerCount(TBRANDT_ID)} Followers`)
  })
})

describe('Profile — header follower count tracks the follow button (CR-003, SOC-054)', () => {
  it('moves the HEADER count when a NANO-band account is followed', async () => {
    // THE test that would have caught CR-003. The header used to render
    // `persona.followerCount` — an object that never changes — so it sat frozen
    // at 568 while the button flipped to "Following". Nano band is what makes
    // that visible: `formatMagnitude` shows sub-1,000 counts as exact integers,
    // whereas its truncation hides a ±1 on every mid/large-band persona the rest
    // of the suite renders.
    const magnitude = seededFollowerCount(TBRANDT_ID)
    expect(magnitude).toBeLessThan(1000) // precondition: exact-integer rendering

    renderProfile(TBRANDT_ID)

    const header = await screen.findByTestId('follower-count')
    await waitFor(() => expect(header).toHaveTextContent(`${magnitude} Followers`))

    const button = await screen.findByTestId('follow-button')
    expectFollowState(button, false)

    fireEvent.click(button)

    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'true'))
    expectFollowState(button, true)
    // The header moved with it — the exact assertion CR-003 fails.
    await waitFor(() => expect(header).toHaveTextContent(`${magnitude + 1} Followers`))
  })

  it('rolls the HEADER count back when the write is rejected', async () => {
    // A failed write must never leave a follower gain on screen either.
    vi.spyOn(api, 'post').mockImplementation(url => (
      url === '/telemetry'
        ? Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config: {} })
        : Promise.reject(new Error('server refused'))
    ))
    const magnitude = seededFollowerCount(TBRANDT_ID)

    renderProfile(TBRANDT_ID)

    const header = await screen.findByTestId('follower-count')
    const button = await screen.findByTestId('follow-button')
    await waitFor(() => expect(header).toHaveTextContent(`${magnitude} Followers`))

    fireEvent.click(button)
    expect(header).toHaveTextContent(`${magnitude + 1} Followers`) // optimistic

    await waitFor(() => expect(button).toHaveAttribute('aria-pressed', 'false'))
    expect(header).toHaveTextContent(`${magnitude} Followers`)
  })

  it('keeps the header count visible under a read-only shell variant (D1-011)', async () => {
    // COR-015/D1-011 removes AFFORDANCES, never information — the count is
    // information, so it stays rendered at every variant. (What removes the
    // Follow CONTROL is the SESSION's `isReadOnly`, resolved by `useFollow`'s
    // `canFollow`, not the shell mount variant — covered by the sibling
    // `components/FollowButton.readonly.test.tsx`, which mocks such a session.)
    const magnitude = seededFollowerCount(TBRANDT_ID)
    renderProfile(TBRANDT_ID, 'readOnly')

    const header = await screen.findByTestId('follower-count')
    await waitFor(() => expect(header).toHaveTextContent(`${magnitude} Followers`))
  })
})
