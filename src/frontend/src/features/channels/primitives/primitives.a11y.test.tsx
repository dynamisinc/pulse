/**
 * Accessibility sweep of every primitive (NFR-001): axe reports no serious / critical
 * violation, interactive parts are keyboard-reachable with a visible focus style, and
 * motion respects `prefers-reduced-motion`.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import {
  ContentMedia,
  LiveRegionAnnouncer,
  SanitizedBody,
  ScenarioDateline,
  WatermarkSlot,
} from '.'
import { mediaFixture, pinScenarioClock, resetExerciseClock, seriousAxeViolations } from './primitivesTestUtils'

const ctl = vi.hoisted(() => ({ reducedMotion: false }))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({ exerciseId: 'ex-1', timeZone: 'America/New_York' }),
}))
vi.mock('@/features/participant-shell/components/OverlayLayer', () => ({
  useOverlayState: () => ({ state: 'none' }),
}))
vi.mock('@/core/hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => ctl.reducedMotion,
}))

beforeEach(() => {
  ctl.reducedMotion = false
  pinScenarioClock('2026-10-29T20:00:00Z')
})

afterEach(() => {
  resetExerciseClock()
})

const BODY = '<h2>What we know</h2><p>Officials said <a href="/news/daily/x">more here</a>.</p>'
  + '<table><caption>Shelters</caption><thead><tr><th scope="col">Name</th></tr></thead>'
  + '<tbody><tr><td>North High</td></tr></tbody></table>'

function Page() {
  return (
    <MemoryRouter>
      <main>
        <h1>Flood update</h1>
        <ScenarioDateline scenarioTime="2026-10-29T18:32:00Z" updatedScenarioTime="2026-10-29T19:05:00Z" />
        <ContentMedia media={mediaFixture()} watermark />
        <ContentMedia
          media={mediaFixture({ id: 'v', kind: 'video', url: '/m/v.mp4', contentType: 'video/mp4', alt: 'Briefing video' })}
        />
        <ContentMedia
          media={mediaFixture({ id: 'd', kind: 'document', url: '/m/advisory.pdf', contentType: 'application/pdf', alt: 'Advisory' })}
        />
        <SanitizedBody bodyHtml={BODY} />
        <div style={{ position: 'relative' }}>
          <WatermarkSlot />
        </div>
        <LiveRegionAnnouncer arrivals={0} />
      </main>
    </MemoryRouter>
  )
}

describe('primitives: axe', () => {
  it('has no serious or critical violations', async () => {
    const { container } = render(<Page />)
    expect(await seriousAxeViolations(container)).toEqual([])
  })
})

describe('primitives: keyboard', () => {
  it('Tab reaches the body link, the video player and the document link', async () => {
    render(<Page />)
    const user = userEvent.setup()
    const reached = new Set<Element>()
    for (let i = 0; i < 12; i += 1) {
      await user.tab()
      if (document.activeElement !== null) reached.add(document.activeElement)
    }
    expect(reached).toContain(screen.getByRole('link', { name: 'more here' }))
    expect(reached).toContain(screen.getByTestId('video-player'))
    expect(reached).toContain(screen.getByRole('link', { name: /Download Advisory/ }))
  })

  it.each([
    ['features/channels/primitives/body/SanitizedBody.module.css', '.body a:focus-visible'],
    ['features/channels/primitives/media/ContentMedia.module.css', '.docLink:focus-visible'],
  ])('%s has a visible focus style (%s)', (path, selector) => {
    const css = readSrcFile(path)
    const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')
    expect(new RegExp(`${escaped}\\s*\\{[^}]*outline:\\s*3px solid`).test(css)).toBe(true)
  })
})

describe('primitives: reduced motion', () => {
  it('the image fade-in is off under prefers-reduced-motion', () => {
    ctl.reducedMotion = true
    render(<ContentMedia media={mediaFixture()} />)
    const img = screen.getByRole('img')
    expect(img.className).not.toMatch(/fade/)
    expect(img.className).toMatch(/loaded/)
  })

  it('the fade-in runs otherwise', () => {
    render(<ContentMedia media={mediaFixture()} />)
    expect(screen.getByRole('img').className).toMatch(/fade/)
  })
})
