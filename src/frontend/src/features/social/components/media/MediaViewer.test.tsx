/**
 * features/social/components/media/MediaViewer.test.tsx
 * ---------------------------------------------------------------------------
 * The lightbox (demo-polish F2; NFR-001): a modal dialog that traps focus, closes
 * on Esc / Close / the dimmed backdrop, pages across the post's images with ←/→
 * and its buttons (no wrap; ends are `aria-disabled`, never `disabled`, so focus
 * is not dropped out of the trap), announces each image's alt text, and RETURNS
 * focus to the thumbnail that opened it. Also the safe-URL fallback, the scroll
 * lock, and the video-in-viewer (modal fallback) path.
 */
import { useState } from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverlayFocusTrap } from '@/features/participant-shell/components/OverlayLayer/useOverlayFocusTrap'
import type { ChromeConfig } from '@/features/participant-shell/mountContract'
import type { PostMedia } from '../../types/post'
import { MediaViewer } from './MediaViewer'
import { installMediaElementStubs } from './mediaTestUtils'
import { resetPlaybackForTests } from './playbackCoordinator'

vi.mock('@/features/participant-shell/chromeConfig', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/participant-shell/chromeConfig')>()
  const banner = { text: 'BANNER', fg: '#fff', bg: '#000' }
  return {
    ...actual,
    useChromeConfig: (): ChromeConfig => ({ enabled: false, top: banner, bottom: banner }),
  }
})

vi.mock('@/features/participant-shell/components/OverlayLayer/overlayState', () => ({
  useOverlayState: () => ({ state: 'none', register: 'in-fiction', message: '' }),
}))

function image(n: number, overrides: Partial<PostMedia> = {}): PostMedia {
  return {
    id: `m${n}`,
    kind: 'image',
    url: `/mock-media/photos/p${n}.svg`,
    alt: `Photo ${n} of the flooded street`,
    width: 1600,
    height: 900,
    ...overrides,
  }
}

const THREE = [image(1), image(2), image(3)]

beforeEach(() => {
  installMediaElementStubs()
  resetPlaybackForTests()
  document.body.style.overflow = ''
})

/** A thumbnail button that opens the viewer, like the post's grid does. */
interface HarnessProps {
  readonly items?: readonly PostMedia[]
  readonly startIndex?: number
}

