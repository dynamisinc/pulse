/**
 * features/social/components/PostCard.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 02's acceptance criteria for the keystone `<PostCard>`
 * (SOC-002, D1-003, R-001, R-002, R-004, NFR-001, NFR-004, COR-053):
 *  - the verified seal renders in the fixed seal-blue, unaffected by the
 *    per-exercise accent;
 *  - an unverified lookalike persona (SOC-052) renders a complete, plausible
 *    card with NO mark and no substitute "unverified" label;
 *  - no platform-added editorial badge text ever renders;
 *  - the action row renders in canonical reply/repost/like(/share) order
 *    with correct counts, and `readOnly` hides the interactive controls
 *    while keeping the counts visible as inert text (COR-015);
 *  - post text renders as inert text, never parsed HTML (NFR-004);
 *  - the relative timestamp renders via scenario time, never wall-clock
 *    (COR-053);
 *  - the card body is keyboard-operable (Enter/Space activates `onOpen`).
 *
 * Renders through the REAL `ExerciseContextProvider` (resolves via the
 * shared axios client's built-in dev mock adapter, exactly as the shipped
 * app does — same pattern as `ShellLayout.test.tsx`), and swaps in a fixed
 * exercise clock so scenario-relative rendering is deterministic.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { personaById, personaIdForHandle, type Persona } from '@/features/personas'
import { PostCard, type PostCounts, type PostView } from './PostCard'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

/** Renders a child through the real `ExerciseContextProvider`, awaiting resolution. */
async function renderWithExerciseContext(children: ReactNode) {
  const utils = render(<ExerciseContextProvider>{children}</ExerciseContextProvider>)
  await waitFor(() => expect(screen.getByTestId('post-card')).toBeInTheDocument())
  return utils
}

function buildPersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-test-author',
    exerciseId: 'ex-mock-0001',
    templateId: 'tmpl-test-author',
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

function buildPost(overrides: Partial<PostView> = {}): PostView {
  return {
    id: 'post-1',
    author: buildPersona(),
    text: 'Boil-water advisory update: zones 2-4, guidance to follow.',
    counts: buildCounts(),
    scenarioTime: '2026-07-16T12:00:00.000Z',
    ...overrides,
  }
}

afterEach(() => {
  resetExerciseClock()
})

describe('PostCard — verified mark (SOC-002, D1-003, R-001)', () => {
  it('renders the seal-blue mark for a verified author', async () => {
    const verifiedAuthor = personaById(personaIdForHandle('FairhavenWater'))
    expect(verifiedAuthor).toBeDefined()
    if (!verifiedAuthor) throw new Error('fixture missing')

    await renderWithExerciseContext(<PostCard post={buildPost({ author: verifiedAuthor })} />)

    const mark = screen.getByTestId('verified-mark')
    const sealPath = mark.querySelector('path[fill]')
    expect(sealPath).toHaveAttribute('fill', '#2D9CDB')
  })

  it('keeps the mark seal-blue even when an ancestor sets a different --pulse-ac accent', async () => {
    const verifiedAuthor = buildPersona({ verified: true, kind: 'org' })

    render(
      <div style={{ ['--pulse-ac' as string]: '#DB3A54' }}>
        <ExerciseContextProvider>
          <PostCard post={buildPost({ author: verifiedAuthor })} />
        </ExerciseContextProvider>
      </div>,
    )
    await waitFor(() => expect(screen.getByTestId('post-card')).toBeInTheDocument())

    const mark = screen.getByTestId('verified-mark')
    const sealPath = mark.querySelector('path[fill]')
    expect(sealPath).toHaveAttribute('fill', '#2D9CDB')
    expect(sealPath).not.toHaveAttribute('fill', '#DB3A54')
  })
})

