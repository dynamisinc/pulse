/**
 * features/controller/personaEdit/PersonaEditDialog.imitates.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 33 (DF-49), Page ACs "Persona editor" and "Console telemetry": the
 * Imitates select in the persona edit dialog, driven through the REAL providers, hooks and
 * mock adapter (which implements the same 400 rules as the server).
 *
 *  - shown only while the draft is unverified; turning Verified on hides it and clears it;
 *  - options: None + the exercise's OTHER verified personas, "Display name (@handle)", sorted;
 *  - part of the patch diff: only sent when changed, null clears;
 *  - a server 400 shows inline (the dialog's role="alert" banner), verbatim;
 *  - the `steering_action` `persona_edit` event lists `imitatesPersonaId` (names only).
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { SEEDED_PERSONAS, type StaffPersona } from '@/features/personas'
import { renderPersonaEdit } from './PersonaEditHarness.testUtils'
import { PERSONA_ADMIN_MESSAGES, resetMockPersonaEdits } from './personaEditMock'
import { patchPersona } from './personaEditService'

vi.mock('./personaEditService', async importOriginal => {
  const actual = await importOriginal<typeof import('./personaEditService')>()
  return { ...actual, patchPersona: vi.fn(actual.patchPersona) }
})

const mockedPatch = vi.mocked(patchPersona)

const WATER_ID = 'persona-fairhavenwater' // verified, "Fairhaven Water Utility"
const NEWSLINE_ID = 'persona-newsline7' // verified, "Newsline 7"
const LOOKALIKE_ID = 'persona-fairhavenwaterupd' // unverified

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

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('persona-edit-button'))
  return screen.findByRole('dialog', { name: 'Edit persona' })
}

const imitates = () => screen.getByRole('combobox', { name: 'Imitates' })
const queryImitates = () => screen.queryByRole('combobox', { name: 'Imitates' })
const saveButton = () => screen.getByRole('button', { name: /^Sav(e|ing…)$/ })
const lastPatch = () => mockedPatch.mock.calls.at(-1)?.[1]
const editEvents = () =>
  getEmittedTelemetryEvents().filter(event => event.eventType === 'steering_action')

async function confirmVerified(user: ReturnType<typeof userEvent.setup>) {
  const confirm = await screen.findByRole('dialog', { name: /verified mark/i })
  await user.click(within(confirm).getByRole('button', { name: /Turn verified (ON|OFF)/ }))
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: /verified mark/i })).not.toBeInTheDocument())
}

describe('Imitates select: visibility', () => {
  it('is hidden while the persona is verified', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    expect(queryImitates()).not.toBeInTheDocument()
  })

  it('is shown while the persona is unverified', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(LOOKALIKE_ID))
    await openDialog(user)
    expect(imitates()).toHaveValue('')
  })

  it('appears when Verified is turned off in the draft', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await confirmVerified(user)
    expect(imitates()).toBeInTheDocument()
  })
})

describe('Imitates select: options', () => {
  it('is None plus the verified personas, labelled "Name (@handle)", sorted by name', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(LOOKALIKE_ID))
    await openDialog(user)
    const labels = within(imitates()).getAllByRole('option').map(option => option.textContent)
    expect(labels).toEqual([
      'None',
      'Fairhaven Water Utility (@FairhavenWater)',
      'Fulton County EM (@FulcoEM)',
      'Newsline 7 (@Newsline7)',
    ])
  })

  it('never lists the persona itself, nor an unverified persona', async () => {
    const user = userEvent.setup()
    // A verified persona, un-verified in the draft: it is still "verified" in the directory,
    // so only the self-exclusion keeps it out of its own list.
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await confirmVerified(user)
    const labels = within(imitates()).getAllByRole('option').map(option => option.textContent)
    expect(labels).not.toContain('Fairhaven Water Utility (@FairhavenWater)')
    expect(labels).toEqual(['None', 'Fulton County EM (@FulcoEM)', 'Newsline 7 (@Newsline7)'])
    expect(labels.join('|')).not.toMatch(/FairhavenWaterUpd|tbrandt41|TheScoopHQ/)
  })
})

describe('Imitates select: the patch', () => {
  it('choosing a target sends { imitatesPersonaId } only, and the mock directory keeps it', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(LOOKALIKE_ID))
    await openDialog(user)
    await user.selectOptions(imitates(), WATER_ID)
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ imitatesPersonaId: WATER_ID })
    expect(seeded(LOOKALIKE_ID).imitatesPersonaId).toBe(WATER_ID)
  })

  it('None on a named lookalike sends null; an unchanged value sends nothing', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit({ ...seeded(LOOKALIKE_ID), imitatesPersonaId: WATER_ID })
    await openDialog(user)
    expect(imitates()).toHaveValue(WATER_ID)
    expect(saveButton()).toBeDisabled() // no change yet
    await user.selectOptions(imitates(), '')
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ imitatesPersonaId: null })
  })

  it('turning Verified on hides the select and clears a set value in the same patch', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit({ ...seeded(LOOKALIKE_ID), imitatesPersonaId: WATER_ID })
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await confirmVerified(user)
    expect(queryImitates()).not.toBeInTheDocument()
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ verified: true, imitatesPersonaId: null })
  })

  it('turning Verified on and back off restores the saved target: nothing to save', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit({ ...seeded(LOOKALIKE_ID), imitatesPersonaId: WATER_ID })
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await confirmVerified(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await confirmVerified(user)
    expect(imitates()).toHaveValue(WATER_ID)
    expect(saveButton()).toBeDisabled()
  })

  it('turning Verified on with nothing set sends only { verified: true }', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(LOOKALIKE_ID))
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await confirmVerified(user)
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ verified: true })
  })
})

describe('Imitates select: server refusal and telemetry', () => {
  it('shows the server 400 inline and keeps the dialog open with the choice intact', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(LOOKALIKE_ID))
    await openDialog(user)
    // Another controller un-verifies the target after the dialog listed it.
    await patchPersona(NEWSLINE_ID, { verified: false })
    mockedPatch.mockClear()
    await user.selectOptions(imitates(), NEWSLINE_ID)
    await user.click(saveButton())
    const banner = await screen.findByTestId('persona-edit-error-text')
    expect(banner).toHaveTextContent(PERSONA_ADMIN_MESSAGES.imitatesNotVerified)
    expect(screen.getByTestId('persona-edit-error')).toHaveAttribute('role', 'alert')
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(imitates()).toHaveValue(NEWSLINE_ID)
    expect(editEvents()).toHaveLength(0)
  })

  it('emits one steering_action persona_edit listing imitatesPersonaId, names only', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(LOOKALIKE_ID))
    await openDialog(user)
    await user.selectOptions(imitates(), WATER_ID)
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const events = editEvents()
    expect(events).toHaveLength(1)
    expect(events[0]?.payload).toEqual({ action: 'persona_edit', fields: ['imitatesPersonaId'] })
    expect(JSON.stringify(events[0]?.payload)).not.toContain(WATER_ID)
  })
})
