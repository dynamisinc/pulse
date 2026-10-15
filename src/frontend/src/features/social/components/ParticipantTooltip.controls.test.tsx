/**
 * features/social/components/ParticipantTooltip.controls.test.tsx
 * ---------------------------------------------------------------------------
 * The participant tooltip ON THE REAL CONTROLS (demo-feedback story 13, #494). One
 * representative of each kind is rendered and driven by hover and by keyboard focus:
 *
 *  - post actions  Reply / Like (hover + focus) and Pin (focus), in `PostActions`;
 *  - composer      "Add photos or video" (hover) and the emoji button (focus);
 *  - media         the viewer's "Next image" (hover + focus) and the video player's
 *                  Mute and Expand (focus);
 *  - nav rail      Home and Post BELOW 840px (icon rail: hover + focus), and nothing at
 *                  840px and up, where the label text is visible;
 *  - headers       the detail header's Back (focus).
 *
 * Each case checks the label matches the control's name (its `aria-label`, or the
 * leading name of a counted one), that the `aria-label` itself is unchanged, and that
 * leave / blur hides it. A source table then pins that EVERY control listed in the AC is
 * wrapped, including the ones not rendered here (attachment remove, video Play,
 * search clear, compose-modal Close, media viewer Previous).
 */
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { personaById, personaIdForHandle } from '@/features/personas'
import { readSrcFile } from '@/test/readSource'
import { resetMockReactions } from '../services/reactionService'
import { resetMockPins } from '../pinned/mockPins'
import { DetailHeader } from '../layout/DetailHeader'
import { NAV_ICON_RAIL_QUERY } from '../layout/frameMetrics'
import { NavRail } from '../layout/NavRail'
import { MemorySocialNavigationProvider } from '../layout/SocialNavigationProvider'
import { Composer } from './Composer'
import { MediaViewer } from './media/MediaViewer'
import { installMediaElementStubs } from './media/mediaTestUtils'
import { resetPlaybackForTests } from './media/playbackCoordinator'
import { VideoPlayer } from './media/VideoPlayer'
import { PostActions } from './post/PostActions'
import type { PostView } from './post/types'
import { TOOLTIP_HOVER_DELAY_MS } from './ParticipantTooltip'
import type { PostMedia } from '../types/post'

vi.mock('@/features/participant-shell/components/OverlayLayer/overlayState', () => ({
  useOverlayState: () => ({ state: 'none', register: 'in-fiction', message: '' }),
}))

const tooltip = () => screen.queryByTestId('participant-tooltip')

/** Waits out the hover dwell for the bubble. */
const hovered = () =>
  screen.findByTestId('participant-tooltip', {}, { timeout: TOOLTIP_HOVER_DELAY_MS * 5 })

/** Moves keyboard focus to `target` with Tab (a real keyboard path, not `.focus()`). */
async function tabTo(user: ReturnType<typeof userEvent.setup>, target: HTMLElement) {
  for (let i = 0; i < 40 && document.activeElement !== target; i += 1) await user.tab()
  expect(target).toHaveFocus()
}

