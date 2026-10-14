/* eslint-disable react-refresh/only-export-components --
   test-only harness: it defines two probe components next to the render helper, and is
   never part of a Fast Refresh boundary (the rule is already off for *.test.tsx). */
/**
 * features/controller/personaEdit/PersonaEditHarness.testUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY render harness for the persona profile edit (demo-polish story 21 /
 * PE-FE). Never imported by app code.
 *
 * Mounts the REAL providers the console supplies — the COBRA theme, a fresh React
 * Query client (the media library reads through it), the real
 * `ExerciseContextProvider`, and an `ActivePersonaProvider` — around a persona
 * edit button, plus three probes the tests read:
 *
 *   - `active-persona`       the console's ACTIVE persona snapshot (`useActivePersona`);
 *   - `staff-directory`      `useStaffPersonas()`'s view of the persona (the console picker);
 *   - `participant-directory` `usePersonas()`'s view (the participant feed's author lookup).
 *
 * The probes are plain render output (the one initial `selectPersona` runs in a
 * LAYOUT effect, never a passive one), so what an assertion reads right after
 * `findBy*` is the same commit — the #412 CI-flake class.
 */

import type { ReactNode } from 'react'
import { useLayoutEffect } from 'react'
import { render, screen, waitFor, type RenderResult } from '@testing-library/react'
import { expect } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { MEDIA_LIBRARY_QUERY_KEY, resolveMediaLibrary } from '@/core/media'
import { useStaffPersonas, usePersonas, type StaffPersona } from '@/features/personas'
import { ActivePersonaProvider, useActivePersona } from '../hooks/useActivePersona'
import { PersonaEditButton } from './PersonaEditButton'

/** The mock exercise the test providers resolve to. */
export const TEST_EXERCISE_ID = 'ex-mock-0001'

function ActivePersonaProbe({ initial }: { readonly initial: StaffPersona | null }) {
  const { activePersona, selectPersona } = useActivePersona()
  useLayoutEffect(() => {
    if (initial !== null) selectPersona(initial)
  }, [initial, selectPersona])
  return (
    <output data-testid="active-persona">
      {activePersona === null
        ? 'none'
        : JSON.stringify({
          id: activePersona.id,
          displayName: activePersona.displayName,
          bio: activePersona.bio ?? null,
          location: activePersona.location ?? null,
          verified: activePersona.verified,
          avatarUrl: activePersona.avatarUrl ?? null,
        })}
    </output>
  )
}

function DirectoryProbe({ personaId }: { readonly personaId: string }) {
  const staff = useStaffPersonas()
  const participant = usePersonas()
  const staffEntry = staff.personas.find(entry => entry.id === personaId)
  const participantEntry = participant.personas.find(entry => entry.id === personaId)
  return (
    <>
      <output data-testid="staff-directory">
        {staffEntry === undefined ? 'loading' : `${staffEntry.displayName}|${staffEntry.verified}`}
      </output>
      <output data-testid="participant-directory">
        {participantEntry === undefined
          ? 'loading'
          : `${participantEntry.displayName}|${participantEntry.verified}`}
      </output>
    </>
  )
}

export interface PersonaEditHarnessOptions {
  /** The persona the console is operating as (default: `persona`). `null` = none selected. */
  readonly activePersona?: StaffPersona | null
  /** Extra children rendered inside the providers. */
  readonly children?: ReactNode
}

export interface PersonaEditHarness extends RenderResult {
  readonly queryClient: QueryClient
}

/** Renders `<PersonaEditButton persona>` in the console providers, awaiting the exercise scope. */
export async function renderPersonaEdit(
  persona: StaffPersona,
  options: PersonaEditHarnessOptions = {},
): Promise<PersonaEditHarness> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Prime the image library so the picker-lookup of a preview URL never races the click.
  queryClient.setQueryData(
    [...MEDIA_LIBRARY_QUERY_KEY, TEST_EXERCISE_ID, 'image'],
    await resolveMediaLibrary('image'),
  )
  const active = options.activePersona === undefined ? persona : options.activePersona

  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <ActivePersonaProvider>
            <ActivePersonaProbe initial={active} />
            <DirectoryProbe personaId={persona.id} />
            <PersonaEditButton persona={persona} />
            {options.children}
          </ActivePersonaProvider>
        </ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('persona-edit-button')).toBeInTheDocument())
  await waitFor(() => expect(screen.getByTestId('staff-directory')).not.toHaveTextContent('loading'))
  return Object.assign(utils, { queryClient })
}
