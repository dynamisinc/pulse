import { describe, expect, it } from 'vitest'
import { contentPermalink } from './permalink'
import type { ContentChannelId } from './vocabulary'

/** Channels-foundation story 02 (#698), AC "Permalinks are path-only" (FC-9.3). */
describe('contentPermalink', () => {
  it('returns /{channelId}/{outletSlug}/{contentSlug}', () => {
    expect(contentPermalink('news', 'newsline-7', 'emergency-call-delays'))
      .toBe('/news/newsline-7/emergency-call-delays')
  })

  it.each(['news', 'press', 'weather'] as const)('never returns a host for %s', channel => {
    const value = contentPermalink(channel, 'outlet-1', 'item-2')
    expect(value).not.toContain('://')
    expect(value.startsWith('//')).toBe(false)
    expect(value.startsWith(`/${channel}/`)).toBe(true)
  })

  it.each([
    ['news', 'https:', 'x'],
    ['news', '', 'x'],
    ['news', 'evil.test', 'x'],
    ['news', 'Newsline', 'x'],
    ['news', 'ok', '../etc'],
    ['news', 'ok', 'a/b'],
    ['news', 'ok', 'a?b=1'],
    ['news', 'ok', 'a'.repeat(81)],
    ['news', 'ok', 'a\n'],
    ['news', 'ok\n', 'a'],
  ])('rejects a malformed slug (%s, %s, %s)', (channel, outlet, slug) => {
    expect(() => contentPermalink(channel as ContentChannelId, outlet, slug)).toThrow()
  })

  it.each(['social', 'portal', '//x.test', 'https://x.test'])('rejects a non-content channel %s', channel => {
    expect(() => contentPermalink(channel as ContentChannelId, 'ok', 'ok')).toThrow()
  })
})
