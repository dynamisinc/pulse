/**
 * features/pwa/manifest/ManifestHead.test.tsx - head injection, cleanup, fail-closed (story 09).
 */
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManifestHead } from './ManifestHead'
import { isStaffPath } from '../isStaffPath'
import type { IconRenderer } from './brandIcons'
import type { BrandTokens } from '@/features/participant-shell/brandTokens'

const brandA: BrandTokens = {
  name: 'Bay Shield Network',
  colors: { primary: '#2b5f75', accent: '#d97706', surface: '#ffffff', onSurface: '#1c1c1c' },
}
const brandB: BrandTokens = { ...brandA, name: 'Harbor Gazette' }

const renderer: IconRenderer = {
  renderLogo: async () => { throw new Error('none') },
  renderInitial: (i, size) => `data:image/png;base64,${i}${size}`,
}

const created: string[] = []
const revoked: string[] = []
let blobText = new Map<string, Blob>()

function head() {
  return document.head
}
const q = (sel: string) => head().querySelector(sel)

beforeEach(() => {
  document.head.innerHTML = `
    <title>Pulse</title>
    <meta name="theme-color" content="#ffffff" />
    <meta name="description" content="Pulse - local news" />
    <meta name="author" content="Dynamis" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />`
  document.title = 'Pulse'
  created.length = 0
  revoked.length = 0
  blobText = new Map()
  let n = 0
  URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
    const u = `blob:test/${++n}`
    created.push(u)
    blobText.set(u, b as Blob)
    return u
  })
  URL.revokeObjectURL = vi.fn((u: string) => { revoked.push(u) })
})
afterEach(() => { document.head.innerHTML = '' })

describe('ManifestHead', () => {
  it('does nothing while the brand is unresolved (fail closed)', async () => {
    render(<ManifestHead brand={undefined} renderer={renderer} />)
    await Promise.resolve()
    expect(q('link[rel="manifest"]')).toBeNull()
    expect(q('link[rel="apple-touch-icon"]')).toBeNull()
    expect(document.title).toBe('Pulse')
    expect(created).toHaveLength(0)
  })

  it('injects manifest + apple tags + theme/title/icon for a resolved brand', async () => {
    render(<ManifestHead brand={brandA} exerciseId="ex-a" renderer={renderer} />)
    await waitFor(() => expect(q('link[rel="manifest"]')).not.toBeNull())
    const href = q('link[rel="manifest"]')?.getAttribute('href') ?? ''
    expect(href).toMatch(/^blob:/)
    const json = await blobText.get(href)?.text()
    const manifest = JSON.parse(json ?? '{}')
    expect(manifest.name).toBe('Bay Shield Network')
    expect(manifest.id).toContain('ex-a')
    expect(manifest.start_url).toBe(`${window.location.origin}/`)
    expect(q('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content'))
      .toBe('Bay Shield Network')
    expect(q('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content')).toBe('yes')
    expect(q('link[rel="apple-touch-icon"]')?.getAttribute('href')).toMatch(/^data:image\/png/)
    expect(q('meta[name="theme-color"]')?.getAttribute('content')).toBe('#2b5f75')
    expect(q('link[rel="icon"]')?.getAttribute('href')).toMatch(/^data:image\/png/)
    expect(document.title).toBe('Bay Shield Network')
    expect(q('meta[name="description"]')?.getAttribute('content')).toBe('Bay Shield Network')
    expect(q('meta[name="author"]')?.getAttribute('content')).toBe('Bay Shield Network')
    // no leak anywhere in the head
    expect(head().innerHTML).not.toMatch(/pulse|dynamis|favicon\.svg/i)
  })

  it('on unmount removes tags, restores the neutral head and revokes the blob', async () => {
    const { unmount } = render(<ManifestHead brand={brandA} renderer={renderer} />)
    await waitFor(() => expect(q('link[rel="manifest"]')).not.toBeNull())
    unmount()
    expect(q('link[rel="manifest"]')).toBeNull()
    expect(q('link[rel="apple-touch-icon"]')).toBeNull()
    expect(q('meta[name="apple-mobile-web-app-title"]')).toBeNull()
    expect(revoked).toEqual(created)
    expect(document.title).toBe('Pulse')
    expect(q('meta[name="description"]')?.getAttribute('content')).toBe('Pulse - local news')
    expect(q('meta[name="author"]')?.getAttribute('content')).toBe('Dynamis')
    expect(q('meta[name="theme-color"]')?.getAttribute('content')).toBe('#ffffff')
    expect(q('link[rel="icon"]')?.getAttribute('href')).toBe('/favicon.svg')
  })

  it('revokes the old blob and never reuses the old brand on exercise switch', async () => {
    const { rerender } = render(<ManifestHead brand={brandA} renderer={renderer} />)
    await waitFor(() => expect(q('link[rel="manifest"]')).not.toBeNull())
    const first = created[0]
    rerender(<ManifestHead brand={brandB} renderer={renderer} />)
    await waitFor(() => expect(document.title).toBe('Harbor Gazette'))
    expect(revoked).toContain(first)
    expect(head().querySelectorAll('link[rel="manifest"]')).toHaveLength(1)
    expect(head().innerHTML).not.toContain('Bay Shield')
    const json = await blobText.get(q('link[rel="manifest"]')?.getAttribute('href') ?? '')?.text()
    expect(JSON.parse(json ?? '{}').name).toBe('Harbor Gazette')
  })

  it('tears down when the brand goes back to undefined (sign-out / failure)', async () => {
    const { rerender } = render(<ManifestHead brand={brandA} renderer={renderer} />)
    await waitFor(() => expect(q('link[rel="manifest"]')).not.toBeNull())
    rerender(<ManifestHead brand={undefined} renderer={renderer} />)
    expect(q('link[rel="manifest"]')).toBeNull()
    expect(document.title).toBe('Pulse')
    expect(revoked).toHaveLength(1)
  })

  it('discards a stale async result when unmounted before icons are ready', async () => {
    let release: () => void = () => undefined
    const slow: IconRenderer = {
      renderLogo: () => new Promise<string>(res => { release = () => res('data:x') }),
      renderInitial: renderer.renderInitial,
    }
    const { unmount } = render(
      <ManifestHead brand={{ ...brandA, logo: { src: '/l.png', alt: '' } }} renderer={slow} />,
    )
    unmount()
    release()
    await new Promise(r => setTimeout(r, 0))
    expect(q('link[rel="manifest"]')).toBeNull()
    expect(created).toHaveLength(0)
  })

  it('installs nothing if icon generation is impossible (no canvas)', async () => {
    const broken: IconRenderer = {
      renderLogo: renderer.renderLogo,
      renderInitial: () => { throw new Error('no canvas') },
    }
    render(<ManifestHead brand={brandA} renderer={broken} />)
    await new Promise(r => setTimeout(r, 0))
    expect(q('link[rel="manifest"]')).toBeNull()
    expect(document.title).toBe('Pulse')
  })
})

describe('isStaffPath', () => {
  it('flags only /staff paths', () => {
    expect(isStaffPath('/staff')).toBe(true)
    expect(isStaffPath('/staff/console')).toBe(true)
    expect(isStaffPath('/')).toBe(false)
    expect(isStaffPath('/staffing')).toBe(false)
  })
})
