/**
 * News story 05 (#722): the hero slot, the broadcast player and the EXERCISE chip.
 *
 * `useChromeConfig` is mocked at the module boundary (`isWatermarkRequired` stays real),
 * and `useOverlayState` likewise, as in the shared player's own suite.
 */
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import {
  NEUTRAL_SKIN_TOKENS,
  SkinScope,
  WATERMARK_TEXT,
  mergeSkinTokens,
} from '@/features/channels'
import type { OutletSkinTokens } from '@/features/channels'
import { seriousAxeViolations } from '@/features/channels/primitives/primitivesTestUtils'
import { readSrcFile } from '@/test/readSource'
import { HeroSlot } from './HeroSlot'
import type { PlayProgressEvent } from './heroModel'
import { heroImage, heroVideo, installMediaStubs } from './heroTestUtils'

const chrome = vi.hoisted(() => ({ enabled: true, watermark: true }))

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfigAvailable: () => true,
    useChromeConfig: (): ChromeConfig => ({
      enabled: chrome.enabled,
      watermark: chrome.watermark,
      top: banner,
      bottom: banner,
    }),
  }
})

vi.mock('@/features/participant-shell/components/OverlayLayer/overlayState', () => ({
  useOverlayState: () => ({ state: 'none', register: 'in-fiction', message: '' }),
}))

let play: ReturnType<typeof vi.fn>

beforeEach(() => {
  chrome.enabled = true
  chrome.watermark = true
  play = installMediaStubs().play
})

function skin(media: Partial<OutletSkinTokens['media']> = {}): OutletSkinTokens {
  return { ...NEUTRAL_SKIN_TOKENS, media: { ...NEUTRAL_SKIN_TOKENS.media, ...media } }
}

function renderHero(
  hero: ReturnType<typeof heroImage> | null,
  tokens: OutletSkinTokens = skin(),
  onPlayProgress?: (event: PlayProgressEvent) => void,
) {
  return render(
    <SkinScope scopeId="news-test" tokens={tokens}>
      <HeroSlot item={{ hero }} skin={tokens} onPlayProgress={onPlayProgress} />
    </SkinScope>,
  )
}

