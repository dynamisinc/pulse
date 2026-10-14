/**
 * features/controller/personaEdit/PersonaEditButton.liveShape.test.tsx
 * ---------------------------------------------------------------------------
 * The save flow end to end against a body shaped EXACTLY like the real server's
 * (demo-polish story 21 / PE-FE, Gate-1 H-1).
 *
 * The mock adapter returns a seeded mock persona, which has a template id — so
 * every mock-mode test passed while a LIVE save on any seeded persona failed: the
 * server answers with `StaffPersonaResponseDto.FromPersona`, whose `templateId` is
 * the EMPTY STRING for a persona without a template (the whole demo cast,
 * `PersonaCastSeeder` creates them template-less), and which OMITS `bio` /
 * `avatarUrl` / `bannerUrl` / `location` when null. The old parser demanded a
 * non-empty `templateId`, so the console showed "could not read" after a save that
 * had succeeded — no active-persona refresh, no telemetry.
 *
 * Here the per-request mock adapter is replaced by a stand-in SERVER that applies
 * the merge-patch and answers in that exact wire shape; the rest — `patchPersona`,
 * the parser, `usePersonaEdit`, the dialog — is the real thing. A save must close
 * the dialog, refresh the active persona from the body, and emit ONE
 * `steering_action`.
 */
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { SEEDED_PERSONAS } from '@/features/personas'
import { renderPersonaEdit } from './PersonaEditHarness.testUtils'

const TOM_ID = 'persona-tbrandt41'

vi.mock('./personaEditMock', async importOriginal => {
  const actual = await importOriginal<typeof import('./personaEditMock')>()
  // A tiny stand-in server: the persona as `FromPersona` would project it for a
  // template-less, image-less persona, with the merge-patch applied.
  const state: { displayName: string; bio: string | null; verified: boolean } = {
    displayName: 'Tom Brandt',
    bio: 'Small business owner. Coffee, dogs, local sports.',
    verified: false,
  }
  const serverShaped: AxiosAdapter = config => {
    const patch = JSON.parse(typeof config.data === 'string' ? config.data : '{}') as Record<
      string,
      unknown
    >
    if (typeof patch.displayName === 'string') state.displayName = patch.displayName
    if (patch.bio === null) state.bio = null
    else if (typeof patch.bio === 'string') state.bio = patch.bio
    if (typeof patch.verified === 'boolean') state.verified = patch.verified
    return Promise.resolve({
      data: {
        id: 'persona-tbrandt41',
        exerciseId: 'ex-mock-0001',
        templateId: '', // <- the template-less persona: an EMPTY STRING, not a template id
        displayName: state.displayName,
        handle: 'tbrandt41',
        kind: 'human',
        personaType: 'citizen',
        verified: state.verified,
        avatarColor: '#0CA678',
        initials: 'TB',
        ...(state.bio !== null ? { bio: state.bio } : {}), // omitted when null
        audienceBand: 'nano',
        followerCount: 0,
        audienceMagnitude: 0,
        followingCount: 0,
        joinedAt: '2033-08-01T00:00:00.000Z',
        // no avatarUrl / bannerUrl / location keys: omitted when null (WhenWritingNull)
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    })
  }
  return { ...actual, personaPatchMockAdapter: serverShaped }
})

beforeEach(() => {
  resetTelemetryBuffer()
})

describe('saving against the real server\'s response shape (templateId "")', () => {
  it('closes, refreshes the active persona from the body, and emits exactly one steering_action', async () => {
    const user = userEvent.setup()
    const tom = SEEDED_PERSONAS.find(persona => persona.id === TOM_ID)
    if (tom === undefined) throw new Error('seeded persona missing')
    await renderPersonaEdit(tom)

    await user.click(screen.getByTestId('persona-edit-button'))
    await screen.findByRole('dialog', { name: 'Edit persona' })
    const name = screen.getByLabelText(/display name/i)
    await user.clear(name)
    await user.type(name, 'Thomas Brandt')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // NOT "could not read": the dialog closes and the outcome is "Saved".
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.queryByTestId('persona-edit-error-text')).not.toBeInTheDocument()
    expect(screen.getByTestId('persona-edit-saved')).toHaveTextContent('Saved')

    // selectPersona(updated) ran with the SERVER's body.
    expect(JSON.parse(screen.getByTestId('active-persona').textContent ?? '')).toMatchObject({
      id: TOM_ID,
      displayName: 'Thomas Brandt',
    })

    // Exactly one audit event, names only.
    const events = getEmittedTelemetryEvents().filter(
      event => event.eventType === 'steering_action',
    )
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      target: { entityType: 'persona', entityId: TOM_ID },
      payload: { action: 'persona_edit', fields: ['displayName'] },
    })
  })

  it('clearing the bio (the key then OMITTED from the response) also saves', async () => {
    const user = userEvent.setup()
    const tom = SEEDED_PERSONAS.find(persona => persona.id === TOM_ID)
    if (tom === undefined) throw new Error('seeded persona missing')
    await renderPersonaEdit(tom)

    await user.click(screen.getByTestId('persona-edit-button'))
    await screen.findByRole('dialog', { name: 'Edit persona' })
    await user.clear(screen.getByLabelText(/^bio/i))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const active: Record<string, unknown> = JSON.parse(
      screen.getByTestId('active-persona').textContent ?? '',
    )
    expect(active.bio).toBeNull()
    expect(
      getEmittedTelemetryEvents().filter(event => event.eventType === 'steering_action'),
    ).toHaveLength(1)
  })
})
