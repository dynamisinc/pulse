/**
 * features/pwa/serviceWorker/sw-killswitch.test.ts - harness test of public/sw-killswitch.js (H-1).
 * Installing it must: skipWaiting, delete every pulse-shell-* cache (and only those), unregister,
 * and navigate each open window to its own URL. It has no fetch handler.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const SRC = readFileSync(path.resolve(__dirname, '../../../../public/sw-killswitch.js'), 'utf8')

type Listener = (e: { waitUntil: (p: Promise<unknown>) => void }) => void

describe('sw-killswitch.js', () => {
  it('skips waiting, purges pulse-shell caches, unregisters and reloads open windows', async () => {
    const listeners: Record<string, Listener> = {}
    const caches = new Map<string, true>([
      ['pulse-shell-a', true], ['pulse-shell-b', true], ['other', true],
    ])
    const order: string[] = []
    const navigate = vi.fn(async () => { order.push('navigate') })
    const self = {
      addEventListener: (t: string, l: Listener) => { listeners[t] = l },
      skipWaiting: vi.fn(),
      registration: { unregister: vi.fn(async () => { order.push('unregister'); return true }) },
      clients: {
        matchAll: vi.fn(async () => [
          { url: 'https://x/a', navigate }, { url: 'https://x/b', navigate },
        ]),
      },
    }
    const cachesApi = {
      keys: async () => [...caches.keys()],
      delete: async (k: string) => { order.push(`delete:${k}`); return caches.delete(k) },
    }
    new Function('self', 'caches', SRC)(self, cachesApi)

    expect(Object.keys(listeners).sort()).toEqual(['activate', 'install']) // no fetch handler
    listeners.install?.({ waitUntil: () => undefined })
    expect(self.skipWaiting).toHaveBeenCalled()

    let p: Promise<unknown> = Promise.resolve()
    listeners.activate?.({ waitUntil: x => { p = x } })
    await p

    expect([...caches.keys()]).toEqual(['other'])
    expect(self.registration.unregister).toHaveBeenCalledOnce()
    expect(self.clients.matchAll).toHaveBeenCalledWith({ type: 'window' })
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenNthCalledWith(1, 'https://x/a')
    expect(navigate).toHaveBeenNthCalledWith(2, 'https://x/b')
    // unregister only after the caches are gone, navigation last
    expect(order.indexOf('unregister')).toBeGreaterThan(order.lastIndexOf('delete:pulse-shell-b'))
    expect(order.indexOf('navigate')).toBeGreaterThan(order.indexOf('unregister'))
  })
})
