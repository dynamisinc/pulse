/**
 * features/social/components/FollowerList.test.tsx
 * ---------------------------------------------------------------------------
 * Test pass for profiles-social-graph/05 "Audience magnitude & follower
 * affordance" (#113) — `<FollowerList>`'s presentational contract (AC2,
 * SOC-054/D1-012, NFR-001):
 *
 *  - it renders the REAL follow edges, then the italic "…and ~48.2K others";
 *  - **it NEVER fabricates rows** — the row count equals `edges.length` at any
 *    magnitude, including a mega-band 1.5M audience. This is the story's hard
 *    rule and the assertion a reviewer should look for first;
 *  - the "…and ~N others" line is a REAL, announced element (present in the
 *    accessible text, outside the `<ul>` so the list length never lies), not a
 *    decorative string;
 *  - the verified seal renders by presence/absence only (SOC-052/D1-008 — the
 *    platform never labels a lookalike fake).
 *
 * Rendered STANDALONE (no profile page, no fetch) — the component takes its
 * already exercise-scoped edges as props. The COR-001/AC4 assertion ("every
 * rendered edge belongs to the active exercise") is DEFERRED to the integration
 * pass: it is vacuous until something actually queries for edges. The fixtures
 * below carry `exerciseId` so that assertion is expressible the moment the
 * Followers view is wired to a real read.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FollowerList, type FollowerEdge } from './FollowerList'

/** The active exercise every fixture edge belongs to (COR-001/AC4). */
const EXERCISE_ID = 'exercise-fairhaven'

const edge = (overrides: Partial<FollowerEdge> & Pick<FollowerEdge, 'id' | 'handle'>):
FollowerEdge => ({
  exerciseId: EXERCISE_ID,
  displayName: 'Maria Vega',
  kind: 'human',
  verified: false,
  avatarColor: '#3c6e91',
  initials: 'MV',
  ...overrides,
})

const EDGES: readonly FollowerEdge[] = [
  edge({ id: 'persona-mvega_fh', handle: 'mvega_fh', displayName: 'Maria Vega' }),
  edge({
    id: 'persona-fairhavenwater',
    handle: 'FairhavenWater',
    displayName: 'Fairhaven Water',
    kind: 'org',
    verified: true,
    initials: 'FW',
    bio: 'Official utility account for the City of Fairhaven.',
  }),
  edge({ id: 'persona-tbrandt41', handle: 'tbrandt41', displayName: 'Tom Brandt' }),
]

describe('FollowerList — real edges then the magnitude affordance (AC2, D1-012)', () => {
  it('renders one row per REAL follow edge, with name and handle', () => {
    render(<FollowerList edges={EDGES} magnitude={48_200} />)

    const rows = screen.getAllByTestId('follower-row')
    expect(rows).toHaveLength(EDGES.length)
    expect(within(rows[0] as HTMLElement).getByText('Maria Vega')).toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).getByText('@mvega_fh')).toBeInTheDocument()
    expect(within(rows[1] as HTMLElement).getByText('Fairhaven Water')).toBeInTheDocument()
  })

  it('renders the italic "…and ~48.2K others" line AFTER the real edges', () => {
    const { container } = render(<FollowerList edges={EDGES} magnitude={48_200} />)

    const others = screen.getByTestId('follower-others')
    expect(others).toHaveTextContent('…and ~48.2K others')

    // Document order: the affordance follows the list, never precedes it.
    const list = screen.getByTestId('follower-edges')
    expect(list.compareDocumentPosition(others) & Node.DOCUMENT_POSITION_FOLLOWING)
      .toBeTruthy()
    expect(container.querySelector('[data-testid="follower-others"]')).not.toBeNull()
  })

  it('formats the magnitude compactly through the shared model', () => {
    const { rerender } = render(<FollowerList edges={EDGES} magnitude={1_500_000} />)
    expect(screen.getByTestId('follower-others')).toHaveTextContent('…and ~1.5M others')

    rerender(<FollowerList edges={EDGES} magnitude={450} />)
    expect(screen.getByTestId('follower-others')).toHaveTextContent('…and ~450 others')
  })
})

