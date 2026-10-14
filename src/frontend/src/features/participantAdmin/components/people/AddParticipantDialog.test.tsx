/**
 * features/participantAdmin/components/people/AddParticipantDialog.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — "Add participant", through the stateful mock backend.
 * Pins: validation BEFORE sending (name required; sign-in name pattern; email
 * shape) with the first bad field focused, the exact wire body, server 400/409
 * text shown inline (never a toast), and a clean slate on every open.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { configure, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { getRosterMockEntries, resetRosterMocks } from '../../mocks/rosterMocks'
import * as rosterService from '../../services/rosterService'
import { renderWithProviders } from '../../test/renderWithProviders'
import type { RosterEntryDto } from '../../types'
import { AddParticipantDialog } from './AddParticipantDialog'
import { deferred, setupUser, fill } from '../../test/userEvents'

// These tests render the full COBRA page / MUI dialogs through the stateful mock
// backend. A CI box under load can take several seconds just to mount the first
// one, so give them headroom over the 10 s test default and the 5 s `findBy`/`waitFor`
// default (set in src/test/setup.ts) rather than let contention read as a regression.
// Both settings are per test file (each file runs in its own isolated worker).
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 10_000 })

vi.mock('../../services/rosterService', async importOriginal => {
  const actual = await importOriginal<typeof import('../../services/rosterService')>()
  return { ...actual, addParticipant: vi.fn(actual.addParticipant) }
})

const addSpy = vi.mocked(rosterService.addParticipant)

async function renderDialog(open = true) {
  const onClose = vi.fn()
  const onAdded = vi.fn<(entry: RosterEntryDto) => void>()
  const view = renderWithProviders(
    <AddParticipantDialog open={open} onClose={onClose} onAdded={onAdded} />,
  )
  const user = setupUser()
  if (open) await screen.findByRole('dialog', { name: 'Add participant' })
  return { ...view, onClose, onAdded, user }
}

const field = (label: RegExp | string) => screen.getByLabelText(label)

beforeEach(() => {
  resetRosterMocks()
  addSpy.mockClear()
})

describe('AddParticipantDialog — structure', () => {
  it('is a named dialog with the six RosterRowWrite fields, name focused first', async () => {
    await renderDialog()
    const dialog = screen.getByRole('dialog', { name: 'Add participant' })
    const labels = [/^name/i, /^agency/i, /^role/i, /^email/i, /^persona handle/i, /^sign-in name/i]
    for (const label of labels) {
      expect(within(dialog).getByLabelText(label)).toBeInTheDocument()
    }
    expect(field(/^name/i)).toHaveFocus()
    expect(field(/^name/i)).toBeRequired()
  })

  it('renders nothing when closed', async () => {
    await renderDialog(false)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explains the optional fields as helper text', async () => {
    await renderDialog()
    expect(screen.getByText(/blank derives it from the name/i)).toBeInTheDocument()
    expect(screen.getByText(/blank creates a citizen persona/i)).toBeInTheDocument()
    expect(screen.getByText(/staff-only; never shown to participants/i)).toBeInTheDocument()
  })
})

describe('AddParticipantDialog — validation before sending', () => {
  it('an empty name is refused client-side: nothing is sent, the field is invalid and focused', async () => {
    const { user } = await renderDialog()
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    const name = field(/^name/i)
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText('Enter the participant\'s name.')).toBeInTheDocument()
    await waitFor(() => expect(name).toHaveFocus())
    expect(addSpy).not.toHaveBeenCalled()
  })

  it('refuses a bad sign-in name and a bad email, each with its own message', async () => {
    const { user } = await renderDialog()
    await fill(user, field(/^name/i), 'Jane Smith')
    await fill(user, field(/^email/i), 'not-an-email')
    await fill(user, field(/^sign-in name/i), 'a b')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    expect(await screen.findByText(/enter a valid email address/i)).toBeInTheDocument()
    expect(screen.getByText(/use 3 to 32 characters/i)).toBeInTheDocument()
    expect(field(/^email/i)).toHaveAttribute('aria-invalid', 'true')
    expect(field(/^sign-in name/i)).toHaveAttribute('aria-invalid', 'true')
    // The FIRST invalid field in form order takes focus.
    await waitFor(() => expect(field(/^email/i)).toHaveFocus())
    expect(addSpy).not.toHaveBeenCalled()
  })

  it('ties each error to its field with aria-describedby (text, not colour)', async () => {
    const { user } = await renderDialog()
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    const name = field(/^name/i)
    await waitFor(() => expect(name).toHaveAccessibleDescription('Enter the participant\'s name.'))
  })

  it('clears a field\'s error as soon as the user edits it', async () => {
    const { user } = await renderDialog()
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    await screen.findByText('Enter the participant\'s name.')

    await fill(user, field(/^name/i), 'J')

    expect(screen.queryByText('Enter the participant\'s name.')).not.toBeInTheDocument()
    expect(field(/^name/i)).not.toHaveAttribute('aria-invalid', 'true')
  })
})

describe('AddParticipantDialog — success', () => {
  it('sends the trimmed body (blank optionals dropped, sign-in name lower-cased) and reports the new row', async () => {
    const { user, onAdded } = await renderDialog()
    await fill(user, field(/^name/i), '  Riley Chen ')
    await fill(user, field(/^agency/i), 'Fulco Fire')
    await fill(user, field(/^sign-in name/i), 'RChen2')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(addSpy).toHaveBeenCalledWith({
      name: 'Riley Chen',
      agency: 'Fulco Fire',
      role: '',
      email: '',
      personaHandle: '',
      signInName: 'rchen2',
    })
    const added = onAdded.mock.calls[0]?.[0]
    expect(added).toMatchObject({ name: 'Riley Chen', signInName: 'rchen2', agency: 'Fulco Fire' })
    expect(getRosterMockEntries().some(e => e.id === added?.id)).toBe(true)
  })

  it('binds an org persona when one is named', async () => {
    const { user, onAdded } = await renderDialog()
    await fill(user, field(/^name/i), 'Sam Ortiz')
    await fill(user, field(/^persona handle/i), '@FulcoEM')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(onAdded.mock.calls[0]?.[0].persona).toMatchObject({ handle: 'FulcoEM', kind: 'org' })
  })

  it('Enter in a field submits the form', async () => {
    const { user, onAdded } = await renderDialog()
    await fill(user, field(/^name/i), 'Riley Chen')
    await user.keyboard('{Enter}')
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
  })
})

describe('AddParticipantDialog — server answers shown inline', () => {
  it('a 409 shows "already on the roster" in a role="alert", keeps the dialog and the typed values', async () => {
    const { user, onAdded } = await renderDialog()
    await fill(user, field(/^name/i), 'Someone Else')
    await fill(user, field(/^sign-in name/i), 'dwhitfield')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    const alert = await screen.findByTestId('add-participant-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('That person is already on the roster.')
    expect(screen.getByRole('dialog', { name: 'Add participant' })).toBeInTheDocument()
    expect(field(/^name/i)).toHaveValue('Someone Else')
    expect(field(/^sign-in name/i)).toHaveValue('dwhitfield')
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('a 400 shows the server\'s reason', async () => {
    const { user } = await renderDialog()
    await fill(user, field(/^name/i), 'Sam Ortiz')
    await fill(user, field(/^persona handle/i), 'NoSuchOrg')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    expect(await screen.findByTestId('add-participant-error'))
      .toHaveTextContent('personaHandle must name an organization persona in this exercise.')
  })

  it('a 403 says the user may not add participants', async () => {
    addSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 403 }))
    const { user } = await renderDialog()
    await fill(user, field(/^name/i), 'Sam Ortiz')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    expect(await screen.findByTestId('add-participant-error'))
      .toHaveTextContent('You don\'t have access to add participants.')
  })

  it('clears the server message once the user edits a field', async () => {
    const { user } = await renderDialog()
    await fill(user, field(/^name/i), 'Someone Else')
    await fill(user, field(/^sign-in name/i), 'dwhitfield')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    await screen.findByTestId('add-participant-error')

    await user.type(field(/^sign-in name/i), '2')

    expect(screen.queryByTestId('add-participant-error')).not.toBeInTheDocument()
  })
})

describe('AddParticipantDialog — closing', () => {
  it('Cancel asks the owner to close', async () => {
    const { user, onClose } = await renderDialog()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape asks the owner to close', async () => {
    const { user, onClose } = await renderDialog()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('reopening starts from a blank form', async () => {
    const { user, rerender } = await renderDialog()
    await fill(user, field(/^name/i), 'Half Typed')
    rerender(<AddParticipantDialog open={false} onClose={vi.fn()} onAdded={vi.fn()} />)
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    rerender(<AddParticipantDialog open onClose={vi.fn()} onAdded={vi.fn()} />)
    await screen.findByRole('dialog', { name: 'Add participant' })
    expect(field(/^name/i)).toHaveValue('')
  })
})

describe('AddParticipantDialog — one request at a time (Gate-1 W3)', () => {
  const CREATED: RosterEntryDto = {
    id: 'new-1',
    name: 'Riley Chen',
    signInName: 'rchen',
    exerciseRole: 'participant',
    link: { status: 'active', useCount: 0 },
    access: 'enabled',
    liveSessions: 0,
    createdAt: '2026-10-13T12:30:00.000Z',
  }

  async function startPendingAdd() {
    const gate = deferred<RosterEntryDto>()
    addSpy.mockReturnValueOnce(gate.promise)
    const view = await renderDialog()
    await fill(view.user, field(/^name/i), 'Riley Chen')
    const form = screen.getByRole('dialog', { name: 'Add participant' }).querySelector('form')
    if (form === null) throw new Error('no form')
    return { ...view, gate, form }
  }

  it('a double submit in the same tick sends ONE request', async () => {
    const { gate, form, onAdded } = await startPendingAdd()

    // Two submits before React has rendered `pending`: only the in-flight ref can stop #2.
    fireEvent.submit(form)
    fireEvent.submit(form)

    await waitFor(() => expect(addSpy).toHaveBeenCalledTimes(1))
    gate.resolve(CREATED)
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(addSpy).toHaveBeenCalledTimes(1)
  })

  it('Enter pressed twice quickly sends ONE request', async () => {
    const { gate, user, onAdded } = await startPendingAdd()
    field(/^name/i).focus()

    await user.keyboard('{Enter}{Enter}')

    await waitFor(() => expect(addSpy).toHaveBeenCalledTimes(1))
    gate.resolve(CREATED)
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
  })

  it('the guard is released after a failure, so the retry goes through', async () => {
    addSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 500 }))
    const { user, onAdded } = await renderDialog()
    await fill(user, field(/^name/i), 'Riley Chen')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    await screen.findByTestId('add-participant-error')

    await user.click(screen.getByRole('button', { name: 'Add participant' }))

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
    expect(addSpy).toHaveBeenCalledTimes(2)
  })

  it('cannot be closed mid-request: Escape, a backdrop click and Cancel all do nothing', async () => {
    const { gate, user, onClose, onAdded } = await startPendingAdd()
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled())

    await user.keyboard('{Escape}')
    const backdrop = document.querySelector('.MuiBackdrop-root')
    if (backdrop === null) throw new Error('no backdrop')
    fireEvent.click(backdrop)
    fireEvent.mouseDown(backdrop)

    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Add participant' })).toBeInTheDocument()

    gate.resolve(CREATED)
    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1))
  })

  it('closes again as normal once the request has settled', async () => {
    addSpy.mockRejectedValueOnce(new rosterService.RosterError('x', { status: 500 }))
    const { user, onClose } = await renderDialog()
    await fill(user, field(/^name/i), 'Riley Chen')
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    await screen.findByTestId('add-participant-error')

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
