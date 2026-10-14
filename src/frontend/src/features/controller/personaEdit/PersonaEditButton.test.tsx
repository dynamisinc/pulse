/**
 * features/controller/personaEdit/PersonaEditButton.test.tsx
 * ---------------------------------------------------------------------------
 * Story 21 / PE-FE (demo-polish; docs/features/demo-polish/21-persona-profile-edit.md)
 * — the frontend acceptance criteria, end to end through the REAL providers, the
 * REAL hooks (`usePersonaEdit`, `useMediaUpload`, `useStaffPersonas`/`usePersonas`)
 * and the MOCK adapter (which edits the mock persona directory):
 *
 *  AC "Dialog"
 *   - a COBRA dialog with display name, bio (counter), location, a Verified
 *     checkbox with the helper text "Changes the trust mark participants see"
 *     (state also in words), avatar/banner choosers (upload via `useMediaUpload`,
 *     or pick from the library) with an image preview; the handle is read-only;
 *   - Save is disabled while invalid, while uploading, while saving, and while
 *     nothing changed — always with the reason written beside it; errors are
 *     visible (the server's sentence, verbatim); focus is trapped and returns to
 *     the button; turning Verified on/off asks for confirmation (SOC-052);
 *   - text is never truncated (lone-surrogate hazard): the limit is shown instead.
 *  AC "Refresh and telemetry"
 *   - on success the dialog closes, `invalidatePersonas()` is called, the active
 *     persona snapshot is refreshed (`selectPersona(updated)`), the staff AND
 *     participant persona reads show the edit, and EXACTLY ONE `steering_action`
 *     (`payload { action: 'persona_edit', fields }`, `target { persona, id }`,
 *     acting human) is emitted — field NAMES only; a failure does none of that.
 *  Merge-patch: only changed fields are sent; `null` clears; nothing echoed.
 *
 * The library picker (C1's `MediaLibraryPicker`) is replaced by a props-contract
 * fake, so these tests exercise the FROZEN contract (§1.11), not C1's DOM. Uploads
 * go through the shared `fakeMediaUploader`.
 */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { uploadPickedMedia } from '@/core/media/uploadMedia'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { SEEDED_PERSONAS, type StaffPersona } from '@/features/personas'
import { invalidatePersonas } from '@/features/personas/personaService'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { SAVED_NOTE_MS } from './PersonaEditButton'
import { renderPersonaEdit } from './PersonaEditHarness.testUtils'
import { resetMockPersonaEdits } from './personaEditMock'
import { PERSONA_EDIT_ERROR_TEXT, PersonaEditError, patchPersona } from './personaEditService'

vi.mock('@/core/media/uploadMedia', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media/uploadMedia')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

vi.mock('@/features/personas/personaService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/personas/personaService')>()
  return { ...actual, invalidatePersonas: vi.fn(actual.invalidatePersonas) }
})

vi.mock('./personaEditService', async importOriginal => {
  const actual = await importOriginal<typeof import('./personaEditService')>()
  return { ...actual, patchPersona: vi.fn(actual.patchPersona) }
})

// A props-contract fake of C1's picker (implementation.md §1.11).
vi.mock('./libraryPicker', async () => {
  const { createElement } = await import('react')
  interface FakePickerProps {
    kind?: string
    max: number
    selectedIds: string[]
    onChange(ids: string[]): void
  }
  const pick = (label: string, ids: string[], onChange: (ids: string[]) => void) =>
    createElement('button', { type: 'button', key: label, onClick: () => onChange(ids) }, label)
  return {
    MediaLibraryPicker: ({ kind, max, selectedIds, onChange }: FakePickerProps) =>
      createElement(
        'div',
        {
          'data-testid': 'fake-picker',
          'data-kind': kind ?? '',
          'data-max': String(max),
          'data-selected': selectedIds.join(','),
        },
        pick('pick flood', ['mock-media-canned-flood'], onChange),
        pick('pick plant', ['mock-media-canned-plant'], onChange),
        pick('pick video', ['mock-media-canned-video'], onChange),
        pick('pick flood then plant', ['mock-media-canned-flood', 'mock-media-canned-plant'], onChange),
        pick('pick nothing', [], onChange),
      ),
  }
})

const mockedPatch = vi.mocked(patchPersona)
const mockedInvalidate = vi.mocked(invalidatePersonas)
const mockedUpload = vi.mocked(uploadPickedMedia)

const WATER_ID = 'persona-fairhavenwater' // verified; has avatar + banner; no location
const TOM_ID = 'persona-tbrandt41' // unverified; no avatar, banner or location
const FLOOD_URL = '/mock-media/photos/flood-main-street.svg'
const PLANT_URL = '/mock-media/photos/water-plant.svg'

function seeded(id: string): StaffPersona {
  const found = SEEDED_PERSONAS.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`no seeded persona ${id}`)
  return found
}

let uploader: FakeUploader

beforeEach(() => {
  resetMockPersonaEdits()
  resetTelemetryBuffer()
  mockedInvalidate.mockClear()
  mockedPatch.mockClear()
  uploader = installFakeUploader(mockedUpload)
})

afterEach(() => {
  resetMockPersonaEdits()
  vi.restoreAllMocks()
})

/** Opens the dialog from the button. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId('persona-edit-button'))
  return screen.findByRole('dialog', { name: 'Edit persona' })
}

const field = (label: RegExp | string) => screen.getByLabelText(label)
const saveButton = () => screen.getByRole('button', { name: /^Sav(e|ing…)$/ })
const personaEditEvents = () =>
  getEmittedTelemetryEvents().filter(event => event.eventType === 'steering_action')

async function typeInto(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp | string,
  text: string,
) {
  const input = field(label)
  await user.clear(input)
  await user.type(input, text)
}

/** The last `patchPersona(personaId, patch)` call's patch. */
function lastPatch(): unknown {
  return mockedPatch.mock.calls.at(-1)?.[1]
}

