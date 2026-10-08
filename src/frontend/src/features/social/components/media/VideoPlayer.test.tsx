/**
 * features/social/components/media/VideoPlayer.test.tsx
 * ---------------------------------------------------------------------------
 * The inline player (demo-polish F2) against a STUBBED `HTMLMediaElement`
 * (jsdom has no media pipeline): attributes (controls / playsInline /
 * preload="metadata" / poster, `#t=0.1` without one, never autoplay), the
 * duration badge, keyboard handling (Space/K, ←/→ ±5 s, M, F; wrapper-only so the
 * native `<video>` is never double-handled), `aria-pressed` toggles, the
 * single-playing-video rule, no thread-open on click, the NFR-008 watermark slot
 * both ways, native fullscreen with the modal fallback, the unplayable-codec
 * message and the unsafe-URL placeholder.
 *
 * `useChromeConfig` is mocked at the module boundary (`isWatermarkRequired` stays
 * real) so the watermark is driven through the real derivation.
 */
import type { ComponentProps } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import type { PostMedia } from '../../types/post'
import { installMediaElementStubs, renderWithMediaProviders } from './mediaTestUtils'
import type { MediaElementStubs } from './mediaTestUtils'
import { resetPlaybackForTests } from './playbackCoordinator'
import { VideoPlayer } from './VideoPlayer'

const chrome = vi.hoisted(() => ({ enabled: true }))

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfig: (): ChromeConfig => ({ enabled: chrome.enabled, top: banner, bottom: banner }),
  }
})

const ALT = 'A Fairhaven Water crew explains the boil-water advisory'

function video(overrides: Partial<PostMedia> = {}): PostMedia {
  return {
    id: 'v1',
    kind: 'video',
    url: '/mock-media/video/water-update.mp4',
    posterUrl: '/mock-media/video/water-update.poster.svg',
    alt: ALT,
    width: 640,
    height: 360,
    durationSec: 24,
    ...overrides,
  }
}

let stubs: MediaElementStubs

beforeEach(() => {
  chrome.enabled = true
  stubs = installMediaElementStubs()
  resetPlaybackForTests()
})

type PlayerProps = Partial<ComponentProps<typeof VideoPlayer>>

function mount(media: PostMedia = video(), props: PlayerProps = {}) {
  const utils = render(<VideoPlayer media={media} {...props} />)
  const wrapper = screen.getByTestId('video-player')
  const el = wrapper.querySelector('video')
  if (el === null) throw new Error('no <video> rendered')
  return { ...utils, wrapper, el }
}

describe('VideoPlayer — element', () => {
  it('renders controls, playsInline, preload="metadata" and the poster; never autoplays', () => {
    const { el } = mount()

    expect(el).toHaveAttribute('controls')
    expect(el.playsInline).toBe(true)
    expect(el).toHaveAttribute('preload', 'metadata')
    expect(el).toHaveAttribute('poster', '/mock-media/video/water-update.poster.svg')
    expect(el.getAttribute('src')).toBe('/mock-media/video/water-update.mp4')
    expect(el.autoplay).toBe(false)
    expect(el).not.toHaveAttribute('autoplay')
    expect(stubs.play).not.toHaveBeenCalled()
  })

  it('uses the #t=0.1 first-frame fallback when there is no poster', () => {
    const { posterUrl: _poster, ...noPoster } = video()
    const { el } = mount(noPoster)

    expect(el).not.toHaveAttribute('poster')
    expect(el.getAttribute('src')).toBe('/mock-media/video/water-update.mp4#t=0.1')
  })

  it('treats an UNSAFE poster URL as no poster (dropped, fallback applies)', () => {
    const { el } = mount(video({ posterUrl: 'javascript:alert(1)' }))

    expect(el).not.toHaveAttribute('poster')
    expect(el.getAttribute('src')).toMatch(/#t=0\.1$/)
  })

  it('keeps the native fullscreen button out of the way so the watermark cannot be dropped', () => {
    const { el } = mount()
    expect(el).toHaveAttribute('controlslist', 'nofullscreen')
    expect(el).toHaveAttribute('disablepictureinpicture')
  })

  it('is a focusable role="group" named by the alt text', () => {
    const { wrapper } = mount()

    expect(wrapper).toHaveAttribute('role', 'group')
    expect(wrapper).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('group', { name: ALT })).toBe(wrapper)
  })

  it('takes focus from the keyboard (Tab) before its own buttons', async () => {
    const user = userEvent.setup()
    const { wrapper } = mount()

    await user.tab()
    expect(wrapper).toHaveFocus()
  })
})

