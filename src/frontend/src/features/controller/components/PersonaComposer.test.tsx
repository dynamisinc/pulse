/**
 * features/controller/components/PersonaComposer.test.tsx
 * ---------------------------------------------------------------------------
 * Covers persona-operation/01's acceptance criteria for the Controller
 * Console's `<PersonaComposer>` (CTL-001, COR-018, COR-053, SOC-003, R-003):
 *  - a controller composes text and publishes AS the supplied `activePersona`,
 *    which routes through `composeAsPersona`/`createPost` with
 *    `origin: 'controller-as-persona'` — clearing the draft and firing
 *    `onPublished` with the created `Post`;
 *  - the staff-only console origin line reads `SIMCELL · MANUAL` (via the
 *    shipped `originConsoleLabel`), alongside the operating controller's call
 *    sign (COR-018) — never participant-visible;
 *  - the persona identity header renders the active persona (name/handle/seal);
 *  - the scenario instant stamped on the published post is the injected
 *    exercise-clock instant, never wall-clock (COR-053).
 *
 * Renders through the REAL `ExerciseContextProvider` (resolves via the shared
 * axios dev mock adapter) and swaps in a fixed exercise clock so the scenario
 * instant is deterministic. `activePersona` + `actingHumanId` + `callSign` are
 * PROPS (Wave-1 inputs-not-imports contract) — no sibling feature is imported.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import type { Persona } from '@/features/personas'
import type { Post } from '@/features/social'
import { PersonaComposer } from './PersonaComposer'

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

const ACTIVE_PERSONA: Persona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-mock-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

async function renderComposer(children: ReactNode) {
  // Staff world: the console lives under the root COBRA <ThemeProvider>, so the
  // Cobra* components need it here too (they read theme.palette.buttonPrimary).
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>{children}</ExerciseContextProvider>
    </ThemeProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('persona-composer')).toBeInTheDocument())
  return utils
}

beforeEach(() => {
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
})

describe('PersonaComposer — publish as the active persona (CTL-001)', () => {
  it('publishes typed text as the persona, clears the draft, and fires onPublished', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
        onPublished={onPublished}
      />,
    )

    const input = screen.getByLabelText('Post text')
    const postButton = screen.getByRole('button', { name: 'Post' })
    expect(postButton).toBeDisabled()

    await user.type(input, 'Zones 2-4 are now clear.')
    expect(postButton).toBeEnabled()

    await user.click(postButton)

    expect(onPublished).toHaveBeenCalledTimes(1)
    const post = onPublished.mock.calls[0]?.[0]
    expect(post?.text).toBe('Zones 2-4 are now clear.')
    expect(post?.authorPersonaId).toBe('persona-fairhavenwater')
    expect(post?.origin).toBe('controller-as-persona')
    expect(post?.actingHumanId).toBe('human-ctl-7')
    // Draft cleared.
    expect(input).toHaveValue('')
    expect(postButton).toBeDisabled()
  })
})

describe('PersonaComposer — staff-only origin line (R-003, SOC-003)', () => {
  it('surfaces the SIMCELL · MANUAL origin line with the operating call sign after firing', async () => {
    const user = userEvent.setup()
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
      />,
    )

    // Not shown until something is fired.
    expect(screen.queryByTestId('origin-line')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText('Post text'), 'Official update.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    expect(screen.getByTestId('origin-label')).toHaveTextContent('SIMCELL · MANUAL')
    expect(screen.getByTestId('origin-line')).toHaveTextContent('SIMCELL-3')
  })
})

describe('PersonaComposer — identity + scenario time (R-001/R-004, COR-053)', () => {
  it('renders the active persona identity header (name/handle/seal)', async () => {
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
      />,
    )

    const identity = screen.getByTestId('persona-identity')
    expect(identity).toHaveTextContent('Fairhaven Water')
    expect(identity).toHaveTextContent('@FairhavenWater')
    // Verified persona shows the canonical seal.
    expect(screen.getByTestId('verified-mark')).toBeInTheDocument()
  })

  it('stamps the published post with the injected scenario instant, never wall-clock', async () => {
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
        onPublished={onPublished}
      />,
    )

    await user.type(screen.getByLabelText('Post text'), 'Advisory update.')
    await user.click(screen.getByRole('button', { name: 'Post' }))

    const post = onPublished.mock.calls[0]?.[0]
    expect(post?.scenarioTime).toBe('2031-03-01T14:00:00.000Z')
  })

  it('does not render the verified seal for an unverified persona (SOC-052)', async () => {
    const unverifiedPersona: Persona = { ...ACTIVE_PERSONA, verified: false }
    await renderComposer(
      <PersonaComposer
        activePersona={unverifiedPersona}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
      />,
    )

    expect(screen.getByTestId('persona-identity')).toHaveTextContent('Fairhaven Water')
    expect(screen.queryByTestId('verified-mark')).not.toBeInTheDocument()
  })

  it('never shows the operating controller identity inside the persona identity header', async () => {
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
      />,
    )

    // R-001/R-004: the identity header is who the WORLD sees. The operator's
    // call sign / acting-human id belong only in the fire control / origin
    // line (asserted elsewhere), never here alongside the persona's own name.
    const identity = screen.getByTestId('persona-identity')
    expect(identity).not.toHaveTextContent('SIMCELL-3')
    expect(identity).not.toHaveTextContent('human-ctl-7')
  })
})

describe('PersonaComposer — dual-time fire control never conflates the two clocks (COR-053)', () => {
  it('renders the scenario reading from the injected exercise clock and a differently-sourced wall reading', async () => {
    // Fixed scenario instant far from "now" (the real wall-clock, ~2026) so a
    // regression that wired the WALL·UTC readout to scenarioNow() instead of
    // wallClockNowIso() would leak "2031" into the wall reading too.
    setExerciseClock(fixedClock(new Date('2031-03-01T14:00:00.000Z')))
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
      />,
    )

    const scenarioReading = screen.getByTestId('dual-time-scenario')
    const wallReading = screen.getByTestId('dual-time-wall')

    expect(scenarioReading).toHaveTextContent('2031')
    expect(wallReading).not.toHaveTextContent('2031')
    // The wall-clock reading is a bare UTC HH:MM:SSZ clock face.
    expect(wallReading.textContent).toMatch(/^\d{2}:\d{2}:\d{2}Z$/)
  })
})

describe('PersonaComposer — over-length draft blocks publish (SOC-001 char limit)', () => {
  it('disables Post and flags the counter as over-limit once the draft exceeds charLimit', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
        charLimit={10}
        onPublished={onPublished}
      />,
    )

    await user.type(screen.getByLabelText('Post text'), 'This is way over the ten-char limit')

    const counter = screen.getByTestId('char-counter')
    expect(counter).toHaveAttribute('data-state', 'over')
    expect(counter).toHaveAccessibleName(/characters over the limit/i)
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(onPublished).not.toHaveBeenCalled()
  })
})

describe('PersonaComposer — keyboard-first fire (NFR-001, CTL-001 quick-fire)', () => {
  it('publishes on Ctrl+Enter without clicking the Post button', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    await renderComposer(
      <PersonaComposer
        activePersona={ACTIVE_PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
        onPublished={onPublished}
      />,
    )

    const input = screen.getByLabelText('Post text')
    await user.type(input, 'Fire via keyboard.')
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onPublished.mock.calls[0]?.[0]?.text).toBe('Fire via keyboard.')
  })
})
