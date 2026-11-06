/**
 * core/media/player: the OPT-IN `renderControls` hook (news story 05). Unset, the player
 * is unchanged (Social's own suite pins that); set, the native controls and the default
 * top row / centre Play are replaced by the host row, which gets live state and actions.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import type { PlayerControlsApi, PlayerMedia } from './playerTypes'
import { VideoPlayer } from './VideoPlayer'

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfigAvailable: () => true,
    useChromeConfig: (): ChromeConfig => (
      { enabled: true, watermark: true, top: banner, bottom: banner }
    ),
  }
})

vi.mock('@/features/participant-shell/components/OverlayLayer/overlayState', () => ({
  useOverlayState: () => ({ state: 'none', register: 'in-fiction', message: '' }),
}))

const MEDIA: PlayerMedia = {
  kind: 'video',
  url: '/mock-media/video/a.mp4',
  posterUrl: '/mock-media/video/a.poster.svg',
  alt: 'A briefing',
  width: 640,
  height: 360,
  durationSec: 60,
}

let latest: PlayerControlsApi | undefined

/** jsdom has no media pipeline: `play` flips `paused` and fires `play`, like a browser. */
function installMediaStubs(): void {
  const paused = new WeakMap<HTMLMediaElement, boolean>()
  Object.defineProperty(HTMLMediaElement.prototype, 'paused', {
    configurable: true,
    get(this: HTMLMediaElement) {
      return paused.get(this) ?? true
    },
  })
  HTMLMediaElement.prototype.play = function play(this: HTMLMediaElement) {
    paused.set(this, false)
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  }
  HTMLMediaElement.prototype.pause = function pause(this: HTMLMediaElement) {
    const wasPlaying = paused.get(this) === false
    paused.set(this, true)
    if (wasPlaying) this.dispatchEvent(new Event('pause'))
  }
  HTMLMediaElement.prototype.load = vi.fn()
}

function renderHost() {
  return render(
    <VideoPlayer
      media={MEDIA}
      renderControls={api => {
        latest = api
        return <input type="range" aria-label="Seek" data-testid="host-row" />
      }}
    />,
  )
}

interface FakeTrack { kind: string; mode: TextTrackMode }

function fakeTracks(video: HTMLVideoElement, tracks: FakeTrack[]): EventTarget {
  const list = Object.assign(new EventTarget(), tracks, { length: tracks.length })
  Object.defineProperty(video, 'textTracks', { configurable: true, value: list })
  return list
}

beforeEach(() => {
  latest = undefined
  installMediaStubs()
})

describe('VideoPlayer renderControls', () => {
  it('replaces the native controls and the default overlay buttons', () => {
    renderHost()
    const video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    expect(video).not.toHaveAttribute('controls')
    expect(video).not.toHaveAttribute('autoplay')
    expect(screen.queryByTestId('video-play-toggle')).toBeNull()
    expect(screen.queryByTestId('video-mute-toggle')).toBeNull()
    expect(screen.getByTestId('video-player')).toContainElement(screen.getByTestId('host-row'))
  })

  it('passes className and describedBy to the wrapper', () => {
    render(
      <>
        <p id="cap">The caption</p>
        <VideoPlayer
          media={MEDIA}
          className="host-frame"
          describedBy="cap"
          renderControls={() => null}
        />
      </>,
    )
    const wrapper = screen.getByTestId('video-player')
    expect(wrapper.className).toMatch(/host-frame/)
    expect(wrapper).toHaveAccessibleDescription('The caption')
  })

  it('only a host-controls player subscribes to the text tracks (Social pays nothing)', () => {
    const subscribe = vi.fn()
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'textTracks')
    Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', {
      configurable: true,
      get() {
        return { length: 0, addEventListener: subscribe, removeEventListener: vi.fn() }
      },
    })
    try {
      const social = render(<VideoPlayer media={MEDIA} />)
      expect(subscribe).not.toHaveBeenCalled()
      social.unmount()
      renderHost()
      expect(subscribe).toHaveBeenCalledWith('addtrack', expect.any(Function))
    } finally {
      if (original) Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', original)
      else Reflect.deleteProperty(HTMLMediaElement.prototype, 'textTracks')
    }
  })

  it('without it, the native controls stay (Social unchanged)', () => {
    render(<VideoPlayer media={MEDIA} />)
    const video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    expect(video).toHaveAttribute('controls')
    expect(screen.getByTestId('video-play-toggle')).toBeInTheDocument()
  })

  it('hands the host live state: play, time, seek, duration', () => {
    renderHost()
    expect(latest?.duration).toBe(60)
    act(() => latest?.togglePlay())
    expect(latest?.playing).toBe(true)
    act(() => latest?.seekTo(75))
    const video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    // jsdom's duration is NaN: the clamp is to [0, +inf).
    expect(video.currentTime).toBe(75)
    video.currentTime = 20
    fireEvent.timeUpdate(video)
    expect(latest?.currentTime).toBe(20)
  })

  it('a click on the picture play-pauses (no native controls to do it)', () => {
    renderHost()
    const video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    fireEvent.click(video)
    expect(latest?.playing).toBe(true)
  })

  it('arrow keys on the host scrub are not also handled by the wrapper (no double seek)', () => {
    renderHost()
    const video = screen.getByTestId('video-player').querySelector('video') as HTMLVideoElement
    video.currentTime = 10
    fireEvent.keyDown(screen.getByTestId('host-row'), { key: 'ArrowRight' })
    expect(video.currentTime).toBe(10)
  })

  it('captions: available only with a captions / subtitles track, and toggles it', () => {
    const { unmount } = renderHost()
    expect(latest?.captionsAvailable).toBe(false)
    unmount()

    const tracks: FakeTrack[] = [{ kind: 'metadata', mode: 'hidden' }, { kind: 'captions', mode: 'disabled' }]
    const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'textTracks')
    Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', {
      configurable: true,
      get(this: HTMLVideoElement) {
        return (this as unknown as { _tracks?: EventTarget })._tracks
          ?? ((this as unknown as { _tracks?: EventTarget })._tracks = fakeTracks(this, tracks))
      },
    })
    try {
      renderHost()
      expect(latest?.captionsAvailable).toBe(true)
      expect(latest?.captionsOn).toBe(false)
      act(() => latest?.toggleCaptions())
      expect(tracks[1]?.mode).toBe('showing')
      expect(tracks[0]?.mode).toBe('hidden')
      expect(latest?.captionsOn).toBe(true)
      act(() => latest?.toggleCaptions())
      expect(tracks[1]?.mode).toBe('hidden')
    } finally {
      if (original) Object.defineProperty(HTMLMediaElement.prototype, 'textTracks', original)
      else Reflect.deleteProperty(HTMLMediaElement.prototype, 'textTracks')
    }
  })
})
