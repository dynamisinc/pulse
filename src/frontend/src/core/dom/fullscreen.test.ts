/**
 * core/dom/fullscreen.test.ts
 * ---------------------------------------------------------------------------
 * The typed document-level Fullscreen wrapper (standard + `webkit` prefix) used by
 * the shell's overlay layer and the social player. jsdom implements none of the API,
 * so each test installs what it needs and `afterEach` removes it.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FULLSCREEN_CHANGE_EVENTS, exitFullscreen, getFullscreenElement } from './fullscreen'

afterEach(() => {
  for (const key of ['fullscreenElement', 'webkitFullscreenElement', 'exitFullscreen', 'webkitExitFullscreen']) {
    Reflect.deleteProperty(document, key)
  }
})

describe('getFullscreenElement', () => {
  it('is null when nothing is fullscreen (or the API is absent)', () => {
    expect(getFullscreenElement()).toBeNull()
  })

  it('reads the standard property, then the webkit-prefixed one', () => {
    const standard = document.createElement('div')
    const prefixed = document.createElement('video')
    Object.defineProperty(document, 'webkitFullscreenElement', { configurable: true, value: prefixed })
    expect(getFullscreenElement()).toBe(prefixed)

    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: standard })
    expect(getFullscreenElement()).toBe(standard)
  })
})

describe('exitFullscreen', () => {
  it('calls the standard exit when present', async () => {
    const exit = vi.fn().mockResolvedValue(undefined)
    document.exitFullscreen = exit
    await exitFullscreen()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('falls back to webkitExitFullscreen', async () => {
    const exit = vi.fn()
    Object.defineProperty(document, 'webkitExitFullscreen', { configurable: true, value: exit })
    await exitFullscreen()
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('never throws — an absent API or a refusal is swallowed', async () => {
    await expect(exitFullscreen()).resolves.toBeUndefined()
    document.exitFullscreen = vi.fn().mockRejectedValue(new TypeError('not fullscreen'))
    await expect(exitFullscreen()).resolves.toBeUndefined()
  })
})

describe('FULLSCREEN_CHANGE_EVENTS', () => {
  it('lists the standard and the webkit event names', () => {
    expect([...FULLSCREEN_CHANGE_EVENTS]).toEqual(['fullscreenchange', 'webkitfullscreenchange'])
  })
})
