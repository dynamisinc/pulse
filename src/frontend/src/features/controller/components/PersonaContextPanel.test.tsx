/**
 * features/controller/components/PersonaContextPanel.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 03's acceptance criteria for `<PersonaContextPanel>`
 * (CTL-003, COR-020, SOC-054, D5-014/2.4, COR-001, COR-053, NFR-001):
 *  - renders voice notes resolved via the template, recent posts, and the
 *    audience-magnitude band for the active persona;
 *  - renders the "POSTING AS {category}" chip, text-carrying the signal;
 *  - updates (voice notes, recents, audience band, category chip) when the
 *    active persona prop changes, without a full reload (a rerender);
 *  - recents are scoped to the active exercise instance (COR-001) — a
 *    same-id persona in a DIFFERENT exercise shows no recents;
 *  - reachable/legible via keyboard/screen reader (a labelled, plain-text
 *    `<section>`, no interactive controls to trap focus).
 *
 * Demo-polish C4 adds (docs/features/demo-polish/20-console-cleanup.md):
 *  - the persona's server `bio` is shown (muted note when it has none);
 *  - recents come from the LIVE EXERCISE FEED read (`resolveFeed('all',
 *    { includeReplies: true })`, mocked per test), not the `listPosts()`
 *    fixture: authored by THIS persona, replies included, newest first, capped
 *    at 3, in scenario time, with honest loading / error / empty states and no
 *    exercise id sent by the client (COR-001: the server scopes);
 *  - a persona with no voice-notes template reads "No voice notes authored"
 *    (muted), never "unavailable";
 *  - `actionsSlot` mounts a sibling story's control and, absent, renders nothing.
 *
 * Renders through the REAL `ExerciseContextProvider` (resolves via the
 * shared axios client's built-in dev mock adapter, same pattern as
 * `PostCard.test.tsx` / `Composer.test.tsx`). `resolveFeed` is wrapped in a spy
 * that DEFAULTS to the real (mock-adapter) implementation, so the tests that
 * read the seeded cast still do; the feed-specific tests override it per test.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { personaIdForHandle, type StaffPersona } from '@/features/personas'
import type { Post } from '@/features/social'
import { resolveFeed } from '@/features/social/services/feedService'
import { PersonaContextPanel } from './PersonaContextPanel'

vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn(actual.resolveFeed) }
})

const mockedResolveFeed = vi.mocked(resolveFeed)
const realResolveFeed = mockedResolveFeed.getMockImplementation()

beforeEach(() => {
  mockedResolveFeed.mockClear()
  if (realResolveFeed) mockedResolveFeed.mockImplementation(realResolveFeed)
})

afterEach(() => {
  resetExerciseClock()
})

const PERSONA_ID = personaIdForHandle('FairhavenWater')

/** A feed post by `authorPersonaId` — only the fields the panel reads matter. */
function buildPost(overrides: Partial<Post> & Pick<Post, 'id' | 'scenarioTime'>): Post {
  return {
    exerciseId: 'ex-mock-0001',
    authorPersonaId: PERSONA_ID,
    actingHumanId: 'human-controller-01',
    text: `text of ${overrides.id}`,
    counts: { reply: 0, repost: 0, like: 0 },
    createdWallClock: '2026-01-01T00:00:00.000Z',
    origin: 'controller-as-persona',
    ...overrides,
  }
}