describe('the dialog (AC "Dialog")', () => {
  it('opens a labelled dialog from the "Edit persona" button; the handle is read-only; nothing is changed yet', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByTestId('persona-edit-button')).toHaveTextContent('Edit persona')
    expect(screen.getByTestId('persona-edit-button')).toHaveAttribute('aria-haspopup', 'dialog')

    const dialog = await openDialog(user)
    expect(within(dialog).getByLabelText(/display name/i)).toHaveValue('Fairhaven Water Utility')
    expect(within(dialog).getByLabelText(/^bio/i)).toHaveValue(seeded(WATER_ID).bio)
    expect(within(dialog).getByLabelText(/^location/i)).toHaveValue('')
    expect(within(dialog).getByRole('checkbox', { name: /verified/i })).toBeChecked()

    const handle = within(dialog).getByLabelText(/^handle/i)
    expect(handle).toHaveValue('@FairhavenWater')
    expect(handle).toHaveAttribute('readonly')

    // Nothing to save yet — and it says why.
    expect(saveButton()).toBeDisabled()
    expect(screen.getByTestId('persona-edit-save-hint')).toHaveTextContent('No changes to save.')
    expect(saveButton()).toHaveAccessibleDescription('No changes to save.')
  })

  it('puts focus on the display name when it opens', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    expect(field(/display name/i)).toHaveFocus()
  })

  it('Verified has the helper text "Changes the trust mark participants see" and states its effect in words', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)

    const checkbox = screen.getByRole('checkbox', { name: /verified/i })
    expect(screen.getByText('Changes the trust mark participants see')).toBeInTheDocument()
    expect(checkbox).toHaveAccessibleDescription('Changes the trust mark participants see')
    expect(screen.getByTestId('persona-edit-verified-state')).toHaveTextContent(
      'Participants currently see the verified seal on this account.',
    )
  })

  it('shows a live bio counter (n/512), a limit message and a disabled Save when over — and NEVER truncates', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)

    const bio = field(/^bio/i)
    expect(screen.getByTestId('persona-edit-bio-counter')).toHaveTextContent(
      `${(seeded(TOM_ID).bio ?? '').length}/512`,
    )

    await user.clear(bio)
    await user.click(bio)
    await user.paste('x'.repeat(520))
    expect(screen.getByTestId('persona-edit-bio-counter')).toHaveTextContent('520/512')
    expect(screen.getByText('Bio must be at most 512 characters (8 over).')).toBeInTheDocument()
    expect(bio).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton()).toBeDisabled()
    expect(screen.getByTestId('persona-edit-save-hint')).toHaveTextContent('Fix the highlighted fields to save.')
    // The paste was kept whole (no maxLength, no slice).
    expect(bio).toHaveValue('x'.repeat(520))
    expect(bio).not.toHaveAttribute('maxlength')

    await user.clear(bio)
    await user.click(bio)
    await user.paste('x'.repeat(512))
    expect(screen.getByTestId('persona-edit-bio-counter')).toHaveTextContent('512/512')
    expect(saveButton()).toBeEnabled()
  })

  it('counts like the SERVER (UTF-16 units): an emoji is TWO; hints say so; a half-emoji is refused', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    const bio = field(/^bio/i)
    expect(within(screen.getByRole('dialog')).getAllByText(/Emoji count as 2\./)).toHaveLength(3)

    fireEvent.change(bio, { target: { value: '😀'.repeat(3) } })
    expect(screen.getByTestId('persona-edit-bio-counter')).toHaveTextContent('6/512')
    expect(saveButton()).toBeEnabled()

    // 256 emoji fill the 512-unit bio exactly; 257 do not.
    fireEvent.change(bio, { target: { value: '😀'.repeat(256) } })
    expect(screen.getByTestId('persona-edit-bio-counter')).toHaveTextContent('512/512')
    expect(saveButton()).toBeEnabled()
    fireEvent.change(bio, { target: { value: '😀'.repeat(257) } })
    expect(screen.getByTestId('persona-edit-bio-counter')).toHaveTextContent('514/512')
    expect(screen.getByText('Bio must be at most 512 characters (2 over).')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    // A display name of 60 waves is 120 units: refused client-side.
    fireEvent.change(bio, { target: { value: 'fine' } })
    fireEvent.change(field(/display name/i), { target: { value: '🌊'.repeat(60) } })
    expect(screen.getByTestId('persona-edit-name-counter')).toHaveTextContent('120/100')
    expect(screen.getByText('Display name must be at most 100 characters (20 over).'))
      .toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    fireEvent.change(field(/display name/i), { target: { value: 'Tom Brandt' } })
    fireEvent.change(bio, { target: { value: '' } })

    fireEvent.change(bio, { target: { value: `half ${'😀'.charAt(0)}` } })
    expect(screen.getByText(/Bio contains a broken character/)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('blocks Save and says why for: empty name, 101-char name, 101-char location', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)

    const name = field(/display name/i)
    await user.clear(name)
    expect(screen.getByText('Display name is required.')).toBeInTheDocument()
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton()).toBeDisabled()

    fireEvent.change(name, { target: { value: 'n'.repeat(101) } })
    expect(screen.getByText('Display name must be at most 100 characters (1 over).')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(name, { target: { value: 'Fine name' } })
    expect(saveButton()).toBeEnabled()

    fireEvent.change(field(/^location/i), { target: { value: 'l'.repeat(101) } })
    expect(screen.getByText('Location must be at most 100 characters (1 over).')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
  })

  it('refuses what the server refuses: control characters, bidi overrides, an invisible name', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)

    const name = field(/display name/i)
    fireEvent.change(name, { target: { value: 'a\u0000b' } })
    expect(screen.getByText(/Display name can't contain control characters/)).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(name, { target: { value: 'evil\u202Ename' } })
    expect(screen.getByText(/Display name can't contain text-direction override characters/))
      .toBeInTheDocument()

    fireEvent.change(name, { target: { value: '\u200B\u200B' } })
    expect(screen.getByText('Display name needs at least one visible character.')).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()

    fireEvent.change(name, { target: { value: 'Fаirhаven Wаter' } }) // lookalike: allowed
    expect(saveButton()).toBeEnabled()
  })

  it('discards an unsaved draft on cancel — reopening starts from the persona again', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Half-typed edit')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedPatch).not.toHaveBeenCalled()

    await openDialog(user)
    expect(field(/display name/i)).toHaveValue('Fairhaven Water Utility')
    expect(saveButton()).toBeDisabled()
  })
})

describe('keyboard and focus (the console is fully keyboard-operable)', () => {
  it('traps Tab inside the dialog', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    const dialog = await openDialog(user)
    for (let step = 0; step < 24; step += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
    for (let step = 0; step < 24; step += 1) {
      await user.tab({ shift: true })
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    }
  })

  it('Cancel returns focus to the Edit persona button', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('persona-edit-button')).toHaveFocus()
  })

  it('Esc closes the dialog and returns focus to the button', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('persona-edit-button')).toHaveFocus()
  })

  it('the button opens from the keyboard (Enter)', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    screen.getByTestId('persona-edit-button').focus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
  })

  it('Enter in a single-line field saves; Ctrl+Enter saves from the bio', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt{Enter}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ displayName: 'Thomas Brandt' })

    await openDialog(user)
    await typeInto(user, /^bio/i, 'Saved from the bio{Control>}{Enter}{/Control}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ bio: 'Saved from the bio' })
    expect(mockedPatch).toHaveBeenCalledTimes(2)
  })
})