function Harness({ items = THREE, startIndex = 0 }: HarnessProps) {
  const [trigger, setTrigger] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button
        type="button"
        onClick={event => {
          setTrigger(event.currentTarget)
          setOpen(true)
        }}
      >
        Thumbnail
      </button>
      <button type="button">Elsewhere</button>
      {open && (
        <MediaViewer
          items={items}
          startIndex={startIndex}
          returnFocusTo={trigger}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

async function openViewer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Thumbnail' }))
  return screen.getByRole('dialog')
}

describe('MediaViewer — dialog semantics', () => {
  it('is a modal dialog with a name, portalled to <body>, showing the opened image with its alt', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness startIndex={1} />)
    const dialog = await openViewer(user)

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('Media viewer')
    expect(container).not.toContainElement(dialog)
    expect(document.body).toContainElement(dialog)
    const img = within(dialog).getByRole('img')
    expect(img).toHaveAttribute('alt', 'Photo 2 of the flooded street')
    expect(img).toHaveAttribute('src', '/mock-media/photos/p2.svg')
  })

  it('announces the item and its alt text to assistive tech (polite live region)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openViewer(user)

    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Image 1 of 3: Photo 1 of the flooded street')
  })

  it('clamps an out-of-range start index', async () => {
    const user = userEvent.setup()
    render(<Harness startIndex={99} />)
    const dialog = await openViewer(user)

    expect(within(dialog).getByRole('img')).toHaveAttribute('alt', 'Photo 3 of the flooded street')
  })

  it('renders nothing for an empty list', () => {
    const { baseElement } = render(<MediaViewer items={[]} onClose={vi.fn()} />)
    expect(within(baseElement).queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('locks page scroll while open and restores it on close', async () => {
    const user = userEvent.setup()
    document.body.style.overflow = 'auto'
    render(<Harness />)

    await openViewer(user)
    expect(document.body.style.overflow).toBe('hidden')

    await user.keyboard('{Escape}')
    expect(document.body.style.overflow).toBe('auto')
  })

  it('stops clicks inside it from reaching the page behind (React-tree ancestors)', async () => {
    const user = userEvent.setup()
    const onParentClick = vi.fn()
    render(
      <div onClick={onParentClick}>
        <MediaViewer items={THREE} onClose={vi.fn()} />
      </div>,
    )

    await user.click(screen.getByRole('img'))
    await user.click(screen.getByTestId('media-viewer-next'))

    expect(onParentClick).not.toHaveBeenCalled()
  })
})

describe('MediaViewer — focus trap and return', () => {
  it('moves focus into the dialog on open', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)

    expect(dialog).toHaveFocus()
  })

  it('cycles Tab and Shift+Tab inside the dialog (focus never reaches the page behind)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)
    const inside = within(dialog).getAllByRole('button')
    expect(inside.length).toBeGreaterThanOrEqual(3)

    // Walk forward past the end: stays in the dialog and wraps.
    for (let i = 0; i < inside.length + 2; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    // Shift+Tab backwards also stays inside.
    for (let i = 0; i < inside.length + 2; i += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    expect(screen.getByRole('button', { name: 'Elsewhere', hidden: true })).not.toHaveFocus()
  })

  it('pulls focus back if it lands outside while open', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)

    screen.getByRole('button', { name: 'Elsewhere', hidden: true }).focus()

    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('returns focus to the thumbnail on Esc', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const thumbnail = screen.getByRole('button', { name: 'Thumbnail' })
    await openViewer(user)

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(thumbnail).toHaveFocus()
  })

  it('returns focus to the thumbnail on Close', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const thumbnail = screen.getByRole('button', { name: 'Thumbnail' })
    await openViewer(user)

    await user.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(thumbnail).toHaveFocus()
  })

  it('returns focus to the explicit trigger even when the browser did not focus it on click (Safari)', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    const { unmount } = render(
      <MediaViewer items={THREE} onClose={vi.fn()} returnFocusTo={trigger} />,
    )
    expect(document.activeElement).not.toBe(trigger)

    unmount()

    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('closes on a click on the dimmed backdrop but not on the image itself', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<MediaViewer items={THREE} onClose={onClose} />)

    await user.click(screen.getByRole('img'))
    expect(onClose).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('media-viewer'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('MediaViewer — paging', () => {
  it('moves across the images with ← and → and announces each alt', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)
    const shown = () => within(dialog).getByRole('img').getAttribute('alt')

    await user.keyboard('{ArrowRight}')
    expect(shown()).toBe('Photo 2 of the flooded street')
    expect(screen.getByRole('status')).toHaveTextContent('Image 2 of 3: Photo 2 of the flooded street')

    await user.keyboard('{ArrowRight}')
    expect(shown()).toBe('Photo 3 of the flooded street')

    await user.keyboard('{ArrowLeft}')
    expect(shown()).toBe('Photo 2 of the flooded street')
  })

  it('does not wrap at either end', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)
    const shown = () => within(dialog).getByRole('img').getAttribute('alt')

    await user.keyboard('{ArrowLeft}')
    expect(shown()).toBe('Photo 1 of the flooded street')

    await user.keyboard('{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}')
    expect(shown()).toBe('Photo 3 of the flooded street')
  })

  it('pages with the Previous / Next buttons and shows the position', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)
    const next = within(dialog).getByRole('button', { name: 'Next image' })
    const previous = within(dialog).getByRole('button', { name: 'Previous image' })

    expect(dialog).toHaveTextContent('1 / 3')
    await user.click(next)
    expect(dialog).toHaveTextContent('2 / 3')
    await user.click(previous)
    expect(dialog).toHaveTextContent('1 / 3')
  })

  it('marks the ends aria-disabled (not disabled) so focus stays inside the trap', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)
    const previous = within(dialog).getByRole('button', { name: 'Previous image' })
    const next = within(dialog).getByRole('button', { name: 'Next image' })

    expect(previous).toHaveAttribute('aria-disabled', 'true')
    expect(previous).not.toBeDisabled()
    expect(next).toHaveAttribute('aria-disabled', 'false')

    next.focus()
    await user.click(next)
    await user.click(next)
    expect(next).toHaveAttribute('aria-disabled', 'true')
    expect(next).toHaveFocus()
    // Activating a disabled end does nothing.
    await user.click(next)
    expect(dialog).toHaveTextContent('3 / 3')
  })

  it('has no pager for a single item', async () => {
    const user = userEvent.setup()
    render(<Harness items={[image(1)]} />)
    const dialog = await openViewer(user)

    expect(within(dialog).queryByRole('button', { name: 'Next image' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Previous image' })).not.toBeInTheDocument()
    await user.keyboard('{ArrowRight}')
    expect(within(dialog).getByRole('img')).toHaveAttribute('alt', 'Photo 1 of the flooded street')
  })
})

describe('MediaViewer — announces the alt on open (L-1)', () => {
  it('describes the dialog by the status line, so the alt text is read when the viewer opens', async () => {
    const user = userEvent.setup()
    render(<Harness startIndex={1} />)
    const dialog = await openViewer(user)

    expect(dialog).toHaveAccessibleDescription('Image 2 of 3: Photo 2 of the flooded street')
    expect(dialog).toHaveAccessibleName('Media viewer')

    await user.keyboard('{ArrowRight}')
    expect(dialog).toHaveAccessibleDescription('Image 3 of 3: Photo 3 of the flooded street')
  })
})

describe('MediaViewer — safe URLs and errors', () => {
  it.each(['javascript:alert(1)', 'data:image/png;base64,AAAA', '//evil.example.net/a.png'])(
    'shows the alt-text placeholder, never a src, for %j',
    async url => {
      const user = userEvent.setup()
      render(<Harness items={[image(1, { url })]} />)
      const dialog = await openViewer(user)

      expect(dialog.querySelector('[src]')).toBeNull()
      expect(within(dialog).getByTestId('media-fallback')).toHaveTextContent('Photo 1 of the flooded street')
    },
  )

  it('retries an image whose URL is re-minted (a failed src does not stick to the item)', () => {
    const { rerender } = render(<MediaViewer items={[image(1, { url: '/mock-media/old.svg' })]} onClose={vi.fn()} />)
    fireEvent.error(screen.getByRole('img'))
    expect(screen.getByTestId('media-fallback')).toBeInTheDocument()

    rerender(<MediaViewer items={[image(1, { url: '/mock-media/old.svg' })]} onClose={vi.fn()} />)
    expect(screen.getByTestId('media-fallback')).toBeInTheDocument()

    rerender(<MediaViewer items={[image(1, { url: '/mock-media/new.svg' })]} onClose={vi.fn()} />)
    expect(screen.queryByTestId('media-fallback')).not.toBeInTheDocument()
    expect(screen.getByRole('img')).toHaveAttribute('src', '/mock-media/new.svg')
  })

  it('swaps a failed image for the alt-text placeholder', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const dialog = await openViewer(user)

    fireEvent.error(within(dialog).getByRole('img'))

    expect(within(dialog).getByTestId('media-fallback')).toHaveTextContent('Photo 1 of the flooded street')
  })
})

