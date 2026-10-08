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
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
