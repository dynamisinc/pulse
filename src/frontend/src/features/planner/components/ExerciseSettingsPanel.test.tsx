/**
 * features/planner/components/ExerciseSettingsPanel.test.tsx
 * ---------------------------------------------------------------------------
 * Story 01b (per-exercise settings — exercise-configuration; #41 / story #67):
 * the COBRA staff settings editor.
 *
 * The SERVICE is mocked (keeping the real `ExerciseSettingsError` class and the
 * real field-bound constants via `importOriginal`), so every test drives the
 * panel through a controlled seam and `@/core/services/api` is never touched —
 * no real axios sink, no Vitest worker-teardown footgun.
 *
 * The centrepiece is the FULL-REPLACE round trip: `PUT` is a replace, not a
 * patch, so editing ONE field must still submit every other field unchanged.
 * A regression there silently clears settings a planner never touched, which is
 * this story's most likely defect — hence the whole-body `toEqual` assertion
 * rather than a `toMatchObject` on the field under test.
 *
 * Rendered inside the COBRA `ThemeProvider` (this is a STAFF surface — COBRA is
 * correct here) + a React Query client, exactly as `App.tsx` will mount it.
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseSettingsPanel } from './ExerciseSettingsPanel'
import {
  ExerciseSettingsError,
  getExerciseSettings,
  updateExerciseSettings,
  type ExerciseSettings,
} from '../services/exerciseSettingsService'

vi.mock('../services/exerciseSettingsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/exerciseSettingsService')>()
  return { ...actual, getExerciseSettings: vi.fn(), updateExerciseSettings: vi.fn() }
})

const mockGet = vi.mocked(getExerciseSettings)
const mockUpdate = vi.mocked(updateExerciseSettings)

/**
 * A PART-CONFIGURED exercise — the interesting case. `locale`, `brandName`,
 * `brandAccent`, `brandSurface`, `brandOnSurface` and `scheduledEndAt` are
 * `null` ("not configured"), so the participant world falls back to a shipped
 * constant for each. The editor must show those as EMPTY.
 */
const SETTINGS: ExerciseSettings = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  name: 'Atlanta CIE 2026',
  worldName: 'Metro Atlanta',
  locale: null,
  timeZone: 'America/New_York',
  scheduledStartAt: '2026-03-01T13:00:00.0000000+00:00',
  scheduledEndAt: null,
  channels: [
    { id: 'social', label: 'Social', enabled: true },
    { id: 'portal', label: 'Portal', enabled: false },
    { id: 'news', label: 'News', enabled: false },
    { id: 'press', label: 'Press Room', enabled: false },
    { id: 'weather', label: 'Weather', enabled: false },
  ],
  brandName: null,
  brandPrimary: '#2b5f75',
  brandAccent: null,
  brandSurface: null,
  brandOnSurface: null,
  outletNames: { news: 'WXYZ 9 News' },
}

/** The complete body a save of the UNTOUCHED fixture must produce. */
const UNTOUCHED_BODY = {
  name: 'Atlanta CIE 2026',
  worldName: 'Metro Atlanta',
  locale: null,
  timeZone: 'America/New_York',
  scheduledStartAt: '2026-03-01T13:00:00.000Z',
  scheduledEndAt: null,
  enabledChannels: ['social'],
  brandName: null,
  brandPrimary: '#2b5f75',
  brandAccent: null,
  brandSurface: null,
  brandOnSurface: null,
  outletNames: { news: 'WXYZ 9 News' },
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<ExerciseSettingsPanel />, { wrapper: Wrapper })
}

/** Waits for the loaded form. */
async function renderLoadedPanel() {
  renderPanel()
  await screen.findByTestId('exercise-settings-form')
}

/** The single body the panel submitted (fails loudly if it never submitted). */
function submittedBody(): Record<string, unknown> {
  const call = mockUpdate.mock.calls[0]
  if (!call) throw new Error('the panel did not submit a settings update')
  return call[0] as unknown as Record<string, unknown>
}