describe('VideoPlayer — duration badge', () => {
  it('shows the contract duration as m:ss', () => {
    mount(video({ durationSec: 24 }))
    expect(screen.getByTestId('video-duration')).toHaveTextContent('0:24')
  })

  it('formats longer clips with hours', () => {
    mount(video({ durationSec: 3725 }))
    expect(screen.getByTestId('video-duration')).toHaveTextContent('1:02:05')
  })

  it('falls back to the media metadata when the server sent no duration', () => {
    const { durationSec: _d, ...noDuration } = video()
    const { el } = mount(noDuration)
    expect(screen.queryByTestId('video-duration')).not.toBeInTheDocument()

    Object.defineProperty(el, 'duration', { configurable: true, value: 65 })
    fireEvent.loadedMetadata(el)

    expect(screen.getByTestId('video-duration')).toHaveTextContent('1:05')
  })

  it('shows no wall-clock anywhere in the player', () => {
    const { wrapper } = mount()
    expect(wrapper.textContent ?? '').not.toMatch(/\b(AM|PM|ago|UTC)\b/)
  })
})

describe('VideoPlayer — buttons (aria-pressed, never colour-only)', () => {
  it('Play reflects playback through aria-pressed and swaps its icon', async () => {
    const user = userEvent.setup()
    const { el } = mount()
    const play = screen.getByRole('button', { name: 'Play' })
    expect(play).toHaveAttribute('aria-pressed', 'false')

    await user.click(play)
    expect(stubs.play).toHaveBeenCalledTimes(1)
    expect(play).toHaveAttribute('aria-pressed', 'true')
    expect(el.paused).toBe(false)

    await user.click(play)
    expect(stubs.pause).toHaveBeenCalledTimes(1)
    expect(play).toHaveAttribute('aria-pressed', 'false')
  })

  it('Mute toggles the element and its aria-pressed state', async () => {
    const user = userEvent.setup()
    const { el } = mount()
    const mute = screen.getByRole('button', { name: 'Mute' })
    expect(mute).toHaveAttribute('aria-pressed', 'false')

    await user.click(mute)
    expect(el.muted).toBe(true)
    expect(mute).toHaveAttribute('aria-pressed', 'true')

    await user.click(mute)
    expect(el.muted).toBe(false)
    expect(mute).toHaveAttribute('aria-pressed', 'false')
  })

  it('follows the element when the browser changes playback or volume itself (native controls)', () => {
    const { el } = mount()
    const play = screen.getByRole('button', { name: 'Play' })
    const mute = screen.getByRole('button', { name: 'Mute' })

    fireEvent.play(el)
    expect(play).toHaveAttribute('aria-pressed', 'true')
    fireEvent.pause(el)
    expect(play).toHaveAttribute('aria-pressed', 'false')
    fireEvent.play(el)
    fireEvent.ended(el)
    expect(play).toHaveAttribute('aria-pressed', 'false')

    el.muted = true
    fireEvent.volumeChange(el)
    expect(mute).toHaveAttribute('aria-pressed', 'true')
  })

  it('has an Expand button (text name + icon) in the inline variant only', () => {
    const { unmount } = mount()
    expect(screen.getByRole('button', { name: 'Expand' })).toBeInTheDocument()
    unmount()

    mount(video(), { variant: 'expanded' })
    expect(screen.queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument()
  })
})

describe('VideoPlayer — keyboard (wrapper focused)', () => {
  it('Space and K toggle play / pause', () => {
    const { wrapper } = mount()

    fireEvent.keyDown(wrapper, { key: ' ' })
    expect(stubs.play).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(wrapper, { key: ' ' })
    expect(stubs.pause).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(wrapper, { key: 'k' })
    expect(stubs.play).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(wrapper, { key: 'K' })
    expect(stubs.pause).toHaveBeenCalledTimes(2)
  })

  it('prevents the default of a handled key (Space must not scroll the page)', () => {
    const { wrapper } = mount()
    const notPrevented = fireEvent.keyDown(wrapper, { key: ' ', cancelable: true })
    expect(notPrevented).toBe(false)
  })

  it('ArrowLeft / ArrowRight seek 5 s, clamped to [0, duration]', () => {
    const { wrapper, el } = mount()
    Object.defineProperty(el, 'duration', { configurable: true, value: 24 })
    el.currentTime = 10

    fireEvent.keyDown(wrapper, { key: 'ArrowRight' })
    expect(el.currentTime).toBe(15)
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft' })
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft' })
    expect(el.currentTime).toBe(5)
    fireEvent.keyDown(wrapper, { key: 'ArrowLeft' })
    expect(el.currentTime).toBe(0)
    el.currentTime = 22
    fireEvent.keyDown(wrapper, { key: 'ArrowRight' })
    expect(el.currentTime).toBe(24)
  })

  it('M toggles mute', () => {
    const { wrapper, el } = mount()

    fireEvent.keyDown(wrapper, { key: 'm' })
    expect(el.muted).toBe(true)
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyDown(wrapper, { key: 'M' })
    expect(el.muted).toBe(false)
  })

  it('F requests fullscreen on the WRAPPER (so the watermark overlay stays on screen)', () => {
    const { wrapper } = mount()
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    wrapper.requestFullscreen = requestFullscreen

    fireEvent.keyDown(wrapper, { key: 'f' })

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
  })

  it('ignores other keys and modified shortcuts', () => {
    const { wrapper } = mount()

    fireEvent.keyDown(wrapper, { key: 'x' })
    fireEvent.keyDown(wrapper, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(wrapper, { key: 'm', metaKey: true })
    fireEvent.keyDown(wrapper, { key: ' ', altKey: true })

    expect(stubs.play).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('does NOT handle keys while focus is in the native <video> (the browser does; no double toggle)', () => {
    const { el } = mount()

    fireEvent.keyDown(el, { key: ' ' })
    fireEvent.keyDown(el, { key: 'k' })
    fireEvent.keyDown(el, { key: 'm' })

    expect(stubs.play).not.toHaveBeenCalled()
    expect(el.muted).toBe(false)
  })

  it('lets a focused button activate itself on Space (no second toggle from the wrapper)', async () => {
    const user = userEvent.setup()
    mount()
    const play = screen.getByRole('button', { name: 'Play' })
    play.focus()

    await user.keyboard(' ')

    // One activation = one play(); the wrapper handler skipped Space on a button.
    expect(stubs.play).toHaveBeenCalledTimes(1)
  })

  it('stops handled keys from bubbling (so the modal viewer\'s ←/→ never also page)', () => {
    const onOuterKey = vi.fn()
    render(
      <div onKeyDown={onOuterKey}>
        <VideoPlayer media={video()} />
      </div>,
    )
    const wrapper = screen.getByTestId('video-player')

    fireEvent.keyDown(wrapper, { key: 'ArrowRight' })
    expect(onOuterKey).not.toHaveBeenCalled()

    fireEvent.keyDown(wrapper, { key: 'Tab' }) // not ours: must bubble
    expect(onOuterKey).toHaveBeenCalledTimes(1)
  })
})

describe('VideoPlayer — one video at a time', () => {
  it('pauses the other player when this one starts', () => {
    render(
      <>
        <VideoPlayer media={video({ id: 'a', alt: 'First clip' })} />
        <VideoPlayer media={video({ id: 'b', alt: 'Second clip' })} />
      </>,
    )
    const first = within(screen.getByRole('group', { name: 'First clip' }))
    const second = within(screen.getByRole('group', { name: 'Second clip' }))
    const firstEl = screen.getByRole('group', { name: 'First clip' }).querySelector('video')
    const secondEl = screen.getByRole('group', { name: 'Second clip' }).querySelector('video')

    fireEvent.click(first.getByRole('button', { name: 'Play' }))
    expect(firstEl?.paused).toBe(false)
    expect(first.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(second.getByRole('button', { name: 'Play' }))

    expect(secondEl?.paused).toBe(false)
    expect(firstEl?.paused).toBe(true)
    expect(first.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'false')
    expect(second.getByRole('button', { name: 'Play' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('also reacts to a NATIVE play (the browser controls) the same way', () => {
    render(
      <>
        <VideoPlayer media={video({ id: 'a', alt: 'First clip' })} />
        <VideoPlayer media={video({ id: 'b', alt: 'Second clip' })} />
      </>,
    )
    const [firstEl, secondEl] = Array.from(document.querySelectorAll('video'))
    if (firstEl === undefined || secondEl === undefined) throw new Error('missing players')

    fireEvent.play(firstEl)
    fireEvent.play(secondEl)

    expect(stubs.pause).toHaveBeenCalledTimes(1)
    expect(stubs.pause.mock.contexts[0]).toBe(firstEl)
  })

  it('releases its claim on unmount, so the next play pauses nothing stale', () => {
    const first = render(<VideoPlayer media={video({ id: 'a' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    first.unmount()

    stubs.pause.mockClear()
    render(<VideoPlayer media={video({ id: 'b' })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Play' }))

    expect(stubs.pause).not.toHaveBeenCalled()
  })
})

describe('VideoPlayer — clicking does not open the thread', () => {
  it('stops click propagation from the player, its buttons and the video', async () => {
    const user = userEvent.setup()
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <VideoPlayer media={video()} />
      </div>,
    )

    await user.click(screen.getByTestId('video-player'))
    await user.click(screen.getByRole('button', { name: 'Play' }))
    await user.click(screen.getByRole('button', { name: 'Mute' }))
    await user.click(screen.getByRole('button', { name: 'Expand' }))
    const el = document.querySelector('video')
    if (el === null) throw new Error('no video')
    await user.click(el)

    expect(onParentClick).not.toHaveBeenCalled()
  })
})

describe('VideoPlayer — EXERCISE watermark slot (NFR-008)', () => {
  it('is present and EMPTY while the compliance chrome is on', () => {
    chrome.enabled = true
    mount()

    const slot = screen.getByTestId('media-watermark-slot')
    expect(slot).toBeEmptyDOMElement()
    expect(slot).not.toHaveAttribute('role')
  })

  it('renders the text "EXERCISE" when the chrome is off', () => {
    chrome.enabled = false
    mount()

    const slot = screen.getByTestId('media-watermark-slot')
    expect(slot).toHaveTextContent('EXERCISE')
    expect(slot).toHaveAttribute('role', 'note')
    expect(screen.getByRole('note', { name: 'Exercise watermark' })).toBe(slot)
  })

  it('is the SAME reserved element either way, so toggling shifts nothing', () => {
    chrome.enabled = true
    const { rerender } = render(<VideoPlayer media={video()} />)
    const slotOn = screen.getByTestId('media-watermark-slot')
    const siblings = (el: HTMLElement) => Array.from(el.parentElement?.children ?? [])
    const orderBefore = siblings(slotOn).map(node => node.getAttribute('data-testid'))

    chrome.enabled = false
    rerender(<VideoPlayer media={video()} />)

    expect(screen.getByTestId('media-watermark-slot')).toBe(slotOn)
    expect(siblings(slotOn).map(node => node.getAttribute('data-testid'))).toEqual(orderBefore)
    expect(slotOn).toHaveTextContent('EXERCISE')
  })

  it('stays on the wrapper that is fullscreened (the watermark is a child of it)', () => {
    chrome.enabled = false
    const { wrapper } = mount()
    expect(wrapper).toContainElement(screen.getByTestId('media-watermark-slot'))
  })
})

describe('VideoPlayer — Expand (native fullscreen, modal fallback)', () => {
  it('uses native fullscreen on the wrapper when available, without opening the modal', async () => {
    const user = userEvent.setup()
    const onRequestModal = vi.fn()
    const { wrapper } = mount(video(), { onRequestModal })
    const requestFullscreen = vi.fn().mockResolvedValue(undefined)
    wrapper.requestFullscreen = requestFullscreen

    await user.click(screen.getByRole('button', { name: 'Expand' }))

    expect(requestFullscreen).toHaveBeenCalledTimes(1)
    expect(onRequestModal).not.toHaveBeenCalled()
  })

  it('falls back to the modal viewer when there is no fullscreen API (with the wrapper for focus return)', async () => {
    const user = userEvent.setup()
    const onRequestModal = vi.fn()
    const { wrapper } = mount(video(), { onRequestModal })

    await user.click(screen.getByRole('button', { name: 'Expand' }))

    expect(onRequestModal).toHaveBeenCalledTimes(1)
    expect(onRequestModal).toHaveBeenCalledWith(wrapper)
  })

  it('falls back to the modal viewer when the browser REFUSES fullscreen', async () => {
    const user = userEvent.setup()
    const onRequestModal = vi.fn()
    const { wrapper } = mount(video(), { onRequestModal })
    wrapper.requestFullscreen = vi.fn().mockRejectedValue(new TypeError('not allowed'))

    await user.click(screen.getByRole('button', { name: 'Expand' }))

    expect(onRequestModal).toHaveBeenCalledTimes(1)
  })

  it('pauses the inline video when it hands over to the modal', async () => {
    const user = userEvent.setup()
    mount(video(), { onRequestModal: vi.fn() })
    await user.click(screen.getByRole('button', { name: 'Play' }))
    stubs.pause.mockClear()

    await user.click(screen.getByRole('button', { name: 'Expand' }))

    expect(stubs.pause).toHaveBeenCalledTimes(1)
  })

  it('F inside the modal variant never re-opens a modal', async () => {
    const onRequestModal = vi.fn()
    const { wrapper } = mount(video(), { variant: 'expanded', onRequestModal })

    fireEvent.keyDown(wrapper, { key: 'f' })
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(onRequestModal).not.toHaveBeenCalled()
  })
})

describe('VideoPlayer — unplayable and unsafe', () => {
  it('shows a clear message plus the alt text when the browser cannot play it', () => {
    const { el, wrapper } = mount()

    fireEvent.error(el)

    const panel = screen.getByTestId('video-unplayable')
    expect(panel).toHaveTextContent("This video can't be played in this browser")
    expect(panel).toHaveTextContent(ALT)
    expect(wrapper.querySelector('video')).toBeNull()
    // The group (and its accessible name) survives; the dead controls are gone.
    expect(screen.getByRole('group', { name: ALT })).toBe(wrapper)
    expect(screen.queryByRole('button', { name: 'Play' })).not.toBeInTheDocument()
  })

  it('keeps the watermark slot even when the video cannot play', () => {
    chrome.enabled = false
    const { el } = mount()

    fireEvent.error(el)

    expect(screen.getByTestId('media-watermark-slot')).toHaveTextContent('EXERCISE')
  })

  it.each([
    'javascript:alert(1)',
    'data:video/mp4;base64,AAAA',
    '//evil.example.net/a.mp4',
    'http://example.org/a.mp4',
  ])('renders the alt-text placeholder and NO <video> for the unsafe url %j', url => {
    const { container } = render(<VideoPlayer media={video({ url })} />)

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('[src]')).toBeNull()
    expect(screen.getByTestId('media-fallback')).toHaveTextContent(ALT)
  })
})

describe('VideoPlayer — providers (the real stack)', () => {
  it('resolves the real chrome config (chrome on by default => empty slot) under the shell providers', async () => {
    renderWithMediaProviders(<VideoPlayer media={video()} />)

    expect(await screen.findByTestId('media-watermark-slot')).toBeEmptyDOMElement()
  })
})