describe('success (AC "Refresh and telemetry")', () => {
  it('sends ONLY the changed fields, closes, invalidates, refreshes the active persona and emits exactly one event', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await typeInto(user, /^bio/i, 'A brand new bio')

    expect(saveButton()).toBeEnabled()
    await user.click(saveButton())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // The merge-patch: only the two changed members, nothing echoed.
    expect(mockedPatch).toHaveBeenCalledTimes(1)
    expect(mockedPatch.mock.calls[0]?.[0]).toBe(TOM_ID)
    expect(lastPatch()).toEqual({ displayName: 'Thomas Brandt', bio: 'A brand new bio' })

    // The persona reads are invalidated ...
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
    // ... the active-persona snapshot is refreshed ...
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      id: TOM_ID,
      displayName: 'Thomas Brandt',
      bio: 'A brand new bio',
    })
    // ... and the STAFF and PARTICIPANT directories both show the edit.
    await waitFor(() => expect(screen.getByTestId('staff-directory')).toHaveTextContent('Thomas Brandt|false'))
    await waitFor(() =>
      expect(screen.getByTestId('participant-directory')).toHaveTextContent('Thomas Brandt|false'))

    // Exactly ONE steering_action, names only.
    const events = personaEditEvents()
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: 'steering_action',
      channel: 'system',
      exerciseId: 'ex-mock-0001',
      actor: { kind: 'system', actingHumanId: 'human-controller-01', role: 'controller' },
      target: { entityType: 'persona', entityId: TOM_ID },
      payload: { action: 'persona_edit', fields: ['displayName', 'bio'] },
    })
    expect(JSON.stringify(events[0]?.payload)).not.toMatch(/Thomas|brand new/)

    // Focus is back on the button, and the outcome is stated.
    expect(screen.getByTestId('persona-edit-button')).toHaveFocus()
    expect(screen.getByTestId('persona-edit-saved')).toHaveTextContent('Saved')
  })

  it('clears a bio and a location with null (never ""), and reports the field names', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.clear(field(/^bio/i))
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(lastPatch()).toEqual({ bio: null })
    expect(personaEditEvents().map(event => event.payload)).toEqual([
      { action: 'persona_edit', fields: ['bio'] },
    ])
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({ bio: null })
  })

  it('"Saved" is announced in a polite status region and goes away on its own', async () => {
    const timeouts = vi.spyOn(globalThis, 'setTimeout')
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    // The live region exists BEFORE there is anything to announce.
    expect(screen.getByTestId('persona-edit-saved')).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('persona-edit-saved')).toBeEmptyDOMElement()
    await openDialog(user)
    await typeInto(user, /^location/i, 'Fairhaven')
    await user.click(saveButton())
    await waitFor(() => expect(screen.getByTestId('persona-edit-saved')).toHaveTextContent('Saved'))
    expect(screen.getByTestId('persona-edit-saved')).toHaveAttribute('role', 'status')

    const expire = timeouts.mock.calls.filter(call => call[1] === SAVED_NOTE_MS).at(-1)?.[0]
    expect(expire).toBeTypeOf('function')
    act(() => (expire as () => void)())
    expect(screen.getByTestId('persona-edit-saved')).toBeEmptyDOMElement()
  })

  it('does not yank the console to this persona if the controller has switched to another meanwhile', async () => {
    const user = userEvent.setup()
    const other = seeded('persona-fulcoem')
    await renderPersonaEdit(seeded(TOM_ID), { activePersona: other })
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      id: other.id,
      displayName: 'Fulton County EM',
    })
    // The edit itself still happened and was audited.
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
    expect(personaEditEvents()).toHaveLength(1)
  })

  it('does NOT switch the console to the edited persona when none is active (L-7)', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID), { activePersona: null })
    expect(screen.getByTestId('active-persona')).toHaveTextContent('none')
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    // The console is left exactly as it was: still operating as nobody ...
    expect(screen.getByTestId('active-persona')).toHaveTextContent('none')
    // ... but the edit landed, the lists were re-read, and it was audited once.
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
    expect(personaEditEvents()).toHaveLength(1)
    await waitFor(() => expect(screen.getByTestId('staff-directory')).toHaveTextContent('Thomas Brandt'))
  })
})