// STAFF fixture: the panel renders the `personaType`-derived category chip,
// which only the staff projection carries (SOC-052/D1-008).
function buildPersona(overrides: Partial<StaffPersona> = {}): StaffPersona {
  return {
    id: personaIdForHandle('FairhavenWater'),
    exerciseId: 'ex-mock-0001',
    templateId: 'tmpl-fairhavenwater',
    displayName: 'Fairhaven Water Utility',
    handle: 'fairhavenwater',
    kind: 'org',
    personaType: 'agency',
    verified: true,
    avatarColor: '#19647e',
    initials: 'FW',
    audienceBand: 'mid',
    followerCount: 4200,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Renders through the real exercise-context provider, awaiting resolution. */
async function renderPanel(children: ReactNode) {
  const utils = render(<ExerciseContextProvider>{children}</ExerciseContextProvider>)
  await waitFor(() => expect(screen.getByTestId('persona-context-panel')).toBeInTheDocument())
  return utils
}

describe('PersonaContextPanel (persona-operation/03)', () => {
  it('renders voice notes (via the template), audience band, category chip, and recents', async () => {
    await renderPanel(<PersonaContextPanel persona={buildPersona()} />)

    expect(screen.getByTestId('persona-context-voice-notes').textContent).toMatch(/measured, factual/i)
    expect(screen.getByTestId('persona-context-audience-band')).toHaveTextContent('Mid-size audience')
    expect(screen.getByTestId('persona-context-category-chip')).toHaveTextContent('POSTING AS OFFICIAL ACCOUNT')
    // Recents are an async feed read now — wait for them.
    expect(await screen.findByTestId('persona-context-recents')).toBeInTheDocument()
    expect(screen.getByText(/boil water advisory remains in effect/i)).toBeInTheDocument()
  })

  it('derives a distinct, text-carried category chip per personaType (never color-only)', async () => {
    const { unmount } = await renderPanel(
      <PersonaContextPanel persona={buildPersona({ personaType: 'citizen', kind: 'human' })} />,
    )
    expect(screen.getByTestId('persona-context-category-chip')).toHaveTextContent('POSTING AS CITIZEN VOICE')
    unmount()
  })

  it('updates all sections when the active persona prop changes, without a full reload', async () => {
    const { rerender } = await renderPanel(<PersonaContextPanel persona={buildPersona()} />)
    expect(screen.getByTestId('persona-context-category-chip')).toHaveTextContent('POSTING AS OFFICIAL ACCOUNT')

    const nextPersona = buildPersona({
      id: personaIdForHandle('FairhavenWaterUpd'),
      templateId: 'tmpl-fairhavenwaterupd',
      displayName: 'Fairhaven Water Update',
      handle: 'fairhavenwaterupd',
      personaType: 'bad-actor',
      verified: false,
      audienceBand: 'nano',
    })

    rerender(
      <ExerciseContextProvider>
        <PersonaContextPanel persona={nextPersona} />
      </ExerciseContextProvider>,
    )

    expect(await screen.findByTestId('persona-context-category-chip')).toHaveTextContent(
      'POSTING AS UNOFFICIAL / BAD ACTOR',
    )
    expect(screen.getByTestId('persona-context-audience-band')).toHaveTextContent('Nano audience')
  })

  it('scopes recent posts to the active exercise instance (COR-001)', async () => {
    const otherExercisePersona = buildPersona({ exerciseId: 'ex-some-other-exercise' })
    await renderPanel(<PersonaContextPanel persona={otherExercisePersona} />)

    expect(
      await screen.findByText(/no recent posts from this persona in this exercise yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/boil water advisory remains in effect/i)).not.toBeInTheDocument()
  })

  it('scopes recent posts to THIS persona, not merely the exercise (a same-exercise, different persona sees only its own posts)', async () => {
    // Fulton County EM shares ex-mock-0001 with Fairhaven Water, so a filter
    // that only matched `exerciseId` (dropping the `authorPersonaId` match)
    // would incorrectly surface the utility's advisory here too.
    const fulcoEm = buildPersona({
      id: 'persona-fulcoem',
      templateId: 'tmpl-fulcoem',
      displayName: 'Fulton County EM',
      handle: 'FulcoEM',
      initials: 'FC',
      audienceBand: 'mid',
    })
    await renderPanel(<PersonaContextPanel persona={fulcoEm} />)

    expect(await screen.findByText(/coordinating with fairhaven water/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/boil water advisory remains in effect for zones 2-4/i),
    ).not.toBeInTheDocument()
  })

  it('renders a graceful, honest fallback (not a crash) when the persona\'s template cannot be resolved', async () => {
    const orphanPersona = buildPersona({ templateId: 'tmpl-does-not-exist' })
    await renderPanel(<PersonaContextPanel persona={orphanPersona} />)

    // Demo-polish C4: this is a NORMAL state (no authored voice notes), said
    // honestly and muted — the old "unavailable" wording read as an error.
    const notes = screen.getByTestId('persona-context-voice-notes')
    expect(notes).toHaveTextContent('No voice notes authored')
    expect(notes).not.toHaveTextContent(/unavailable/i)
    expect(notes).toHaveStyle({ fontStyle: 'italic' })
  })

  it('is a labelled, keyboard/screen-reader reachable section with no interactive controls', async () => {
    await renderPanel(<PersonaContextPanel persona={buildPersona()} />)
    const panel = screen.getByRole('region', { name: /persona context for fairhaven water utility/i })
    expect(panel).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})

describe('PersonaContextPanel — real data (demo-polish C4)', () => {
  it('shows the persona\'s server bio', async () => {
    await renderPanel(
      <PersonaContextPanel persona={buildPersona({ bio: 'Official water utility for Fairhaven.' })} />,
    )
    expect(screen.getByTestId('persona-context-bio')).toHaveTextContent(
      'Official water utility for Fairhaven.',
    )
  })

  it('says so, muted, when the persona has no bio', async () => {
    await renderPanel(<PersonaContextPanel persona={buildPersona({ bio: undefined })} />)
    const bio = screen.getByTestId('persona-context-bio')
    expect(bio).toHaveTextContent('No bio on this persona.')
    expect(bio).toHaveStyle({ fontStyle: 'italic' })
  })

  it('renders the bio as inert text (never markup)', async () => {
    await renderPanel(
      <PersonaContextPanel persona={buildPersona({ bio: '<img src=x onerror=alert(1)>hi' })} />,
    )
    const bio = screen.getByTestId('persona-context-bio')
    expect(bio).toHaveTextContent('<img src=x onerror=alert(1)>hi')
    expect(bio.querySelector('img')).toBeNull()
  })

  describe('recent posts from the live feed read', () => {
    beforeEach(() => {
      // 14:00 scenario time: 13:30 -> "30m ago", 12:00 -> "2h ago".
      setExerciseClock({ scenarioNow: () => new Date('2026-07-16T14:00:00Z') })
    })

    it('reads the feed WITH replies and NO exercise id (the server scopes the exercise, COR-001)', async () => {
      mockedResolveFeed.mockResolvedValue([])
      await renderPanel(<PersonaContextPanel persona={buildPersona()} />)
      await screen.findByTestId('persona-context-recents-empty')

      expect(mockedResolveFeed).toHaveBeenCalledWith('all', { includeReplies: true })
      for (const call of mockedResolveFeed.mock.calls) {
        expect(JSON.stringify(call)).not.toMatch(/ex-mock-0001/)
      }
    })

    it('shows up to 3 posts authored by THIS persona, replies included, newest first, in scenario time', async () => {
      mockedResolveFeed.mockResolvedValue([
        buildPost({ id: 'p-old', scenarioTime: '2026-07-16T09:00:00Z', text: 'oldest post' }),
        buildPost({ id: 'p-2h', scenarioTime: '2026-07-16T12:00:00Z', text: 'two hours ago post' }),
        // Someone else's post must never appear.
        buildPost({
          id: 'p-other',
          authorPersonaId: 'persona-someone-else',
          scenarioTime: '2026-07-16T13:59:00Z',
          text: 'a different persona',
        }),
        // A reply authored by this persona counts as theirs.
        buildPost({ id: 'p-reply', scenarioTime: '2026-07-16T13:30:00Z', text: 'a reply by this persona' }),
        buildPost({ id: 'p-1h', scenarioTime: '2026-07-16T13:00:00Z', text: 'one hour ago post' }),
      ])
      await renderPanel(<PersonaContextPanel persona={buildPersona()} />)

      const list = await screen.findByTestId('persona-context-recents')
      const items = within(list).getAllByRole('listitem')
      expect(items).toHaveLength(3)
      expect(items.map(li => li.textContent)).toEqual([
        'a reply by this persona30m ago',
        'one hour ago post1h ago',
        'two hours ago post2h ago',
      ])
      expect(screen.queryByText('a different persona')).not.toBeInTheDocument()
      expect(screen.queryByText('oldest post')).not.toBeInTheDocument()
    })

    it('honours maxRecents', async () => {
      mockedResolveFeed.mockResolvedValue([
        buildPost({ id: 'a', scenarioTime: '2026-07-16T13:00:00Z' }),
        buildPost({ id: 'b', scenarioTime: '2026-07-16T12:00:00Z' }),
      ])
      await renderPanel(<PersonaContextPanel persona={buildPersona()} maxRecents={1} />)

      const list = await screen.findByTestId('persona-context-recents')
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
      expect(within(list).getByText('text of a')).toBeInTheDocument()
    })

    it('accepts live-wire posts that carry no exerciseId, and drops a post from another exercise', async () => {
      const wirePost: Partial<Post> = buildPost({ id: 'wire', scenarioTime: '2026-07-16T13:00:00Z' })
      delete (wirePost as { exerciseId?: string }).exerciseId
      mockedResolveFeed.mockResolvedValue([
        wirePost as Post,
        buildPost({
          id: 'foreign',
          exerciseId: 'ex-some-other-exercise',
          scenarioTime: '2026-07-16T13:10:00Z',
        }),
      ])
      await renderPanel(<PersonaContextPanel persona={buildPersona()} />)

      const list = await screen.findByTestId('persona-context-recents')
      expect(within(list).getAllByRole('listitem')).toHaveLength(1)
      expect(within(list).getByText('text of wire')).toBeInTheDocument()
    })

    it('says so honestly when the persona has posted nothing', async () => {
      mockedResolveFeed.mockResolvedValue([
        buildPost({ id: 'x', authorPersonaId: 'persona-someone-else', scenarioTime: '2026-07-16T13:00:00Z' }),
      ])
      await renderPanel(<PersonaContextPanel persona={buildPersona()} />)

      expect(await screen.findByTestId('persona-context-recents-empty')).toHaveTextContent(
        'No recent posts from this persona in this exercise yet.',
      )
      expect(screen.queryByTestId('persona-context-recents')).not.toBeInTheDocument()
    })

    it('shows a loading note first, then the posts', async () => {
      let release: (posts: Post[]) => void = () => undefined
      mockedResolveFeed.mockReturnValue(new Promise<Post[]>(resolve => { release = resolve }))
      await renderPanel(<PersonaContextPanel persona={buildPersona()} />)

      expect(screen.getByTestId('persona-context-recents-loading')).toHaveTextContent(
        'Loading recent posts…',
      )
      release([buildPost({ id: 'late', scenarioTime: '2026-07-16T13:00:00Z' })])
      expect(await screen.findByTestId('persona-context-recents')).toBeInTheDocument()
      expect(screen.queryByTestId('persona-context-recents-loading')).not.toBeInTheDocument()
    })

    it('a failed read says it failed — it never claims the persona has no posts', async () => {
      mockedResolveFeed.mockRejectedValue(new Error('feed down'))
      await renderPanel(<PersonaContextPanel persona={buildPersona()} />)

      expect(await screen.findByTestId('persona-context-recents-error')).toHaveTextContent(
        'Recent posts could not be loaded.',
      )
      expect(screen.queryByTestId('persona-context-recents-empty')).not.toBeInTheDocument()
    })

    it('re-reads for the new persona when the active persona changes, and drops the old persona\'s posts', async () => {
      mockedResolveFeed.mockResolvedValue([
        buildPost({ id: 'water', scenarioTime: '2026-07-16T13:00:00Z', text: 'water utility post' }),
        buildPost({
          id: 'em',
          authorPersonaId: 'persona-fulcoem',
          scenarioTime: '2026-07-16T13:05:00Z',
          text: 'county em post',
        }),
      ])
      const { rerender } = await renderPanel(<PersonaContextPanel persona={buildPersona()} />)
      expect(await screen.findByText('water utility post')).toBeInTheDocument()

      rerender(
        <ExerciseContextProvider>
          <PersonaContextPanel persona={buildPersona({ id: 'persona-fulcoem', displayName: 'Fulton County EM' })} />
        </ExerciseContextProvider>,
      )

      expect(await screen.findByText('county em post')).toBeInTheDocument()
      expect(screen.queryByText('water utility post')).not.toBeInTheDocument()
    })
  })

  describe('actionsSlot', () => {
    it('mounts the slot content beside the category chip', async () => {
      await renderPanel(
        <PersonaContextPanel
          persona={buildPersona()}
          actionsSlot={<button type="button">Edit persona</button>}
        />,
      )

      const actions = screen.getByTestId('persona-context-actions')
      expect(within(actions).getByRole('button', { name: 'Edit persona' })).toBeInTheDocument()
    })

    it('renders nothing for the slot when it is absent', async () => {
      await renderPanel(<PersonaContextPanel persona={buildPersona()} />)
      expect(screen.queryByTestId('persona-context-actions')).not.toBeInTheDocument()
    })
  })
})