describe('MediaViewer — a video (the fullscreen modal fallback)', () => {
  const clip: PostMedia = {
    id: 'v1',
    kind: 'video',
    url: '/mock-media/video/water-update.mp4',
    alt: 'A crew explains the advisory',
    durationSec: 4,
  }

  it('renders the expanded player (watermark slot included) and lets its own keys through', async () => {
    const user = userEvent.setup()
    render(<Harness items={[clip, image(2)]} />)
    const dialog = await openViewer(user)

    const player = within(dialog).getByRole('group', { name: 'A crew explains the advisory' })
    expect(within(player).getByTestId('media-watermark-slot')).toHaveTextContent('EXERCISE')
    expect(within(player).queryByRole('button', { name: 'Expand' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('status')).toHaveTextContent(
      'Video 1 of 2: A crew explains the advisory',
    )

    // ← / → on the focused player SEEK (and stop); they must not page the viewer.
    player.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(dialog).getByRole('group', { name: 'A crew explains the advisory' })).toBeInTheDocument()
  })
})

/**
 * Gate-1 H-1. The shell's Pause / EndEx / break-fiction overlay mounts as a sibling
 * of the channel, traps focus with its own `useOverlayFocusTrap`, and paints ABOVE
 * the viewer. The two traps used to fight (each pulled focus back to itself) until
 * the stack overflowed, leaving focus under the overlay. Now they yield to each other.
 */
function OverlayHarness({ overlayActive }: { overlayActive: boolean }) {
  const containerRef = useOverlayFocusTrap<HTMLDivElement>(overlayActive)
  if (!overlayActive) return null
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label="Exercise paused"
      tabIndex={-1}
      data-testid="shell-overlay"
    >
      <button type="button">Refresh</button>
      <button type="button">Help</button>
    </div>
  )
}