describe('saving state', () => {
  it('disables Save and Cancel, ignores Esc and a second click while the request is in flight', async () => {
    let finish: (updated: StaffPersona) => void = () => undefined
    mockedPatch.mockImplementationOnce(
      () => new Promise<StaffPersona>(resolve => {
        finish = resolve
      }),
    )
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.click(saveButton())

    expect(saveButton()).toBeDisabled()
    expect(saveButton()).toHaveTextContent('Saving…')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByTestId('persona-edit-save-hint')).toHaveTextContent('Saving…')

    await user.keyboard('{Escape}')
    fireEvent.submit(screen.getByRole('dialog', { name: 'Edit persona' }))
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(mockedPatch).toHaveBeenCalledTimes(1)
    // The text inputs stay focusable but read-only while saving.
    expect(field(/display name/i)).toHaveAttribute('readonly')

    await act(async () => {
      finish({ ...seeded(TOM_ID), displayName: 'Thomas Brandt' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(personaEditEvents()).toHaveLength(1)
  })
})

describe('failure (visible, verbatim, nothing half-done)', () => {
  it('shows the server\'s 400 sentence VERBATIM, keeps the dialog and every edit, and does none of the success work', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Renamed Utility')

    // A video as the avatar passes the picker but not the server.
    await user.click(
      within(screen.getByTestId('persona-edit-avatar')).getByRole('button', {
        name: /choose from library/i,
      }),
    )
    await user.click(screen.getByRole('button', { name: 'pick video' }))
    await user.click(saveButton())

    const error = await screen.findByTestId('persona-edit-error-text')
    expect(error).toHaveTextContent(
      'avatarMediaId must name an image in this exercise, or be null to clear it.',
    )
    expect(error.textContent).toBe(
      'avatarMediaId must name an image in this exercise, or be null to clear it.',
    )
    expect(screen.getByTestId('persona-edit-error')).toHaveAttribute('role', 'alert')
    expect(screen.getByTestId('persona-edit-error')).toHaveTextContent('Not saved.')

    // Still open, edits intact, retry one keypress away.
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(field(/display name/i)).toHaveValue('Renamed Utility')
    expect(saveButton()).toBeEnabled()
    expect(saveButton()).toHaveFocus()

    // None of the success work happened.
    expect(mockedInvalidate).not.toHaveBeenCalled()
    expect(personaEditEvents()).toHaveLength(0)
    expect(screen.getByTestId('persona-edit-saved')).toBeEmptyDOMElement()
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      displayName: 'Fairhaven Water Utility',
    })
    expect(seeded(WATER_ID).displayName).toBe('Fairhaven Water Utility')

    // Fixing the cause and saving again works, and clears the banner: ONE event in total.
    await user.click(screen.getByRole('button', { name: /undo avatar change/i }))
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ displayName: 'Renamed Utility' })
    expect(personaEditEvents()).toHaveLength(1)
  })

  it('shows the server\'s sentence for a text refusal too (e.g. a display name the server rejects)', async () => {
    mockedPatch.mockRejectedValueOnce(
      new PersonaEditError('rejected', 'displayName must be 1 to 100 characters.', { status: 400 }),
    )
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.click(saveButton())
    expect(await screen.findByTestId('persona-edit-error-text')).toHaveTextContent(
      'displayName must be 1 to 100 characters.',
    )
  })

  it.each([
    ['401', new PersonaEditError('unauthenticated', PERSONA_EDIT_ERROR_TEXT.unauthenticated, { status: 401 })],
    ['403', new PersonaEditError('forbidden', PERSONA_EDIT_ERROR_TEXT.forbidden, { status: 403 })],
    ['404', new PersonaEditError('notFound', PERSONA_EDIT_ERROR_TEXT.notFound, { status: 404 })],
    ['5xx', new PersonaEditError('server', PERSONA_EDIT_ERROR_TEXT.server(503), { status: 503 })],
    ['network', new PersonaEditError('network', PERSONA_EDIT_ERROR_TEXT.network)],
  ])('%s: clear staff copy in the alert, nothing else happens', async (_label, failure) => {
    mockedPatch.mockRejectedValueOnce(failure)
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.click(saveButton())

    expect(await screen.findByTestId('persona-edit-error-text')).toHaveTextContent(failure.message)
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(mockedInvalidate).not.toHaveBeenCalled()
    expect(personaEditEvents()).toHaveLength(0)
  })

  it('a 2xx the console cannot read: says so, re-syncs the persona lists, but selects and emits nothing', async () => {
    mockedPatch.mockRejectedValueOnce(
      new PersonaEditError('malformed', PERSONA_EDIT_ERROR_TEXT.malformed, { mayHaveSaved: true }),
    )
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.click(saveButton())

    expect(await screen.findByTestId('persona-edit-error-text')).toHaveTextContent(
      PERSONA_EDIT_ERROR_TEXT.malformed,
    )
    expect(mockedInvalidate).toHaveBeenCalledTimes(1)
    expect(personaEditEvents()).toHaveLength(0)
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      displayName: 'Tom Brandt',
    })
  })
})

describe('Verified — a trust signal participants see (SOC-052): flipping it asks first', () => {
  const confirmDialog = (name: RegExp) => screen.findByRole('dialog', { name })

  it('turning it OFF: confirm text names the consequence; Cancel changes nothing and returns focus to the checkbox', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    const checkbox = screen.getByRole('checkbox', { name: /verified/i })

    await user.click(checkbox)
    const confirm = await confirmDialog(/turn the verified mark off for @FairhavenWater/i)
    expect(within(confirm).getByText(/no longer see the verified seal/i)).toBeInTheDocument()
    expect(within(confirm).getByText(/reaches participants when you save/i)).toBeInTheDocument()
    // Nothing changed yet.
    expect(checkbox).toBeChecked()

    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /verified mark/i })).not.toBeInTheDocument())
    expect(checkbox).toBeChecked()
    expect(saveButton()).toBeDisabled()
    expect(checkbox).toHaveFocus()
    // The edit dialog underneath is still open.
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
  })

  it('turning it OFF and confirming sends { verified: false } on Save', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    const confirm = await confirmDialog(/turn the verified mark off/i)
    const turnOff = within(confirm).getByRole('button', { name: 'Turn verified OFF' })
    expect(turnOff).toHaveFocus()
    await user.click(turnOff)

    await waitFor(() => expect(screen.queryByRole('dialog', { name: /verified mark/i })).not.toBeInTheDocument())
    expect(screen.getByRole('checkbox', { name: /verified/i })).not.toBeChecked()
    expect(screen.getByTestId('persona-edit-verified-state')).toHaveTextContent(
      'After you save, participants will see no verified seal on this account.',
    )
    // Not sent until Save.
    expect(mockedPatch).not.toHaveBeenCalled()
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(lastPatch()).toEqual({ verified: false })
    expect(personaEditEvents().map(event => event.payload)).toEqual([
      { action: 'persona_edit', fields: ['verified'] },
    ])
    await waitFor(() => expect(screen.getByTestId('participant-directory')).toHaveTextContent('|false'))
  })

  it('turning it ON asks too, with its own wording', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    const confirm = await confirmDialog(/turn the verified mark on for @tbrandt41/i)
    expect(within(confirm).getByText(/will see the verified seal next to this account/i))
      .toBeInTheDocument()
    await user.click(within(confirm).getByRole('button', { name: 'Turn verified ON' }))
    await waitFor(() => expect(screen.getByRole('checkbox', { name: /verified/i })).toBeChecked())
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ verified: true })
    await waitFor(() => expect(screen.getByTestId('participant-directory')).toHaveTextContent('|true'))
  })

  it('Esc closes only the confirmation, not the edit dialog beneath it', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await confirmDialog(/turn the verified mark on/i)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /verified mark/i })).not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /verified/i })).not.toBeChecked()
  })
})

