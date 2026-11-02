/**
 * PortalMasthead (exercise-portal story 06, AC3-AC6): name / logo / tagline, the
 * scenario-time dateline off the shell's `scenarioNow`, the alerts-entry and watermark
 * slots, and the a11y shape (one banner, one h1, axe clean).
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import axe from 'axe-core'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import type { ContentMediaDto } from '@/features/channels'
import {
  ShellContextProvider,
  type ShellMountProps,
} from '@/features/participant-shell/mountContract'
import type { PortalMastheadDto } from '../contract'
import { PortalSkinScope } from '../skin'
import { PORTAL_FALLBACK_NAME, PortalMasthead, splitMastheadName, type PortalMastheadProps } from '.'

const EXERCISE_NAME = 'Operation Riverbend FSE'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-1',
    exerciseName: 'Operation Riverbend FSE',
    timeZone: 'America/New_York',
  }),
}))

const NOW = '2026-10-29T18:32:00Z'

beforeEach(() => {
  const epoch = Date.parse(NOW)
  setExerciseClock({ scenarioNow: () => new Date(epoch) })
})

afterEach(() => {
  resetExerciseClock()
  vi.restoreAllMocks()
})

function logo(overrides: Partial<ContentMediaDto> = {}): ContentMediaDto {
  return {
    id: 'logo-1',
    kind: 'image',
    role: 'inline',
    url: '/media/atlanta-today-logo.png',
    posterUrl: null,
    contentType: 'image/png',
    width: 240,
    height: 80,
    durationSec: null,
    alt: 'Atlanta Today logo',
    caption: null,
    ...overrides,
  } as ContentMediaDto
}

const MASTHEAD: PortalMastheadDto = {
  name: 'Atlanta Today',
  tagline: 'Your city, every hour',
  logo: logo(),
}

function shell(scenarioNow: string): ShellMountProps {
  return { variant: 'full', scenarioNow: new Date(Date.parse(scenarioNow)) }
}

function Frame({ now = NOW, children }: { now?: string; children: ReactNode }) {
  return (
    <ShellContextProvider value={shell(now)}>
      <PortalSkinScope>{children}</PortalSkinScope>
    </ShellContextProvider>
  )
}

function mount(props: Partial<PortalMastheadProps> = {}, now = NOW) {
  const all: PortalMastheadProps = { masthead: MASTHEAD, ...props }
  const view = render(<Frame now={now}><PortalMasthead {...all} /></Frame>)
  return {
    ...view,
    rerenderAt: (next: string) =>
      view.rerender(<Frame now={next}><PortalMasthead {...all} /></Frame>),
  }
}

describe('PortalMasthead: masthead (AC3)', () => {
  it('renders the name as the one h1, the logo with its alt, and the tagline', () => {
    mount()
    const heading = screen.getByRole('heading', { level: 1 })
    expect(heading).toHaveTextContent('Atlanta Today')
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('img', { name: 'Atlanta Today logo' })).toHaveAttribute(
      'src', '/media/atlanta-today-logo.png',
    )
    expect(screen.getByTestId('portal-masthead-tagline')).toHaveTextContent('Your city, every hour')
  })

  it('styles the "Today" word apart without splitting the accessible name', () => {
    mount()
    const heading = screen.getByRole('heading', { level: 1, name: 'Atlanta Today' })
    expect(within(heading).getByText('Today').tagName).toBe('SPAN')
  })

  it('renders the name alone, cleanly, with no logo and no tagline', () => {
    mount({ masthead: { name: 'Atlanta Today', tagline: null, logo: null } })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Atlanta Today')
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByTestId('portal-masthead-tagline')).toBeNull()
  })

  it.each([
    ['an off-origin http URL', logo({ url: 'http://evil.example/logo.png' })],
    ['a javascript: URL', logo({ url: 'javascript:alert(1)' })],
    ['a non-image media kind', logo({ kind: 'video', url: '/media/x.mp4' })],
  ])('drops a logo with %s and keeps the name', (_label, bad) => {
    mount({ masthead: { ...MASTHEAD, logo: bad } })
    expect(screen.queryByTestId('portal-masthead-logo')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Atlanta Today')
  })

  it('drops a logo that fails to load and keeps the name', () => {
    mount()
    fireEvent.error(screen.getByTestId('portal-masthead-logo'))
    expect(screen.queryByTestId('portal-masthead-logo')).toBeNull()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Atlanta Today')
  })

  it('a blank name renders the neutral "Local Today", never the exercise name', () => {
    mount({ masthead: { ...MASTHEAD, name: '   ' } })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(PORTAL_FALLBACK_NAME)
    expect(document.body).not.toHaveTextContent(EXERCISE_NAME)
  })

  it('is not a link out of the portal', () => {
    mount({ alertsEntry: undefined })
    expect(within(screen.getByTestId('portal-masthead')).queryAllByRole('link')).toHaveLength(0)
  })
})

describe('PortalMasthead: dateline (AC4, COR-053)', () => {
  it('shows the shell\'s scenario date and time in the exercise time zone', () => {
    mount()
    const dateline = screen.getByTestId('scenario-dateline')
    // 18:32Z is 2:32 PM in New York (EDT), whatever the test runner's own zone is.
    expect(dateline).toHaveTextContent(/OCT 29, 2026/i)
    expect(dateline).toHaveTextContent('2:32 PM')
    expect(dateline).toHaveTextContent('EDT')
    expect(dateline.querySelector('time')).toHaveAttribute('dateTime', '2026-10-29T18:32:00.000Z')
  })

  it('advances with the shell\'s scenarioNow, without a refetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const view = mount()
    view.rerenderAt('2026-10-29T19:05:00Z')
    expect(screen.getByTestId('scenario-dateline')).toHaveTextContent('3:05 PM')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('is never labelled "scenario time"', () => {
    mount()
    expect(screen.getByTestId('portal-masthead')).not.toHaveTextContent(/scenario/i)
  })
})

describe('PortalMasthead: slots (AC5)', () => {
  it('places the alerts entry on the name line', () => {
    mount({ alertsEntry: <button type="button">Alerts 2</button> })
    const slot = screen.getByTestId('portal-masthead-alerts-entry')
    expect(within(slot).getByRole('button', { name: 'Alerts 2' })).toBeInTheDocument()
  })

  it('renders no alerts slot when none is given, and never an alert bar of its own', () => {
    mount()
    expect(screen.queryByTestId('portal-masthead-alerts-entry')).toBeNull()
    const masthead = screen.getByTestId('portal-masthead')
    expect(within(masthead).queryByRole('alert')).toBeNull()
    expect(within(masthead).queryByRole('status')).toBeNull()
  })

  it('reserves the EXERCISE watermark slot in its hero area', () => {
    mount({ hero: <div>hero image</div> })
    const hero = screen.getByTestId('portal-masthead-hero')
    expect(within(hero).getByText('hero image')).toBeInTheDocument()
    expect(within(hero).getByTestId('watermark-slot')).toBeInTheDocument()
  })
})

describe('PortalMasthead: a11y (AC6)', () => {
  it('is still the banner when mounted beside the portal main, as story 17 will', async () => {
    const { container } = render(
      <Frame>
        <PortalMasthead masthead={MASTHEAD} />
        <main><h2>Top stories</h2></main>
      </Frame>,
    )
    expect(screen.getByRole('banner')).toBe(screen.getByTestId('portal-masthead'))
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map(v => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('is a banner landmark with a single h1', () => {
    mount()
    const banner = screen.getByRole('banner')
    expect(banner).toBe(screen.getByTestId('portal-masthead'))
    expect(within(banner).getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('axe reports no violations (structure; contrast is computed separately)', async () => {
    const { container } = mount({
      alertsEntry: <button type="button">Alerts</button>,
      hero: <div>hero</div>,
    })
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map(v => `${v.id}: ${v.help}`)).toEqual([])
  })

  it('axe reports no structural violations without a logo or tagline', async () => {
    const { container } = mount({ masthead: { name: 'Local Today', tagline: null, logo: null } })
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map(v => `${v.id}: ${v.help}`)).toEqual([])
  })
})

describe('splitMastheadName', () => {
  it.each([
    ['Atlanta Today', 'Atlanta ', 'Today'],
    ['Local TODAY', 'Local ', 'TODAY'],
    ['Fairhaven Daily', 'Fairhaven Daily', ''],
    ['Today', 'Today', ''],
    ['Yesterday', 'Yesterday', ''],
  ])('%s', (name, lead, today) => {
    expect(splitMastheadName(name)).toEqual({ lead, today })
  })
})
