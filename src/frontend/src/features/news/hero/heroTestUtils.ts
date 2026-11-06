/**
 * features/news/hero/heroTestUtils.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helpers for the hero suites (news story 05). Never import from app code.
 *
 * jsdom has no media pipeline: `installMediaStubs` replaces `play` / `pause` / `load` so
 * `play` flips `paused` and fires `play` (like a browser), and the player's state machine
 * runs end to end.
 */

import { vi } from 'vitest'
import type { ContentMediaDto } from '@/features/channels'

export function installMediaStubs(): { play: ReturnType<typeof vi.fn> } {
  const paused = new WeakMap<HTMLMediaElement, boolean>()
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return paused.get(this) ?? true
    },
  })
  const play = vi.fn(function play(this: HTMLMediaElement) {
    paused.set(this, false)
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement['play']
  HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
    const wasPlaying = paused.get(this) === false
    paused.set(this, true)
    if (wasPlaying) this.dispatchEvent(new Event('pause'))
  }
  HTMLMediaElement.prototype.load = vi.fn()
  return { play }
}

export function heroImage(overrides: Partial<ContentMediaDto> = {}): ContentMediaDto {
  return {
    id: 'hero-img-1',
    kind: 'image',
    role: 'hero',
    url: '/media/hero-img-1?sig=abc',
    posterUrl: null,
    contentType: 'image/jpeg',
    width: 800,
    height: 800,
    durationSec: null,
    alt: 'Floodwater covering Main Street',
    caption: 'Main Street at noon.',
    ...overrides,
  }
}

export function heroVideo(overrides: Partial<ContentMediaDto> = {}): ContentMediaDto {
  return {
    id: 'hero-vid-1',
    kind: 'video',
    role: 'hero',
    url: '/media/hero-vid-1?sig=def',
    posterUrl: '/media/hero-vid-1-poster?sig=ghi',
    contentType: 'video/mp4',
    width: 1280,
    height: 720,
    durationSec: 90,
    alt: 'The county emergency manager briefs reporters',
    caption: 'The 2 p.m. briefing at the county EOC.',
    ...overrides,
  }
}