describe('Hero slot: collapse', () => {
  it('renders nothing (no gap, no placeholder art) without a hero', () => {
    const { container } = render(<HeroSlot item={{ hero: null }} skin={skin()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('a document is never a hero: nothing renders', () => {
    const doc = heroImage({ kind: 'document', contentType: 'application/pdf' })
    const { container } = render(<HeroSlot item={{ hero: doc }} skin={skin()} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('Hero slot: image via ContentMedia', () => {
  it('renders the contract URL with its alt and the caption', () => {
    renderHero(heroImage())
    const hero = screen.getByTestId('news-hero')
    expect(within(hero).getByTestId('content-media')).toBeInTheDocument()
    const img = within(hero).getByRole('img', { name: 'Floodwater covering Main Street' })
    // The signed, host-relative URL from the DTO, unaltered (isolation; FC-9.3).
    expect(img).toHaveAttribute('src', '/media/hero-img-1?sig=abc')
    expect(hero).toHaveTextContent('Main Street at noon.')
  })

  it.each([
    ['low', '1'],
    ['medium', `${1000 / 667}`],
    ['high', `${1000 / 563}`],
  ] as const)('crop %s sets the box ratio only (aspect-ratio %s)', (crop, ratio) => {
    renderHero(heroImage(), skin({ cropAggression: crop }))
    const img = screen.getByRole('img')
    const frame = img.parentElement as HTMLElement
    expect(frame.style.aspectRatio).toBe(`${ratio} / 1`)
    expect(img).toHaveAttribute('src', '/media/hero-img-1?sig=abc')
  })

  it.each([
    ['plain', /captionPlain/],
    ['italic-serif', /captionItalicSerif/],
    ['small-caps', /captionSmallCaps/],
    ['shouty', /captionShouty/],
  ] as const)('caption style %s comes from the skin', (captionStyle, className) => {
    renderHero(heroImage(), skin({ captionStyle }))
    expect(screen.getByTestId('news-hero').className).toMatch(className)
  })

  it('shows the EXERCISE chip bottom-right of the image frame when required', () => {
    renderHero(heroImage())
    const chip = screen.getByTestId('watermark-slot')
    expect(chip).toHaveAttribute('data-watermark-shown', 'true')
    expect(chip).toHaveTextContent(WATERMARK_TEXT)
    // Inside the image's positioned frame (the box ContentMedia sizes).
    expect(chip.parentElement).toBe(screen.getByRole('img').parentElement)
    expect(screen.getByTestId('exercise-bands')).toBeInTheDocument()
  })

  it('reserves the chip space when not required (no layout shift)', () => {
    chrome.watermark = false
    renderHero(heroImage())
    const chip = screen.getByTestId('watermark-slot')
    expect(chip).toHaveAttribute('data-watermark-shown', 'false')
    expect(chip.className).toMatch(/reserved/)
  })

  it.each([
    [true, false],
    [false, false],
    [true, true],
  ])('chrome and watermark are never both off (watermark=%s, chrome=%s => shown)', (w, e) => {
    chrome.watermark = w
    chrome.enabled = e
    renderHero(heroImage())
    expect(screen.getByTestId('watermark-slot')).toHaveAttribute('data-watermark-shown', 'true')
  })
})

describe('Hero slot: broadcast player (NWS-014)', () => {
  it('renders the shared player with poster, preload=metadata and never autoplays', () => {
    renderHero(heroVideo())
    const player = screen.getByTestId('video-player')
    const video = player.querySelector('video') as HTMLVideoElement
    expect(video).toHaveAttribute('poster', '/media/hero-vid-1-poster?sig=ghi')
    expect(video).toHaveAttribute('src', '/media/hero-vid-1?sig=def')
    expect(video).toHaveAttribute('preload', 'metadata')
    expect(video).not.toHaveAttribute('autoplay')
    // The broadcast row replaces the native controls.
    expect(video).not.toHaveAttribute('controls')
    expect(play).not.toHaveBeenCalled()
  })

  it('has one labelled control group: play, scrub, elapsed/total, mute, fullscreen', () => {
    renderHero(heroVideo())
    const group = screen.getByRole('group', { name: 'Video controls' })
    expect(within(group).getByRole('button', { name: 'Play' })).not.toHaveAttribute('aria-pressed')
    expect(within(group).getByRole('slider', { name: 'Seek' })).toHaveAttribute(
      'aria-valuetext', '0:00 of 1:30',
    )
    expect(within(group).getByTestId('broadcast-time')).toHaveTextContent('0:00 / of 1:30')
    expect(within(group).getByRole('button', { name: 'Mute' })).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Full screen' })).toBeInTheDocument()
    // No captions track on the media: no captions toggle.
    expect(within(group).queryByRole('button', { name: 'Captions' })).toBeNull()
    // The old Social top row / centre button are not drawn.
    expect(screen.queryByTestId('video-play-toggle')).toBeNull()
    expect(screen.queryByTestId('video-expand')).toBeNull()
  })

  it('the controls live inside the wrapper that fullscreens (overlays survive)', () => {
    renderHero(heroVideo())
    const wrapper = screen.getByTestId('video-player')
    expect(wrapper).toContainElement(screen.getByTestId('broadcast-controls'))
    expect(wrapper).toContainElement(screen.getByTestId('watermark-slot'))
    expect(wrapper).toContainElement(screen.getByTestId('exercise-bands'))
  })

  it('without a captions track the caption is the accessible description', () => {
    renderHero(heroVideo())
    const wrapper = screen.getByTestId('video-player')
    expect(wrapper).toHaveAccessibleDescription('The 2 p.m. briefing at the county EOC.')
  })

  it('plays and pauses from the keyboard and the button (no sound autoplay)', async () => {
    const user = userEvent.setup()
    renderHero(heroVideo())
    const button = screen.getByTestId('broadcast-play')
    await user.click(button)
    expect(play).toHaveBeenCalledTimes(1)
    // The NAME carries the state (a pressed "Play" would read as the opposite).
    expect(button).toHaveAccessibleName('Pause')
    screen.getByTestId('video-player').focus()
    await user.keyboard(' ')
    expect(button).toHaveAccessibleName('Play')
  })

  it('scrubbing seeks the video', () => {
    renderHero(heroVideo())
    const video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '30' } })
    expect(video.currentTime).toBe(30)
  })

  it('reports the first play and the 50% / 100% milestones once each', async () => {
    const events: PlayProgressEvent[] = []
    const user = userEvent.setup()
    renderHero(heroVideo(), skin(), event => events.push(event))
    const video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    // Poster render and metadata load report nothing.
    expect(events).toEqual([])
    await user.click(screen.getByRole('button', { name: 'Play' }))
    video.currentTime = 46
    fireEvent.timeUpdate(video)
    video.currentTime = 90
    fireEvent.timeUpdate(video)
    fireEvent.timeUpdate(video)
    expect(events).toEqual([
      { type: 'play' },
      { type: 'progress', pct: 50 },
      { type: 'progress', pct: 100 },
    ])
  })

  it('a failed URL that is re-minted does not report play / milestones again', async () => {
    const events: PlayProgressEvent[] = []
    const user = userEvent.setup()
    const tokens = skin()
    const ui = (url: string) => (
      <SkinScope scopeId="news-test" tokens={tokens}>
        <HeroSlot
          item={{ hero: heroVideo({ url }) }}
          skin={tokens}
          onPlayProgress={event => events.push(event)}
        />
      </SkinScope>
    )
    const { rerender } = render(ui('/media/hero-vid-1?sig=one'))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    let video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    video.currentTime = 46
    fireEvent.timeUpdate(video)
    fireEvent.error(video)
    // The control row is gone while the video is unplayable.
    expect(screen.queryByTestId('broadcast-controls')).toBeNull()
    rerender(ui('/media/hero-vid-1?sig=two'))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    video.currentTime = 46
    fireEvent.timeUpdate(video)
    expect(events).toEqual([{ type: 'play' }, { type: 'progress', pct: 50 }])
  })

  // Source GUARDS (jsdom does no layout): the frame adds the row's height to the picture's
  // ratio, and the picture box ends above the row.
  it('the picture ends above the control row (captions / lower-thirds never behind it)', () => {
    const css = readSrcFile('features/news/hero/BroadcastPlayer.module.css')
    const frame = /\.frame\.frame\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    const root = /\.root\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(root).toMatch(/container-type:\s*inline-size/)
    expect(frame).toMatch(/aspect-ratio:\s*auto !important/)
    expect(frame).toContain(
      'height: calc(100cqi / var(--vp-ratio, 1.7778) + var(--pulse-player-controls-h, 44px))',
    )
    const rule = /\.frame\.frame > video\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toMatch(/height:\s*calc\(100% - var\(--pulse-player-controls-h, 44px\)\)/)
  })

  it('an unplayable video shows no footage, so no chip or bands (as F14 / Social)', () => {
    renderHero(heroVideo())
    fireEvent.error(screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement)
    expect(screen.getByTestId('video-unplayable')).toBeInTheDocument()
    expect(screen.queryByTestId('watermark-slot')).toBeNull()
    expect(screen.queryByTestId('exercise-bands')).toBeNull()
  })
})

describe('Hero slot: no news stylesheet reaches the chip', () => {
  it('no hero CSS targets the watermark slot, its chip or its data attributes', () => {
    for (const file of ['HeroSlot.module.css', 'BroadcastPlayer.module.css', 'PlayerControls.module.css']) {
      const css = readSrcFile(`features/news/hero/${file}`).replace(/\/\*[\s\S]*?\*\//g, '')
      expect(css, file).not.toMatch(/watermark|\.slot\b|\.chip\b|\.reserved\b|\.clearControls\b/i)
      // The chip box positions the slot; it never sets visibility, opacity, colour or size.
      const box = /\.chipBox\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
      expect(box, file).not.toMatch(/visibility|opacity|color|display|transform|font/)
    }
  })
})

describe('Hero slot: video watermark (NWS-032 / NFR-008)', () => {
  it('the chip is bottom-right of the video frame, in a box that stops above the controls', () => {
    renderHero(heroVideo())
    const chip = screen.getByTestId('watermark-slot')
    const box = screen.getByTestId('broadcast-chip-box')
    expect(chip.parentElement).toBe(box)
    expect(screen.getByTestId('broadcast-controls')).not.toContainElement(chip)
    const css = readSrcFile('features/news/hero/BroadcastPlayer.module.css')
    expect(css).toMatch(/\.chipBox\s*\{[^}]*bottom:\s*var\(--pulse-player-controls-h, 44px\)/)
  })

  it('reserves the chip when not required', () => {
    chrome.watermark = false
    renderHero(heroVideo())
    expect(screen.getByTestId('watermark-slot')).toHaveAttribute('data-watermark-shown', 'false')
  })
})

describe('Hero slot: no token can move, hide or restyle the chip (CANNOT list)', () => {
  const hostileOverrides = {
    palette: { accent: '#ffffff', bg: '#000000', surface: '#000000', text: '#ffffff' },
    density: { radius: 24, spacingScale: 2, ruleWeight: 6 },
    media: { playerTint: '#111418', cropAggression: 'high', captionStyle: 'shouty' },
    // Not in the schema: rejected by the strict merge, never reaching the chip.
    watermark: { hidden: true, position: 'top-left' },
    ext: { news: { watermark: 'off', watermarkPosition: 'top-left', exerciseChip: false } },
  }

  it.each(['image', 'video'] as const)('%s hero: the chip is unchanged', kind => {
    const media = kind === 'image' ? heroImage() : heroVideo()
    const baseline = renderHero(media)
    const before = screen.getByTestId('watermark-slot').outerHTML
    baseline.unmount()

    const { tokens } = mergeSkinTokens('neutral', hostileOverrides)
    renderHero(media, tokens)
    const chip = screen.getByTestId('watermark-slot')
    expect(chip.outerHTML).toBe(before)
    expect(chip).toHaveAttribute('data-watermark-shown', 'true')
    expect(chip.getAttribute('style')).toBeNull()
  })
})

describe('Hero slot: accessibility and isolation', () => {
  it.each([['image'], ['video']] as const)('%s hero has no serious axe violations', async kind => {
    const { container } = renderHero(kind === 'image' ? heroImage() : heroVideo())
    expect(await seriousAxeViolations(container)).toEqual([])
  })

  it('hard-codes no absolute host and builds no media URL (FC-9.3)', () => {
    for (const file of ['HeroSlot.tsx', 'BroadcastPlayer.tsx', 'PlayerControls.tsx', 'heroModel.ts']) {
      const source = readSrcFile(`features/news/hero/${file}`)
      expect(source, file).not.toMatch(/https?:\/\//)
      expect(source, file).not.toMatch(/['"`]\/media\//)
    }
  })

  it('participant world: no COBRA, no MUI icons, no Social import', () => {
    for (const file of ['HeroSlot.tsx', 'BroadcastPlayer.tsx', 'PlayerControls.tsx']) {
      const source = readSrcFile(`features/news/hero/${file}`)
      expect(source, file).not.toMatch(/from '[^']*(@\/theme|cobra|@mui|features\/social)/i)
    }
  })
})
