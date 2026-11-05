/**
 * Story 07 (#772) AC "Module frame" and AC "Registry" (mounting from a
 * registry with no layout change). Rendered behind an explicit frame
 * environment, so no global mock is needed.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ModuleFrame, type ModuleFrameProps } from './ModuleFrame'
import { PortalFrameEnvironmentProvider } from './frameEnvironment'
import type { PortalFrameEnvironment } from './frameEnvironmentContext'
import { PortalLayout } from './PortalLayout'
import { createPortalModuleRegistry } from './registry'
import type { PortalModuleProps } from './types'

function environment(enabled: readonly string[]): PortalFrameEnvironment {
  return { isChannelEnabled: id => enabled.includes(id), channelsKnown: true, trackClick: () => {} }
}

function renderFrame(props: Partial<ModuleFrameProps> = {}, enabled: readonly string[] = ['news']) {
  return render(
    <MemoryRouter>
      <PortalFrameEnvironmentProvider value={environment(enabled)}>
        <ModuleFrame moduleId="topStories" title="Top Stories" status="ready" {...props}>
          <p>Body</p>
        </ModuleFrame>
      </PortalFrameEnvironmentProvider>
    </MemoryRouter>,
  )
}

describe('ModuleFrame', () => {
  it('renders a labelled section with a real h2 and its body', () => {
    renderFrame()
    const section = screen.getByRole('region', { name: 'Top Stories' })
    expect(section.tagName).toBe('SECTION')
    expect(screen.getByRole('heading', { level: 2, name: 'Top Stories' })).toBeDefined()
    expect(screen.getByText('Body')).toBeDefined()
  })

  it('links "See all" to the source channel home while that channel is enabled', () => {
    renderFrame()
    const link = screen.getByRole('link', { name: 'See all Top Stories' })
    expect(link.getAttribute('href')).toBe('/news')
  })

  it('social modules go to Social\'s home at /', () => {
    render(
      <MemoryRouter>
        <PortalFrameEnvironmentProvider value={environment(['social'])}>
          <ModuleFrame moduleId="trending" title="Trending" status="ready" />
        </PortalFrameEnvironmentProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('link', { name: 'See all Trending' }).getAttribute('href')).toBe('/')
  })

  it('shows no "See all" when the channel is off, when asked not to, or outside any environment', () => {
    const { unmount } = renderFrame({}, [])
    expect(screen.queryByRole('link')).toBeNull()
    unmount()
    const second = renderFrame({ seeAll: false })
    expect(screen.queryByRole('link')).toBeNull()
    second.unmount()
    render(
      <MemoryRouter>
        <ModuleFrame moduleId="topStories" title="Top Stories" status="ready" />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('uses a custom visible label and keeps the title for screen readers', () => {
    renderFrame({ seeAllLabel: 'More news' })
    expect(screen.getByRole('link', { name: 'More news Top Stories' })).toBeDefined()
  })

  it('loading keeps the heading over a busy skeleton and withholds the body', () => {
    renderFrame({ status: 'loading' })
    const section = screen.getByRole('region', { name: 'Top Stories' })
    expect(section.getAttribute('aria-busy')).toBe('true')
    expect(screen.getByTestId('module-loading').textContent).toContain('Loading')
    expect(screen.queryByText('Body')).toBeNull()
  })

  it.each(['empty', 'error'] as const)('%s renders nothing at all (fail closed)', status => {
    const { container } = renderFrame({ status })
    expect(container.innerHTML).toBe('')
  })

  it('mounts a polite live region only when given arrivals', () => {
    const { unmount } = renderFrame()
    expect(screen.queryByRole('status')).toBeNull()
    unmount()
    renderFrame({ announce: { arrivals: 0, noun: { one: 'post', other: 'posts' } } })
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite')
  })
})

describe('PortalLayout + registry', () => {
  it('mounts whatever the registry holds, with module props, and skips unregistered ids', () => {
    const registry = createPortalModuleRegistry()
    const seen: PortalModuleProps[] = []
    function Weather(props: PortalModuleProps) {
      seen.push(props)
      return <ModuleFrame moduleId={props.moduleId} title="Weather" status="ready" />
    }
    registry.register({ id: 'weather', channelId: 'weather', region: 'rail', order: 1, Component: Weather })
    render(
      <MemoryRouter>
        <PortalFrameEnvironmentProvider value={environment(['weather', 'news'])}>
          <PortalLayout
            layoutKey="anchor"
            registry={registry}
            modules={[{ id: 'topStories', channelId: 'news' }, { id: 'weather', channelId: 'weather' }]}
          />
        </PortalFrameEnvironmentProvider>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Weather' })).toBeDefined()
    expect(screen.queryAllByRole('region')).toHaveLength(1)
    expect(seen.at(-1)).toMatchObject({ moduleId: 'weather', region: 'rail' })
    // Only the rail is mounted, so it takes the full width.
    expect(screen.getByTestId('portal-layout-grid').dataset.lead).toBe('empty')
  })

  it('a module listed twice mounts once', () => {
    const registry = createPortalModuleRegistry()
    registry.register({
      id: 'weather', channelId: 'weather', region: 'rail', order: 1,
      Component: ({ moduleId }) => <ModuleFrame moduleId={moduleId} title="Weather" status="ready" />,
    })
    render(
      <MemoryRouter>
        <PortalFrameEnvironmentProvider value={environment(['weather'])}>
          <PortalLayout
            layoutKey="anchor"
            registry={registry}
            modules={[{ id: 'weather', channelId: 'weather' }, { id: 'weather', channelId: 'weather' }]}
          />
        </PortalFrameEnvironmentProvider>
      </MemoryRouter>,
    )
    expect(screen.getAllByRole('heading', { name: 'Weather' })).toHaveLength(1)
  })
})
