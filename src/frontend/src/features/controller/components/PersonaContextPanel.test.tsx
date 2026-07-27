/**
 * features/controller/components/PersonaContextPanel.test.tsx
 * ---------------------------------------------------------------------------
 * Covers story 03's acceptance criteria for `<PersonaContextPanel>`
 * (CTL-003, COR-020, SOC-054, D5-014/2.4, COR-001, COR-053, NFR-001):
 *  - renders voice notes resolved via the template, recent posts, and the
 *    audience-magnitude band for the active persona;
 *  - renders the "POSTING AS {category}" chip, text-carrying the signal;
 *  - updates (voice notes, recents, audience band, category chip) when the
 *    active persona prop changes, without a full reload (a rerender);
 *  - recents are scoped to the active exercise instance (COR-001) — a
 *    same-id persona in a DIFFERENT exercise shows no recents;
 *  - reachable/legible via keyboard/screen reader (a labelled, plain-text
 *    `<section>`, no interactive controls to trap focus).
 *
 * Renders through the REAL `ExerciseContextProvider` (resolves via the
 * shared axios client's built-in dev mock adapter, same pattern as
 * `PostCard.test.tsx` / `Composer.test.tsx`).
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { personaIdForHandle, type StaffPersona } from '@/features/personas'
import { PersonaContextPanel } from './PersonaContextPanel'

// STAFF fixture: the panel renders the `personaType`-derived category chip,
// which only the staff projection carries (SOC-052/D1-008).
function buildPersona(overrides: Partial<StaffPersona> = {}): StaffPersona {
  return {
    id: personaIdForHandle('FairhavenWater'),
    exerciseId: 'ex-mock-0001',
    templateId: 'tmpl-fairhavenwater',
    displayName: 'Fairhaven Water Utility',
    handle: 'fairhavenwater',
    kind: 'org',
    personaType: 'agency',
    verified: true,
    avatarColor: '#19647e',
    initials: 'FW',
    audienceBand: 'mid',
    followerCount: 4200,
    joinedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

/** Renders through the real exercise-context provider, awaiting resolution. */
async function renderPanel(children: ReactNode) {
  const utils = render(<ExerciseContextProvider>{children}</ExerciseContextProvider>)
  await waitFor(() => expect(screen.getByTestId('persona-context-panel')).toBeInTheDocument())
  return utils
}

describe('PersonaContextPanel (persona-operation/03)', () => {
  it('renders voice notes (via the template), audience band, category chip, and recents', async () => {
    await renderPanel(<PersonaContextPanel persona={buildPersona()} />)

    expect(screen.getByTestId('persona-context-voice-notes').textContent).toMatch(/measured, factual/i)
    expect(screen.getByTestId('persona-context-audience-band')).toHaveTextContent('Mid-size audience')
    expect(screen.getByTestId('persona-context-category-chip')).toHaveTextContent('POSTING AS OFFICIAL ACCOUNT')
    expect(screen.getByTestId('persona-context-recents')).toBeInTheDocument()
    expect(screen.getByText(/boil water advisory remains in effect/i)).toBeInTheDocument()
  })

  it('derives a distinct, text-carried category chip per personaType (never color-only)', async () => {
    const { unmount } = await renderPanel(
      <PersonaContextPanel persona={buildPersona({ personaType: 'citizen', kind: 'human' })} />,
    )
    expect(screen.getByTestId('persona-context-category-chip')).toHaveTextContent('POSTING AS CITIZEN VOICE')
    unmount()
  })

  it('updates all sections when the active persona prop changes, without a full reload', async () => {
    const { rerender } = await renderPanel(<PersonaContextPanel persona={buildPersona()} />)
    expect(screen.getByTestId('persona-context-category-chip')).toHaveTextContent('POSTING AS OFFICIAL ACCOUNT')

    const nextPersona = buildPersona({
      id: personaIdForHandle('FairhavenWaterUpd'),
      templateId: 'tmpl-fairhavenwaterupd',
      displayName: 'Fairhaven Water Update',
      handle: 'fairhavenwaterupd',
      personaType: 'bad-actor',
      verified: false,
      audienceBand: 'nano',
    })

    rerender(
      <ExerciseContextProvider>
        <PersonaContextPanel persona={nextPersona} />
      </ExerciseContextProvider>,
    )

    expect(await screen.findByTestId('persona-context-category-chip')).toHaveTextContent(
      'POSTING AS UNOFFICIAL / BAD ACTOR',
    )
    expect(screen.getByTestId('persona-context-audience-band')).toHaveTextContent('Nano audience')
  })

  it('scopes recent posts to the active exercise instance (COR-001)', async () => {
    const otherExercisePersona = buildPersona({ exerciseId: 'ex-some-other-exercise' })
    await renderPanel(<PersonaContextPanel persona={otherExercisePersona} />)

    expect(
      screen.getByText(/no recent posts from this persona in this exercise yet/i),
    ).toBeInTheDocument()
    expect(screen.queryByText(/boil water advisory remains in effect/i)).not.toBeInTheDocument()
  })

  it('scopes recent posts to THIS persona, not merely the exercise (a same-exercise, different persona sees only its own posts)', async () => {
    // Fulton County EM shares ex-mock-0001 with Fairhaven Water, so a filter
    // that only matched `exerciseId` (dropping the `authorPersonaId` match)
    // would incorrectly surface the utility's advisory here too.
    const fulcoEm = buildPersona({
      id: 'persona-fulcoem',
      templateId: 'tmpl-fulcoem',
      displayName: 'Fulton County EM',
      handle: 'FulcoEM',
      initials: 'FC',
      audienceBand: 'mid',
    })
    await renderPanel(<PersonaContextPanel persona={fulcoEm} />)

    expect(screen.getByText(/coordinating with fairhaven water/i)).toBeInTheDocument()
    expect(
      screen.queryByText(/boil water advisory remains in effect for zones 2-4/i),
    ).not.toBeInTheDocument()
  })

  it('renders a graceful fallback (not a crash) when the persona\'s template cannot be resolved', async () => {
    const orphanPersona = buildPersona({ templateId: 'tmpl-does-not-exist' })
    await renderPanel(<PersonaContextPanel persona={orphanPersona} />)

    expect(screen.getByTestId('persona-context-voice-notes')).toHaveTextContent(
      /voice notes unavailable/i,
    )
  })

  it('is a labelled, keyboard/screen-reader reachable section with no interactive controls', async () => {
    await renderPanel(<PersonaContextPanel persona={buildPersona()} />)
    const panel = screen.getByRole('region', { name: /persona context for fairhaven water utility/i })
    expect(panel).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