describe('avatar and banner — upload', () => {
  const avatarGroup = () => screen.getByTestId('persona-edit-avatar')
  const avatarFile = () => screen.getByTestId('persona-edit-avatar-file')

  it('uploads through useMediaUpload: progress bar, Save disabled meanwhile, preview, then sends the new media id', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    // The staff DTO cannot tell "no avatar" from "its URL could not be signed" — so the copy
    // does not claim either, and Remove stays available (L-3).
    expect(within(avatarGroup()).getByTestId('persona-edit-avatar-status')).toHaveTextContent(
      'No avatar image available — none is set, or its preview could not be loaded.',
    )
    expect(within(avatarGroup()).getByRole('button', { name: /remove avatar/i })).toBeEnabled()

    await user.upload(avatarFile(), fakeFile('portrait.png', 'image/png'))
    await waitFor(() => expect(uploader.pending).toHaveLength(1))

    const bar = await within(avatarGroup()).findByRole('progressbar', { name: 'Uploading avatar' })
    expect(bar).toBeInTheDocument()
    expect(saveButton()).toBeDisabled()
    expect(screen.getByTestId('persona-edit-save-hint')).toHaveTextContent(
      'Waiting for the image upload to finish.',
    )
    // Another valid edit does not enable Save mid-upload.
    await typeInto(user, /display name/i, 'Thomas Brandt')
    expect(saveButton()).toBeDisabled()

    act(() => uploader.byName('portrait.png').progress(0.5))
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'))

    let asset = { id: '' }
    act(() => {
      asset = uploader.byName('portrait.png').resolve({ url: PLANT_URL })
    })
    await waitFor(() => expect(saveButton()).toBeEnabled())
    expect(within(avatarGroup()).queryByRole('progressbar')).not.toBeInTheDocument()
    expect(within(avatarGroup()).getByRole('img', { name: 'Avatar preview for @tbrandt41' }))
      .toHaveAttribute('src', PLANT_URL)
    expect(within(avatarGroup()).getByTestId('persona-edit-avatar-status')).toHaveTextContent(
      'New image selected — takes effect when you save.',
    )

    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ displayName: 'Thomas Brandt', avatarMediaId: asset.id })
    expect(personaEditEvents().map(event => event.payload)).toEqual([
      { action: 'persona_edit', fields: ['displayName', 'avatarMediaId'] },
    ])
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      avatarUrl: PLANT_URL,
    })
  })

  it('only accepts images in the file input, and refuses a video before uploading', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    expect(avatarFile()).toHaveAttribute('accept', 'image/jpeg,image/png,image/gif,image/webp')

    await user.upload(avatarFile(), fakeFile('clip.mp4', 'video/mp4'))
    expect(await within(avatarGroup()).findByRole('alert')).toHaveTextContent(
      'The avatar must be an image — JPEG, PNG, GIF or WebP.',
    )
    expect(uploader.pending).toHaveLength(0)
    expect(saveButton()).toBeDisabled()
  })

  it('shows the client-side size / type message and never starts the upload', async () => {
    const user = userEvent.setup({ applyAccept: false })
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.upload(avatarFile(), fakeFile('huge.png', 'image/png', 6 * 1024 * 1024))
    expect(await within(avatarGroup()).findByRole('alert')).toHaveTextContent(
      'That image is too large (5 MB max).',
    )
    await user.upload(avatarFile(), fakeFile('notes.txt', 'text/plain'))
    expect(await within(avatarGroup()).findByRole('alert')).toHaveTextContent(/isn't supported/)
    expect(uploader.pending).toHaveLength(0)
  })

  it('Cancel upload aborts it and re-evaluates Save', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.upload(avatarFile(), fakeFile('portrait.png', 'image/png'))
    await within(avatarGroup()).findByRole('progressbar')
    expect(saveButton()).toBeDisabled()

    await user.click(within(avatarGroup()).getByRole('button', { name: /cancel upload/i }))
    await waitFor(() => expect(within(avatarGroup()).queryByRole('progressbar')).not.toBeInTheDocument())
    expect(uploader.byName('portrait.png').aborted).toBe(true)
    expect(saveButton()).toBeEnabled()
    // A cancel is a choice, not an error.
    expect(within(avatarGroup()).queryByRole('alert')).toBeEmptyDOMElement()
  })

  it('a failed upload is shown as an error, leaves the avatar unchanged and does not block Save forever', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt')
    await user.upload(avatarFile(), fakeFile('portrait.png', 'image/png'))
    await within(avatarGroup()).findByRole('progressbar')

    act(() => uploader.byName('portrait.png').fail(new Error('That upload was not accepted.')))
    expect(await within(avatarGroup()).findByRole('alert')).toHaveTextContent('That upload was not accepted.')
    expect(within(avatarGroup()).getByTestId('persona-edit-avatar-status'))
      .toHaveTextContent('No avatar image available')
    expect(saveButton()).toBeEnabled()
  })

  it('uploads a banner independently of the avatar', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.upload(screen.getByTestId('persona-edit-banner-file'), fakeFile('wide.jpg', 'image/jpeg'))
    await waitFor(() => expect(uploader.pending).toHaveLength(1))
    expect(within(screen.getByTestId('persona-edit-banner')).getByRole('progressbar', { name: 'Uploading banner' }))
      .toBeInTheDocument()
    expect(within(avatarGroup()).queryByRole('progressbar')).not.toBeInTheDocument()
    let asset = { id: '' }
    act(() => {
      asset = uploader.byName('wide.jpg').resolve({ url: FLOOD_URL })
    })
    await waitFor(() => expect(saveButton()).toBeEnabled())
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ bannerMediaId: asset.id })
  })
})