describe('PostCard — unverified lookalike (SOC-052, D1-008)', () => {
  it('renders NO verified mark for an unverified impersonator, yet still a complete, plausible card', async () => {
    const impersonator = personaById(personaIdForHandle('FairhavenWaterUpd'))
    expect(impersonator).toBeDefined()
    if (!impersonator) throw new Error('fixture missing')
    expect(impersonator.verified).toBe(false)

    await renderWithExerciseContext(<PostCard post={buildPost({ author: impersonator })} />)

    expect(screen.queryByTestId('verified-mark')).not.toBeInTheDocument()
    // Absence is the ONLY signal — no substitute "unverified" text/badge.
    expect(screen.queryByText(/unverified/i)).not.toBeInTheDocument()
    // Still a complete, plausible-looking card.
    expect(screen.getByText(impersonator.displayName)).toBeInTheDocument()
    expect(screen.getByText(`@${impersonator.handle}`)).toBeInTheDocument()
    expect(screen.getByTestId('post-avatar')).toBeInTheDocument()
  })
})

describe('PostCard — no platform-added editorial badges (SOC-002)', () => {
  it('never renders "OFFICIAL" or "BREAKING" chrome', async () => {
    const { container } = await renderWithExerciseContext(
      <PostCard post={buildPost()} />,
    )

    expect(container.textContent).not.toMatch(/official/i)
    expect(container.textContent).not.toMatch(/breaking/i)
  })
})

describe('PostCard — action row (R-002)', () => {
  it('renders reply, repost, like in canonical order with the right counts', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ counts: { reply: 3, repost: 7, like: 42 } })} />,
    )

    const actionsRegion = screen.getByTestId('post-actions')
    const buttons = actionsRegion.querySelectorAll('button[data-action]')

    expect(Array.from(buttons).map(b => b.getAttribute('data-action'))).toEqual([
      'reply',
      'repost',
      'like',
    ])
    expect(buttons[0]).toHaveTextContent('3')
    expect(buttons[1]).toHaveTextContent('7')
    expect(buttons[2]).toHaveTextContent('42')
  })

  it('appends share, in order, when present', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ counts: { reply: 1, repost: 2, like: 3, share: 4 } })} />,
    )

    const actionsRegion = screen.getByTestId('post-actions')
    const buttons = actionsRegion.querySelectorAll('button[data-action]')

    expect(Array.from(buttons).map(b => b.getAttribute('data-action'))).toEqual([
      'reply',
      'repost',
      'like',
      'share',
    ])
    expect(buttons[3]).toHaveTextContent('4')
  })

  it('omits share entirely when not present in counts', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ counts: { reply: 1, repost: 2, like: 3 } })} />,
    )

    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
  })
})

describe('PostCard — readOnly variant (COR-015, D1-011)', () => {
  it('hides the interactive controls but still shows the counts as inert text', async () => {
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ counts: { reply: 5, repost: 6, like: 7 } })}
        variant="readOnly"
      />,
    )

    const actionsRegion = screen.getByTestId('post-actions')
    expect(actionsRegion.querySelectorAll('button')).toHaveLength(0)
    expect(actionsRegion).toHaveTextContent('5')
    expect(actionsRegion).toHaveTextContent('6')
    expect(actionsRegion).toHaveTextContent('7')
  })

  it('renders interactive buttons in the default "full" variant', async () => {
    await renderWithExerciseContext(<PostCard post={buildPost()} />)

    const actionsRegion = screen.getByTestId('post-actions')
    expect(actionsRegion.querySelectorAll('button')).toHaveLength(3)
  })
})

describe('PostCard — content security (NFR-004)', () => {
  it('renders a script-like text value as inert text, never as parsed HTML', async () => {
    const maliciousText = '<img src=x onerror=alert(1)>'
    const { container } = await renderWithExerciseContext(
      <PostCard post={buildPost({ text: maliciousText })} />,
    )

    // No <img> element was ever created from the text.
    expect(container.querySelector('img')).not.toBeInTheDocument()
    // The literal string renders as text content instead.
    expect(screen.getByText(maliciousText)).toBeInTheDocument()
  })
})