/** Pins `matchMedia` so only the icon-rail query matches (`iconRail`) or nothing does. */
function stubViewport({ iconRail }: { iconRail: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: iconRail && query === NAV_ICON_RAIL_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

beforeEach(() => {
  resetMockReactions()
  resetMockPins()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function inSession(node: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>{node}</SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

function post(): PostView {
  const author = personaById(personaIdForHandle('FairhavenWater'))
  if (!author) throw new Error('fixture missing seeded persona')
  return {
    id: 'tooltip-post-1',
    author,
    text: 'text',
    counts: { reply: 3, repost: 7, like: 42 },
    scenarioTime: '2026-07-16T12:00:00.000Z',
  }
}

describe('post actions (Reply, Repost, Like, Pin)', () => {
  it('Reply and Like show their names on hover; the counted aria-labels are unchanged', async () => {
    const user = userEvent.setup()
    inSession(<PostActions post={post()} variant="full" onReply={vi.fn()} />)
    const row = await screen.findByTestId('post-actions')
    const reply = within(row).getByRole('button', { name: 'Reply, 3' })
    const like = within(row).getByRole('button', { name: 'Like, 42' })

    await user.hover(reply)
    expect(await hovered()).toHaveTextContent(/^Reply$/)
    await user.unhover(reply)
    expect(tooltip()).toBeNull()

    await user.hover(like)
    expect(await hovered()).toHaveTextContent(/^Like$/)
    // The tooltip is the leading name of the counted label; the label itself is intact.
    expect(like.getAttribute('aria-label')?.startsWith('Like')).toBe(true)
    expect(like).toHaveAttribute('aria-label', 'Like, 42')
    await user.unhover(like)
    expect(tooltip()).toBeNull()
  })

  it('keyboard focus shows Repost and Pin at once, and blur hides them', async () => {
    const user = userEvent.setup()
    inSession(<PostActions post={post()} variant="full" onReply={vi.fn()} />)
    const row = await screen.findByTestId('post-actions')
    const repost = within(row).getByRole('button', { name: 'Repost, 7' })
    const pin = await within(row).findByRole('button', { name: 'Pin' })

    await tabTo(user, repost)
    expect(tooltip()).toHaveTextContent(/^Repost$/)
    await tabTo(user, pin)
    expect(tooltip()).toHaveTextContent(/^Pin$/)
    expect(pin).toHaveAttribute('aria-label', 'Pin')
    await user.tab()
    expect(tooltip()).toBeNull()
  })
})

describe('composer (attach, emoji)', () => {
  it('"Add photos or video" on hover, "Add emoji" on keyboard focus', async () => {
    const user = userEvent.setup()
    inSession(<Composer />)
    const form = await screen.findByTestId('composer')
    const attach = within(form).getByRole('button', { name: 'Add photos or video' })
    const emoji = within(form).getByRole('button', { name: 'Add emoji' })

    await user.hover(attach)
    expect(await hovered()).toHaveTextContent('Add photos or video')
    await user.unhover(attach)
    expect(tooltip()).toBeNull()

    await tabTo(user, emoji)
    expect(tooltip()).toHaveTextContent('Add emoji')
    expect(emoji).toHaveAttribute('aria-label', 'Add emoji')
    await user.tab()
    expect(tooltip()).toBeNull()
  })
})

function image(n: number): PostMedia {
  return {
    id: `m${n}`,
    kind: 'image',
    url: `/mock-media/photos/p${n}.svg`,
    alt: `Photo ${n}`,
    width: 1600,
    height: 900,
  }
}

describe('media (viewer previous / next, video controls)', () => {
  beforeEach(() => {
    installMediaElementStubs()
    resetPlaybackForTests()
  })

  it('the viewer\'s "Next image" shows on hover and on keyboard focus', async () => {
    const user = userEvent.setup()
    render(<MediaViewer items={[image(1), image(2), image(3)]} onClose={vi.fn()} />)
    const next = screen.getByRole('button', { name: 'Next image' })

    await user.hover(next)
    expect(await hovered()).toHaveTextContent('Next image')
    await user.unhover(next)
    expect(tooltip()).toBeNull()

    await tabTo(user, next)
    expect(tooltip()).toHaveTextContent('Next image')
    expect(next).toHaveAttribute('aria-label', 'Next image')
    await user.tab()
    expect(tooltip()).toBeNull()
  })

  it('the video player\'s Mute, then Expand, show on keyboard focus', async () => {
    const user = userEvent.setup()
    render(
      <VideoPlayer
        media={{
          id: 'v1',
          kind: 'video',
          url: '/mock-media/video/water-update.mp4',
          alt: 'A crew explains the advisory',
          width: 640,
          height: 360,
          durationSec: 24,
        }}
      />,
    )
    const mute = screen.getByRole('button', { name: 'Mute' })
    await tabTo(user, mute)
    expect(tooltip()).toHaveTextContent(/^Mute$/)
    // Tab moves on to Expand: one bubble, now naming the newly focused control.
    await user.tab()
    expect(screen.getByRole('button', { name: 'Expand' })).toHaveFocus()
    expect(screen.getAllByTestId('participant-tooltip')).toHaveLength(1)
    expect(tooltip()).toHaveTextContent(/^Expand$/)
  })
})

function renderRail(onCompose = vi.fn()) {
  render(
    <MemorySocialNavigationProvider initialEntries={['/home']}>
      <NavRail onCompose={onCompose} self={undefined} showAccount={false} />
    </MemorySocialNavigationProvider>,
  )
  const nav = screen.getByRole('navigation', { name: 'Primary' })
  return {
    home: within(nav).getByRole('link', { name: 'Home' }),
    post: within(nav).getByTestId('nav-post-button'),
  }
}

describe('nav rail links and Post (only while the labels are hidden, below 840px)', () => {
  it('below 840px: Home on keyboard focus, Post on hover; names unchanged', async () => {
    stubViewport({ iconRail: true })
    const user = userEvent.setup()
    const { home, post: postButton } = renderRail()

    await tabTo(user, home)
    expect(tooltip()).toHaveTextContent(/^Home$/)
    expect(home).toHaveAccessibleName('Home')
    await user.tab({ shift: true })
    expect(tooltip()).toBeNull()

    await user.hover(postButton)
    expect(await hovered()).toHaveTextContent(/^Post$/)
    expect(postButton).toHaveAccessibleName('Post')
    await user.unhover(postButton)
    expect(tooltip()).toBeNull()
  })

  it('from 840px (labels visible) neither hover nor focus shows a tooltip', async () => {
    stubViewport({ iconRail: false })
    const user = userEvent.setup()
    const { home, post: postButton } = renderRail()

    await tabTo(user, home)
    expect(tooltip()).toBeNull()
    await user.hover(postButton)
    await new Promise(resolve => setTimeout(resolve, TOOLTIP_HOVER_DELAY_MS * 2))
    expect(tooltip()).toBeNull()
  })

  it('the icon-rail query is the exact complement of the 840px CSS breakpoint', () => {
    expect(NAV_ICON_RAIL_QUERY).toBe('not all and (min-width: 840px)')
  })
})

describe('detail header Back', () => {
  it('shows "Back" on keyboard focus', async () => {
    const user = userEvent.setup()
    render(
      <MemorySocialNavigationProvider initialEntries={['/home', '/explore']}>
        <DetailHeader />
      </MemorySocialNavigationProvider>,
    )
    const back = screen.getByRole('button', { name: 'Back' })
    await tabTo(user, back)
    expect(tooltip()).toHaveTextContent(/^Back$/)
  })
})

describe('every icon-only participant control in the AC is wrapped', () => {
  /** [file under features/social, the tooltip's label prop, a marker of the wrapped control]. */
  const WRAPPED: readonly (readonly [string, string, string])[] = [
    ['components/post/PostActions.tsx', 'key={action.key} label={action.label}', 'aria-label={label}'],
    ['components/post/PostActions.tsx', 'label="Pin"', 'aria-label="Pin"'],
    ['components/ComposerMedia.tsx', 'label="Add photos or video"', 'aria-label="Add photos or video"'],
    ['components/ComposerMedia.tsx', 'label={removeLabel}', 'aria-label={removeLabel}'],
    ['components/Composer.tsx', 'label="Add emoji"', '<EmojiPickerButton'],
    ['components/media/MediaViewer.tsx', 'label="Previous image"', 'aria-label="Previous image"'],
    ['components/media/MediaViewer.tsx', 'label="Next image"', 'aria-label="Next image"'],
    ['components/media/VideoPlayer.tsx', 'label="Mute"', 'aria-label="Mute"'],
    [
      'components/media/VideoPlayer.tsx',
      "label={fullscreen ? 'Exit full screen' : 'Expand'}",
      "aria-label={fullscreen ? 'Exit full screen' : 'Expand'}",
    ],
    ['components/media/VideoPlayer.tsx', 'label="Play"', 'aria-label="Play"'],
    ['explore/SearchBox.tsx', 'label="Clear search"', 'aria-label="Clear search"'],
    ['layout/ComposeModal.tsx', 'label="Close"', 'aria-label="Close"'],
    ['layout/DetailHeader.tsx', 'label="Back"', 'aria-label="Back"'],
    ['layout/NavRail.tsx', 'label={item.label}', 'href={item.path}'],
    ['layout/NavRail.tsx', 'label="Post"', 'data-testid="nav-post-button"'],
  ]

  it.each(WRAPPED)('%s: <ParticipantTooltip %s> wraps the control', (file, label, control) => {
    const source = readSrcFile(`features/social/${file}`)
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const open = source.search(new RegExp(`<ParticipantTooltip\\s+${escaped}`))
    expect(open, `no <ParticipantTooltip ${label}> in ${file}`).toBeGreaterThanOrEqual(0)
    const close = source.indexOf('</ParticipantTooltip>', open)
    const inside = source.slice(open, close)
    expect(inside).toContain(control)
  })

  it('the nav rail tooltips are gated to the icon rail', () => {
    const source = readSrcFile('features/social/layout/NavRail.tsx')
    expect(source.match(/media=\{NAV_ICON_RAIL_QUERY\}/g)).toHaveLength(2)
  })
})
