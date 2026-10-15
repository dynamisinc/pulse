/**
 * features/social/components/ComposerMedia.bands.test.tsx
 * ---------------------------------------------------------------------------
 * demo-feedback 06 (DF-4): the participant composer's attachment PREVIEWS carry the
 * EXERCISE bands (the author sees the media as everyone will) when the exercise
 * requires marking, and none otherwise. Image and video previews alike; the icon-only
 * state (no preview could be made) has none. The bands sit inside the decorative,
 * `aria-hidden` thumbnail, so the description field, the status and the remove button
 * are untouched and the "Video" badge is still there.
 *
 * jsdom has no `URL.createObjectURL`: a stub is installed per test.
 */
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import type { ComposerAttachment } from '../hooks/useComposePost'
import { ComposerMediaTray } from './ComposerMedia'

const ctl = vi.hoisted(() => ({ enabled: true, watermark: true }))

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfigAvailable: () => true,
    useChromeConfig: (): ChromeConfig => ({
      enabled: ctl.enabled,
      watermark: ctl.watermark,
      top: banner,
      bottom: banner,
    }),
  }
})

function attachment(key: string, kind: 'image' | 'video'): ComposerAttachment {
  const type = kind === 'image' ? 'image/png' : 'video/mp4'
  return {
    key,
    file: new File(['x'], `${key}.${kind === 'image' ? 'png' : 'mp4'}`, { type }),
    kind,
    status: 'ready',
    progress: 1,
    alt: 'Water over the road',
  }
}

function renderTray(attachments: readonly ComposerAttachment[]) {
  return render(
    <ComposerMediaTray
      attachments={attachments}
      onAltChange={vi.fn()}
      onCancel={vi.fn()}
      onRemove={vi.fn()}
    />,
  )
}

function stubObjectUrls() {
  let n = 0
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => `blob:preview-${n++}`),
  })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
}

beforeEach(() => {
  ctl.enabled = true
  ctl.watermark = true
  stubObjectUrls()
})

afterEach(() => {
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
})

describe('ComposerMediaTray — EXERCISE bands on previews', () => {
  it('marks each image preview (top + bottom) when required', async () => {
    renderTray([attachment('a', 'image'), attachment('b', 'image')])

    const rows = await screen.findAllByTestId('composer-attachment')
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(await within(row).findByTestId('exercise-band-top')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
      expect(within(row).getByTestId('exercise-band-bottom')).toHaveTextContent('EXERCISE EXERCISE EXERCISE')
    }
  })

  it('marks a video preview and keeps its "Video" badge', async () => {
    renderTray([attachment('v', 'video')])

    const row = await screen.findByTestId('composer-attachment')
    expect(await within(row).findByTestId('exercise-bands')).toBeInTheDocument()
    expect(within(row).getByText('Video')).toBeInTheDocument()
  })

  it('keeps the bands inside the decorative thumbnail; the row controls are unchanged', async () => {
    renderTray([attachment('a', 'image')])

    const bands = await screen.findByTestId('exercise-bands')
    const thumb = bands.parentElement
    expect(thumb).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('textbox', { name: 'Describe photo (required)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove a.png' })).toBeInTheDocument()
  })

  it('renders NO band when not required (watermark off, banner on)', async () => {
    ctl.watermark = false
    renderTray([attachment('a', 'image'), attachment('v', 'video')])

    await screen.findAllByTestId('composer-attachment')
    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
  })

  it('draws them when the chrome is off even with the watermark switch off', async () => {
    ctl.enabled = false
    ctl.watermark = false
    renderTray([attachment('a', 'image')])

    expect(await screen.findByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('has no bands on the icon-only state (no preview could be made, so no media shown)', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => {
        throw new Error('no object URLs here')
      }),
    })
    renderTray([attachment('a', 'image')])

    await screen.findByTestId('composer-attachment')
    expect(screen.queryByTestId('exercise-bands')).not.toBeInTheDocument()
  })
})
