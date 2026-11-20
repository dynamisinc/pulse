/**
 * News story 05: the broadcast control row in isolation (presentational over the
 * shared player's `PlayerControlsApi`), its tint contrast and its touch targets.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PlayerControlsApi } from '@/core/media/player'
import { contrastRatio, getSkinTokens, onColor } from '@/features/channels'
import { readSrcFile } from '@/test/readSource'
import { PLAYER_CONTROLS_LABEL, PlayerControls } from './PlayerControls'

function api(overrides: Partial<PlayerControlsApi> = {}): PlayerControlsApi {
  return {
    playing: false,
    muted: false,
    currentTime: 12,
    duration: 90,
    fullscreen: false,
    captionsAvailable: false,
    captionsOn: false,
    togglePlay: vi.fn(),
    toggleMute: vi.fn(),
    seekTo: vi.fn(),
    toggleFullscreen: vi.fn(),
    toggleCaptions: vi.fn(),
    ...overrides,
  }
}

const css = readSrcFile('features/news/hero/PlayerControls.module.css').replace(/\/\*[\s\S]*?\*\//g, '')

describe('PlayerControls', () => {
  it('is a labelled group with elapsed / total', () => {
    render(<PlayerControls api={api()} />)
    const group = screen.getByRole('group', { name: PLAYER_CONTROLS_LABEL })
    expect(group).toHaveTextContent('0:12')
    expect(group).toHaveTextContent('1:30')
    expect(screen.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', '0:12 of 1:30')
  })

  it('every control calls the player and states its state (not colour-only)', async () => {
    const user = userEvent.setup()
    const controls = api({ playing: true, muted: true, fullscreen: true, captionsAvailable: true })
    render(<PlayerControls api={controls} />)
    await user.click(screen.getByRole('button', { name: 'Pause' }))
    await user.click(screen.getByRole('button', { name: 'Mute' }))
    await user.click(screen.getByRole('button', { name: 'Captions' }))
    await user.click(screen.getByRole('button', { name: 'Exit full screen' }))
    expect(controls.togglePlay).toHaveBeenCalledTimes(1)
    expect(controls.toggleMute).toHaveBeenCalledTimes(1)
    expect(controls.toggleCaptions).toHaveBeenCalledTimes(1)
    expect(controls.toggleFullscreen).toHaveBeenCalledTimes(1)
    // Play / Pause carries its state in the name, not aria-pressed.
    expect(screen.getByRole('button', { name: 'Pause' })).not.toHaveAttribute('aria-pressed')
    expect(screen.getByRole('button', { name: 'Mute' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Captions' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('the captions toggle shows only when the media has a captions track', () => {
    const { rerender } = render(<PlayerControls api={api()} />)
    expect(screen.queryByRole('button', { name: 'Captions' })).toBeNull()
    rerender(<PlayerControls api={api({ captionsAvailable: true, captionsOn: true })} />)
    expect(screen.getByRole('button', { name: 'Captions' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('while dragged, the thumb shows the drag position, not the lagging video time', () => {
    const controls = api({ currentTime: 12 })
    const { rerender } = render(<PlayerControls api={controls} />)
    const scrub = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.pointerDown(scrub)
    fireEvent.change(scrub, { target: { value: '60' } })
    // A timeupdate from the playing video arrives mid-drag.
    rerender(<PlayerControls api={{ ...controls, currentTime: 13 }} />)
    expect(scrub).toHaveValue('60')
    fireEvent.pointerUp(scrub)
    rerender(<PlayerControls api={{ ...controls, currentTime: 60.2 }} />)
    expect(scrub).toHaveValue('60.2')
  })

  it.each([
    ['a release outside the slider (lost pointer capture)', 'lostPointerCapture'],
    ['blur', 'blur'],
  ] as const)('%s ends the drag, so the thumb follows the video again', (_label, end) => {
    const controls = api({ currentTime: 12 })
    const { rerender } = render(<PlayerControls api={controls} />)
    const scrub = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.pointerDown(scrub)
    fireEvent.change(scrub, { target: { value: '60' } })
    fireEvent[end](scrub)
    rerender(<PlayerControls api={{ ...controls, currentTime: 61 }} />)
    expect(scrub).toHaveValue('61')
  })

  it('a slider key ends the drag; a modifier does not', () => {
    const controls = api({ currentTime: 12 })
    const { rerender } = render(<PlayerControls api={controls} />)
    const scrub = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.pointerDown(scrub)
    fireEvent.change(scrub, { target: { value: '60' } })
    fireEvent.keyDown(scrub, { key: 'Shift' })
    rerender(<PlayerControls api={{ ...controls, currentTime: 13 }} />)
    expect(scrub).toHaveValue('60')
    fireEvent.keyDown(scrub, { key: 'ArrowRight' })
    rerender(<PlayerControls api={{ ...controls, currentTime: 14 }} />)
    expect(scrub).toHaveValue('14')
  })

  it('a primary press captures the pointer; a non-primary one does not', () => {
    render(<PlayerControls api={api()} />)
    const scrub = screen.getByRole('slider', { name: 'Seek' })
    const capture = vi.fn()
    scrub.setPointerCapture = capture
    fireEvent.pointerDown(scrub, { button: 2, pointerId: 7 })
    expect(capture).not.toHaveBeenCalled()
    fireEvent.pointerDown(scrub, { button: 0, pointerId: 7 })
    expect(capture).toHaveBeenCalledWith(7)
  })

  it('a non-primary button never starts a drag', () => {
    const controls = api({ currentTime: 12 })
    const { rerender } = render(<PlayerControls api={controls} />)
    const scrub = screen.getByRole('slider', { name: 'Seek' })
    fireEvent.pointerDown(scrub, { button: 2 })
    rerender(<PlayerControls api={{ ...controls, currentTime: 13 }} />)
    expect(scrub).toHaveValue('13')
  })

  it('the scrub seeks; it is disabled until the duration is known', () => {
    const controls = api()
    const { rerender } = render(<PlayerControls api={controls} />)
    fireEvent.change(screen.getByRole('slider', { name: 'Seek' }), { target: { value: '45' } })
    expect(controls.seekTo).toHaveBeenCalledWith(45)
    rerender(<PlayerControls api={api({ duration: undefined })} />)
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeDisabled()
    expect(screen.getByTestId('broadcast-time')).toHaveTextContent('--:--')
  })
})

describe('PlayerControls: tint and targets (NFR-001)', () => {
  it('reads only the player tint and its F13 ink, on an opaque row', () => {
    const row = /\.row\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(row).toMatch(/background-color:\s*var\(--pulse-skin-player-tint/)
    expect(row).toMatch(/color:\s*var\(--pulse-skin-on-player-tint/)
    // No other palette token reaches the player chrome.
    expect(css).not.toMatch(/--pulse-skin-(accent|link|bg|surface|breaking)\b/)
  })

  it.each(['#ffffff', '#000000', '#777777', '#ffcc00', '#0b57d0', '#c8102e'])(
    'tint %s: the ink is >= 3:1 on the opaque row (whatever the poster)',
    tint => {
      expect(contrastRatio(onColor(tint), tint)).toBeGreaterThanOrEqual(3)
    },
  )

  it('the neutral skin has a player tint', () => {
    const tint = getSkinTokens('neutral')?.media.playerTint
    expect(tint).toMatch(/^#/)
  })

  it('controls are 44px on a coarse pointer', () => {
    const coarse = /@media \(pointer: coarse\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(coarse).toMatch(/\.button,\s*\.scrub\s*\{\s*height:\s*44px/)
    expect(coarse).toMatch(/\.button\s*\{\s*width:\s*44px/)
  })
})