describe('PostCard — scenario time only (COR-053)', () => {
  it('renders the relative time from the injected exercise clock, not wall-clock', async () => {
    // An arbitrary scenario "now" nowhere near real wall-clock time at any
    // real test-run moment, so a wall-clock leak would fail this assertion
    // rather than coincidentally pass.
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))

    await renderWithExerciseContext(
      <PostCard post={buildPost({ scenarioTime: '2031-03-01T12:00:00.000Z' })} />,
    )

    const time = screen.getByText('2h ago')
    expect(time.tagName.toLowerCase()).toBe('time')
    // Absolute rendering is exposed too, e.g. via the tooltip/title.
    expect(time).toHaveAttribute('title')
    expect(time.getAttribute('title')).not.toBe('')
  })

  it('renders the machine-readable dateTime and an absolute title anchored to scenario time, never wall-clock', async () => {
    // Same rationale as above: an instant far from any real test-run
    // wall-clock time, so a leak of Date.now()/new Date() into EITHER the
    // `dateTime` attribute or the absolute tooltip fails this assertion
    // rather than coincidentally passing. The Wave-0 mock exercise scope's
    // fixed zone (America/New_York) turns the UTC instant below into one
    // known local string.
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))

    await renderWithExerciseContext(
      <PostCard post={buildPost({ scenarioTime: '2031-03-01T12:00:00.000Z' })} />,
    )

    const time = screen.getByText('2h ago')
    expect(time).toHaveAttribute('dateTime', '2031-03-01T12:00:00.000Z')
    expect(time).toHaveAttribute('title', 'Mar 1, 2031, 7:00 AM')
  })
})

describe('PostCard — keyboard operability (NFR-001)', () => {
  it('fires onOpen on click', async () => {
    const onOpen = vi.fn()
    await renderWithExerciseContext(<PostCard post={buildPost({ id: 'post-42' })} onOpen={onOpen} />)

    screen.getByTestId('post-open-target').click()
    expect(onOpen).toHaveBeenCalledWith('post-42')
  })

  it('fires onOpen on Enter', async () => {
    const onOpen = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    await renderWithExerciseContext(<PostCard post={buildPost({ id: 'post-7' })} onOpen={onOpen} />)

    const target = screen.getByTestId('post-open-target')
    target.focus()
    await user.keyboard('{Enter}')

    expect(onOpen).toHaveBeenCalledWith('post-7')
  })

  it('fires onOpen on Space', async () => {
    const onOpen = vi.fn()
    const { default: userEvent } = await import('@testing-library/user-event')
    const user = userEvent.setup()

    await renderWithExerciseContext(<PostCard post={buildPost({ id: 'post-9' })} onOpen={onOpen} />)

    const target = screen.getByTestId('post-open-target')
    target.focus()
    await user.keyboard(' ')

    expect(onOpen).toHaveBeenCalledWith('post-9')
  })

  it('exposes role="button" and tabIndex only when onOpen is provided', async () => {
    await renderWithExerciseContext(<PostCard post={buildPost()} />)

    const target = screen.getByTestId('post-open-target')
    expect(target).not.toHaveAttribute('role')
    expect(target).not.toHaveAttribute('tabindex')
  })
})

describe('PostCard — media and link preview', () => {
  it('renders an accessible media placeholder for each attachment', async () => {
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({ media: [{ kind: 'image', alt: 'Photo of flooded Main Street' }] })}
      />,
    )

    expect(screen.getByRole('img', { name: 'Photo of flooded Main Street' })).toBeInTheDocument()
  })

  it('renders a link preview card with title and domain', async () => {
    await renderWithExerciseContext(
      <PostCard
        post={buildPost({
          linkPreview: { title: 'Boil water advisory lifted', domain: 'fulco.gov' },
        })}
      />,
    )

    expect(screen.getByText('Boil water advisory lifted')).toBeInTheDocument()
    expect(screen.getByText('fulco.gov')).toBeInTheDocument()
  })
})

