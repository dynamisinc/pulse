/**
 * features/channels/routing/registry.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 12 (#708): `registerChannel()` validation and the pure
 * path → channel lookup the router and the shell nav share.
 */
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  channelNavPath,
  findChannelForPath,
  getRegisteredChannels,
  registerChannel,
  resetChannelRegistryForTests,
  type ChannelRegistration,
} from './registry'

function Scope({ children }: { readonly children: ReactNode }) {
  return <>{children}</>
}

const social: ChannelRegistration = {
  id: 'social',
  pathPrefix: '/',
  navPath: '/home',
  element: <p>social</p>,
  themeScope: Scope,
}
const news: ChannelRegistration = {
  id: 'news',
  pathPrefix: '/news',
  element: <p>news</p>,
  themeScope: Scope,
}

let consoleError: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetChannelRegistryForTests()
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  consoleError.mockRestore()
  resetChannelRegistryForTests()
})

describe('registerChannel', () => {
  it('registers channels in order and ignores an identical re-registration', () => {
    registerChannel(social)
    registerChannel(news)
    registerChannel(news)

    expect(getRegisteredChannels().map(c => c.id)).toEqual(['social', 'news'])
    expect(consoleError).not.toHaveBeenCalled()
  })

  it.each([
    ['an uncatalogued id', { ...news, id: 'radio' as never, pathPrefix: '/radio' }],
    ['a prefix other than /{id}', { ...news, pathPrefix: '/local-news' }],
    ['Social anywhere but /', { ...social, pathPrefix: '/social' }],
    ['a channel at /', { ...news, pathPrefix: '/' }],
    ['an invalid navPath', { ...news, navPath: 'https://evil.example' }],
  ])('refuses %s, loudly, without throwing', (_label, registration) => {
    registerChannel(registration as ChannelRegistration)

    expect(getRegisteredChannels()).toEqual([])
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('refuses a second, different registration of the same id', () => {
    registerChannel(news)
    registerChannel({ ...news, element: <p>other news</p> })

    expect(getRegisteredChannels()).toEqual([news])
    expect(consoleError).toHaveBeenCalledTimes(1)
  })

  it('nav path defaults to the prefix', () => {
    expect(channelNavPath(news)).toBe('/news')
    expect(channelNavPath(social)).toBe('/home')
  })
})

describe('findChannelForPath', () => {
  const registered = [social, news]

  it.each([
    ['/news', 'news'],
    ['/news/newsline-7/emergency-call-delays', 'news'],
    ['/home', 'social'],
    ['/newsroom', 'social'], // a segment boundary, not a string prefix
    ['/social', 'social'],
    ['/alice/status/1', 'social'],
  ])('%s → %s', (path, id) => {
    expect(findChannelForPath(path, registered)?.id).toBe(id)
  })

  it('a catalogued channel that has not registered never falls through to Social', () => {
    expect(findChannelForPath('/weather/zones/north', registered)).toBeUndefined()
    expect(findChannelForPath('/portal', registered)).toBeUndefined()
  })

  it('nothing registered at / → undefined', () => {
    expect(findChannelForPath('/home', [news])).toBeUndefined()
  })
})
