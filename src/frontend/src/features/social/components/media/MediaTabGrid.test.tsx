/**
 * features/social/components/media/MediaTabGrid.test.tsx
 * ---------------------------------------------------------------------------
 * The F0 STUB renders nothing (F2 fills the grid in; F5 mounts it in the profile
 * Media tab). Pins that it is a safe, empty mount with the agreed prop contract.
 */
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MediaTabGrid } from './MediaTabGrid'

describe('MediaTabGrid (stub)', () => {
  it('renders nothing, with or without posts', () => {
    expect(render(<MediaTabGrid posts={[]} />).container).toBeEmptyDOMElement()
    expect(render(<MediaTabGrid posts={[]} onOpenPost={vi.fn()} />).container).toBeEmptyDOMElement()
  })
})
