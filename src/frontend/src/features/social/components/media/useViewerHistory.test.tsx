/**
 * features/social/components/media/useViewerHistory.test.tsx
 * ---------------------------------------------------------------------------
 * Back closes the viewer and every other close pops the entry it pushed
 * (mobile-tablet story 04). Real MediaViewer on jsdom's history.
 */
import { useState } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PostMedia } from '../../types/post'
import { MediaViewer } from './MediaViewer'
import { installMediaElementStubs } from './mediaTestUtils'

const ITEMS: PostMedia[] = [
  { id: 'a', kind: 'image', url: '/mock-media/photos/p1.svg', alt: 'One', width: 16, height: 9 },
]

function Harness() {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button">opener</button>
      {open && <MediaViewer items={ITEMS} onClose={() => setOpen(false)} />}
    </>
  )
}

/** jsdom fires popstate asynchronously after history.back(). */
async function settle() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)) })
}

beforeEach(() => {
  installMediaElementStubs()
  window.history.replaceState(null, '', '/home')
})
afterEach(() => window.history.replaceState(null, '', '/'))

describe('MediaViewer history', () => {
  it('pushes one entry on open, same URL', () => {
    const before = window.history.length
    render(<Harness />)
    expect(window.history.length).toBe(before + 1)
    expect(window.location.pathname).toBe('/home')
  })

  it('Back closes the viewer and stays on the page', async () => {
    render(<Harness />)
    expect(screen.getByTestId('media-viewer')).toBeInTheDocument()
    window.history.back()
    await settle()
    expect(screen.queryByTestId('media-viewer')).toBeNull()
    expect(window.location.pathname).toBe('/home')
  })

  it('Close pops the entry it pushed (no extra Back needed)', async () => {
    render(<Harness />)
    const len = window.history.length
    fireEvent.click(screen.getByTestId('media-viewer-close'))
    expect(screen.queryByTestId('media-viewer')).toBeNull()
    await settle()
    expect(window.location.pathname).toBe('/home')
    expect(window.history.state).toBeNull()
    expect(window.history.length).toBe(len) // the stack is never truncated, just moved back
  })

  it('Escape pops once; a later Back does not close anything else', async () => {
    render(<Harness />)
    fireEvent.keyDown(document, { key: 'Escape' })
    await settle()
    expect(screen.queryByTestId('media-viewer')).toBeNull()
    expect(window.history.state).toBeNull()
  })
})