describe('avatar and banner — library (C1\'s MediaLibraryPicker, frozen props)', () => {
  const bannerGroup = () => screen.getByTestId('persona-edit-banner')
  const openLibrary = async (user: ReturnType<typeof userEvent.setup>, group: HTMLElement) => {
    await user.click(within(group).getByRole('button', { name: /choose from library/i }))
  }

  it('mounts the picker with kind="image", max=1 and the current selection; picking previews and sends the id', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    const group = screen.getByTestId('persona-edit-avatar')
    const toggle = within(group).getByRole('button', { name: /choose from library/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('fake-picker')).not.toBeInTheDocument()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const picker = screen.getByTestId('fake-picker')
    expect(picker).toHaveAttribute('data-kind', 'image')
    expect(picker).toHaveAttribute('data-max', '1')
    expect(picker).toHaveAttribute('data-selected', '')

    await user.click(screen.getByRole('button', { name: 'pick flood' }))
    // The picker closes once something is picked, and the preview shows the asset.
    expect(screen.queryByTestId('fake-picker')).not.toBeInTheDocument()
    expect(within(group).getByRole('img', { name: 'Avatar preview for @tbrandt41' }))
      .toHaveAttribute('src', FLOOD_URL)

    // Reopening hands the picker the current selection.
    await user.click(toggle)
    expect(screen.getByTestId('fake-picker')).toHaveAttribute('data-selected', 'mock-media-canned-flood')
    await user.click(screen.getByRole('button', { name: 'pick flood then plant' }))
    // With max = 1 a picker may return [previous, next]: the NEW one wins.
    expect(within(group).getByRole('img', { name: /preview/i })).toHaveAttribute('src', PLANT_URL)

    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ avatarMediaId: 'mock-media-canned-plant' })
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      avatarUrl: PLANT_URL,
    })
  })

  it('deselecting in the picker reverts to "keep"', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    const group = screen.getByTestId('persona-edit-avatar')
    await openLibrary(user, group)
    await user.click(screen.getByRole('button', { name: 'pick flood' }))
    expect(saveButton()).toBeEnabled()
    await openLibrary(user, group)
    await user.click(screen.getByRole('button', { name: 'pick nothing' }))
    expect(within(group).getByTestId('persona-edit-avatar-status'))
      .toHaveTextContent('No avatar image available')
    expect(saveButton()).toBeDisabled()
  })

  it('banner and avatar are chosen independently', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await openLibrary(user, screen.getByTestId('persona-edit-avatar'))
    await user.click(screen.getByRole('button', { name: 'pick flood' }))
    await openLibrary(user, bannerGroup())
    await user.click(screen.getByRole('button', { name: 'pick plant' }))
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({
      avatarMediaId: 'mock-media-canned-flood',
      bannerMediaId: 'mock-media-canned-plant',
    })
  })

  it('Remove sends null and is undoable; a persona with an image shows its current preview', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    const group = screen.getByTestId('persona-edit-avatar')
    expect(within(group).getByTestId('persona-edit-avatar-status')).toHaveTextContent('Current image.')
    expect(within(group).getByRole('img', { name: /avatar preview/i })).toHaveAttribute(
      'src',
      '/mock-media/avatars/fairhavenwater.svg',
    )

    await user.click(within(group).getByRole('button', { name: /remove avatar/i }))
    expect(within(group).getByTestId('persona-edit-avatar-status')).toHaveTextContent(
      'Image will be removed when you save.',
    )
    expect(within(group).queryByRole('img')).not.toBeInTheDocument()
    expect(saveButton()).toBeEnabled()

    await user.click(within(group).getByRole('button', { name: /undo avatar change/i }))
    expect(within(group).getByTestId('persona-edit-avatar-status')).toHaveTextContent('Current image.')
    expect(saveButton()).toBeDisabled()

    await user.click(within(group).getByRole('button', { name: /remove avatar/i }))
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ avatarMediaId: null })
    expect(personaEditEvents().map(event => event.payload)).toEqual([
      { action: 'persona_edit', fields: ['avatarMediaId'] },
    ])
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      avatarUrl: null,
    })
  })

  it('refuses to preview a URL that fails the media allow-list (shows the text placeholder instead)', async () => {
    const user = userEvent.setup()
    const hostile: StaffPersona = { ...seeded(WATER_ID), avatarUrl: 'javascript:alert(1)' }
    await renderPersonaEdit(hostile)
    await openDialog(user)
    const group = screen.getByTestId('persona-edit-avatar')
    expect(within(group).queryByRole('img')).not.toBeInTheDocument()
    expect(group.querySelector('img')).toBeNull()
  })
})

describe('dismissing a dialog that holds unsaved work (Gate-1 L-2)', () => {
  const backdrop = () => {
    const container = document.querySelector('.MuiDialog-container')
    if (!(container instanceof HTMLElement)) throw new Error('no dialog container')
    return container
  }
  const discardDialog = () => screen.findByRole('dialog', { name: 'Discard your changes?' })

  it('a CLEAN dialog still closes on a backdrop click and on Esc', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(backdrop())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('persona-edit-button')).toHaveFocus()

    await openDialog(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).not.toBeInTheDocument()
  })

  it('a backdrop click does NOT close a dirty dialog, and does not even ask', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Half-typed edit')

    await user.click(backdrop())

    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).not.toBeInTheDocument()
    expect(field(/display name/i)).toHaveValue('Half-typed edit')
  })

  it('Esc on a dirty dialog ASKS first; "Keep editing" (the default) returns to the draft intact', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Half-typed edit')

    await user.keyboard('{Escape}')
    const ask = await discardDialog()
    expect(within(ask).getByText(/unsaved changes to @FairhavenWater/i)).toBeInTheDocument()
    expect(within(ask).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Edit persona', hidden: true })).toBeInTheDocument()

    await user.keyboard('{Enter}') // the focused default: keep editing
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard your changes?' }))
      .not.toBeInTheDocument())
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(field(/display name/i)).toHaveValue('Half-typed edit')
    expect(mockedPatch).not.toHaveBeenCalled()
  })

  it('Esc inside the question closes only the question', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Half-typed edit')
    await user.keyboard('{Escape}')
    await discardDialog()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Discard your changes?' }))
      .not.toBeInTheDocument())
    expect(field(/display name/i)).toHaveValue('Half-typed edit')
  })

  it('"Discard changes" throws the draft away: nothing sent, focus back on the button, next open is fresh', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Half-typed edit')
    await user.keyboard('{Escape}')
    const ask = await discardDialog()

    await user.click(within(ask).getByRole('button', { name: 'Discard changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedPatch).not.toHaveBeenCalled()
    expect(personaEditEvents()).toHaveLength(0)
    expect(screen.getByTestId('persona-edit-button')).toHaveFocus()
    await openDialog(user)
    expect(field(/display name/i)).toHaveValue('Fairhaven Water Utility')
  })

  it('an edit typed back to the original is clean again: Esc closes without asking', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Something else')
    await typeInto(user, /display name/i, 'Fairhaven Water Utility')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('dialog', { name: 'Discard your changes?' })).not.toBeInTheDocument()
  })

  it('an upload in flight counts as unsaved work: Esc asks, backdrop is ignored', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.upload(screen.getByTestId('persona-edit-avatar-file'), fakeFile('p.png', 'image/png'))
    await within(screen.getByTestId('persona-edit-avatar')).findByRole('progressbar')

    await user.click(backdrop())
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await discardDialog()
  })
})

