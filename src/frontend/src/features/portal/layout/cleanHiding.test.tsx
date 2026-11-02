/**
 * Story 07 (#772) AC "Clean hiding" (D2-005, PRT-003) and AC "Anchor layout",
 * over every subset the harness knows: 2^4 content-module subsets, each with
 * Trending absent and present. The page must look complete: no empty frame,
 * no orphaned heading, no dead "See all" link, and an empty rail collapses.
 */
import { useState } from 'react'
import { act, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PortalModuleId } from '../contract'
import { ModuleFrame } from './ModuleFrame'
import type { PortalModuleProps } from './types'
import { PORTAL_CHANNEL_HOME_PATHS } from './channelHome'
import { PORTAL_LAYOUT_SUBSETS, STUB_MODULE_PLACEMENT, STUB_MODULE_TITLES, renderPortalSubset } from './testing'

const label = (subset: readonly PortalModuleId[]) => (subset.length ? subset.join('+') : '(none)')
const railIds = (subset: readonly PortalModuleId[]) => subset.filter(id => STUB_MODULE_PLACEMENT[id].region === 'rail')
const leadIds = (subset: readonly PortalModuleId[]) => subset.filter(id => STUB_MODULE_PLACEMENT[id].region === 'lead')

function grid(): HTMLElement | null {
  return screen.queryByTestId('portal-layout-grid')
}

function mountedGrid(): HTMLElement {
  return screen.getByTestId('portal-layout-grid')
}

