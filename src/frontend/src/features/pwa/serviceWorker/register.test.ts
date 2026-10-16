/**
 * features/pwa/serviceWorker/register.test.ts - registration gating + update flow (story 10).
 */
import { describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from './register'

function fakeEnv(opts: { waiting?: boolean; controller?: boolean } = {}) {
  const regL: Record<string, () => void> = {}
  const contL: Record<string, () => void> = {}
  const waiting = opts.waiting ? { postMessage: vi.fn() } : null
  const reg = {
    waiting,
    installing: null as null | {
      state: string
      addEventListener: (t: string, l: () => void) => void
      removeEventListener: (t: string, l: () => void) => void
    },
    addEventListener: (t: string, l: () => void) => { regL[t] = l },
    removeEventListener: vi.fn(),
    update: vi.fn(async () => undefined),
  }
  const container = {
    controller: opts.controller === false ? null : {},
    register: vi.fn(async () => reg),
    addEventListener: (t: string, l: () => void) => { contL[t] = l },
    removeEventListener: vi.fn(),
  }
  return {
    reg, regL, contL, waiting, raw: container,
    container: container as unknown as ServiceWorkerContainer,
  }
}

describe('registerServiceWorker gating', () => {
  it('does nothing when disabled (dev / tests)', async () => {
    const e = fakeEnv()
    expect(await registerServiceWorker({ enabled: false, pathname: '/', container: e.container })).toBeUndefined()
    expect(e.raw.register).not.toHaveBeenCalled()
  })

  it('does nothing on staff routes', async () => {
    const e = fakeEnv()
    const c = await registerServiceWorker({
      enabled: true, pathname: '/staff/console', container: e.container,
    })
    expect(c).toBeUndefined()
    expect(e.raw.register).not.toHaveBeenCalled()
  })

  it('does nothing without service worker support', async () => {
    const orig = Object.getOwnPropertyDescriptor(navigator, 'serviceWorker')
    expect(await registerServiceWorker({ enabled: true, pathname: '/' })).toBeUndefined()
    expect(orig).toBeUndefined() // jsdom has none
  })

  it('registers /sw.js at root scope, bypassing the HTTP cache for the script', async () => {
    const e = fakeEnv()
    await registerServiceWorker({ enabled: true, pathname: '/social', container: e.container })
    expect(e.raw.register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('fails soft when registration rejects', async () => {
    const e = fakeEnv()
    e.raw.register.mockRejectedValueOnce(new Error('blocked'))
    expect(await registerServiceWorker({ enabled: true, pathname: '/', container: e.container })).toBeUndefined()
  })
})

describe('update flow', () => {
  it('reports an already-waiting worker when a controller exists', async () => {
    const e = fakeEnv({ waiting: true })
    const c = await registerServiceWorker({ enabled: true, pathname: '/', container: e.container })
    expect(c?.updateAvailable).toBe(true)
  })

  it('does not report update on the very first install (no controller yet)', async () => {
    const e = fakeEnv({ waiting: true, controller: false })
    const c = await registerServiceWorker({ enabled: true, pathname: '/', container: e.container })
    expect(c?.updateAvailable).toBe(false)
  })

  it('flags an update when a new worker finishes installing, and notifies subscribers', async () => {
    const e = fakeEnv()
    const c = await registerServiceWorker({ enabled: true, pathname: '/', container: e.container })
    const sl: Record<string, () => void> = {}
    const w = {
      state: 'installing',
      addEventListener: (t: string, l: () => void) => { sl[t] = l },
      removeEventListener: vi.fn(),
    }
    e.reg.installing = w
    const spy = vi.fn()
    c?.subscribe(spy)
    e.regL.updatefound?.()
    w.state = 'installed'
    sl.statechange?.()
    expect(c?.updateAvailable).toBe(true)
    expect(spy).toHaveBeenCalled()
  })

  it('applyUpdate posts SKIP_WAITING; reload only once the new worker takes control', async () => {
    const e = fakeEnv({ waiting: true })
    const reload = vi.fn()
    const c = await registerServiceWorker({ enabled: true, pathname: '/', container: e.container, reload })
    c?.applyUpdate()
    expect(e.waiting?.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).not.toHaveBeenCalled() // no forced reload until the worker has taken over
    e.contL.controllerchange?.()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads on controllerchange if a controller pre-existed (accepted in another tab)', async () => {
    const e = fakeEnv()
    const reload = vi.fn()
    await registerServiceWorker({ enabled: true, pathname: '/', container: e.container, reload })
    e.contL.controllerchange?.()
    e.contL.controllerchange?.()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('never reloads on the first-install claim (no controller at startup)', async () => {
    const e = fakeEnv({ controller: false })
    const reload = vi.fn()
    await registerServiceWorker({ enabled: true, pathname: '/', container: e.container, reload })
    e.contL.controllerchange?.()
    expect(reload).not.toHaveBeenCalled()
  })

  it('dispose removes statechange listeners', async () => {
    const e = fakeEnv()
    const w = { state: 'installing', addEventListener: vi.fn(), removeEventListener: vi.fn() }
    e.reg.installing = w
    const c = await registerServiceWorker({ enabled: true, pathname: '/', container: e.container })
    c?.dispose()
    expect(w.removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function))
  })
})