describe('PostCard — canonical anatomy renders together (R-002, AC1)', () => {
  it('renders avatar, name, handle, separator, relative scenario-time, text, and the action row as one card', async () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T13:00:00.000Z')))
    const author = buildPersona({ displayName: 'Keisha Ward', handle: 'kwardFH' })

    await renderWithExerciseContext(
      <PostCard
        post={buildPost({
          author,
          scenarioTime: '2026-07-16T12:00:00.000Z',
          text: 'Boil-water advisory lifted for zone 3.',
        })}
      />,
    )

    expect(screen.getByTestId('post-avatar')).toBeInTheDocument()
    expect(screen.getByText('Keisha Ward')).toBeInTheDocument()
    expect(screen.getByText('@kwardFH')).toBeInTheDocument()
    expect(screen.getByText('·')).toBeInTheDocument()
    expect(screen.getByText('1h ago')).toBeInTheDocument()
    expect(screen.getByText('Boil-water advisory lifted for zone 3.')).toBeInTheDocument()
    expect(screen.getByTestId('post-actions')).toBeInTheDocument()
  })
})

describe('PostCard — action buttons carry an accessible name including their count (NFR-001)', () => {
  it('exposes reply/repost/like as buttons named "<Label>, <count>", not a color/icon-only signal', async () => {
    await renderWithExerciseContext(
      <PostCard post={buildPost({ counts: { reply: 3, repost: 7, like: 42 } })} />,
    )

    expect(screen.getByRole('button', { name: 'Reply, 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Repost, 7' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Like, 42' })).toBeInTheDocument()
  })
})

describe('PostCard — action row is a sibling of the open target, never nested (NFR-001)', () => {
  it('does not fire onOpen when an action button is clicked', async () => {
    const onOpen = vi.fn()
    await renderWithExerciseContext(<PostCard post={buildPost()} onOpen={onOpen} />)

    screen.getByRole('button', { name: /^reply/i }).click()

    expect(onOpen).not.toHaveBeenCalled()
  })

  it('does not fire onOpen when the avatar is clicked', async () => {
    const onOpen = vi.fn()
    await renderWithExerciseContext(<PostCard post={buildPost()} onOpen={onOpen} />)

    screen.getByTestId('post-avatar').click()

    expect(onOpen).not.toHaveBeenCalled()
  })
})

describe('PostCard — readOnly controls are absent, not merely disabled (COR-015, D1-011)', () => {
  it('exposes no button role and no tab stop on the inert counts', async () => {
    await renderWithExerciseContext(<PostCard post={buildPost()} variant="readOnly" />)

    const actionsRegion = screen.getByTestId('post-actions')
    expect(within(actionsRegion).queryAllByRole('button')).toHaveLength(0)
    expect(actionsRegion.querySelectorAll('[tabindex]')).toHaveLength(0)
  })
})

describe('PostCard — content security (NFR-004) — script payload', () => {
  it('renders a <script> tag payload as inert text, never parsed as a real element', async () => {
    const maliciousText = '<script>window.__pulsePostcardXssProbe = true</script>'
    const { container } = await renderWithExerciseContext(
      <PostCard post={buildPost({ text: maliciousText })} />,
    )

    // A dangerouslySetInnerHTML render would parse this into a literal
    // (inert-in-jsdom, but still DOM-present) <script> element; a plain-text
    // React child never does.
    expect(container.querySelector('script')).not.toBeInTheDocument()
    expect(screen.getByText(maliciousText)).toBeInTheDocument()
  })
})

describe('PostCard — no origin/provenance leak even if present on the data (XC-002)', () => {
  it('never renders an origin/source-exercise value that is not part of PostView', async () => {
    const postWithForeignFields = {
      ...buildPost(),
      origin: 'staff-console-mirror',
      sourceExerciseId: 'ex-other-9999',
    } as PostView & Record<string, unknown>

    const { container } = await renderWithExerciseContext(
      <PostCard post={postWithForeignFields} />,
    )

    expect(container.textContent).not.toMatch(/staff-console-mirror/i)
    expect(container.textContent).not.toMatch(/ex-other-9999/i)
  })
})
