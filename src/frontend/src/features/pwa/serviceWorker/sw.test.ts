/**
 * features/pwa/serviceWorker/sw.test.ts - harness test of public/sw.js (story 10).
 * Evaluates the real worker source against a fake ServiceWorkerGlobalScope + in-memory
 * Cache Storage, then drives install/activate/fetch/message events.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const SRC = readFileSync(path.resolve(__dirname, '../../../../public/sw.js'), 'utf8')
const ORIGIN = 'https://pulse.test'

type Listener = (e: unknown) => void

class FakeCache {
  store = new Map<string, Response>()
  async put(req: string | { url: string }, res: Response) {
    this.store.set(typeof req === 'string' ? new URL(req, ORIGIN).href : req.url, res)
  }
  async match(req: string | { url: string }) {
    const k = typeof req === 'string' ? new URL(req, ORIGIN).href : req.url
    return this.store.get(k)
  }
}

function boot(opts: {
  buildId: string
  precache: string[]
  caches?: Map<string, FakeCache>
  fetchImpl?: typeof fetch
}) {
  const listeners: Record<string, Listener> = {}
  const cacheMap = opts.caches ?? new Map<string, FakeCache>()
  const cachesApi = {
    open: async (n: string) => {
      if (!cacheMap.has(n)) cacheMap.set(n, new FakeCache())
      return cacheMap.get(n)
    },
    keys: async () => [...cacheMap.keys()],
    delete: async (n: string) => cacheMap.delete(n),
  }
  // Real same-origin fetches yield type 'basic'; Node's Response reports 'default'.
  const basic = (r: Response) => Object.defineProperty(r, 'type', { value: 'basic' })
  const fetchMock = vi.fn(async (...a: Parameters<typeof fetch>) =>
    basic(await (opts.fetchImpl ?? (async () => new Response('ok', { status: 200 })))(...a)),
  )
  const skipWaiting = vi.fn()
  const claim = vi.fn(async () => undefined)
  const self = {
    addEventListener: (t: string, l: Listener) => { listeners[t] = l },
    location: { origin: ORIGIN },
    skipWaiting,
    clients: { claim },
  }
  const src = SRC.replace("'__PULSE_BUILD_ID__'", `'${opts.buildId}'`).replace(
    "'__PULSE_PRECACHE__'",
    `'${JSON.stringify(opts.precache)}'`,
  )
  // Node's Request needs absolute URLs; a worker resolves against its own origin.
  const SwRequest = class extends Request {
    constructor(u: string, init?: RequestInit) { super(new URL(u, ORIGIN).href, init) }
  }
  new Function('self', 'caches', 'fetch', 'Request', 'Response', src)(
    self, cachesApi, fetchMock, SwRequest, Response,
  )
  const waitFor = async (fn: (e: unknown) => void) => {
    let p: Promise<unknown> = Promise.resolve()
    fn({ waitUntil: (x: Promise<unknown>) => { p = x } })
    await p
  }
  const request = (
    url: string,
    init: { method?: string; mode?: string; range?: string } = {},
  ) => ({
    url: new URL(url, ORIGIN).href,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    headers: new Headers(init.range ? { range: init.range } : {}),
  })
  /** Returns the response if the worker answered, or 'passthrough'. */
  const fetchEvent = async (req: ReturnType<typeof request>) => {
    let p: Promise<Response> | undefined
    const extended: Array<Promise<unknown>> = []
    listeners.fetch?.({
      request: req,
      respondWith: (x: Promise<Response>) => { p = x },
      waitUntil: (x: Promise<unknown>) => { extended.push(x) },
    })
    const res = p ? await p : 'passthrough'
    await Promise.all(extended)
    return res
  }
  const cacheOf = (n: string): FakeCache => {
    const c = cacheMap.get(n)
    if (!c) throw new Error(`no cache ${n}`)
    return c
  }
  return { listeners, cacheMap, cacheOf, fetchMock, skipWaiting, claim, request, fetchEvent,
    install: () => waitFor(listeners.install as Listener),
    activate: () => waitFor(listeners.activate as Listener) }
}

const PRE = ['/index.html', '/assets/index-abc.js', '/assets/index-abc.css']