/** The element an input points at with `aria-describedby`, if any. */
function describedByText(input: HTMLElement): string {
  const id = input.getAttribute('aria-describedby') ?? ''
  return id
    .split(/\s+/)
    .map(part => document.getElementById(part)?.textContent ?? '')
    .join(' ')
}

beforeEach(() => {
  mockGet.mockReset()
  mockUpdate.mockReset()
  mockGet.mockResolvedValue(SETTINGS)
  mockUpdate.mockResolvedValue(SETTINGS)
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — load states', () => {
  it('announces loading in a status region while the settings are in flight', () => {
    mockGet.mockReturnValue(new Promise<ExerciseSettings>(() => {}))
    renderPanel()

    const loading = screen.getByTestId('exercise-settings-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(loading).toHaveTextContent(/loading exercise settings/i)
    expect(screen.queryByTestId('exercise-settings-form')).not.toBeInTheDocument()
  })

  it('renders the loaded settings once the read resolves', async () => {
    await renderLoadedPanel()

    expect(screen.getByLabelText(/^exercise name/i)).toHaveValue('Atlanta CIE 2026')
    expect(screen.getByLabelText('World name')).toHaveValue('Metro Atlanta')
    expect(screen.getByLabelText(/^time zone/i)).toHaveValue('America/New_York')
    expect(screen.queryByTestId('exercise-settings-loading')).not.toBeInTheDocument()
  })

  it.each<[number, RegExp]>([
    [401, /staff session is not active/i],
    [403, /not assigned to this exercise/i],
  ])('surfaces a %s load failure in an alert with an icon, never color alone', async (status, copy) => {
    mockGet.mockRejectedValue(new ExerciseSettingsError('failed', { status }))
    renderPanel()

    const alert = await screen.findByTestId('exercise-settings-load-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(copy)
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
    expect(screen.queryByTestId('exercise-settings-form')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — "not configured" renders EMPTY, never the shipped constant', () => {
  it.each([
    'Locale',
    'Brand name',
    'Accent color',
    'Surface color',
    'On-surface color',
  ])('shows an empty "%s" field when the server sent null', async label => {
    await renderLoadedPanel()

    expect(screen.getByLabelText(label)).toHaveValue('')
  })

  it('shows an empty scheduled end when the exercise is unscheduled', async () => {
    await renderLoadedPanel()

    expect(screen.getByLabelText(/scheduled end/i)).toHaveValue('')
  })

  it('never pre-fills a participant fallback constant into an unconfigured field', async () => {
    await renderLoadedPanel()

    // The shipped participant defaults (features/participant-shell/brandTokens.ts).
    // Pre-filling one and saving would turn a fallback into stored configuration.
    for (const fallback of ['Sample Exercise Network', '#d97706', '#ffffff', '#1c1c1c']) {
      expect(screen.queryByDisplayValue(fallback)).not.toBeInTheDocument()
    }
  })

  it('sends null — not an invented value — for a field left empty', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().locale).toBeNull()
    expect(submittedBody().brandName).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — the channel catalog comes from the response', () => {
  it('renders one checkbox per catalogued channel, checked per the effective flags', async () => {
    await renderLoadedPanel()

    for (const channel of SETTINGS.channels) {
      const checkbox = screen.getByRole('checkbox', { name: channel.label })
      expect(checkbox).toBeInTheDocument()
      if (channel.enabled) {
        expect(checkbox).toBeChecked()
      } else {
        expect(checkbox).not.toBeChecked()
      }
    }
    expect(screen.getAllByRole('checkbox')).toHaveLength(SETTINGS.channels.length)
  })

  it('renders WHATEVER catalog the server sends — no channel id is hardcoded client-side', async () => {
    mockGet.mockResolvedValue({
      ...SETTINGS,
      channels: [
        { id: 'wire', label: 'Wire Service', enabled: true },
        { id: 'radio', label: 'Radio', enabled: true },
      ],
      outletNames: {},
    })
    await renderLoadedPanel()

    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Wire Service' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Radio' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Social' })).not.toBeInTheDocument()
  })

  it('submits the checked catalog ids, never an invented one', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('checkbox', { name: 'News' }))
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().enabledChannels).toEqual(['social', 'news'])
  })

  it('blocks a save that would enable no channels at all (an empty list is a 400)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('checkbox', { name: 'Social' }))
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    expect(mockUpdate).not.toHaveBeenCalled()
    const group = screen.getByTestId('exercise-settings-channels')
    expect(within(group).getByText(/enable at least one channel/i)).toBeInTheDocument()
    // The message is bound to the group, not just painted red.
    const helpId = group.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(helpId)).toHaveTextContent(/enable at least one channel/i)
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — the FULL-REPLACE round trip', () => {
  it('submits every managed field, unchanged, when nothing has been edited', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody()).toEqual(UNTOUCHED_BODY)
  })

  it('editing ONE field does not clear the others (PUT is a replace, not a patch)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Savannah Metro')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    // The whole body, not just the edited field — this is the regression guard.
    expect(submittedBody()).toEqual({ ...UNTOUCHED_BODY, worldName: 'Savannah Metro' })
  })

  it('keeps the brand, schedule, channels and outlet names when only the name changes', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    const name = screen.getByLabelText(/^exercise name/i)
    await user.clear(name)
    await user.type(name, 'Savannah CIE 2026')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    const body = submittedBody()
    expect(body.name).toBe('Savannah CIE 2026')
    expect(body.brandPrimary).toBe('#2b5f75')
    expect(body.timeZone).toBe('America/New_York')
    expect(body.scheduledStartAt).toBe('2026-03-01T13:00:00.000Z')
    expect(body.enabledChannels).toEqual(['social'])
    expect(body.outletNames).toEqual({ news: 'WXYZ 9 News' })
  })

  it('preserves an outlet-name key that falls outside the channel catalog', async () => {
    mockGet.mockResolvedValue({
      ...SETTINGS,
      outletNames: { news: 'WXYZ 9 News', wire: 'Peachtree Wire' },
    })
    const user = userEvent.setup()
    await renderLoadedPanel()

    // The unknown key is rendered (so it is visible AND survives a replace).
    expect(screen.getByLabelText('wire outlet name')).toHaveValue('Peachtree Wire')

    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().outletNames).toEqual({
      news: 'WXYZ 9 News',
      wire: 'Peachtree Wire',
    })
  })

  it('clears a setting only when the planner actually empties its field', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.clear(screen.getByLabelText('World name'))
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().worldName).toBeNull()
    expect(submittedBody().brandPrimary).toBe('#2b5f75')
  })

  it('re-renders from the SERVER RESPONSE after a save, not from local form state', async () => {
    // The server sanitizes free text (NFR-004) and re-projects: what comes back
    // is the truth about what was stored.
    mockUpdate.mockResolvedValue({
      ...SETTINGS,
      worldName: 'Savannah Metro',
      brandName: 'alert(1)',
    })
    const user = userEvent.setup()
    await renderLoadedPanel()

    const brandName = screen.getByLabelText('Brand name')
    await user.type(brandName, '<script>alert(1)</script>')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await screen.findByTestId('exercise-settings-saved')
    expect(screen.getByLabelText('Brand name')).toHaveValue('alert(1)')
    expect(screen.getByLabelText('World name')).toHaveValue('Savannah Metro')
  })

  it('announces a successful save in a status region (icon + text)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('button', { name: /save settings/i }))

    const saved = await screen.findByTestId('exercise-settings-saved')
    expect(saved).toHaveAttribute('role', 'status')
    expect(saved).toHaveTextContent(/settings saved/i)
    expect(saved.querySelector('svg[data-icon="circle-check"]')).not.toBeNull()
  })

  it('reverts every edited field back to the server state', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Not saved')
    await user.click(screen.getByRole('button', { name: /revert changes/i }))

    expect(screen.getByLabelText('World name')).toHaveValue('Metro Atlanta')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — server rejection (400: nothing was persisted)', () => {
  it('surfaces the single server reason in an alert (icon + text, never color alone)', async () => {
    const reason =
      "'radio' is not a known channel id. Known ids: social, portal, news, press, weather."
    mockUpdate.mockRejectedValue(
      new ExerciseSettingsError('Bad Request', { status: 400, serverMessage: reason }),
    )
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('button', { name: /save settings/i }))

    const alert = await screen.findByTestId('exercise-settings-save-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(reason)
    expect(alert).toHaveTextContent(/were not saved/i)
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
    expect(screen.queryByTestId('exercise-settings-saved')).not.toBeInTheDocument()
  })

  it('keeps the planner’s edits on screen so a rejected save is recoverable', async () => {
    mockUpdate.mockRejectedValue(
      new ExerciseSettingsError('Bad Request', { status: 400, serverMessage: 'nope' }),
    )
    const user = userEvent.setup()
    await renderLoadedPanel()

    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Savannah Metro')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    await screen.findByTestId('exercise-settings-save-error')
    expect(screen.getByLabelText('World name')).toHaveValue('Savannah Metro')
  })

  it('reports a network failure distinctly from a rejection', async () => {
    mockUpdate.mockRejectedValue(new ExerciseSettingsError('Network Error'))
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('button', { name: /save settings/i }))

    const alert = await screen.findByTestId('exercise-settings-save-error')
    expect(alert).toHaveTextContent(/could not reach the server/i)
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — accessibility (NFR-001)', () => {
  it('gives every control a real label', async () => {
    await renderLoadedPanel()

    for (const label of [
      /^exercise name/i, 'World name', 'Locale', /^time zone/i,
      /scheduled start/i, /scheduled end/i, 'Brand name', 'Primary color',
      'Accent color', 'Surface color', 'On-surface color', 'News outlet name',
    ]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
    expect(screen.getByRole('group', { name: /enabled channels/i })).toBeInTheDocument()
  })

  it('associates a required-field error with its field (aria-invalid + aria-describedby)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.clear(screen.getByLabelText(/^exercise name/i))
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    const name = screen.getByLabelText(/^exercise name/i)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(describedByText(name)).toMatch(/an exercise name is required/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('associates the IANA time-zone error with the time-zone field, and blocks the write', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    const zone = screen.getByLabelText(/^time zone/i)
    await user.clear(zone)
    await user.type(zone, 'Eastern Standard Time')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    expect(zone).toHaveAttribute('aria-invalid', 'true')
    expect(describedByText(zone)).toMatch(/iana time zone/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('associates a malformed-color error with its own field', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    const accent = screen.getByLabelText('Accent color')
    await user.type(accent, 'burnt orange')
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    expect(accent).toHaveAttribute('aria-invalid', 'true')
    expect(describedByText(accent)).toMatch(/css hex color/i)
    // A different field must NOT be flagged — errors are per-field, not global.
    expect(screen.getByLabelText('Primary color')).toHaveAttribute('aria-invalid', 'false')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('announces that a blocked save never reached the server', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.clear(screen.getByLabelText(/^exercise name/i))
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    const alert = screen.getByTestId('exercise-settings-client-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/nothing has been sent to the server/i)
  })

  it('rejects an end date that precedes the start, on the end field', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    const end = screen.getByLabelText(/scheduled end/i)
    // `fireEvent` rather than `user.type`: a `datetime-local` input rejects the
    // partial values a per-keystroke type would produce.
    fireEvent.change(end, { target: { value: '2026-02-01T09:00:00' } })
    await user.click(screen.getByRole('button', { name: /save settings/i }))

    expect(describedByText(end)).toMatch(/must not come before the start/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
