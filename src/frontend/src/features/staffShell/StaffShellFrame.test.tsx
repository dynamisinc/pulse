/**
 * features/staffShell/StaffShellFrame.test.tsx
 * ---------------------------------------------------------------------------
 * Story 05 (Cadence chrome tokens + thumbnail-distinguishability gate) — RTL
 * coverage for `StaffShellFrame`: the frame renders Cadence-navy header chrome
 * and a light COBRA work area sourced from `staffShellTokens` (not a second,
 * hardcoded copy of those literals in this file — precedent 17, no
 * tautological tests), renders the `header`/`toolstrip`/`children` slots when
 * provided, still renders a usable, correctly-sized layout when the optional
 * slots are omitted, and actually threads the COBRA theme down to descendants
 * (not merely present in the JSX tree).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Button from '@mui/material/Button'
import { StaffShellFrame } from './StaffShellFrame'
import { STAFF_HEADER_HEIGHT_PX, STAFF_TOOLSTRIP_WIDTH_PX, staffShellTokens } from './staffShellTokens'

describe('StaffShellFrame — Cadence chrome from tokens (AC1)', () => {
  it('renders the navy header row at the token background/border/height', () => {
    render(<StaffShellFrame>work area content</StaffShellFrame>)

    const header = screen.getByTestId('staff-shell-header')
    expect(header).toHaveStyle({
      backgroundColor: staffShellTokens.header.background,
      height: `${STAFF_HEADER_HEIGHT_PX}px`,
      borderBottom: `1px solid ${staffShellTokens.header.borderColor}`,
    })
  })

  it('renders the work area at the token (COBRA-sourced) light background', () => {
    render(<StaffShellFrame>work area content</StaffShellFrame>)

    const workArea = screen.getByTestId('staff-shell-work-area')
    expect(workArea).toHaveStyle({ backgroundColor: staffShellTokens.workArea.background })
  })

  it('renders the toolstrip dock at the token (COBRA-sourced) panel width/background', () => {
    render(<StaffShellFrame>work area content</StaffShellFrame>)

    const toolstrip = screen.getByTestId('staff-shell-toolstrip')
    expect(toolstrip).toHaveStyle({
      width: `${STAFF_TOOLSTRIP_WIDTH_PX}px`,
      backgroundColor: staffShellTokens.toolstrip.background,
    })
  })

  it('header and work-area colors are distinct (the thumbnail-distinguishability gate depends on real contrast, not equal tokens)', () => {
    expect(staffShellTokens.header.background).not.toBe(staffShellTokens.workArea.background)
  })
})

describe('StaffShellFrame — slot props (header/toolstrip/children)', () => {
  it('renders provided header, toolstrip, and children content in their own regions', () => {
    render(
      <StaffShellFrame
        header={<div>HEADER SLOT CONTENT</div>}
        toolstrip={<div>TOOLSTRIP SLOT CONTENT</div>}
      >
        <div>WORK AREA CONTENT</div>
      </StaffShellFrame>,
    )

    expect(screen.getByTestId('staff-shell-header')).toHaveTextContent('HEADER SLOT CONTENT')
    expect(screen.getByTestId('staff-shell-toolstrip')).toHaveTextContent('TOOLSTRIP SLOT CONTENT')
    expect(screen.getByTestId('staff-shell-work-area')).toHaveTextContent('WORK AREA CONTENT')
  })

  it('renders a usable, correctly-sized layout when header/toolstrip slots are omitted', () => {
    render(<StaffShellFrame><div>WORK AREA ONLY</div></StaffShellFrame>)

    const header = screen.getByTestId('staff-shell-header')
    const toolstrip = screen.getByTestId('staff-shell-toolstrip')

    // Regions still occupy their contracted size and render, empty, so the
    // frame's geometry never depends on the slots being filled.
    expect(header).toBeInTheDocument()
    expect(header).toHaveStyle({ height: `${STAFF_HEADER_HEIGHT_PX}px` })
    expect(header).toBeEmptyDOMElement()
    expect(toolstrip).toBeInTheDocument()
    expect(toolstrip).toHaveStyle({ width: `${STAFF_TOOLSTRIP_WIDTH_PX}px` })
    expect(toolstrip).toBeEmptyDOMElement()
    expect(screen.getByTestId('staff-shell-work-area')).toHaveTextContent('WORK AREA ONLY')
  })
})

describe('StaffShellFrame — COBRA theme boundary actually reaches descendants', () => {
  it('a plain @mui/material child picks up the COBRA theme default (small button size), proving ThemeProvider is live, not just present in JSX', () => {
    render(
      <StaffShellFrame>
        <Button>Themed child</Button>
      </StaffShellFrame>,
    )

    const button = screen.getByRole('button', { name: 'Themed child' })
    // cobraTheme's MuiButton defaultProps set size: 'small' (never the MUI
    // default 'medium') — this only holds if StaffShellFrame's ThemeProvider
    // is genuinely the ancestor theme context for this child.
    expect(button.className).toContain('sizeSmall')
  })
})
