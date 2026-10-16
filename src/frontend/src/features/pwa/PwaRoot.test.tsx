/**
 * features/pwa/PwaRoot.test.tsx - PwaRoot gating: pre-brand + staff-route absence (story 09).
 */
import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrandTokens } from '@/features/participant-shell/brandTokens'

const hook = vi.hoisted(() => ({ value: undefined as BrandTokens | undefined }))
vi.mock('@/features/participant-shell/brandTokens', () => ({
  useResolvedBrandConfig: () => hook.value,
}))
vi.mock('./manifest/brandIcons', async orig => ({
  ...(await orig<typeof import('./manifest/brandIcons')>()),
  canvasIconRenderer: {
    renderLogo: async () => { throw new Error('none') },
    renderInitial: (i: string, s: number) => `data:image/png;base64,${i}${s}`,
  },
}))

import { PwaRoot } from './PwaRoot'

const brand: BrandTokens = {
  name: 'Bay Shield Network',
  colors: { primary: '#2b5f75', accent: '#d97706', surface: '#ffffff', onSurface: '#1c1c1c' },
}

beforeEach(() => {
  document.head.innerHTML = '<title>Pulse</title>'
  URL.createObjectURL = vi.fn(() => 'blob:t/1')
  URL.revokeObjectURL = vi.fn()
  window.history.pushState({}, '', '/')
})

describe('PwaRoot', () => {
  it('renders no manifest before the brand resolves', async () => {
    hook.value = undefined
    render(<PwaRoot />)
    await new Promise(r => setTimeout(r, 0))
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull()
  })

  it('renders the manifest once the brand resolves', async () => {
    hook.value = brand
    render(<PwaRoot />)
    await waitFor(() => expect(document.head.querySelector('link[rel="manifest"]')).not.toBeNull())
  })

  it('renders no manifest on a staff route even with a resolved brand', async () => {
    hook.value = brand
    window.history.pushState({}, '', '/staff/console')
    render(<PwaRoot />)
    await new Promise(r => setTimeout(r, 0))
    expect(document.head.querySelector('link[rel="manifest"]')).toBeNull()
    expect(document.title).toBe('Pulse')
  })
})
