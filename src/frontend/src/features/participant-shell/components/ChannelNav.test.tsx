/**
 * features/participant-shell/components/ChannelNav.test.tsx
 * ---------------------------------------------------------------------------
 * Story 03 (channel nav) — RTL coverage for `ChannelNav.tsx`: config-driven
 * visibility with no dangling doors (AC2, D2-005), the current-channel mark
 * that is never color-only (AC1/AC5, NFR-001), per-instance switching (AC3),
 * keyboard operability (NFR-001), the scenario-time dateline (COR-053/061/
 * 062), the mobile-first responsive mechanism, and the quiet participant
 * styling / no-COBRA posture (D0 §2).
 *
 * `../channelNavConfig`'s `useChannelNav` is mocked at the module boundary so
 * every test controls exactly the resolved `ChannelNavConfig` under test,
 * independent of that seam's own network/query behavior (covered separately
 * in `../channelNavConfig.test.tsx` / `../channelNavConfig.default.test.tsx`).
 * `@/core/exerciseContext` is mocked too (only the `timeZone` VALUE matters
 * here). The scenario clock is the REAL `@/core/clock` module driven via
 * `setExerciseClock`/`resetExerciseClock` (mirrors `ShellLayout.test.tsx`) so
 * the dateline assertions exercise the actual `formatScenarioTime` wiring,
 * not a stand-in for it.
 *
 * jsdom limitations (verified empirically against this repo's jsdom/vitest
 * versions, documented here mirroring `ComplianceChrome.test.tsx` /
 * `ShellLayout.test.tsx`'s own notes):
 *
 * 1. jsdom does not evaluate `@media` conditions for `getComputedStyle` (no
 *    `window.matchMedia` in this environment either) — only each selector's
 *    unconditional (outside-`@media`) rule ever applies. That means the
 *    desktop strip's base rule (`display: none`) is always in effect and the
 *    mobile tab bar's base rule (`display: flex`) is always in effect in this
 *    harness, regardless of viewport — both forms are always present in the
 *    DOM (the component's own "always in the DOM, CSS toggles display"
 *    design; see `ChannelNav.tsx` header), but the strip is always
 *    computed-hidden here. Testing Library's `*ByRole` queries exclude
 *    elements that are hidden from the accessibility tree by default, so
 *    every `getByRole`/`getAllByRole`/`queryByRole` call that targets an
 *    element inside (or the `<nav>` itself of) the desktop strip passes
 *    `{ hidden: true }` to include it — the strip is only "hidden" here as an
 *    artifact of this jsdom gap, not because it is ever actually inaccessible
 *    at a real desktop viewport. The responsive-mechanism tests below assert
 *    on the actual rendered `<style>` text — the real, observable mechanism
 *    that would regress if the mobile-first toggle were ever removed or
 *    inverted — rather than on unobservable-in-jsdom computed `display`
 *    values.
 * 2. `FontAwesomeIcon` injects its own global stylesheet into `<head>` the
 *    first time it renders, ahead of this component's own `<style>` tag in
 *    document order — so `document.querySelector('style')` is not reliable
 *    (it can return FontAwesome's CSS instead of `ChannelNav`'s `NAV_STYLES`).
 *    Tests that need the component's own `<style>` text capture `container`
 *    from `render()` and query `container.querySelector('style')`, which is
 *    scoped to only what `ChannelNav` itself rendered.
 *
 * Fixtures deliberately avoid the shipped single-"social"-channel default
 * (`channelNavConfig.ts`'s `MOCK_CHANNEL_NAV_CONFIG`) wherever more than one
 * channel is needed, so a component that ever hardcoded that shape instead of
 * rendering strictly from its resolved config would still fail these tests
 * (WAVE0-REVIEW precedent 17: no tautological tests).
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChannelNav } from './ChannelNav'
import { useChannelNav } from '../channelNavConfig'
import type { ChannelNavConfig } from '../channelNavConfig'
import { formatScenarioTime, resetExerciseClock, setExerciseClock } from '@/core/clock'
import type { IExerciseClock } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'

vi.mock('../channelNavConfig', () => ({
  useChannelNav: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const mockUseChannelNav = vi.mocked(useChannelNav)
const mockUseExerciseContext = vi.mocked(useExerciseContext)

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

const DEFAULT_EXERCISE_SCOPE = {
  exerciseId: 'ex-test-channel-nav-component-0001',
  exerciseName: 'Channel Nav Component Test Exercise',
  timeZone: 'America/New_York',
  status: 'active' as const,
}

const TWO_CHANNEL_CONFIG: ChannelNavConfig = {
  channels: [
    { id: 'social', label: 'Social', icon: 'social' },
    { id: 'news', label: 'Local News', icon: 'news' },
  ],
  initialChannelId: 'social',
  hideWhenSingleChannel: false,
}

beforeEach(() => {
  mockUseExerciseContext.mockReturnValue(DEFAULT_EXERCISE_SCOPE)
  setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
})

afterEach(() => {
  resetExerciseClock()
})

describe('ChannelNav — config-driven rendering (AC1)', () => {
  it('renders every enabled channel as a link/button in BOTH the desktop strip and the mobile tab bar', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    const strip = screen.getByTestId('pulse-channel-nav-strip')
    const tabs = screen.getByTestId('pulse-channel-nav-tabs')

    for (const label of ['Social', 'Local News']) {
      expect(within(strip).getByRole('button', { name: label, hidden: true })).toBeInTheDocument()
      expect(within(tabs).getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('both forms are landmarks labelled "Channel navigation" for assistive tech', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    // hidden: true to include the desktop strip's <nav> (see file header,
    // jsdom limitation 1). Asserting the aria-label attribute directly rather
    // than filtering getAllByRole by `name` — computing the ACCESSIBLE NAME
    // of a CSS-hidden element is itself an empty string per the accname spec
    // (a jsdom/dom-accessibility-api artifact of "hidden", not a real
    // labelling gap at a real desktop viewport).
    const navs = screen.getAllByRole('navigation', { hidden: true })
    expect(navs).toHaveLength(2)
    for (const nav of navs) {
      expect(nav).toHaveAttribute('aria-label', 'Channel navigation')
    }
  })
})

describe('ChannelNav — config-driven visibility, no dangling doors (AC2, D2-005)', () => {
  it('never renders a channel that is absent from the resolved config — a disabled channel appears NOWHERE', () => {
    // 'news'/'press'/'weather' are deliberately absent here, simulating what
    // the real seam resolves once they're disabled (channelNavConfig.ts
    // filters before this component ever runs) — this proves the COMPONENT
    // itself invents no extra channel beyond what it was handed.
    mockUseChannelNav.mockReturnValue({
      channels: [{ id: 'social', label: 'Social', icon: 'social' }],
      initialChannelId: 'social',
      hideWhenSingleChannel: false,
    })

    render(<ChannelNav />)

    for (const forbidden of ['Local News', 'Press Room', 'Weather', 'Neighborhood Portal']) {
      expect(screen.queryByText(forbidden)).not.toBeInTheDocument()
    }
  })

  it('renders nothing at all (neither strip nor tabs) when hideWhenSingleChannel is set with one enabled channel', () => {
    mockUseChannelNav.mockReturnValue({
      channels: [{ id: 'social', label: 'Social', icon: 'social' }],
      initialChannelId: 'social',
      hideWhenSingleChannel: true,
    })

    render(<ChannelNav />)

    expect(screen.queryByTestId('pulse-channel-nav-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-channel-nav-tabs')).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument()
  })

  it('renders the degenerate single-channel strip when hideWhenSingleChannel is false (Phase-1 default)', () => {
    mockUseChannelNav.mockReturnValue({
      channels: [{ id: 'social', label: 'Social', icon: 'social' }],
      initialChannelId: 'social',
      hideWhenSingleChannel: false,
    })

    render(<ChannelNav />)

    const strip = screen.getByTestId('pulse-channel-nav-strip')
    const tabs = screen.getByTestId('pulse-channel-nav-tabs')
    expect(within(strip).getAllByRole('button', { hidden: true })).toHaveLength(1)
    expect(within(tabs).getAllByRole('button')).toHaveLength(1)
  })

  it('renders nothing when the resolved channel set is empty (the all-disabled edge case)', () => {
    mockUseChannelNav.mockReturnValue({
      channels: [],
      initialChannelId: '',
      hideWhenSingleChannel: false,
    })

    render(<ChannelNav />)

    expect(screen.queryByTestId('pulse-channel-nav-strip')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pulse-channel-nav-tabs')).not.toBeInTheDocument()
  })

  it('caps the mobile tab bar at 5 slots while the desktop strip shows every enabled channel', () => {
    const sixChannels: ChannelNavConfig = {
      channels: [
        { id: 'c1', label: 'Chan One', icon: 'social' },
        { id: 'c2', label: 'Chan Two', icon: 'portal' },
        { id: 'c3', label: 'Chan Three', icon: 'news' },
        { id: 'c4', label: 'Chan Four', icon: 'press' },
        { id: 'c5', label: 'Chan Five', icon: 'weather' },
        { id: 'c6', label: 'Chan Six', icon: 'social' },
      ],
      initialChannelId: 'c1',
      hideWhenSingleChannel: false,
    }
    mockUseChannelNav.mockReturnValue(sixChannels)

    render(<ChannelNav />)

    const strip = screen.getByTestId('pulse-channel-nav-strip')
    const tabs = screen.getByTestId('pulse-channel-nav-tabs')
    expect(within(strip).getAllByRole('button', { hidden: true })).toHaveLength(6)
    expect(within(tabs).getAllByRole('button')).toHaveLength(5)
    expect(within(tabs).queryByRole('button', { name: 'Chan Six' })).not.toBeInTheDocument()
  })
})

describe('ChannelNav — current channel marked, never color-only (AC1/AC5, NFR-001)', () => {
  it('marks the current channel with BOTH aria-current AND a non-color visual class, in both forms', () => {
    mockUseChannelNav.mockReturnValue({
      channels: [
        { id: 'social', label: 'Social', icon: 'social' },
        { id: 'news', label: 'Local News', icon: 'news' },
      ],
      initialChannelId: 'news',
      hideWhenSingleChannel: false,
    })

    render(<ChannelNav />)

    const stripCurrent = within(screen.getByTestId('pulse-channel-nav-strip'))
      .getByRole('button', { name: 'Local News', hidden: true })
    const tabsCurrent = within(screen.getByTestId('pulse-channel-nav-tabs'))
      .getByRole('button', { name: 'Local News' })
    const stripOther = within(screen.getByTestId('pulse-channel-nav-strip'))
      .getByRole('button', { name: 'Social', hidden: true })
    const tabsOther = within(screen.getByTestId('pulse-channel-nav-tabs'))
      .getByRole('button', { name: 'Social' })

    for (const current of [stripCurrent, tabsCurrent]) {
      expect(current).toHaveAttribute('aria-current', 'page')
      expect(current.className).toMatch(/--current/)
    }
    for (const other of [stripOther, tabsOther]) {
      expect(other).not.toHaveAttribute('aria-current')
      expect(other.className).not.toMatch(/--current/)
    }
  })

  it('the "--current" style rules carry more than color — font-weight AND text-decoration (NFR-001: never color alone)', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    const { container } = render(<ChannelNav />)

    const styleText = container.querySelector('style')?.textContent ?? ''

    const linkCurrentRule = /\.pulse-channel-nav-link--current\s*\{([^}]*)\}/.exec(styleText)?.[1] ?? ''
    expect(linkCurrentRule).toMatch(/font-weight:\s*700/)
    expect(linkCurrentRule).toMatch(/text-decoration:\s*underline/)

    const tabCurrentRule = /\.pulse-channel-nav-tab--current\s*\{([^}]*)\}/.exec(styleText)?.[1] ?? ''
    expect(tabCurrentRule).toMatch(/font-weight:\s*700/)
    // The tab's underline lives on the nested label rule (kept separate so
    // the icon itself isn't underlined) — still non-color, still present.
    expect(styleText).toMatch(/\.pulse-channel-nav-tab--current \.pulse-channel-nav-tab-label\s*\{[^}]*text-decoration:\s*underline/)
  })
})

describe('ChannelNav — switching persists per shell instance (AC3)', () => {
  it('clicking a channel in the strip updates aria-current in BOTH the strip and the tab bar', async () => {
    const user = userEvent.setup()
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    const strip = screen.getByTestId('pulse-channel-nav-strip')
    const tabs = screen.getByTestId('pulse-channel-nav-tabs')

    expect(within(strip).getByRole('button', { name: 'Social', hidden: true }))
      .toHaveAttribute('aria-current', 'page')

    await user.click(within(strip).getByRole('button', { name: 'Local News', hidden: true }))

    expect(within(strip).getByRole('button', { name: 'Local News', hidden: true }))
      .toHaveAttribute('aria-current', 'page')
    expect(within(strip).getByRole('button', { name: 'Social', hidden: true }))
      .not.toHaveAttribute('aria-current')
    // The SAME switch is reflected in the mobile tab bar — one shared
    // current-channel state, not two independent switchers.
    expect(within(tabs).getByRole('button', { name: 'Local News' })).toHaveAttribute('aria-current', 'page')
    expect(within(tabs).getByRole('button', { name: 'Social' })).not.toHaveAttribute('aria-current')
  })

  it('clicking a channel in the mobile tab bar also updates the desktop strip', async () => {
    const user = userEvent.setup()
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    const tabs = screen.getByTestId('pulse-channel-nav-tabs')
    const strip = screen.getByTestId('pulse-channel-nav-strip')

    await user.click(within(tabs).getByRole('button', { name: 'Local News' }))

    expect(within(strip).getByRole('button', { name: 'Local News', hidden: true }))
      .toHaveAttribute('aria-current', 'page')
  })

  it('a switch persists across a re-render of the same instance (e.g. an unrelated config refresh)', async () => {
    const user = userEvent.setup()
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    const { rerender } = render(<ChannelNav />)
    await user.click(screen.getByRole('button', { name: 'Local News' }))
    expect(screen.getAllByRole('button', { name: 'Local News' })[0]).toHaveAttribute('aria-current', 'page')

    // Same channel set resolves again (e.g. the query refetches identical
    // data) — the locally-switched "current" must not snap back to the
    // config's initialChannelId ('social').
    mockUseChannelNav.mockReturnValue({ ...TWO_CHANNEL_CONFIG })
    rerender(<ChannelNav />)

    expect(screen.getAllByRole('button', { name: 'Local News' })[0]).toHaveAttribute('aria-current', 'page')
  })

  it('falls back to the new initialChannelId — not a dangling pointer — when the current channel disappears from a changed config', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)
    const { rerender } = render(<ChannelNav />)
    expect(screen.getAllByRole('button', { name: 'Social' })[0]).toHaveAttribute('aria-current', 'page')

    // A differently-scoped config resolves (e.g. a fresh exercise) whose
    // channel set no longer includes 'social' at all.
    mockUseChannelNav.mockReturnValue({
      channels: [{ id: 'weather', label: 'Weather', icon: 'weather' }],
      initialChannelId: 'weather',
      hideWhenSingleChannel: false,
    })
    rerender(<ChannelNav />)

    expect(screen.queryByText('Social')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Weather' })[0]).toHaveAttribute('aria-current', 'page')
  })
})

describe('ChannelNav — keyboard operability (NFR-001)', () => {
  it('a channel button is reachable by Tab and activatable with Enter, updating aria-current', async () => {
    const user = userEvent.setup()
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    const target = screen.getAllByRole('button', { name: 'Local News' })[0]
    if (!target) throw new Error('expected a "Local News" button to be rendered')
    target.focus()
    expect(target).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(target).toHaveAttribute('aria-current', 'page')
  })

  it('publishes a :focus-visible outline rule for both nav forms (visible focus indicator)', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    const { container } = render(<ChannelNav />)

    const styleText = container.querySelector('style')?.textContent ?? ''
    expect(styleText).toContain('.pulse-channel-nav-link:focus-visible')
    expect(styleText).toContain('.pulse-channel-nav-tab:focus-visible')
    expect(styleText).toMatch(/:focus-visible[\s\S]*?outline:\s*2px solid/)
  })
})

describe('ChannelNav — scenario dateline (COR-053/061/062)', () => {
  it('renders the dateline in the exercise scenario time zone via @/core/clock, right-aligned on the desktop strip only', () => {
    const instant = new Date('2026-07-16T23:00:00Z')
    setExerciseClock(fixedClock(instant))
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    // Computed independently via the SAME real utility ChannelNav is
    // documented to call - if the component ever passed the wrong format
    // (e.g. 'absolute') or the wrong time zone, this would diverge and fail.
    const expectedDateline = formatScenarioTime(instant, DEFAULT_EXERCISE_SCOPE.timeZone, {
      format: 'dateline',
    })

    const strip = screen.getByTestId('pulse-channel-nav-strip')
    const tabs = screen.getByTestId('pulse-channel-nav-tabs')
    expect(within(strip).getByText(expectedDateline)).toBeInTheDocument()
    expect(within(tabs).queryByText(expectedDateline)).not.toBeInTheDocument()
  })

  it('reflects a different exercise time zone (not a hardcoded zone) - isolation across exercises', () => {
    const instant = new Date('2026-01-01T04:00:00Z')
    setExerciseClock(fixedClock(instant))
    mockUseExerciseContext.mockReturnValue({ ...DEFAULT_EXERCISE_SCOPE, timeZone: 'Asia/Tokyo' })
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    const expectedDateline = formatScenarioTime(instant, 'Asia/Tokyo', { format: 'dateline' })
    const utcDateline = formatScenarioTime(instant, 'UTC', { format: 'dateline' })

    expect(screen.getByText(expectedDateline)).toBeInTheDocument()
    // Jan 1 04:00 UTC is already Jan 1 in Tokyo (JST = UTC+9) - both zones
    // happen to read the same calendar day here, so additionally confirm the
    // rendered dateline is exactly the Tokyo-zoned rendering, not merely "a"
    // valid dateline for either zone.
    expect(expectedDateline).toBe(utcDateline)
    expect(screen.getByText(expectedDateline)).toBeInTheDocument()
  })

  it('never renders the exercise id, name, or status alongside the dateline (no exercise/admin leak)', () => {
    setExerciseClock(fixedClock(new Date('2026-07-16T14:00:00Z')))
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    const bodyText = document.body.textContent ?? ''
    expect(bodyText).not.toContain(DEFAULT_EXERCISE_SCOPE.exerciseId)
    expect(bodyText).not.toContain(DEFAULT_EXERCISE_SCOPE.exerciseName)
  })
})

describe('ChannelNav — mobile-first responsive mechanism', () => {
  it('defaults the tab bar visible and the strip hidden outside any media query (mobile-first)', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    const { container } = render(<ChannelNav />)

    const styleText = container.querySelector('style')?.textContent ?? ''
    const mediaIndex = styleText.indexOf('@media')
    expect(mediaIndex).toBeGreaterThan(-1)
    const baseText = styleText.slice(0, mediaIndex)

    expect(baseText).toMatch(/\.pulse-channel-nav-strip\s*\{[^}]*display:\s*none;[^}]*height:\s*38px;/)
    expect(baseText).toMatch(/\.pulse-channel-nav-tabs\s*\{[^}]*display:\s*flex;[^}]*height:\s*56px;/)
  })

  it('toggles to the desktop strip (and hides the tab bar) inside a min-width media query', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    const { container } = render(<ChannelNav />)

    const styleText = container.querySelector('style')?.textContent ?? ''
    const mediaBlock = styleText.slice(styleText.indexOf('@media'))

    expect(mediaBlock).toMatch(/@media \(min-width: \d+px\)/)
    expect(mediaBlock).toMatch(/\.pulse-channel-nav-strip\s*\{\s*display:\s*flex;\s*\}/)
    expect(mediaBlock).toMatch(/\.pulse-channel-nav-tabs\s*\{\s*display:\s*none;\s*\}/)
  })

  it('both nav forms are simultaneously present in the DOM (jsdom cannot evaluate @media; see file header)', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    expect(screen.getByTestId('pulse-channel-nav-strip')).toBeInTheDocument()
    expect(screen.getByTestId('pulse-channel-nav-tabs')).toBeInTheDocument()
  })
})

describe('ChannelNav — participant world: quiet styling, FontAwesome-only, no COBRA/MUI (D0 §2)', () => {
  it('renders no MUI/COBRA class names anywhere in its output', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    const { container } = render(<ChannelNav />)

    expect(container.querySelector('[class*="Mui"]')).toBeNull()
    expect(container.querySelector('[class*="Cobra"]')).toBeNull()
  })

  it('renders a FontAwesome <svg> icon (aria-hidden) per tab in the mobile bar, and none in the desktop strip', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    const strip = screen.getByTestId('pulse-channel-nav-strip')
    const tabs = screen.getByTestId('pulse-channel-nav-tabs')

    expect(strip.querySelector('svg')).toBeNull()
    const icons = tabs.querySelectorAll('svg')
    expect(icons).toHaveLength(TWO_CHANNEL_CONFIG.channels.length)
    for (const icon of icons) {
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('renders only the configured channel labels as button text — no instructional copy (XC-002)', () => {
    mockUseChannelNav.mockReturnValue(TWO_CHANNEL_CONFIG)

    render(<ChannelNav />)

    // hidden: true so this covers the desktop strip's buttons too, not just
    // the mobile tab bar's (see file header, jsdom limitation 1).
    const buttons = screen.getAllByRole('button', { hidden: true })
    expect(buttons).toHaveLength(TWO_CHANNEL_CONFIG.channels.length * 2)
    for (const button of buttons) {
      const label = TWO_CHANNEL_CONFIG.channels.find(channel => channel.label === button.textContent)
      expect(label).toBeDefined()
    }
  })
})
