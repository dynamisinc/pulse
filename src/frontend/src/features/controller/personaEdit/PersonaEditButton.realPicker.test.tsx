/**
 * features/controller/personaEdit/PersonaEditButton.realPicker.test.tsx
 * ---------------------------------------------------------------------------
 * The persona edit dialog against C1's REAL `MediaLibraryPicker` (nothing mocked about the
 * picker; `PersonaEditButton.test.tsx` swaps in a props-contract fake). Wave 3 Gate-2 A L-6:
 * a plain Enter on any radio or checkbox inside the dialog's <form> must not submit it.
 * Chromium and Firefox implicitly submit on Enter in a radio, which here would SAVE the profile -
 * live to participants - from the picker's All / Images / Videos filter, a control whose Enter
 * means nothing. PE-FE Gate-1 L-6 covered only the Verified checkbox.
 *
 *  - Enter on the picker's checked filter radio: no save, the dialog stays;
 *  - Enter on the Verified checkbox: still no save (now covered by the same dialog-level guard);
 *  - Enter in a single-line text field still saves (the guard is not a dead Enter), and the
 *    arrow keys / Space on the radios still work.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { SEEDED_PERSONAS, type StaffPersona } from '@/features/personas'
import { renderPersonaEdit } from './PersonaEditHarness.testUtils'
import { resetMockPersonaEdits } from './personaEditMock'
import { patchPersona } from './personaEditService'

vi.mock('./personaEditService', async importOriginal => {
  const actual = await importOriginal<typeof import('./personaEditService')>()
  return { ...actual, patchPersona: vi.fn(actual.patchPersona) }
})

vi.setConfig({ testTimeout: 30_000 })

const mockedPatch = vi.mocked(patchPersona)

function seeded(id: string): StaffPersona {
  const found = SEEDED_PERSONAS.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no seeded persona ${id}`)
  return found
}

beforeEach(() => {
  resetMockPersonaEdits()
  resetTelemetryBuffer()
  mockedPatch.mockClear()
})
afterEach(() => {
  resetMockPersonaEdits()
})

async function openDialogWithRealPicker(user: ReturnType<typeof userEvent.setup>) {
  await renderPersonaEdit(seeded('persona-tbrandt41'))
  await user.click(screen.getByTestId('persona-edit-button'))
  const dialog = await screen.findByRole('dialog', { name: 'Edit persona' })
  // Dirty and valid, so Save is enabled and an implicit submit WOULD save.
  const name = within(dialog).getByLabelText(/display name/i)
  await user.clear(name)
  await user.type(name, 'Thomas Brandt')
  expect(within(dialog).getByRole('button', { name: 'Save' })).toBeEnabled()
  // Open the avatar chooser's library: C1's real picker mounts inside the form.
  const avatar = within(dialog).getByTestId('persona-edit-avatar')
  await user.click(within(avatar).getByRole('button', { name: /choose from library/i }))
  const picker = await within(dialog).findByTestId('media-library-picker')
  return { dialog, picker }
}

describe('Enter on a radio or checkbox inside the persona edit dialog (Gate-2 A L-6)', () => {
  it('does not save from the real picker\'s filter radio', async () => {
    const user = userEvent.setup({ delay: null })
    const { dialog, picker } = await openDialogWithRealPicker(user)

    const radio = within(picker).getByRole('radio', { checked: true })
    expect(radio).toHaveAttribute('type', 'radio')
    radio.focus()
    await user.keyboard('{Enter}')

    expect(mockedPatch).not.toHaveBeenCalled()
    expect(dialog).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
  })

  it('does not save from the Verified checkbox either', async () => {
    const user = userEvent.setup({ delay: null })
    const { dialog } = await openDialogWithRealPicker(user)

    const checkbox = within(dialog).getByRole('checkbox', { name: /verified/i })
    checkbox.focus()
    await user.keyboard('{Enter}')

    expect(mockedPatch).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: /verified mark/i })).not.toBeInTheDocument()
  })

  it('Enter in a single-line field still saves (the guard is not a dead Enter)', async () => {
    const user = userEvent.setup({ delay: null })
    const { dialog } = await openDialogWithRealPicker(user)

    const name = within(dialog).getByLabelText(/display name/i)
    name.focus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(mockedPatch).toHaveBeenCalledTimes(1))
  })

  it('arrow keys still move between the picker\'s filter radios', async () => {
    const user = userEvent.setup({ delay: null })
    const { picker } = await openDialogWithRealPicker(user)
    const radios = within(picker).getAllByRole('radio')
    expect(radios.length).toBeGreaterThanOrEqual(2)
    const checked = within(picker).getByRole('radio', { checked: true })
    checked.focus()
    await user.keyboard('{ArrowRight}')
    expect(within(picker).getAllByRole('radio', { checked: true })).toHaveLength(1)
    expect(mockedPatch).not.toHaveBeenCalled()
  })
})
