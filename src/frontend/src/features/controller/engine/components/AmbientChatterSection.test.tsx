/**
 * features/controller/engine/components/AmbientChatterSection.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the "Ambient chatter" section of the engine settings flyout (#168,
 * AC2) end to end through the REAL panel + `useEngineSettings` store +
 * `engineSettingsActions` service:
 *  - the saved mode renders as TEXT + ICON (NFR-001);
 *  - Save POSTs `/engine/settings/ambient-policy` with the right body
 *    (`actingHumanId`, `timeZone`, mode, caps, allow-lists; no exerciseId);
 *  - a 400 on `autonomous` shows the PROVIDER-GOVERNANCE §8 message and keeps
 *    the previous mode; `review` stays available;
 *  - empty allow-lists read "Nothing allowed";
 *  - mock mode (`USE_MOCK_DATA=true`) works with no network, and rejects
 *    `autonomous` while the mock policy is unauthorized.
 *
 * `@/core/services/api` is mocked (no network); the persona list and the
 * controller gate are fixed.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import {
  engineSettingsStore,
  MOCK_ENGINE_SETTINGS,
  type EngineSettingsDto,
} from '../hooks/useEngineSettings'
import {
  AMBIENT_AUTONOMOUS_NOT_AUTHORIZED_MESSAGE,
  type AmbientPolicyDto,
} from '../models/ambientPolicyContract'
import { EngineSettingsPanel } from './EngineSettingsPanel'

vi.mock('@/features/controller/access/useCanControl', () => ({ useCanControl: () => true }))

vi.mock('@/features/personas', () => ({
  useStaffPersonas: () => ({
    personas: [
      { id: 'p-1', displayName: 'Dana Reyes', handle: '@dana' },
      { id: 'p-2', displayName: 'Mo Okafor', handle: '@mo' },
    ],
    loading: false,
    error: null,
  }),
}))

const postMock = vi.fn()
const getMock = vi.fn()
vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
  },
}))

const flags = vi.hoisted(() => ({ useMockData: false }))
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return flags.useMockData
  },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'Test Exercise',
    timeZone: 'America/New_York',
    status: 'active',
  }),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: () => ({
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
  }),
}))

const EXERCISE_ID = 'ex-mock-0001'

function policy(overrides: Partial<AmbientPolicyDto> = {}): AmbientPolicyDto {
  return {
    mode: 'off',
    maxPerMinute: 2,
    maxPerHour: 30,
    topicAllowList: [],
    personaAllowList: [],
    ...overrides,
  }
}

function dto(ambientPolicy: AmbientPolicyDto = policy()): EngineSettingsDto {
  return { ...MOCK_ENGINE_SETTINGS, ambientPolicy }
}

function axios400(body: unknown): AxiosError {
  const error = new AxiosError('Request failed', '400')
  error.response = {
    status: 400,
    statusText: 'Bad Request',
    data: body,
    headers: {},
    config: { headers: new AxiosHeaders() },
  }
  return error
}

function renderPanel() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <EngineSettingsPanel open onClose={vi.fn()} />
    </ThemeProvider>,
  )
}

beforeEach(() => {
  flags.useMockData = false
  postMock.mockReset()
  getMock.mockReset()
  engineSettingsStore.resetForTests()
})

afterEach(() => {
  engineSettingsStore.resetForTests()
})

describe('Ambient chatter section (live mode)', () => {
  it('renders the saved mode as text plus an icon, and the reset-on-restart note', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'review' })))
    renderPanel()

    const status = await screen.findByTestId('ambient-mode-status')
    expect(status).toHaveTextContent('Ambient mode: Review')
    expect(status.querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('ambient-reset-note')).toHaveTextContent(/resets to Off when the server restarts/i)
  })

  it('shows "Nothing allowed" for empty topic and persona allow-lists', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    expect(screen.getByTestId('ambient-topic-nothing-allowed')).toHaveTextContent('Nothing allowed')
    expect(screen.getByTestId('ambient-persona-nothing-allowed')).toHaveTextContent('Nothing allowed')
  })

  it('falls back to the local topic vocabulary when the server does not expose one', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    for (const id of ['local-color', 'traffic-mundane', 'food', 'sports', 'community-events']) {
      expect(screen.getByTestId(`ambient-topic-${id}`)).toBeInTheDocument()
    }
  })

  it('uses the server topic vocabulary when exposed', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ topicVocabulary: ['weather-small-talk'] })))
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    expect(screen.getByTestId('ambient-topic-weather-small-talk')).toBeInTheDocument()
    expect(screen.queryByTestId('ambient-topic-food')).not.toBeInTheDocument()
  })

  it('Save POSTs the right path and body', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    const saved = policy({
      mode: 'review',
      maxPerMinute: 4,
      maxPerHour: 50,
      topicAllowList: ['food'],
      personaAllowList: ['p-2'],
    })
    postMock.mockResolvedValue({ data: dto(saved) })
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-mode-review'))
    await user.clear(screen.getByTestId('ambient-max-per-minute'))
    await user.type(screen.getByTestId('ambient-max-per-minute'), '4')
    await user.clear(screen.getByTestId('ambient-max-per-hour'))
    await user.type(screen.getByTestId('ambient-max-per-hour'), '50')
    await user.click(screen.getByTestId('ambient-topic-food'))
    await user.click(screen.getByTestId('ambient-persona-p-2'))
    await user.click(screen.getByTestId('ambient-save'))

    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
    const [path, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(path).toBe('/engine/settings/ambient-policy')
    expect(body).toMatchObject({
      mode: 'review',
      maxPerMinute: 4,
      maxPerHour: 50,
      topicAllowList: ['food'],
      personaAllowList: ['p-2'],
    })
    expect(typeof body.actingHumanId).toBe('string')
    expect(typeof body.timeZone).toBe('string')
    expect(body).not.toHaveProperty('exerciseId')

    // The server response is applied verbatim.
    await waitFor(() =>
      expect(screen.getByTestId('ambient-mode-status')).toHaveTextContent('Ambient mode: Review'),
    )
  })

  it('a 400 on autonomous shows the not-authorized message and keeps the previous mode', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'review' })))
    postMock.mockRejectedValue(axios400('Autonomous ambient posting is not authorized by PROVIDER-GOVERNANCE §8'))
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-mode-autonomous'))
    await user.click(screen.getByTestId('ambient-save'))
    await user.click(screen.getByTestId('ambient-autonomous-confirm-button'))

    const error = await screen.findByTestId('ambient-error')
    expect(within(error).getByText(AMBIENT_AUTONOMOUS_NOT_AUTHORIZED_MESSAGE)).toBeInTheDocument()
    expect(screen.getByTestId('ambient-mode-status')).toHaveTextContent('Ambient mode: Review')
    await waitFor(() =>
      expect(screen.getByTestId('ambient-mode-review')).toHaveAttribute('aria-pressed', 'true'),
    )
    expect(screen.getByTestId('ambient-mode-autonomous')).toHaveAttribute('aria-pressed', 'false')
    // Review stays available.
    expect(screen.getByTestId('ambient-mode-review')).not.toBeDisabled()
  })

  it('autonomous save requires confirmation; cancel keeps the mode and posts nothing', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'review' })))
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-mode-autonomous'))
    await user.click(screen.getByTestId('ambient-save'))

    const dialog = screen.getByRole('alertdialog')
    expect(dialog).toHaveTextContent(
      'Autonomous ambient posts publish without review, within your caps and allow-lists. Turn on?',
    )
    expect(postMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('ambient-autonomous-cancel')).toHaveFocus()

    await user.click(screen.getByTestId('ambient-autonomous-cancel'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(postMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('ambient-mode-status')).toHaveTextContent('Ambient mode: Review')
    expect(screen.getByTestId('ambient-mode-review')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('ambient-save')).toHaveFocus()
  })

  it('confirming autonomous saves it; lowering to off saves with no confirmation', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'review' })))
    postMock.mockImplementation((_url: string, body: { mode: string }) =>
      Promise.resolve({ data: dto(policy({ mode: body.mode as AmbientPolicyDto['mode'] })) }),
    )
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-mode-autonomous'))
    await user.click(screen.getByTestId('ambient-save'))
    await user.click(screen.getByTestId('ambient-autonomous-confirm-button'))
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
    await waitFor(() =>
      expect(screen.getByTestId('ambient-mode-status')).toHaveTextContent('Ambient mode: Autonomous'),
    )

    await user.click(screen.getByTestId('ambient-mode-off'))
    await user.click(screen.getByTestId('ambient-save'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(2))
  })

  it('widening while already autonomous asks to confirm; cancel keeps the draft and focuses Save', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'autonomous' })))
    postMock.mockResolvedValue({ data: dto(policy({ mode: 'autonomous', maxPerMinute: 3 })) })
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.clear(screen.getByTestId('ambient-max-per-minute'))
    await user.type(screen.getByTestId('ambient-max-per-minute'), '3')
    await user.click(screen.getByTestId('ambient-save'))

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'This widens what posts without review. Apply?',
    )
    expect(postMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('ambient-autonomous-cancel')).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(postMock).not.toHaveBeenCalled()
    expect(screen.getByTestId('ambient-save')).toHaveFocus()

    await user.click(screen.getByTestId('ambient-save'))
    await user.click(screen.getByTestId('ambient-autonomous-confirm-button'))
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
  })

  it('adding a topic while autonomous asks to confirm the widening, then saves it', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto(policy({ mode: 'autonomous', topicAllowList: ['local-color'] })),
    )
    postMock.mockResolvedValue({
      data: dto(policy({ mode: 'autonomous', topicAllowList: ['local-color', 'food'] })),
    })
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-topic-food'))
    await user.click(screen.getByTestId('ambient-save'))

    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'This widens what posts without review. Apply?',
    )
    expect(postMock).not.toHaveBeenCalled()

    await user.click(screen.getByTestId('ambient-autonomous-confirm-button'))
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
    const [, body] = postMock.mock.calls[0] as [string, Record<string, unknown>]
    expect(body.topicAllowList).toEqual(expect.arrayContaining(['local-color', 'food']))
  })

  it('removing a topic while autonomous narrows it, so it saves with no confirmation', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(
      EXERCISE_ID,
      dto(policy({ mode: 'autonomous', topicAllowList: ['local-color'] })),
    )
    postMock.mockResolvedValue({ data: dto(policy({ mode: 'autonomous' })) })
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-topic-local-color'))
    await user.click(screen.getByTestId('ambient-save'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
  })

  it('unchanged autonomous save does not confirm', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'autonomous' })))
    postMock.mockResolvedValue({ data: dto(policy({ mode: 'autonomous' })) })
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-save'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
  })

  it('review saves immediately with no confirmation', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'off' })))
    postMock.mockResolvedValue({ data: dto(policy({ mode: 'review' })) })
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-mode-review'))
    await user.click(screen.getByTestId('ambient-save'))
    expect(screen.queryByRole('alertdialog')).toBeNull()
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1))
  })

  it('notes that autonomous is not authorized when the server says so', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ autonomousAuthorized: false })))
    renderPanel()

    expect(await screen.findByTestId('ambient-autonomous-unauthorized-note')).toHaveTextContent(
      /not authorized/i,
    )
  })

  it('disables Autonomous (described by the note) when not authorized; Review stays enabled', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ autonomousAuthorized: false })))
    renderPanel()

    const auto = await screen.findByTestId('ambient-mode-autonomous')
    expect(auto).toBeDisabled()
    const note = screen.getByTestId('ambient-autonomous-unauthorized-note')
    expect(auto.getAttribute('aria-describedby')).toBe(note.id)
    expect(screen.getByTestId('ambient-mode-review')).not.toBeDisabled()
  })

  it('leaves Autonomous enabled when authorization is true or unknown', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ autonomousAuthorized: true })))
    renderPanel()
    expect(await screen.findByTestId('ambient-mode-autonomous')).not.toBeDisabled()
  })

  it('shows the server message verbatim for a kill-switch/cut autonomous 400', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ mode: 'review' })))
    postMock.mockRejectedValue(axios400(
      'engine is stopped or cut to Fake — restore it before enabling autonomous ambient',
    ))
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.click(screen.getByTestId('ambient-mode-autonomous'))
    await user.click(screen.getByTestId('ambient-save'))
    await user.click(screen.getByTestId('ambient-autonomous-confirm-button'))
    const error = await screen.findByTestId('ambient-error')
    expect(error).toHaveAttribute('role', 'alert')
    expect(error).toHaveTextContent(
      'engine is stopped or cut to Fake — restore it before enabling autonomous ambient',
    )
  })

  it('labels personas not eligible for ambient as text, with a helper note', async () => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ voiceablePersonaIds: ['p-1'] })))
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    expect(screen.getByTestId('ambient-persona-p-2-note')).toHaveTextContent('not eligible for ambient')
    expect(screen.queryByTestId('ambient-persona-p-1-note')).toBeNull()
    expect(screen.getByTestId('ambient-persona-cast-help')).toHaveTextContent(/only residents and helpers in the engine cast/i)
  })

  it.each([undefined, null])('shows no cast labels when voiceablePersonaIds is %s', async value => {
    engineSettingsStore.setForTests(EXERCISE_ID, dto(policy({ voiceablePersonaIds: value })))
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    expect(screen.queryByTestId('ambient-persona-p-2-note')).toBeNull()
  })

  it('blocks Save on non-integer caps', async () => {
    const user = userEvent.setup()
    engineSettingsStore.setForTests(EXERCISE_ID, dto())
    renderPanel()

    await screen.findByTestId('ambient-chatter-section')
    await user.clear(screen.getByTestId('ambient-max-per-minute'))
    await user.type(screen.getByTestId('ambient-max-per-minute'), 'x')
    expect(screen.getByTestId('ambient-save')).toBeDisabled()
    expect(screen.getByTestId('ambient-caps-invalid')).toBeInTheDocument()
  })
})

describe('Ambient chatter section (mock mode)', () => {
  beforeEach(() => {
    flags.useMockData = true
  })

  it('renders from the mock snapshot (Off) and saves locally with no network call', async () => {
    const user = userEvent.setup()
    renderPanel()

    expect(await screen.findByTestId('ambient-mode-status')).toHaveTextContent('Ambient mode: Off')
    await user.click(screen.getByTestId('ambient-mode-review'))
    await user.click(screen.getByTestId('ambient-persona-p-1'))
    await user.click(screen.getByTestId('ambient-save'))

    await waitFor(() =>
      expect(screen.getByTestId('ambient-mode-status')).toHaveTextContent('Ambient mode: Review'),
    )
    expect(screen.getByTestId('ambient-persona-p-1')).toHaveAttribute('aria-pressed', 'true')
    expect(postMock).not.toHaveBeenCalled()
  })

  it('greys out Autonomous while the mock policy is unauthorized', async () => {
    renderPanel()

    expect(await screen.findByTestId('ambient-mode-autonomous')).toBeDisabled()
    expect(screen.getByTestId('ambient-autonomous-unauthorized-note')).toBeInTheDocument()
    expect(screen.getByTestId('ambient-mode-status')).toHaveTextContent('Ambient mode: Off')
  })
})