describe('the console\'s global chords stay out of the dialogs (Gate-1 M-2)', () => {
  // What ControllerConsole does: a window keydown listener toggles the command palette.
  let palette: Mock<() => void>
  const onWindowKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') palette()
  }
  beforeEach(() => {
    palette = vi.fn()
    window.addEventListener('keydown', onWindowKeyDown)
  })
  afterEach(() => {
    window.removeEventListener('keydown', onWindowKeyDown)
  })

  it('baseline: Ctrl+K on the page reaches the console listener', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    screen.getByTestId('persona-edit-button').focus()
    await user.keyboard('{Control>}k{/Control}')
    expect(palette).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+K and Cmd+K typed in the edit dialog never reach it (no palette behind the modal)', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)

    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('{Meta>}K{/Meta}')
    expect(palette).not.toHaveBeenCalled()
    // ... and the browser's own Ctrl+K is cancelled too.
    expect(fireEvent.keyDown(field(/display name/i), { key: 'k', ctrlKey: true })).toBe(false)
    expect(palette).not.toHaveBeenCalled()
    // Other keys are untouched.
    expect(fireEvent.keyDown(field(/display name/i), { key: 'j', ctrlKey: true })).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
  })

  // Gate-1 M-2r: MUI parks focus on `.MuiDialog-container` (the form's PARENT) whenever the
  // focused control unmounts or is disabled, and a key pressed there never passes through the
  // form. The guard therefore lives on the Dialog ROOT.
  const dialogContainer = () => {
    const container = document.querySelector('.MuiDialog-container')
    if (!(container instanceof HTMLElement)) throw new Error('no dialog container')
    return container
  }

  it('Ctrl+K is swallowed with focus PARKED on the dialog container, not only inside the form', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)

    dialogContainer().focus()
    expect(dialogContainer()).toHaveFocus()
    await user.keyboard('{Control>}k{/Control}')
    await user.keyboard('{Meta>}k{/Meta}')

    expect(palette).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(dialogContainer(), { key: 'k', ctrlKey: true })).toBe(false)
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
  })

  it('Ctrl+K stays swallowed right after Remove avatar, and while a save is in flight', async () => {
    let finish: (updated: StaffPersona) => void = () => undefined
    mockedPatch.mockImplementationOnce(
      () => new Promise<StaffPersona>(resolve => {
        finish = resolve
      }),
    )
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)

    await user.click(
      within(screen.getByTestId('persona-edit-avatar')).getByRole('button', { name: /remove avatar/i }),
    )
    await user.keyboard('{Control>}k{/Control}')
    expect(palette).not.toHaveBeenCalled()

    // Saving disables the focused Save button, so focus is parked again.
    await user.click(saveButton())
    expect(saveButton()).toBeDisabled()
    dialogContainer().focus()
    await user.keyboard('{Control>}k{/Control}')
    expect(palette).not.toHaveBeenCalled()

    await act(async () => {
      finish({ ...seeded(WATER_ID) })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('... nor from the Verified confirmation or the discard question', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(screen.getByRole('checkbox', { name: /verified/i }))
    await screen.findByRole('dialog', { name: /verified mark/i })
    await user.keyboard('{Control>}k{/Control}')
    expect(palette).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /verified mark/i }))
      .not.toBeInTheDocument())

    await typeInto(user, /display name/i, 'Half-typed edit')
    await user.keyboard('{Escape}')
    await screen.findByRole('dialog', { name: 'Discard your changes?' })
    await user.keyboard('{Control>}k{/Control}')
    expect(palette).not.toHaveBeenCalled()
  })
})

describe('Enter on the Verified checkbox (Gate-1 L-6)', () => {
  it('does not submit the form: it neither saves nor flips the mark', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await typeInto(user, /display name/i, 'Thomas Brandt') // dirty and valid: Save is enabled
    expect(saveButton()).toBeEnabled()

    const checkbox = screen.getByRole('checkbox', { name: /verified/i })
    checkbox.focus()
    await user.keyboard('{Enter}')

    expect(mockedPatch).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Edit persona' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: /verified mark/i })).not.toBeInTheDocument()
    expect(checkbox).not.toBeChecked()
    // Space still toggles it (and asks).
    await user.keyboard(' ')
    expect(await screen.findByRole('dialog', { name: /verified mark/i })).toBeInTheDocument()
  })
})

