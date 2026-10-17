/**
 * features/staffShell/StaffShellFrame.tablet.test.tsx
 * ---------------------------------------------------------------------------
 * Story 13 (mobile-tablet, staff shell at tablet sizes; D7-011, D5-021/024, TABLET-AMENDMENT §2/§4)
 * — the frame and its FLYOUTS at tablet widths.
 *
 *  - Focus/DOM order is header -> work area -> toolstrip (-> shell-global overlay last), so a
 *    keyboard or switch user meets them in that order at every width.
 *  - The frame never lets an over-wide child stretch it past the viewport (`minmax(0, 1fr)`).
 *  - Flyout contract (CSS contract; one `staffFlyoutPanelSx` shared by the panels): full pane
 *    height (top/bottom), never past the edge (`max-width`), starts at `--staff-flyout-top`
 *    (so story 12's sticky command band is never covered), z-index above work-area content, and
 *    the SHELL (header = separate grid row, toolstrip = separate column) is structurally
 *    uncoverable. The persona dock (a story-12-owned file) gets the same contract from the frame.
 *  - Every flyout (participant admin, ENGINE, USAGE, persona dock) has a VISIBLE close button,
 *    closes on Escape, and the close is 44x44 under a coarse pointer.
 *  - Participant admin: focus moves to the close button on open and returns to the toolstrip button
 *    on close; role guards are unchanged (read-only role sees no quick actions).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { StaffShellFrame } from './StaffShellFrame'
import { Toolstrip } from './components/Toolstrip'
import { ParticipantAdminFlyout, PARTICIPANT_ADMIN_TOOL_ID } from './components/ParticipantAdminFlyout'
import { ToolstripProvider } from './toolRegistry'
import { staffShellTokens, STAFF_TOUCH_TARGET_PX, STAFF_TOOLSTRIP_WIDTH_PX } from './staffShellTokens'
import { mediaRuleDeclarations, ruleDeclarations } from './tabletTestUtils'
import { useAdminAuthorization, useParticipantAdminRoster } from './participantAdminMocks'
import type { ParticipantAdminRow } from './participantAdminMocks'
import { PersonaDockHost } from '@/features/controller/console/personaDockHost.tsx'
import { EngineSettingsPanel } from '@/features/controller/engine/components/EngineSettingsPanel'
import { UsagePanel } from '@/features/controller/engine/components/UsagePanel'
import { engineSettingsStore } from '@/features/controller/engine/hooks/useEngineSettings'
import { engineUsageStore } from '@/features/controller/engine/hooks/useEngineUsage'

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: vi.fn(actual.useExerciseContext) }
})
vi.mock('./participantAdminMocks', () => ({
  useParticipantAdminRoster: vi.fn(),
  useAdminAuthorization: vi.fn(),
}))

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-test-flyouts',
  exerciseName: 'Bay Shield 2026',
  timeZone: 'UTC',
  status: 'active',
}
const ROSTER: ParticipantAdminRow[] = [
  { id: 'p1', name: 'Ada Lovelace', role: 'EOC Liaison', status: 'locked-out' },
]

function setAuth(canPerformAdminAction: boolean, role: string) {
  vi.mocked(useAdminAuthorization).mockReturnValue({
    role,
    actingHumanId: 'staff-1',
    canPerformAdminAction,
  } as ReturnType<typeof useAdminAuthorization>)
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue(SCOPE)
  vi.mocked(useParticipantAdminRoster).mockReturnValue(ROSTER)
  setAuth(true, 'controller')
  engineUsageStore.resetForTests()
  engineSettingsStore.resetForTests()
})
afterEach(() => {
  engineUsageStore.resetForTests()
  engineSettingsStore.resetForTests()
})

function renderFrame() {
  return render(
    <MemoryRouter>
      <ToolstripProvider>
        <StaffShellFrame
          header={<button type="button">header-control</button>}
          toolstrip={<Toolstrip />}
          globalOverlay={<ParticipantAdminFlyout />}
        >
          <button type="button">work-control</button>
        </StaffShellFrame>
      </ToolstripProvider>
    </MemoryRouter>,
  )
}

describe('StaffShellFrame — tablet frame contract', () => {
  it('orders focus header -> work area -> toolstrip (overlay last)', async () => {
    const user = userEvent.setup()
    renderFrame()
    await user.tab()
    expect(screen.getByText('header-control')).toHaveFocus()
    await user.tab()
    expect(screen.getByText('work-control')).toHaveFocus()
    await user.tab()
    expect(screen.getByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`)).toHaveFocus()
  })

  it('has a single shrinkable grid column so an over-wide child cannot push the toolstrip off-screen', () => {
    renderFrame()
    const frame = screen.getByTestId('staff-shell-frame')
    expect(ruleDeclarations(frame)['grid-template-columns']).toBe('minmax(0, 1fr)')
    expect(ruleDeclarations(screen.getByTestId('staff-shell-header'))['min-width']).toBe('0px')
  })

  it('keeps the header and toolstrip in their own grid tracks (flyouts cannot cover them)', () => {
    renderFrame()
    const frame = screen.getByTestId('staff-shell-frame')
    const header = screen.getByTestId('staff-shell-header')
    const toolstrip = screen.getByTestId('staff-shell-toolstrip')
    // The header is a direct child of the frame grid, the overlay's positioned row is another one.
    expect(header.parentElement).toBe(frame)
    expect(toolstrip.parentElement).not.toBe(frame)
    expect(toolstrip.parentElement?.contains(header)).toBe(false)
    expect(toolstrip.style.width || ruleDeclarations(toolstrip).width).toBeTruthy()
    expect(STAFF_TOOLSTRIP_WIDTH_PX).toBe(56)
  })

  it('tablet tokens (header height, toolstrip width) are set under the tablet media query', () => {
    renderFrame()
    const header = screen.getByTestId('staff-shell-header')
    expect(mediaRuleDeclarations(header, 'max-width: 1279.95px').height).toBe('56px')
    const toolstrip = screen.getByTestId('staff-shell-toolstrip')
    expect(mediaRuleDeclarations(toolstrip, 'max-width: 1279.95px').width).toBe('56px')
  })
})

describe('Participant admin flyout — tablet', () => {
  it('opens full height, clamped to the viewport, below --staff-flyout-top, above content', async () => {
    const user = userEvent.setup()
    renderFrame()
    await user.click(screen.getByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`))
    const flyout = screen.getByTestId('participant-admin-flyout')
    const css = ruleDeclarations(flyout)
    expect(css.bottom).toBe('0px')
    expect(css.top).toBe(`var(${staffShellTokens.flyout.topVar}, 0px)`)
    expect(css['max-width']).toBe(`calc(100% - ${STAFF_TOOLSTRIP_WIDTH_PX}px)`)
    expect(css.right).toBe(`${STAFF_TOOLSTRIP_WIDTH_PX}px`)
    expect(css['z-index']).toBe(String(staffShellTokens.flyout.zIndex))
  })

  it('has a visible close button that closes it, plus Escape; focus lands in then returns', async () => {
    const user = userEvent.setup()
    renderFrame()
    const tool = screen.getByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`)

    await user.click(tool)
    const close = screen.getByTestId('participant-admin-close')
    expect(close).toBeVisible()
    expect(close).toHaveFocus()

    await user.click(close)
    expect(screen.queryByTestId('participant-admin-flyout')).not.toBeInTheDocument()
    expect(tool).toHaveFocus()

    await user.click(tool)
    await user.keyboard('{Escape}')
    expect(screen.queryByTestId('participant-admin-flyout')).not.toBeInTheDocument()
    expect(tool).toHaveFocus()
  })

  it('sizes the close button and row action to 44px only under a coarse pointer', async () => {
    const user = userEvent.setup()
    renderFrame()
    await user.click(screen.getByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`))
    const close = screen.getByTestId('participant-admin-close')
    expect(mediaRuleDeclarations(close, 'pointer: coarse').width).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
    expect(mediaRuleDeclarations(close, 'pointer: coarse').height).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
    const action = screen.getByTestId('participant-admin-action-p1')
    expect(mediaRuleDeclarations(action, 'pointer: coarse')['min-height']).toBe(
      `${STAFF_TOUCH_TARGET_PX}px`,
    )
  })

  it('role guard unchanged: a read-only role sees no quick actions at tablet size either', async () => {
    setAuth(false, 'observer')
    const user = userEvent.setup()
    renderFrame()
    await user.click(screen.getByTestId(`toolstrip-tool-${PARTICIPANT_ADMIN_TOOL_ID}`))
    expect(screen.getByTestId('participant-admin-row-p1')).toBeInTheDocument()
    expect(screen.queryByTestId('participant-admin-action-p1')).not.toBeInTheDocument()
  })
})

function withProviders(node: React.ReactNode) {
  return (
    <ThemeProvider theme={cobraTheme}>{node}</ThemeProvider>
  )
}

describe('Console-hosted flyouts (ENGINE, USAGE, persona dock) — shared contract', () => {
  it.each([
    ['ENGINE', 'engine-settings-panel', 'engine-settings-close', <EngineSettingsPanel key="e" open onClose={() => undefined} />],
    ['USAGE', 'engine-usage-panel', 'engine-usage-close', <UsagePanel key="u" open onClose={() => undefined} />],
  ])('%s: full height, edge-clamped, below --staff-flyout-top, 44px close under coarse', (_n, panelId, closeId, node) => {
    render(withProviders(node))
    const panel = screen.getByTestId(panelId)
    const css = ruleDeclarations(panel)
    expect(css.bottom).toBe('0px')
    expect(css.top).toBe(`var(${staffShellTokens.flyout.topVar}, 0px)`)
    expect(css['max-width']).toBe('100%')
    expect(css['z-index']).toBe(String(staffShellTokens.flyout.zIndex))
    const close = screen.getByTestId(closeId)
    expect(close).toBeVisible()
    expect(mediaRuleDeclarations(close, 'pointer: coarse').height).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
  })

  it.each([
    ['ENGINE', 'engine-settings-panel', (onClose: () => void) => <EngineSettingsPanel open onClose={onClose} />],
    ['USAGE', 'engine-usage-panel', (onClose: () => void) => <UsagePanel open onClose={onClose} />],
    ['persona dock', 'persona-dock-host', (onClose: () => void) => <PersonaDockHost open onClose={onClose} />],
  ])('%s: Escape closes it', async (_n, panelId, make) => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(withProviders(make(onClose)))
    const panel = screen.getByTestId(panelId)
    expect(panel).toBeVisible()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('the frame applies the same clamp, top seam and 44px close to the persona dock (story 12 owns that file)', () => {
    render(
      <MemoryRouter>
        <ToolstripProvider>
          <StaffShellFrame>
            <PersonaDockHost open onClose={() => undefined} />
          </StaffShellFrame>
        </ToolstripProvider>
      </MemoryRouter>,
    )
    const dock = screen.getByTestId('persona-dock-host')
    // The frame's own descendant-selector rule (it out-specifies the dock's class, which a naive
    // "last rule wins" flatten would not model, so find that rule by its selector).
    const frameRule = Array.from(document.styleSheets)
      .flatMap(sheet => Array.from(sheet.cssRules))
      .find(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule &&
          rule.selectorText.includes('persona-dock-host') &&
          dock.matches(rule.selectorText) &&
          rule.style.getPropertyValue('max-width') !== '',
      )
    expect(frameRule?.style.getPropertyValue('max-width')).toBe('100%')
    expect(frameRule?.style.getPropertyValue('top')).toBe(`var(${staffShellTokens.flyout.topVar}, 0px)`)
    const close = screen.getByRole('button', { name: /^Close/ })
    expect(mediaRuleDeclarations(close, 'pointer: coarse').height).toBe(`${STAFF_TOUCH_TARGET_PX}px`)
  })
})