function ViewerUnderOverlay() {
  const [overlayActive, setOverlayActive] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOverlayActive(true)}>Pause the exercise</button>
      <MediaViewer items={THREE} onClose={vi.fn()} />
      <OverlayHarness overlayActive={overlayActive} />
    </>
  )
}

describe('MediaViewer — yields to the shell overlay (H-1)', () => {
  it('the overlay keeps focus when it mounts over an open viewer; Tab cycles inside the overlay and never throws', async () => {
    const user = userEvent.setup()
    render(<ViewerUnderOverlay />)
    const viewer = screen.getByTestId('media-viewer')
    expect(viewer).toHaveFocus()

    // The shell overlay becomes active while the viewer is open.
    act(() => {
      screen.getByRole('button', { name: 'Pause the exercise' }).click()
    })
    const overlay = screen.getByTestId('shell-overlay')
    expect(overlay).toHaveFocus()

    // Tab: previously `RangeError: Maximum call stack size exceeded` and focus under the overlay.
    for (let i = 0; i < 5; i += 1) {
      await user.tab()
      expect(overlay).toContainElement(document.activeElement as HTMLElement)
      expect(viewer).not.toContainElement(document.activeElement as HTMLElement)
    }
    for (let i = 0; i < 5; i += 1) {
      await user.tab({ shift: true })
      expect(overlay).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('settles (no focus ping-pong) even if something programmatically focuses the viewer under an active overlay', async () => {
    const user = userEvent.setup()
    render(<ViewerUnderOverlay />)
    act(() => {
      screen.getByRole('button', { name: 'Pause the exercise' }).click()
    })
    const close = within(screen.getByTestId('media-viewer')).getByRole('button', { name: 'Close' })

    // Each trap yields to the other's modal, so a stray focus move into the viewer fires a
    // handful of `focusin`s at most — the old pull-back loop fired thousands and overflowed.
    let focusIns = 0
    const count = () => {
      focusIns += 1
    }
    document.addEventListener('focusin', count)
    try {
      close.focus()
      await user.tab()
      await user.tab({ shift: true })
    } finally {
      document.removeEventListener('focusin', count)
    }

    expect(focusIns).toBeLessThan(12)
  })

  it('a viewer that opens while the overlay already holds focus does not steal it', () => {
    function OverlayThenViewer() {
      const [viewerOpen, setViewerOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setViewerOpen(true)}>Open viewer</button>
          <OverlayHarness overlayActive={true} />
          {viewerOpen && <MediaViewer items={THREE} onClose={vi.fn()} />}
        </>
      )
    }
    render(<OverlayThenViewer />)
    const overlay = screen.getByTestId('shell-overlay')
    expect(overlay).toHaveFocus()

    act(() => {
      screen.getByRole('button', { name: 'Open viewer', hidden: true }).click()
    })

    expect(screen.getByTestId('media-viewer')).toBeInTheDocument()
    expect(overlay).toHaveFocus()
  })
})

describe('MediaViewer — resuming a handed-over video (L-8)', () => {
  it('opens the expanded player at startAt, paused', async () => {
    const user = userEvent.setup()
    function ResumeHarness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Thumbnail</button>
          {open && (
            <MediaViewer
              items={[{ id: 'v1', kind: 'video', url: '/mock-media/video/a.mp4', alt: 'Clip', durationSec: 9 }]}
              startAt={4.5}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }
    render(<ResumeHarness />)
    await openViewer(user)

    const video = screen.getByRole('group', { name: 'Clip' }).querySelector('video')
    expect(video?.getAttribute('src')).toBe('/mock-media/video/a.mp4#t=4.5')
    expect(video?.paused).toBe(true)
  })
})
