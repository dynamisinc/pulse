/**
 * features/staffShell/StaffShellFrame.landmark.test.tsx
 * ---------------------------------------------------------------------------
 * demo-polish C6, Gate-2 W-3 -- the staff work area is the page's `main` landmark, EXCEPT while
 * "Preview as participant" is staged: the preview hosts the real Social channel, which brings its
 * own `main`, and a page has ONE (WCAG 1.3.1 / 2.4.1: a screen-reader user jumps to "the" main).
 * The frame learns of the preview through the NON-THROWING `useOptionalPreview()`, so a surface
 * with no `PreviewProvider` (the planner workspace) is unaffected.
 */
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PreviewProvider, usePreview, type PreviewContextValue } from './previewContext'
import { StaffShellFrame } from './StaffShellFrame'

/** Hands the test the live preview controls. */
function Controls({ onReady }: { onReady: (preview: PreviewContextValue) => void }) {
  onReady(usePreview())
  return null
}

describe('StaffShellFrame -- the work-area landmark', () => {
  it('is the page\'s main when there is no PreviewProvider at all (the planner workspace)', () => {
    render(<StaffShellFrame><p>work</p></StaffShellFrame>)

    expect(screen.getByRole('main')).toBe(screen.getByTestId('staff-shell-work-area'))
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('is the page\'s main under a PreviewProvider while the preview is NOT staged', () => {
    render(
      <PreviewProvider>
        <StaffShellFrame><p>work</p></StaffShellFrame>
      </PreviewProvider>,
    )

    expect(screen.getByRole('main')).toBe(screen.getByTestId('staff-shell-work-area'))
  })

  it('stops being a main while the preview is staged, and is one again after Exit', () => {
    let preview: PreviewContextValue | undefined
    render(
      <PreviewProvider>
        <Controls onReady={value => { preview = value }} />
        <StaffShellFrame><p>work</p></StaffShellFrame>
      </PreviewProvider>,
    )

    act(() => preview?.toggle())
    expect(screen.queryByRole('main')).not.toBeInTheDocument()
    const staged = screen.getByTestId('staff-shell-work-area')
    expect(staged.tagName).toBe('DIV')
    expect(staged).toHaveTextContent('work')

    act(() => preview?.toggle())
    expect(screen.getByRole('main')).toBe(screen.getByTestId('staff-shell-work-area'))
  })
})
