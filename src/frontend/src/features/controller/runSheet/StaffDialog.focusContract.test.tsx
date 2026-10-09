/**
 * features/controller/runSheet/StaffDialog.focusContract.test.tsx
 * ---------------------------------------------------------------------------
 * The focus-trap contract (demo-polish C3 Gate-1; `core/a11y/modalPriority.ts`): the run
 * sheet's dialogs (`BeatEditor`, `ConfirmDialog`, both built on `StaffDialog`) must STAND
 * ASIDE while any other `aria-modal` layer - the shell's Pause / EndEx / break-fiction
 * overlay, marked `data-shell-layer` - is on screen. MUI's trap only knows MUI modals, so
 * left alone it pulls focus back from that overlay and the two traps fight forever.
 *
 * Each case mounts an `aria-modal` overlay over (or under) an open dialog and checks that
 * focus STAYS in the overlay and that Tab does not throw. A control test with a bare MUI
 * `Dialog` proves the scenario really does pull focus back without `StaffDialog`.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ConfirmDialog } from './ConfirmDialog'

vi.mock('@/features/controller/media/MediaLibraryPicker', async () => {
  const React = await import('react')
  return { MediaLibraryPicker: () => React.createElement('div', { 'data-testid': 'mock-picker' }) }
})

import { BeatEditor } from './BeatEditor'
import { sheetFixture } from './runSheetTestKit'

vi.setConfig({ testTimeout: 30_000 })

const overlays: HTMLElement[] = []

/** Mounts a shell-style overlay: `aria-modal`, `data-shell-layer`, one focusable action. */
function mountOverlay(): HTMLButtonElement {
  const overlay = document.createElement('div')
  overlay.setAttribute('role', 'alertdialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('data-shell-layer', '')
  const action = document.createElement('button')
  action.textContent = 'Resume exercise'
  overlay.appendChild(action)
  document.body.appendChild(overlay)
  overlays.push(overlay)
  return action
}

function unmountOverlays() {
  for (const overlay of overlays.splice(0)) overlay.remove()
}

/** Lets MutationObserver callbacks, React effects and MUI's focus interval all run. */
async function settle() {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 120))
  })
}

afterEach(() => {
  unmountOverlays()
})

const withTheme = (ui: React.ReactNode) => <ThemeProvider theme={cobraTheme}>{ui}</ThemeProvider>

const cases: readonly { readonly name: string; readonly element: () => React.ReactNode }[] = [
  {
    name: 'ConfirmDialog',
    element: () => (
      <ConfirmDialog title="Delete this beat?" confirmLabel="Delete beat" onConfirm={() => {}} onCancel={() => {}}>
        Body text.
      </ConfirmDialog>
    ),
  },
  {
    name: 'BeatEditor',
    element: () => (
      <BeatEditor data={sheetFixture([])} personas={[]} onSave={() => {}} onCancel={() => {}} />
    ),
  },
]

describe('control: a bare MUI Dialog fights an outside aria-modal layer', () => {
  it('pulls focus back from the overlay (which is why StaffDialog exists)', async () => {
    render(withTheme(<Dialog open><button type="button">Inside</button></Dialog>))
    const action = mountOverlay()
    await settle()
    act(() => action.focus())
    await settle()
    expect(action).not.toHaveFocus()
    expect(within(screen.getByRole('dialog', { hidden: true })).getByText('Inside')).toBeInTheDocument()
  })
})

describe.each(cases)('$name stands aside for another aria-modal layer', ({ element }) => {
  it('keeps focus in an overlay mounted OVER the open dialog, and Tab does not throw', async () => {
    const user = userEvent.setup({ delay: null })
    render(withTheme(element()))
    await screen.findByRole('dialog')

    const action = mountOverlay()
    await settle()
    act(() => action.focus())
    await settle()
    expect(action).toHaveFocus()

    // Pressing Tab inside the overlay must not throw, and the dialog must not yank focus back.
    await expect(user.tab()).resolves.not.toThrow()
    await settle()
    expect(document.activeElement).not.toBeNull()
    action.focus()
    await settle()
    expect(action).toHaveFocus()
  })

  it('does not steal focus when it OPENS under an overlay that is already up', async () => {
    const action = mountOverlay()
    act(() => action.focus())
    expect(action).toHaveFocus()

    render(withTheme(element()))
    await screen.findByRole('dialog', { hidden: true })
    await settle()
    expect(action).toHaveFocus()
    // And it does not hide the overlay from assistive tech (MUI aria-hides body siblings).
    expect(action.closest('[aria-modal="true"]')).not.toHaveAttribute('aria-hidden', 'true')
  })

  it('takes focus back once the overlay is gone', async () => {
    render(withTheme(element()))
    await screen.findByRole('dialog')
    const action = mountOverlay()
    await settle()
    act(() => action.focus())
    await settle()
    expect(action).toHaveFocus()

    unmountOverlays()
    await settle()
    const outside = document.createElement('button')
    outside.textContent = 'Outside'
    document.body.appendChild(outside)
    act(() => outside.focus())
    // MUI's trap root is the dialog's container (the Paper's parent): focus lands there or in it.
    const trapRoot = screen.getByRole('dialog').closest('.MuiDialog-container')
    await waitFor(() => expect(outside).not.toHaveFocus())
    expect(trapRoot).not.toBeNull()
    expect(trapRoot).toContainElement(document.activeElement as HTMLElement)
    outside.remove()
  })
})
