/**
 * features/pwa/manifest/buildManifest.test.ts - pure manifest + icon tests (story 09).
 */
import { describe, expect, it, vi } from 'vitest'
import { buildManifest, shortNameFor } from './buildManifest'
import {
  pickInitial,
  readableTextColor,
  renderBrandIcons,
  type IconRenderer,
} from './brandIcons'
import type { BrandTokens } from '@/features/participant-shell/brandTokens'

const brand: BrandTokens = {
  name: 'Bay Shield Network',
  colors: { primary: '#2b5f75', accent: '#d97706', surface: '#ffffff', onSurface: '#1c1c1c' },
}
const icons = [
  { src: 'data:image/png;base64,AAA', sizes: '192x192', type: 'image/png' },
  { src: 'data:image/png;base64,BBB', sizes: '512x512', type: 'image/png' },
]

describe('buildManifest', () => {
  const m = buildManifest(brand, 'https://x.example', icons)

  it('takes name, colors and display from the brand', () => {
    expect(m.name).toBe('Bay Shield Network')
    expect(m.short_name).toBe('Bay Shield')
    expect(m.theme_color).toBe('#2b5f75')
    expect(m.background_color).toBe('#ffffff')
    expect(m.display).toBe('standalone')
  })

  it('uses absolute same-origin start_url, scope and id', () => {
    expect(m.start_url).toBe('https://x.example/')
    expect(m.scope).toBe('https://x.example/')
    expect(m.id).toBe('https://x.example/')
    expect(buildManifest(brand, 'https://x.example/', icons).start_url).toBe('https://x.example/')
  })

  it('never leaks Pulse or Dynamis in the serialized JSON', () => {
    expect(JSON.stringify(m)).not.toMatch(/pulse|dynamis/i)
  })

  it('shortens long names at a word boundary', () => {
    expect(shortNameFor('Fairhaven Community Alerts')).toBe('Fairhaven')
    expect(shortNameFor('Supercalifragilistic')).toBe('Supercalifra')
    expect(shortNameFor('  KFHV  ')).toBe('KFHV')
  })
})

describe('icons', () => {
  const fake = (over: Partial<IconRenderer> = {}): IconRenderer => ({
    renderLogo: vi.fn(async (_s, size) => `data:logo-${size}`),
    renderInitial: vi.fn((i, size) => `data:init-${i}-${size}`),
    ...over,
  })

  it('uses the logo for 192 and 512 when it renders', async () => {
    const r = fake()
    const set = await renderBrandIcons({ ...brand, logo: { src: '/l.png', alt: 'l' } }, r)
    expect(set.source).toBe('logo')
    expect(set.icons.map(i => [i.sizes, i.src])).toEqual([
      ['192x192', 'data:logo-192'],
      ['512x512', 'data:logo-512'],
    ])
    expect(set.touchIconHref).toBe('data:logo-192')
    expect(r.renderInitial).not.toHaveBeenCalled()
  })

  it('falls back to the generated initial when the logo is unusable (CORS/taint/404)', async () => {
    const r = fake({ renderLogo: vi.fn().mockRejectedValue(new Error('tainted')) })
    const set = await renderBrandIcons({ ...brand, logo: { src: 'https://cdn.other/l.png', alt: '' } }, r)
    expect(set.source).toBe('generated')
    expect(set.icons[1]?.src).toBe('data:init-B-512')
  })

  it('generates the initial with no logo', async () => {
    const set = await renderBrandIcons(brand, fake())
    expect(set.source).toBe('generated')
    expect(JSON.stringify(set.icons)).not.toMatch(/pulse|dynamis/i)
  })

  it('picks initials and contrast-screened text', () => {
    expect(pickInitial('  the bay')).toBe('T')
    expect(pickInitial('!!!')).toBe('E')
    expect(readableTextColor('#2b5f75')).toBe('#ffffff')
    expect(readableTextColor('#ffe08a')).toBe('#1c1c1c')
    expect(readableTextColor('not-a-color')).toBe('#ffffff')
  })
})
