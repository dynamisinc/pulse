/**
 * features/staffShell/previewFrameMetrics.test.ts
 * ---------------------------------------------------------------------------
 * demo-polish C6 -- the preview mat's two frame widths are COPIES of the Social
 * channel's own breakpoints (the staff half imports nothing from the participant
 * world, so it cannot share the constants; see `previewFrameMetrics.ts`). This is
 * the drift check: change a breakpoint in `social/layout/frameMetrics` and this
 * fails until the copy follows.
 */
import { describe, expect, it } from 'vitest'
import { FRAME_MIN_WIDTH, NAV_EXPANDED_MIN_WIDTH } from '@/features/social/layout/frameMetrics'
import { PREVIEW_FRAME_FULL_WIDTH_PX, PREVIEW_FRAME_NAV_WIDTH_PX } from './previewFrameMetrics'

describe('previewFrameMetrics -- the mat gives the frame the width its breakpoint assumes', () => {
  it('the full three-column width is the channel\'s FRAME_MIN_WIDTH', () => {
    expect(PREVIEW_FRAME_FULL_WIDTH_PX).toBe(FRAME_MIN_WIDTH)
  })

  it('the two-column width is the channel\'s NAV_EXPANDED_MIN_WIDTH', () => {
    expect(PREVIEW_FRAME_NAV_WIDTH_PX).toBe(NAV_EXPANDED_MIN_WIDTH)
  })
})
