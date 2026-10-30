/**
 * WatermarkSlot: the EXERCISE chip slot on high-risk imagery (NFR-008).
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import { contrastRatio } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import { WATERMARK_TEXT, WatermarkSlot } from './WatermarkSlot'

const ctl = vi.hoisted(() => ({ available: true, enabled: true, watermark: true }))

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfigAvailable: () => ctl.available,
    useChromeConfig: (): ChromeConfig => ({
      enabled: ctl.enabled,
      watermark: ctl.watermark,
      top: banner,
      bottom: banner,
    }),
  }
})

beforeEach(() => {
  ctl.available = true
  ctl.enabled = true
  ctl.watermark = true
})

const css = readSrcFile('features/channels/primitives/watermark/WatermarkSlot.module.css')
  .replace(/\/\*[\s\S]*?\*\//g, '')

function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const body = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(css)?.[1]
  if (body === undefined) throw new Error(`rule ${selector} not found`)
  return body
}

describe('WatermarkSlot: when it shows (isWatermarkRequired = watermark || !enabled)', () => {
  it.each([
    [true, true, true],
    [true, false, true],
    [false, false, true],
    [false, true, false],
  ])('watermark=%s, chrome enabled=%s => shown=%s', (watermark, enabled, shown) => {
    ctl.watermark = watermark
    ctl.enabled = enabled
    render(<WatermarkSlot />)
    const slot = screen.getByTestId('watermark-slot')
    expect(slot).toHaveAttribute('data-watermark-shown', String(shown))
    expect(slot).toHaveTextContent(WATERMARK_TEXT)
  })

  it('force shows it whatever the config says', () => {
    ctl.watermark = false
    render(<WatermarkSlot force />)
    expect(screen.getByTestId('watermark-slot')).toHaveAttribute('data-watermark-shown', 'true')
  })

  it('outside the shell providers it shows (fail toward marking)', () => {
    ctl.available = false
    ctl.watermark = false
    render(<WatermarkSlot />)
    expect(screen.getByTestId('watermark-slot')).toHaveAttribute('data-watermark-shown', 'true')
  })
})

describe('WatermarkSlot: no layout shift', () => {
  it('stays in the DOM when off, hidden by visibility (its box is reserved)', () => {
    ctl.watermark = false
    render(<WatermarkSlot />)
    const slot = screen.getByTestId('watermark-slot')
    expect(slot.className).toMatch(/reserved/)
    expect(rule('.reserved')).toMatch(/visibility:\s*hidden/)
    expect(rule('.reserved')).not.toMatch(/display:\s*none/)
  })

  it('is absolutely positioned at the bottom-right, so it never pushes the media', () => {
    const slot = rule('.slot')
    expect(slot).toMatch(/position:\s*absolute/)
    expect(slot).toMatch(/right:/)
    expect(slot).toMatch(/bottom:/)
  })
})

describe('WatermarkSlot: a11y and interaction', () => {
  it('is aria-hidden and click-through', () => {
    render(<WatermarkSlot />)
    expect(screen.getByTestId('watermark-slot')).toHaveAttribute('aria-hidden', 'true')
    expect(rule('.slot')).toMatch(/pointer-events:\s*none/)
  })

  it('chip contrast is >= 4.5:1 (fixed colours, not skin tokens)', () => {
    const chip = rule('.chip')
    const fg = /(?:^|;)\s*color:\s*(#[0-9a-f]{6})/i.exec(chip)?.[1]
    const bg = /background-color:\s*(#[0-9a-f]{6})/i.exec(chip)?.[1]
    expect(fg).toBeDefined()
    expect(bg).toBeDefined()
    expect(contrastRatio(fg as string, bg as string)).toBeGreaterThanOrEqual(4.5)
    expect(chip).not.toMatch(/var\(/)
  })

  it('clearVideoControls lifts it above the video control row (>= 44px, the native bar)', () => {
    render(<WatermarkSlot clearVideoControls />)
    expect(screen.getByTestId('watermark-slot').className).toMatch(/clearControls/)
    const bottom = Number(/bottom:\s*(\d+)px/.exec(rule('.clearControls'))?.[1])
    expect(bottom).toBeGreaterThanOrEqual(44)
  })
})