function region(container: HTMLElement, name: 'lead' | 'rail'): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[data-portal-region="${name}"]`)
}

function sections(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('section[data-portal-module]'))
}

describe('the harness', () => {
  it('covers 32 subsets, each distinct', () => {
    expect(PORTAL_LAYOUT_SUBSETS).toHaveLength(32)
    expect(new Set(PORTAL_LAYOUT_SUBSETS.map(label)).size).toBe(32)
  })
})

describe.each(PORTAL_LAYOUT_SUBSETS.map(subset => [label(subset), subset] as const))(
  'subset %s',
  (_name, subset) => {
    it('frames exactly the subset, each with a labelled h2 and a live "See all"', () => {
      const { container } = renderPortalSubset(subset)
      const framed = sections(container)
      expect(framed.map(section => section.dataset.portalModule).sort()).toEqual([...subset].sort())

      for (const section of framed) {
        const id = section.dataset.portalModule as PortalModuleId
        const heading = within(section).getByRole('heading', { level: 2 })
        expect(heading.textContent).toBe(STUB_MODULE_TITLES[id])
        expect(section.getAttribute('aria-labelledby')).toBe(heading.id)
        // Each "See all" goes to an enabled channel's home (the subset's channels are enabled).
        const seeAll = within(section).getByTestId('module-see-all')
        expect(Object.values(PORTAL_CHANNEL_HOME_PATHS)).toContain(seeAll.getAttribute('href'))
      }
      // No heading outside a frame.
      expect(container.querySelectorAll('h2').length).toBe(framed.length)
    })

    it('fills regions only with modules and collapses an empty rail', () => {
      const { container } = renderPortalSubset(subset)
      if (subset.length === 0) {
        expect(grid()).toBeNull()
        expect(container.querySelector('main')?.textContent).toBe('')
        return
      }
      const layout = mountedGrid()
      expect(layout.dataset.lead).toBe(leadIds(subset).length ? 'filled' : 'empty')
      expect(layout.dataset.rail).toBe(railIds(subset).length ? 'filled' : 'empty')
      expect(region(container, 'rail') === null).toBe(railIds(subset).length === 0)
      expect(region(container, 'lead') === null).toBe(leadIds(subset).length === 0)
    })

    it('hides every empty or errored module whole, and collapses what they leave', () => {
      const statuses = Object.fromEntries(
        subset.map((id, index) => [id, index % 2 ? 'error' : 'empty']),
      )
      const { container } = renderPortalSubset(subset, { statuses })
      expect(sections(container)).toHaveLength(0)
      expect(container.querySelectorAll('h2, a')).toHaveLength(0)
      if (subset.length > 0) expect(mountedGrid().hidden).toBe(true)
    })
  },
)

describe('runtime hiding', () => {
  it('a rail whose modules all go empty collapses and the lead takes the width', () => {
    const { container } = renderPortalSubset(['topStories', 'socialStream', 'trending'], {
      statuses: { socialStream: 'empty', trending: 'error' },
    })
    expect(mountedGrid().dataset.rail).toBe('empty')
    expect(mountedGrid().dataset.lead).toBe('filled')
    expect(region(container, 'rail')?.hidden).toBe(true)
  })

  it('a lead whose modules all go empty collapses and the rail takes the width', () => {
    const { container } = renderPortalSubset(['topStories', 'pressLatest', 'weather'], {
      statuses: { topStories: 'error', pressLatest: 'empty' },
    })
    expect(mountedGrid().dataset.lead).toBe('empty')
    expect(mountedGrid().dataset.rail).toBe('filled')
    expect(region(container, 'lead')?.hidden).toBe(true)
  })

  it('a module that throws while rendering hides itself; the rest of the page stays', () => {
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    function Broken(): never {
      throw new Error('module bug')
    }
    const { container } = renderPortalSubset(['topStories', 'socialStream'], {
      registrations: [{ id: 'socialStream', channelId: 'social', region: 'rail', order: 30, Component: Broken }],
    })
    silence.mockRestore()
    expect(sections(container).map(section => section.dataset.portalModule)).toEqual(['topStories'])
    expect(mountedGrid().dataset.rail).toBe('empty')
    expect(region(container, 'rail')?.hidden).toBe(true)
  })

  it('a module that throws after mounting hides too (frame cleanup, then the boundary)', () => {
    const ctl: { break?: () => void } = {}
    function Flaky({ moduleId }: PortalModuleProps) {
      const [broken, setBroken] = useState(false)
      ctl.break = () => setBroken(true)
      if (broken) throw new Error('module bug')
      return <ModuleFrame moduleId={moduleId} title="Latest from Pulse" status="ready" />
    }
    const { container } = renderPortalSubset(['topStories', 'socialStream'], {
      registrations: [{ id: 'socialStream', channelId: 'social', region: 'rail', order: 30, Component: Flaky }],
    })
    expect(mountedGrid().dataset.rail).toBe('filled')
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {})
    act(() => ctl.break?.())
    silence.mockRestore()
    expect(sections(container).map(section => section.dataset.portalModule)).toEqual(['topStories'])
    expect(mountedGrid().dataset.rail).toBe('empty')
    expect(region(container, 'rail')?.hidden).toBe(true)
  })

  it('a rail keeps its place while one of its modules is still visible', () => {
    renderPortalSubset(['topStories', 'socialStream', 'weather'], { statuses: { socialStream: 'empty' } })
    expect(mountedGrid().dataset.rail).toBe('filled')
    expect(screen.getByRole('heading', { name: 'Weather' })).toBeDefined()
    expect(screen.queryByRole('heading', { name: 'Latest from Pulse' })).toBeNull()
  })

  it('drops a module whose channel is off once the enabled set is known (live toggle)', () => {
    const { container } = renderPortalSubset(['topStories', 'pressLatest', 'weather'], {
      enabledChannels: ['news', 'weather'],
    })
    expect(sections(container).map(section => section.dataset.portalModule)).toEqual(['topStories', 'weather'])
  })

  it('while the enabled set loads, trusts the server list but shows no "See all" (fail closed)', () => {
    const { container } = renderPortalSubset(['topStories', 'weather'], { channelsKnown: false })
    expect(sections(container)).toHaveLength(2)
    expect(screen.queryAllByTestId('module-see-all')).toHaveLength(0)
  })
})

describe('anchor order', () => {
  it('keeps the stored order inside each region, lead before rail in the DOM (reading order)', () => {
    const { container } = renderPortalSubset(['topStories', 'socialStream', 'trending', 'pressLatest', 'weather'])
    const order = sections(container).map(section => section.dataset.portalModule)
    expect(order).toEqual(['topStories', 'pressLatest', 'socialStream', 'weather', 'trending'])
    expect(container.querySelector('main')?.dataset.portalLayout).toBe('anchor')
  })
})