describe('sw.js', () => {
  it('precaches index.html and the hashed bundle in a versioned cache, without skipWaiting', async () => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    await sw.install()
    expect([...sw.cacheMap.keys()]).toEqual(['pulse-shell-v1'])
    const keys = [...sw.cacheOf('pulse-shell-v1').store.keys()]
      .map(k => new URL(k).pathname)
    expect(keys.sort()).toEqual([...PRE].sort())
    expect(sw.skipWaiting).not.toHaveBeenCalled()
  })

  it('precache fetches omit credentials', async () => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    await sw.install()
    const req = sw.fetchMock.mock.calls[0]?.[0] as unknown as Request
    expect(req.credentials).toBe('omit')
  })

  it('applies the update only on an explicit SKIP_WAITING message', () => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    sw.listeners.message?.({ data: { type: 'noise' } })
    expect(sw.skipWaiting).not.toHaveBeenCalled()
    sw.listeners.message?.({ data: { type: 'SKIP_WAITING' } })
    expect(sw.skipWaiting).toHaveBeenCalledOnce()
  })

  it('deletes old pulse-shell caches on activate and leaves foreign caches alone', async () => {
    const caches = new Map<string, FakeCache>([
      ['pulse-shell-v0', new FakeCache()],
      ['pulse-shell-v1', new FakeCache()],
      ['someone-elses', new FakeCache()],
    ])
    const sw = boot({ buildId: 'v1', precache: PRE, caches })
    await sw.activate()
    expect([...caches.keys()].sort()).toEqual(['pulse-shell-v1', 'someone-elses'])
    expect(sw.claim).toHaveBeenCalled()
  })

  it.each([
    ['GET /api/feed', '/api/feed', {}],
    ['SignalR hub', '/hubs/feed', {}],
    ['SignalR negotiate', '/hubs/feed/negotiate', {}],
    ['media', '/media/photo.jpg', {}],
    ['join token path', '/join/abc123', { mode: 'navigate' }],
    ['join bare', '/join', { mode: 'navigate' }],
    ['staff nav', '/staff/console', { mode: 'navigate' }],
    ['staff api-ish', '/staff/x.json', {}],
    ['non-GET', '/assets/index-abc.js', { method: 'POST' }],
    ['the worker itself', '/sw.js', {}],
  ])('is network-only passthrough for %s', async (_n, url, init) => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    expect(await sw.fetchEvent(sw.request(url, init))).toBe('passthrough')
    expect(sw.fetchMock).not.toHaveBeenCalled()
    expect(sw.cacheMap.size).toBe(0)
  })

  it('is passthrough for cross-origin requests (even /assets)', async () => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    const r = { ...sw.request('/assets/x.js'), url: 'https://cdn.example.com/assets/x.js' }
    expect(await sw.fetchEvent(r)).toBe('passthrough')
  })

  it('serves /assets/* cache-first and fills the cache lazily with ok basic responses only', async () => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    await sw.install()
    sw.fetchMock.mockClear()
    // precached hit: no network
    const hit = await sw.fetchEvent(sw.request('/assets/index-abc.js'))
    expect(hit).toBeInstanceOf(Response)
    expect(sw.fetchMock).not.toHaveBeenCalled()
    // lazy chunk: network then cached
    await sw.fetchEvent(sw.request('/assets/chunk-9.js'))
    expect(sw.fetchMock).toHaveBeenCalledOnce()
    expect(await sw.cacheOf('pulse-shell-v1').match(sw.request('/assets/chunk-9.js'))).toBeDefined()
  })

  it('does not cache a failed asset response', async () => {
    const sw = boot({
      buildId: 'v1', precache: [],
      fetchImpl: async () => new Response('nope', { status: 500 }),
    })
    await sw.fetchEvent(sw.request('/assets/broken.js'))
    expect(await sw.cacheOf('pulse-shell-v1').match(sw.request('/assets/broken.js'))).toBeUndefined()
  })

  it('navigation: network-first, falls back to the cached shell only when the network fails', async () => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    await sw.install()
    const online = await sw.fetchEvent(sw.request('/social/feed', { mode: 'navigate' }))
    expect(await (online as Response).text()).toBe('ok')

    sw.fetchMock.mockRejectedValue(new TypeError('offline'))
    const offline = await sw.fetchEvent(sw.request('/social/feed', { mode: 'navigate' }))
    expect(offline).toBeInstanceOf(Response)
    expect((offline as Response).ok).toBe(true) // the cached /index.html
  })

  it('never stores a navigation response (could be per-session)', async () => {
    const sw = boot({ buildId: 'v1', precache: [] })
    await sw.fetchEvent(sw.request('/social/feed', { mode: 'navigate' }))
    const c = sw.cacheMap.get('pulse-shell-v1')
    expect(c?.store.size ?? 0).toBe(0)
  })

  it('cache keys only ever contain static shell URLs (no session / exercise data)', async () => {
    const sw = boot({ buildId: 'v1', precache: PRE })
    await sw.install()
    await sw.fetchEvent(sw.request('/assets/chunk-9.js'))
    await sw.fetchEvent(sw.request('/api/feed?exerciseId=x'))
    await sw.fetchEvent(sw.request('/join/tok', { mode: 'navigate' }))
    const paths = [...sw.cacheMap.values()]
      .flatMap(c => [...c.store.keys()])
      .map(k => new URL(k).pathname)
    expect(paths.every(p => p === '/index.html' || p.startsWith('/assets/'))).toBe(true)
  })

  it('passes through Range requests and does not cache non-200 (206) responses', async () => {
    const sw = boot({ buildId: 'v1', precache: [] })
    expect(await sw.fetchEvent(sw.request('/assets/video-1.mp4', { range: 'bytes=0-9' })))
      .toBe('passthrough')
    const sw2 = boot({
      buildId: 'v1', precache: [],
      fetchImpl: async () => new Response('part', { status: 206 }),
    })
    await sw2.fetchEvent(sw2.request('/assets/chunk-2.js'))
    expect(await sw2.cacheOf('pulse-shell-v1').match(sw2.request('/assets/chunk-2.js')))
      .toBeUndefined()
  })

  it('only treats hashed top-level /assets/ files as shell assets', async () => {
    const sw = boot({ buildId: 'v1', precache: [] })
    expect(await sw.fetchEvent(sw.request('/assets/sub/dir/x.js'))).toBe('passthrough')
    expect(await sw.fetchEvent(sw.request('/assets/'))).toBe('passthrough')
    expect(await sw.fetchEvent(sw.request('/assets/index-abc.js'))).toBeInstanceOf(Response)
  })

  it('/join keeps exact + /join/ prefix semantics for navigation', async () => {
    const sw = boot({ buildId: 'v1', precache: [] })
    expect(await sw.fetchEvent(sw.request('/join', { mode: 'navigate' }))).toBe('passthrough')
    expect(await sw.fetchEvent(sw.request('/join/t', { mode: 'navigate' }))).toBe('passthrough')
  })
})
