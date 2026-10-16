/**
 * features/pwa/serviceWorker/ServiceWorkerRegistrar.test.tsx - banner wiring (story 10).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const reg = vi.hoisted(() => ({ fn: vi.fn() }))
vi.mock('./register', () => ({ registerServiceWorker: reg.fn }))

import { ServiceWorkerRegistrar } from './ServiceWorkerRegistrar'

function controller(initial: boolean) {
  let available = initial
  const subs = new Set<() => void>()
  return {
    get updateAvailable() { return available },
    subscribe: (l: () => void) => { subs.add(l); return () => subs.delete(l) },
    applyUpdate: vi.fn(),
    dispose: vi.fn(),
    flip: () => { available = true; subs.forEach(l => l()) },
  }
}

describe('ServiceWorkerRegistrar', () => {
  it('is disabled outside production by default (vitest is not PROD)', async () => {
    reg.fn.mockResolvedValue(undefined)
    render(<ServiceWorkerRegistrar />)
    await waitFor(() => expect(reg.fn).toHaveBeenCalledWith(expect.objectContaining({ enabled: false })))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the update banner when an update appears; Refresh applies; Later hides', async () => {
    const c = controller(false)
    reg.fn.mockResolvedValue(c)
    render(<ServiceWorkerRegistrar enabled />)
    await waitFor(() => expect(reg.fn).toHaveBeenCalled())
    expect(screen.queryByRole('status')).toBeNull()
    c.flip()
    const banner = await screen.findByRole('status', { name: 'Update ready' })
    expect(banner.textContent).not.toMatch(/pulse|dynamis/i)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(c.applyUpdate).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('disposes the controller on unmount', async () => {
    const c = controller(true)
    reg.fn.mockResolvedValue(c)
    const { unmount } = render(<ServiceWorkerRegistrar enabled />)
    await screen.findByRole('status')
    unmount()
    expect(c.dispose).toHaveBeenCalled()
  })
})
