/**
 * features/controller/runSheet/RunSheet.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (D5-024): the run sheet on a tablet. Each key (F / H / S / E / N / A) has a visible,
 * labelled button; every run-sheet button is >= 44x44 inside `@media (pointer: coarse)` (real
 * layout space, no ::before / ::after hit-slop) and row actions sit >= 8px apart.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { RunSheetRow } from './RunSheetRow'
import { RunSheetButton, RunSheetIconButton } from './RunSheetButtons'
import { makeItem } from './runSheetTestHarness'
import { faBolt, faArrowUp } from '@fortawesome/free-solid-svg-icons'
import { hasPseudoHitSlop, mediaRuleDeclarations } from '../consoleTouchTestUtils'

vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

function expect44(el: HTMLElement) {
  const coarse = mediaRuleDeclarations(el, 'pointer: coarse')
  expect(coarse['min-width']).toBe('44px')
  expect(coarse['min-height']).toBe('44px')
  expect(hasPseudoHitSlop(el)).toBe(false)
}

describe('Run sheet — touch targets (story 14)', () => {
  it('RunSheetButton and RunSheetIconButton (every kind) are 44x44 under a coarse pointer', () => {
    render(
      <ThemeProvider theme={cobraTheme}>
        <RunSheetButton kind="primary" icon={faBolt} label="Fire next" testId="b-primary" onClick={vi.fn()} />
        <RunSheetButton label="Add" testId="b-secondary" onClick={vi.fn()} />
        <RunSheetButton kind="danger" label="Delete" testId="b-danger" onClick={vi.fn()} />
        <RunSheetButton label="Mine" pressed testId="b-pressed" onClick={vi.fn()} />
        <RunSheetIconButton icon={faArrowUp} ariaLabel="Move up" testId="b-icon" onClick={vi.fn()} />
      </ThemeProvider>,
    )
    for (const id of ['b-primary', 'b-secondary', 'b-danger', 'b-pressed', 'b-icon']) {
      expect44(screen.getByTestId(id))
    }
  })

  it('a row exposes F / H / S / E as labelled buttons, all 44px, in a group with an 8px coarse gap', () => {
    render(
      <ThemeProvider theme={cobraTheme}>
        <ul>
          <RunSheetRow
            item={makeItem({ status: 'pending' })}
            selected={false}
            tabStop={false}
            busy={false}
            fireDisabledReason={undefined}
            fireReasonId="r"
            isMine={false}
            personaOf={() => undefined}
            nameOf={() => undefined}
            timeZone="America/New_York"
            canMoveUp
            canMoveDown
            confirmingDelete={false}
            onSelect={vi.fn()}
            onFire={vi.fn()}
            onHold={vi.fn()}
            onRelease={vi.fn()}
            onSkip={vi.fn()}
            onUnskip={vi.fn()}
            onRetry={vi.fn()}
            onMarkFired={vi.fn()}
            onOpen={vi.fn()}
            onRequestDelete={vi.fn()}
            onConfirmDelete={vi.fn()}
            onCancelDelete={vi.fn()}
            onMoveUp={vi.fn()}
            onMoveDown={vi.fn()}
          />
        </ul>
      </ThemeProvider>,
    )
    const row = screen.getByTestId('run-sheet-row')
    for (const id of ['row-fire', 'row-hold', 'row-skip', 'row-open', 'row-move-up', 'row-move-down']) {
      const button = within(row).getByTestId(id)
      expect44(button)
    }
    // Fire / Hold / Skip / Edit have visible text (not icon-only): the touch twin of F / H / S / E.
    expect(within(row).getByTestId('row-fire')).toHaveTextContent('Fire')
    expect(within(row).getByTestId('row-hold')).toHaveTextContent('Hold')
    expect(within(row).getByTestId('row-skip')).toHaveTextContent('Skip')
    expect(within(row).getByTestId('row-open')).toHaveTextContent(/Edit|View/)
    const group = within(row).getByTestId('row-fire').parentElement as HTMLElement
    expect(mediaRuleDeclarations(group, 'pointer: coarse').gap).toBe('8px')
  })
})
