/**
 * features/controller/components/steering/PausePill.align.test.tsx
 * ---------------------------------------------------------------------------
 * #626: the pause-tier popover stays inside the work area. It opens left-aligned under the pill;
 * when that 300px paper would cross into the 56px right-edge toolstrip (the pill sits at the
 * right end of the tablet command band at 1180px), it right-aligns to the pill instead. jsdom has
 * no layout, so the pill's rect and the window width are stubbed and the chosen alignment is read
 * from the popover's `data-align`.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { usePauseState, type PauseState } from '../../hooks/usePauseState'
import { PausePill } from './PausePill'

vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))
vi.mock('../../hooks/usePauseState', async () => ({
  ...(await vi.importActual<typeof import('../../hooks/usePauseState')>('../../hooks/usePauseState')),
  usePauseState: vi.fn(),
}))

const mockedUsePauseState = vi.mocked(usePauseState)

function stub(): PauseState {
  return {
    tier: 'running',
    label: 'RUNNING',
    isPaused: false,
    isFrozen: false,
    overlayRegister: 'out-of-fiction',
    setTier: vi.fn(),
    resume: vi.fn(),
    setOverlayRegister: vi.fn(),
    refusal: null,
    dismissRefusal: vi.fn(),
  }
}

/** Opens the popover with the pill's left edge at `pillLeft` in a `viewportWidth`-wide window. */
function openWithPillAt(pillLeft: number, viewportWidth: number) {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(viewportWidth)
  mockedUsePauseState.mockReturnValue(stub())
  render(<ThemeProvider theme={cobraTheme}><PausePill /></ThemeProvider>)
  const pill = screen.getByTestId('pause-pill')
  vi.spyOn(pill, 'getBoundingClientRect').mockReturnValue({
    left: pillLeft, right: pillLeft + 105, top: 65, bottom: 109, width: 105, height: 44,
    x: pillLeft, y: 65, toJSON: () => ({}),
  })
  fireEvent.click(pill)
  return screen.getByTestId('pause-popover')
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PausePill popover alignment (#626)', () => {
  it('right-aligns to the pill when a left-aligned popover would cross into the toolstrip', () => {
    // 1180 x 820 tablet: the pill ends where the toolstrip begins (1124).
    expect(openWithPillAt(1019, 1180)).toHaveAttribute('data-align', 'right')
  })

  it('stays left-aligned when there is room (1024 tablet and desktop)', () => {
    expect(openWithPillAt(12, 1024)).toHaveAttribute('data-align', 'left')
  })

  it('stays left-aligned at exactly the boundary', () => {
    // left + 300 === innerWidth - 56 - 8  ->  not crossing.
    expect(openWithPillAt(1440 - 56 - 8 - 300, 1440)).toHaveAttribute('data-align', 'left')
  })
})
