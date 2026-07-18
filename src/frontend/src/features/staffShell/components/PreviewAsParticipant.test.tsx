/**
 * features/staffShell/components/PreviewAsParticipant.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (Preview as participant) — RTL coverage for the Acceptance
 * Criteria in docs/features/staff-shell/04-preview-as-participant.md:
 *
 *  - The stage is unmistakably labelled as a preview (AC1/AC3) and stays
 *    inside the staff frame (no navigation — this component renders nothing
 *    that changes `window.location` or mounts a router).
 *  - The moment picker offers exactly STARTEX/ADVISORY/BURST/NOW, is
 *    mutually exclusive (`role="radiogroup"`/`role="radio"` +
 *    `aria-checked`), and selecting one drives both the staged alert content
 *    AND the participant render's mount props (AC2).
 *  - The staged content renders via the REAL `ShellContextProvider` with
 *    `variant: 'preview'` (AC1/AC4) and carries NO post/act affordance
 *    (read-only).
 *  - Exit calls `usePreview().toggle()` — proven end-to-end through a small
 *    harness that mirrors the orchestrator's `active ? <PreviewAsParticipant
 *    /> : <WorkArea />` wiring (AC3); this component does not manage its own
 *    `active` state.
 *  - The picker + Exit are keyboard-operable (Tab + Enter/Space) — no
 *    pointer-only interaction (AC5).
 *
 * `@/core/exerciseContext` is mocked at the module boundary (mirrors
 * `StaffHeader.test.tsx` / `PortalStub.test.tsx`) purely so the nested
 * `PortalStub` can resolve a `timeZone` for its dateline; this test does not
 * exercise that seam's own resolution timing.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext } from '@/core/exerciseContext'
import { PreviewProvider, usePreview } from '../previewContext'
import { PreviewAsParticipant } from './PreviewAsParticipant'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-test-preview-as-participant-0001',
    exerciseName: 'Bay Shield 2026',
    timeZone: 'UTC',
    status: 'active',
  })
})

/**
 * Mirrors the orchestrator's Integration-B wiring exactly (see
 * `previewContext.ts`'s module header): a header-style toggle button plus
 * `active ? <PreviewAsParticipant /> : <WorkArea />`. This is NOT
 * `PreviewAsParticipant`'s own responsibility — it proves the exported seam
 * composes the way the real frame will use it.
 */
function Harness() {
  const { active, toggle } = usePreview()
  return (
    <div>
      <button type="button" aria-pressed={active} onClick={toggle}>
        header preview toggle
      </button>
      {active
        ? <PreviewAsParticipant />
        : <div data-testid="work-area">Controller Console work area</div>}
    </div>
  )
}

function renderHarness() {
  return render(
    <PreviewProvider>
      <Harness />
    </PreviewProvider>,
  )
}

describe('PreviewAsParticipant — replaces the work area, labelled, within the staff frame (AC1/AC3)', () => {
  it('is not mounted until the header toggle activates preview; activating swaps the work area for the stage', async () => {
    const user = userEvent.setup()
    renderHarness()

    expect(screen.getByTestId('work-area')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))

    expect(screen.queryByTestId('work-area')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-as-participant')).toBeInTheDocument()
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent(/preview as participant/i)
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent(/read-only/i)
  })

  it('exiting (Exit control) calls toggle() and restores the prior work area — never a navigation', async () => {
    const user = userEvent.setup()
    const originalLocation = window.location.href
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))
    expect(screen.getByTestId('preview-as-participant')).toBeInTheDocument()

    await user.click(screen.getByTestId('preview-exit'))

    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-area')).toBeInTheDocument()
    // "Exit" never navigates away (AC3) — the URL is untouched.
    expect(window.location.href).toBe(originalLocation)
  })
})

describe('PreviewAsParticipant — moment picker (AC2/AC5)', () => {
  async function openPreview() {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))
    return user
  }

  it('offers exactly the four moments STARTEX/ADVISORY/BURST/NOW, as a radiogroup', async () => {
    await openPreview()

    const picker = screen.getByRole('radiogroup', { name: 'Preview scenario moment' })
    const chips = within(picker).getAllByRole('radio')
    expect(chips.map(chip => chip.textContent)).toEqual(['STARTEX', 'ADVISORY', 'BURST', 'NOW'])
  })

  it('defaults to NOW selected, and only NOW carries aria-checked="true"', async () => {
    await openPreview()

    expect(screen.getByTestId('preview-moment-now')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('preview-moment-startex')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('preview-moment-advisory')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('preview-moment-burst')).toHaveAttribute('aria-checked', 'false')
  })

  it('selecting a different chip is mutually exclusive — exactly one aria-checked="true" at a time', async () => {
    const user = await openPreview()

    await user.click(screen.getByTestId('preview-moment-advisory'))

    const checkedChips = screen.getAllByRole('radio', { checked: true })
    expect(checkedChips).toHaveLength(1)
    expect(checkedChips[0]).toBe(screen.getByTestId('preview-moment-advisory'))
    expect(screen.getByTestId('preview-moment-now')).toHaveAttribute('aria-checked', 'false')
  })

  it('selecting a moment drives the staged participant content (AC2)', async () => {
    const user = await openPreview()

    const nowHeadline = /water distribution site open at fairview high school/i
    const burstHeadline = /do not drink tap water in zones 2–4/i

    // Scoped to the <h1> headline specifically — BURST's alert-banner MESSAGE
    // text also contains the same words, so an unscoped text query would
    // ambiguously match both.
    expect(screen.getByRole('heading', { name: nowHeadline })).toBeInTheDocument()

    await user.click(screen.getByTestId('preview-moment-burst'))

    expect(screen.getByRole('heading', { name: burstHeadline })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: nowHeadline })).not.toBeInTheDocument()
    // BURST's mock alert state is "emergency" — its banner is present.
    expect(screen.getByTestId('portal-stub-alert')).toHaveTextContent('EMERGENCY')
  })

  it('selecting STARTEX (alertState "none") removes the alert banner entirely', async () => {
    const user = await openPreview()

    await user.click(screen.getByTestId('preview-moment-startex'))

    expect(screen.queryByTestId('portal-stub-alert')).not.toBeInTheDocument()
  })

  it('the picker and Exit are keyboard-operable — Tab reaches each control, Enter/Space activates it', async () => {
    const user = await openPreview()

    // Tab from the top of the document until the ADVISORY chip has focus.
    const advisoryChip = screen.getByTestId('preview-moment-advisory')
    await user.tab()
    let iterations = 0
    while (document.activeElement !== advisoryChip && iterations < 10) {
      await user.tab()
      iterations += 1
    }
    expect(document.activeElement).toBe(advisoryChip)

    await user.keyboard('{Enter}')
    expect(advisoryChip).toHaveAttribute('aria-checked', 'true')

    const exitButton = screen.getByTestId('preview-exit')
    exitButton.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
  })
})

describe('PreviewAsParticipant — staged content is read-only (AC4) and provably variant "preview"', () => {
  it('the staged PortalStub carries data-shell-variant="preview" and no post/act affordance', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))

    const stub = screen.getByTestId('portal-stub')
    expect(stub).toHaveAttribute('data-shell-variant', 'preview')

    // No affordance anywhere INSIDE the staged participant content (the
    // stage chrome's own Exit/moment-picker buttons live outside `portal-stub`).
    expect(within(stub).queryAllByRole('button')).toHaveLength(0)
    expect(within(stub).queryAllByRole('link')).toHaveLength(0)
  })
})