describe('FollowerList — NEVER fabricates followers (the hard rule: SOC-054/D1-012)', () => {
  it('renders exactly edges.length rows at a mega-band magnitude', () => {
    render(<FollowerList edges={EDGES} magnitude={1_500_000} />)

    expect(screen.getAllByTestId('follower-row')).toHaveLength(3)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })

  it('renders NO list at all when there are no real edges, however large the audience', () => {
    render(<FollowerList edges={[]} magnitude={48_200} />)

    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryAllByTestId('follower-row')).toHaveLength(0)
    // The audience is still conveyed — as a number, not as people.
    expect(screen.getByTestId('follower-others')).toHaveTextContent('…and ~48.2K others')
  })

  it('keeps the row count fixed as the magnitude grows by orders of magnitude', () => {
    const { rerender } = render(<FollowerList edges={EDGES} magnitude={0} />)
    expect(screen.getAllByTestId('follower-row')).toHaveLength(3)

    for (const magnitude of [4_800, 46_000, 220_000, 1_500_000]) {
      rerender(<FollowerList edges={EDGES} magnitude={magnitude} />)
      expect(screen.getAllByTestId('follower-row')).toHaveLength(3)
    }
  })

  it('renders no "others" line when the account has no simulated audience', () => {
    render(<FollowerList edges={EDGES} magnitude={0} />)

    expect(screen.queryByTestId('follower-others')).toBeNull()
    expect(screen.getAllByTestId('follower-row')).toHaveLength(3)
  })

  it('degrades safely on a broken magnitude — no line, no NaN, real rows intact', () => {
    // Shares the model's `safeCount` guard: a broken count is 0, never rendered.
    for (const broken of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const { unmount } = render(<FollowerList edges={EDGES} magnitude={broken} />)
      expect(screen.queryByTestId('follower-others')).toBeNull()
      expect(screen.getAllByTestId('follower-row')).toHaveLength(3)
      expect(screen.queryByText(/NaN|Infinity/)).toBeNull()
      unmount()
    }
  })

  it('shows an honest empty state when there are neither edges nor an audience', () => {
    render(<FollowerList edges={[]} magnitude={0} />)

    expect(screen.getByTestId('follower-empty')).toHaveTextContent('No followers yet.')
    expect(screen.queryByRole('list')).toBeNull()
    expect(screen.queryByTestId('follower-others')).toBeNull()
  })
})

describe('FollowerList — accessibility (NFR-001)', () => {
  it('exposes a labelled Followers region containing a real list', () => {
    render(<FollowerList edges={EDGES} magnitude={48_200} />)

    const region = screen.getByRole('region', { name: 'Followers' })
    expect(within(region).getByRole('list')).toBeInTheDocument()
  })

  it('keeps the "…and ~N others" line OUT of the list so the item count never lies', () => {
    render(<FollowerList edges={EDGES} magnitude={48_200} />)

    const list = screen.getByRole('list')
    expect(within(list).queryByText(/others/)).toBeNull()
    expect(screen.getAllByRole('listitem')).toHaveLength(EDGES.length)
  })

  it('announces the affordance as real text, never aria-hidden or icon-only', () => {
    render(<FollowerList edges={EDGES} magnitude={48_200} />)

    const others = screen.getByText(/…and ~48\.2K others/)
    expect(others).toBeInTheDocument()
    expect(others.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('renders the verified seal by presence/absence only (SOC-052/D1-008)', () => {
    render(<FollowerList edges={EDGES} magnitude={48_200} />)

    const rows = screen.getAllByTestId('follower-row')
    // Exactly one seeded edge is verified; the unverified lookalikes carry no
    // counter-badge — absence IS the signal, the platform never flags a fake.
    expect(screen.getAllByTestId('verified-mark')).toHaveLength(1)
    expect(within(rows[1] as HTMLElement).getByTestId('verified-mark')).toBeInTheDocument()
    expect(within(rows[0] as HTMLElement).queryByTestId('verified-mark')).toBeNull()
    expect(screen.queryByText(/unverified/i)).toBeNull()
  })
})