describe('Remove does not depend on the preview URL (Gate-1 L-3)', () => {
  it('a persona whose avatar URL is missing (signing failed) still offers Remove and sends null', async () => {
    const user = userEvent.setup()
    const { avatarUrl: _signingFailed, ...withoutUrl } = seeded(WATER_ID)
    expect(withoutUrl).not.toHaveProperty('avatarUrl')
    await renderPersonaEdit(withoutUrl)
    await openDialog(user)

    const group = screen.getByTestId('persona-edit-avatar')
    // Honest copy: it does not claim "none is set".
    expect(within(group).getByTestId('persona-edit-avatar-status')).toHaveTextContent(
      'No avatar image available — none is set, or its preview could not be loaded.',
    )
    await user.click(within(group).getByRole('button', { name: /remove avatar/i }))
    expect(within(group).getByTestId('persona-edit-avatar-status')).toHaveTextContent(
      'Image will be removed when you save.',
    )
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    expect(lastPatch()).toEqual({ avatarMediaId: null })
    expect(personaEditEvents().map(event => event.payload)).toEqual([
      { action: 'persona_edit', fields: ['avatarMediaId'] },
    ])
    // The image really was cleared on the (mock) server.
    expect(seeded(WATER_ID)).not.toHaveProperty('avatarUrl')
  })

  it('offers Remove for the banner too', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    const group = screen.getByTestId('persona-edit-banner')
    expect(within(group).getByTestId('persona-edit-banner-status')).toHaveTextContent(
      'No banner image available — none is set, or its preview could not be loaded.',
    )
    await user.click(within(group).getByRole('button', { name: /remove banner/i }))
    await user.click(saveButton())
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(lastPatch()).toEqual({ bannerMediaId: null })
  })
})

describe('a cancelled upload is never applied (ImageChooser race)', () => {
  it('a response that lands in the same tick as Cancel is dropped', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    const group = screen.getByTestId('persona-edit-avatar')
    await user.upload(screen.getByTestId('persona-edit-avatar-file'), fakeFile('late.png', 'image/png'))
    await within(group).findByRole('progressbar')
    const cancel = within(group).getByRole('button', { name: /cancel upload/i })

    // The request finishes and Cancel is pressed in the same tick.
    act(() => {
      uploader.byName('late.png').resolve({ url: PLANT_URL })
      fireEvent.click(cancel)
    })

    await waitFor(() => expect(within(group).queryByRole('progressbar')).not.toBeInTheDocument())
    expect(within(group).queryByRole('img')).not.toBeInTheDocument()
    expect(within(group).getByTestId('persona-edit-avatar-status'))
      .toHaveTextContent('No avatar image available')
    expect(saveButton()).toBeDisabled() // nothing was chosen
  })

  it('a second upload supersedes the first: only the newest result is applied', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    const group = screen.getByTestId('persona-edit-avatar')
    await user.upload(screen.getByTestId('persona-edit-avatar-file'), fakeFile('one.png', 'image/png'))
    await within(group).findByRole('progressbar')
    await user.click(within(group).getByRole('button', { name: /cancel upload/i }))
    await user.upload(screen.getByTestId('persona-edit-avatar-file'), fakeFile('two.png', 'image/png'))
    await waitFor(() => expect(uploader.pending).toHaveLength(2))
    await within(group).findByRole('progressbar')

    act(() => {
      uploader.byName('one.png').resolve({ url: FLOOD_URL }) // the cancelled one answers late
    })
    act(() => {
      uploader.byName('two.png').resolve({ url: PLANT_URL })
    })
    expect(await within(group).findByRole('img', { name: /avatar preview/i }))
      .toHaveAttribute('src', PLANT_URL)
  })
})

describe('focus continuity in the image chooser (Gate-1 L-focus)', () => {
  const group = (slot: 'avatar' | 'banner' = 'avatar') => screen.getByTestId(`persona-edit-${slot}`)
  const remove = (slot: 'avatar' | 'banner' = 'avatar') =>
    within(group(slot)).getByRole('button', { name: new RegExp(`remove ${slot}`, 'i') })
  const undo = (slot: 'avatar' | 'banner' = 'avatar') =>
    within(group(slot)).getByRole('button', { name: new RegExp(`undo ${slot} change`, 'i') })

  it('Remove -> focus moves to Undo (the Remove button is gone)', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)

    await user.click(remove())

    expect(within(group()).queryByRole('button', { name: /remove avatar/i })).not.toBeInTheDocument()
    expect(undo()).toHaveFocus()
    expect(group().contains(document.activeElement)).toBe(true)
  })

  it('Undo -> focus moves back to Remove', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(remove())
    expect(undo()).toHaveFocus()

    await user.click(undo())

    expect(remove()).toHaveFocus()
    expect(within(group()).queryByRole('button', { name: /undo avatar change/i })).not.toBeInTheDocument()
  })

  it('a library pick (the picker closes) -> focus moves to Undo', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.click(within(group()).getByRole('button', { name: /choose from library/i }))
    await user.click(screen.getByRole('button', { name: 'pick flood' }))

    expect(screen.queryByTestId('fake-picker')).not.toBeInTheDocument()
    expect(undo()).toHaveFocus()
  })

  it('works for the banner too', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(WATER_ID))
    await openDialog(user)
    await user.click(remove('banner'))
    expect(undo('banner')).toHaveFocus()
    await user.click(undo('banner'))
    expect(remove('banner')).toHaveFocus()
  })

  it('Cancel upload (the Cancel button is gone) -> focus returns to "Upload image…"', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.upload(screen.getByTestId('persona-edit-avatar-file'), fakeFile('p.png', 'image/png'))
    await within(group()).findByRole('progressbar')

    await user.click(within(group()).getByRole('button', { name: /cancel upload/i }))

    await waitFor(() => expect(within(group()).queryByRole('progressbar')).not.toBeInTheDocument())
    expect(within(group()).getByRole('button', { name: /upload image/i })).toHaveFocus()
  })

  it('a finished upload -> focus moves to Undo ...', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.upload(screen.getByTestId('persona-edit-avatar-file'), fakeFile('p.png', 'image/png'))
    await within(group()).findByRole('progressbar')

    act(() => {
      uploader.byName('p.png').resolve({ url: PLANT_URL })
    })

    await waitFor(() => expect(undo()).toHaveFocus())
  })

  it('... but never steals focus from a field the controller moved to while it uploaded', async () => {
    const user = userEvent.setup()
    await renderPersonaEdit(seeded(TOM_ID))
    await openDialog(user)
    await user.upload(screen.getByTestId('persona-edit-avatar-file'), fakeFile('p.png', 'image/png'))
    await within(group()).findByRole('progressbar')
    await user.click(field(/^location/i))
    expect(field(/^location/i)).toHaveFocus()

    act(() => {
      uploader.byName('p.png').resolve({ url: PLANT_URL })
    })

    await waitFor(() => expect(within(group()).getByRole('img', { name: /preview/i })).toBeInTheDocument())
    expect(field(/^location/i)).toHaveFocus()
  })
})
