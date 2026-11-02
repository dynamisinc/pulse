/**
 * Story 07 (#772) AC "Registry": a registered module mounts with no layout
 * change, and a duplicate id throws at registration.
 */
import { describe, expect, it } from 'vitest'
import { createPortalModuleRegistry } from './registry'
import type { PortalModuleRegistration } from './types'

const Component = () => null

function registration(overrides: Partial<PortalModuleRegistration> = {}): PortalModuleRegistration {
  return { id: 'topStories', channelId: 'news', region: 'lead', order: 10, Component, ...overrides } as PortalModuleRegistration
}

describe('portal module registry', () => {
  it('registers and returns a module', () => {
    const registry = createPortalModuleRegistry()
    const entry = registration()
    registry.register(entry)
    expect(registry.get('topStories')).toBe(entry)
    expect(registry.get('weather')).toBeUndefined()
  })

  it('throws when the same id registers twice', () => {
    const registry = createPortalModuleRegistry()
    registry.register(registration())
    const Other = () => null
    expect(() => registry.register(registration({ Component: Other })))
      .toThrow(/already registered/)
    expect(registry.list()).toHaveLength(1)
  })

  it('treats re-registering the same component as a no-op (two import paths)', () => {
    const registry = createPortalModuleRegistry()
    registry.register(registration())
    expect(() => registry.register(registration({ order: 99 }))).not.toThrow()
    expect(registry.get('topStories')?.order).toBe(10)
  })

  it('replaces instead of throwing only when asked (dev hot reload)', () => {
    const registry = createPortalModuleRegistry({ replaceDuplicates: true })
    registry.register(registration())
    const Next = () => null
    registry.register(registration({ Component: Next }))
    expect(registry.get('topStories')?.Component).toBe(Next)
    // An edit to only the metadata of a hot-reloaded register.ts lands too.
    registry.register(registration({ Component: Next, order: 77 }))
    expect(registry.get('topStories')?.order).toBe(77)
  })

  it('the app registry throws on a second module for an id outside hot reload', async () => {
    const { portalModuleRegistry } = await import('./registry')
    const Other = () => null
    // `trending` is registered nowhere else in this suite.
    portalModuleRegistry.register(registration({ id: 'trending', channelId: 'social', Component }))
    expect(() => portalModuleRegistry.register(
      registration({ id: 'trending', channelId: 'social', Component: Other }),
    )).toThrow(/already registered/)
  })

  it('rejects a channel that is not the module\'s PC-1 source channel', () => {
    const registry = createPortalModuleRegistry()
    expect(() => registry.register(registration({ channelId: 'social' } as never))).toThrow(/must use channel 'news'/)
  })

  it('rejects an unknown id, region or a non-finite order', () => {
    const registry = createPortalModuleRegistry()
    expect(() => registry.register(registration({ id: 'ticker' } as never))).toThrow(/not a portal module id/)
    expect(() => registry.register(registration({ region: 'footer' } as never))).toThrow(/unknown region/)
    expect(() => registry.register(registration({ order: Number.NaN }))).toThrow(/finite order/)
  })

  it('lists by order, ties by id', () => {
    const registry = createPortalModuleRegistry()
    registry.register(registration({ id: 'weather', channelId: 'weather', region: 'rail', order: 5 } as never))
    registry.register(registration({ id: 'trending', channelId: 'social', region: 'rail', order: 5 } as never))
    registry.register(registration({ order: 1 }))
    expect(registry.list().map(entry => entry.id)).toEqual(['topStories', 'trending', 'weather'])
  })

  it('isolated registries do not share entries', () => {
    const a = createPortalModuleRegistry()
    const b = createPortalModuleRegistry()
    a.register(registration())
    expect(b.get('topStories')).toBeUndefined()
  })
})
