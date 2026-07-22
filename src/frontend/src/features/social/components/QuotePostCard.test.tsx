/**
 * features/social/components/QuotePostCard.test.tsx
 * ---------------------------------------------------------------------------
 * Covers amplification story-01 ACs for the presentation (SOC-020, SOC-003,
 * COR-053, D1-011, NFR-004, NFR-001):
 *   - a repost attributes "X reposted" above the original post;
 *   - a quote embeds the original AND renders the added commentary;
 *   - the embedded original's timestamp renders in scenario time (COR-053),
 *     from the injected exercise clock, never wall-clock;
 *   - observer mode (readOnly) hides the reposted post's interactive controls
 *     (D1-011);
 *   - commentary renders as inert text, never parsed HTML (NFR-004).
 *
 * Renders through the REAL `ExerciseContextProvider` (resolves via the shared
 * axios client's dev mock adapter, exactly as PostCard.test.tsx does) with a
 * fixed exercise clock so scenario-relative rendering is deterministic.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import type { Persona } from '@/features/personas'
import { QuotePostCard } from './QuotePostCard'
import type { PostView, PostCounts } from './PostCard'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

async function renderWithExerciseContext(children: ReactNode) {
  const utils = render(<ExerciseContextProvider>{children}</ExerciseContextProvider>)
  await waitFor(() => expect(screen.getByTestId('quote-post-card')).toBeInTheDocument())
  return utils
}

function buildPersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-author',
    exerciseId: 'ex-mock-0001',
    templateId: 'tmpl-author',
    displayName: 'Test Author',
    handle: 'testauthor',
    kind: 'human',
    personaType: 'citizen',
    verified: false,
    avatarColor: '#7c5cd6',
    initials: 'TA',
    audienceBand: 'micro',
    followerCount: 420,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function buildCounts(overrides: Partial<PostCounts> = {}): PostCounts {
  return { reply: 3, repost: 7, like: 42, ...overrides }
}

function buildOriginal(overrides: Partial<PostView> = {}): PostView {
  return {
    id: 'post-original-1',
    author: buildPersona({ displayName: 'Fairhaven Water', handle: 'FairhavenWater' }),
    text: 'Boil water advisory remains in effect for Zones 2-4.',
    counts: buildCounts(),
    scenarioTime: '2031-03-01T12:00:00.000Z',
    ...overrides,
  }
}

const AMPLIFIER = buildPersona({ displayName: 'Maria Vega', handle: 'mvega_fh' })

afterEach(() => {
  resetExerciseClock()
})

describe('QuotePostCard — repost (SOC-020)', () => {
  it('attributes "X reposted" above the original post', async () => {
    await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal()}
        scenarioTime="2031-03-01T14:00:00.000Z"
      />,
    )

    expect(screen.getByTestId('quote-post-card')).toHaveAttribute('data-amplification', 'repost')
    expect(screen.getByText('Maria Vega reposted')).toBeInTheDocument()
    // The original is rendered verbatim through <PostCard>.
    expect(screen.getByTestId('post-card')).toBeInTheDocument()
    expect(
      screen.getByText('Boil water advisory remains in effect for Zones 2-4.'),
    ).toBeInTheDocument()
  })

  it('does not render a quote commentary block in repost mode', async () => {
    await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal()}
        scenarioTime="2031-03-01T14:00:00.000Z"
      />,
    )

    expect(screen.queryByTestId('quote-commentary')).not.toBeInTheDocument()
    expect(screen.queryByTestId('quoted-embed')).not.toBeInTheDocument()
  })
})

describe('QuotePostCard — quote (SOC-020)', () => {
  it('embeds the original and renders the added commentary', async () => {
    await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal()}
        scenarioTime="2031-03-01T14:00:00.000Z"
        commentary="This account is NOT the official utility — do not share."
      />,
    )

    expect(screen.getByTestId('quote-post-card')).toHaveAttribute('data-amplification', 'quote')
    expect(
      screen.getByText('This account is NOT the official utility — do not share.'),
    ).toBeInTheDocument()

    // The original is embedded (its author + text visible), with NO action row.
    const embed = screen.getByTestId('quoted-embed')
    expect(within(embed).getByText('Fairhaven Water')).toBeInTheDocument()
    expect(
      within(embed).getByText('Boil water advisory remains in effect for Zones 2-4.'),
    ).toBeInTheDocument()
    expect(within(embed).queryByTestId('post-actions')).not.toBeInTheDocument()
  })

  it('renders an empty-string commentary as a quote (present, not repost)', async () => {
    await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal()}
        scenarioTime="2031-03-01T14:00:00.000Z"
        commentary=""
      />,
    )

    expect(screen.getByTestId('quote-post-card')).toHaveAttribute('data-amplification', 'quote')
    expect(screen.getByTestId('quoted-embed')).toBeInTheDocument()
    expect(screen.queryByText(/reposted$/)).not.toBeInTheDocument()
  })
})

describe('QuotePostCard — scenario time on the quoted embed (COR-053)', () => {
  it('renders the embed timestamp from the injected exercise clock, not wall-clock', async () => {
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))

    await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal({ scenarioTime: '2031-03-01T12:00:00.000Z' })}
        scenarioTime="2031-03-01T13:00:00.000Z"
        commentary="context"
      />,
    )

    const embed = screen.getByTestId('quoted-embed')
    // 12:00 vs a 14:00 scenario-now -> "2h ago", with an absolute-time title.
    const embedTime = within(embed).getByText('2h ago')
    expect(embedTime.tagName.toLowerCase()).toBe('time')
    expect(embedTime).toHaveAttribute('dateTime', '2031-03-01T12:00:00.000Z')
    expect(embedTime.getAttribute('title')).not.toBe('')

    // The quoter's own timestamp (13:00 vs 14:00) is "1h ago" — also scenario time.
    expect(screen.getByText('1h ago')).toBeInTheDocument()
  })
})

describe('QuotePostCard — observer mode (COR-015, D1-011)', () => {
  it('hides the reposted post interactive controls in readOnly', async () => {
    await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal()}
        scenarioTime="2031-03-01T14:00:00.000Z"
        variant="readOnly"
      />,
    )

    const actionsRegion = screen.getByTestId('post-actions')
    expect(within(actionsRegion).queryAllByRole('button')).toHaveLength(0)
  })

  it('renders interactive controls on the reposted post in the default full variant', async () => {
    await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal()}
        scenarioTime="2031-03-01T14:00:00.000Z"
      />,
    )

    const actionsRegion = screen.getByTestId('post-actions')
    expect(within(actionsRegion).queryAllByRole('button').length).toBeGreaterThan(0)
  })
})

describe('QuotePostCard — content security (NFR-004)', () => {
  it('renders script-like commentary as inert text, never parsed HTML', async () => {
    const malicious = '<img src=x onerror=alert(1)>'
    const { container } = await renderWithExerciseContext(
      <QuotePostCard
        amplifier={AMPLIFIER}
        original={buildOriginal()}
        scenarioTime="2031-03-01T14:00:00.000Z"
        commentary={malicious}
      />,
    )

    expect(container.querySelector('img')).not.toBeInTheDocument()
    expect(screen.getByText(malicious)).toBeInTheDocument()
  })
})
