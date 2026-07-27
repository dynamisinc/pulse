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
 * The centerpiece is the FULL-REPLACE round trip: `PUT` is a replace, not a
 * patch, so editing ONE field must still submit every other field unchanged.
 * A regression there silently clears settings a planner never touched, which is
 * this story's most likely defect — hence the whole-body `toEqual` assertion
 * rather than a `toMatchObject` on the field under test.
 *
 * ============================================================================
 * WHY EVERY RENDER NAMES A SECTION
 * ============================================================================
 * The panel now shows ONE of three sections at a time (`section` prop), driven
 * by `ExerciseSettingsPage`'s left nav — three VIEWS over one form, never three
 * forms. So these tests render the section that owns the field under test, and
 * `show(...)` switches sections the way the page does (a prop change on the same
 * mounted panel — remounting would be a different component with different
 * state, and would not be testing what ships).
 *
 * That makes the full-replace guard STRONGER than it was when everything was on
 * screen at once: a save issued from `identity` must still submit the theming
 * and channel fields, which are not rendered at all. If `toUpdate()` ever starts
 * reading the DOM instead of state, these tests go red.
 *
 * Rendered inside the COBRA `ThemeProvider` (this is a STAFF surface — COBRA is
 * correct here) + a React Query client, exactly as `ExerciseSettingsPage` mounts
 * it.
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import {
  EXERCISE_SETTINGS_SECTION_META,
  type ExerciseSettingsSectionId,
  type ExerciseSettingsStatus,
} from '../exerciseSettingsSections'
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

interface RenderOptions {
  readonly section?: ExerciseSettingsSectionId
  readonly onStatusChange?: (status: ExerciseSettingsStatus) => void
  readonly onRequestSection?: (section: ExerciseSettingsSectionId) => void
}

/**
 * Renders the panel on one section, and hands back `show()` — a PROP CHANGE on
 * the same mounted panel, which is exactly how the page switches sections. Form
 * state therefore survives the switch, here as in the app.
 */
function renderPanel(options: RenderOptions = {}) {
  const { section = 'identity', onStatusChange, onRequestSection } = options
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
  const view = render(
    <ExerciseSettingsPanel
      section={section}
      onStatusChange={onStatusChange}
      onRequestSection={onRequestSection}
    />,
    { wrapper: Wrapper },
  )
  return {
    ...view,
    show(next: ExerciseSettingsSectionId) {
      view.rerender(
        <ExerciseSettingsPanel
          section={next}
          onStatusChange={onStatusChange}
          onRequestSection={onRequestSection}
        />,
      )
    },
  }
}

/** Waits for the loaded form. */
async function renderLoadedPanel(options: RenderOptions = {}) {
  const view = renderPanel(options)
  await screen.findByTestId('exercise-settings-form')
  return view
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

/** The save button — the shared footer control, present in every section. */
function saveButton(): HTMLElement {
  return screen.getByRole('button', { name: /save settings/i })
}

const ALL_SECTIONS: readonly ExerciseSettingsSectionId[] = ['identity', 'channels', 'theming']

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

describe('ExerciseSettingsPanel — sections are VIEWS over one form', () => {
  it.each(ALL_SECTIONS)('heads the %s section with its own h2, matching the nav label', async section => {
    await renderLoadedPanel({ section })

    expect(
      screen.getByRole('heading', {
        level: 2,
        name: EXERCISE_SETTINGS_SECTION_META[section].label,
      }),
    ).toBeInTheDocument()
  })

  it.each(ALL_SECTIONS)('offers Save and Revert in the %s section (one footer, all three)', async section => {
    await renderLoadedPanel({ section })

    expect(saveButton()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /revert changes/i })).toBeInTheDocument()
  })

  it('renders the fields of the selected section only', async () => {
    const { show } = await renderLoadedPanel({ section: 'identity' })

    expect(screen.getByLabelText('World name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Accent color')).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Social' })).not.toBeInTheDocument()

    show('theming')
    expect(screen.getByLabelText('Accent color')).toBeInTheDocument()
    expect(screen.queryByLabelText('World name')).not.toBeInTheDocument()

    show('channels')
    expect(screen.getByRole('checkbox', { name: 'Social' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Accent color')).not.toBeInTheDocument()
  })

  it('keeps an edit made in one section when another is shown and returned to', async () => {
    // The page relies on this: switching sections must never quietly drop work.
    const user = userEvent.setup()
    const { show } = await renderLoadedPanel({ section: 'identity' })

    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Savannah Metro')

    show('theming')
    show('identity')

    expect(screen.getByLabelText('World name')).toHaveValue('Savannah Metro')
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — "not configured" renders EMPTY, never the shipped constant', () => {
  it.each<[ExerciseSettingsSectionId, string]>([
    ['identity', 'Locale'],
    ['theming', 'Brand name'],
    ['theming', 'Accent color'],
    ['theming', 'Surface color'],
    ['theming', 'On-surface color'],
  ])('shows an empty "%s / %s" field when the server sent null', async (section, label) => {
    await renderLoadedPanel({ section })

    expect(screen.getByLabelText(label)).toHaveValue('')
  })

  it('shows an empty scheduled end when the exercise is unscheduled', async () => {
    await renderLoadedPanel({ section: 'identity' })

    expect(screen.getByLabelText(/scheduled end/i)).toHaveValue('')
  })

  it('never pre-fills a participant fallback constant into an unconfigured field', async () => {
    const { show } = await renderLoadedPanel({ section: 'identity' })

    // The shipped participant defaults (features/participant-shell/brandTokens.ts).
    // Pre-filling one and saving would turn a fallback into stored configuration.
    // Checked in EVERY section, since any of them could render a brand field.
    for (const section of ALL_SECTIONS) {
      show(section)
      for (const fallback of ['Sample Exercise Network', '#d97706', '#ffffff', '#1c1c1c']) {
        expect(screen.queryByDisplayValue(fallback)).not.toBeInTheDocument()
      }
    }
  })

  it('sends null — not an invented value — for a field left empty', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    await user.click(saveButton())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().locale).toBeNull()
    // `brandName` is edited in a section that is NOT on screen — and still sent.
    expect(submittedBody().brandName).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — the channel catalog comes from the response', () => {
  it('renders one checkbox per cataloged channel, checked per the effective flags', async () => {
    await renderLoadedPanel({ section: 'channels' })

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
    await renderLoadedPanel({ section: 'channels' })

    expect(screen.getAllByRole('checkbox')).toHaveLength(2)
    expect(screen.getByRole('checkbox', { name: 'Wire Service' })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: 'Radio' })).toBeChecked()
    expect(screen.queryByRole('checkbox', { name: 'Social' })).not.toBeInTheDocument()
  })

  it('submits the checked catalog ids, never an invented one', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'channels' })

    await user.click(screen.getByRole('checkbox', { name: 'News' }))
    await user.click(saveButton())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().enabledChannels).toEqual(['social', 'news'])
  })

  it('blocks a save that would enable no channels at all (an empty list is a 400)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'channels' })

    await user.click(screen.getByRole('checkbox', { name: 'Social' }))
    await user.click(saveButton())

    expect(mockUpdate).not.toHaveBeenCalled()
    const group = screen.getByTestId('exercise-settings-channels')
    expect(within(group).getByText(/turn on at least one channel/i)).toBeInTheDocument()
    // The message is bound to the group, not just painted red.
    const helpId = group.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(helpId)).toHaveTextContent(/turn on at least one channel/i)
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — the FULL-REPLACE round trip', () => {
  it.each(ALL_SECTIONS)(
    'submits every managed field, unchanged, from the %s section — including the fields it does not render',
    async section => {
      // THE regression guard for the sectioned layout: whichever slice of the
      // form is on screen, the body is complete. An omitted field CLEARS it.
      const user = userEvent.setup()
      await renderLoadedPanel({ section })

      await user.click(saveButton())

      await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
      expect(submittedBody()).toEqual(UNTOUCHED_BODY)
    },
  )

  it('editing ONE field does not clear the others (PUT is a replace, not a patch)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Savannah Metro')
    await user.click(saveButton())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    // The whole body, not just the edited field — this is the regression guard.
    expect(submittedBody()).toEqual({ ...UNTOUCHED_BODY, worldName: 'Savannah Metro' })
  })

  it('carries edits made in one section into a save issued from another', async () => {
    const user = userEvent.setup()
    const { show } = await renderLoadedPanel({ section: 'theming' })

    await user.type(screen.getByLabelText('Accent color'), '#123456')

    show('identity')
    const name = screen.getByLabelText(/^exercise name/i)
    await user.clear(name)
    await user.type(name, 'Savannah CIE 2026')
    await user.click(saveButton())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody()).toEqual({
      ...UNTOUCHED_BODY,
      name: 'Savannah CIE 2026',
      brandAccent: '#123456',
    })
  })

  it('keeps the brand, schedule, channels and outlet names when only the name changes', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    const name = screen.getByLabelText(/^exercise name/i)
    await user.clear(name)
    await user.type(name, 'Savannah CIE 2026')
    await user.click(saveButton())

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
    await renderLoadedPanel({ section: 'theming' })

    // The unknown key is rendered (so it is visible AND survives a replace).
    expect(screen.getByLabelText('wire outlet name')).toHaveValue('Peachtree Wire')

    await user.click(saveButton())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().outletNames).toEqual({
      news: 'WXYZ 9 News',
      wire: 'Peachtree Wire',
    })
  })

  it('clears a setting only when the planner actually empties its field', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    await user.clear(screen.getByLabelText('World name'))
    await user.click(saveButton())

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody().worldName).toBeNull()
    expect(submittedBody().brandPrimary).toBe('#2b5f75')
  })

  it('re-renders from the SERVER RESPONSE after a save, not from local form state', async () => {
    // The server sanitizes free text (NFR-004) and re-projects: what comes back
    // is the truth about what was stored — in every section, not just the one on
    // screen when the save was issued.
    mockUpdate.mockResolvedValue({
      ...SETTINGS,
      worldName: 'Savannah Metro',
      brandName: 'alert(1)',
    })
    const user = userEvent.setup()
    const { show } = await renderLoadedPanel({ section: 'theming' })

    const brandName = screen.getByLabelText('Brand name')
    await user.type(brandName, '<script>alert(1)</script>')
    await user.click(saveButton())

    await screen.findByTestId('exercise-settings-saved')
    expect(screen.getByLabelText('Brand name')).toHaveValue('alert(1)')

    show('identity')
    expect(screen.getByLabelText('World name')).toHaveValue('Savannah Metro')
  })

  it('announces a successful save in a status region (icon + text)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    await user.click(saveButton())

    const saved = await screen.findByTestId('exercise-settings-saved')
    expect(saved).toHaveAttribute('role', 'status')
    expect(saved).toHaveTextContent(/settings saved/i)
    expect(saved.querySelector('svg[data-icon="circle-check"]')).not.toBeNull()
  })

  it('reverts every edited field back to the server state, across all sections', async () => {
    const user = userEvent.setup()
    const { show } = await renderLoadedPanel({ section: 'theming' })

    await user.type(screen.getByLabelText('Accent color'), '#123456')

    show('identity')
    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Not saved')

    // ONE revert, from ONE section, restores the WHOLE form.
    await user.click(screen.getByRole('button', { name: /revert changes/i }))

    expect(screen.getByLabelText('World name')).toHaveValue('Metro Atlanta')
    show('theming')
    expect(screen.getByLabelText('Accent color')).toHaveValue('')
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — reporting up to the page nav', () => {
  it('reports clean and error-free once the settings load', async () => {
    const onStatusChange = vi.fn<(status: ExerciseSettingsStatus) => void>()
    await renderLoadedPanel({ onStatusChange })

    await waitFor(() => expect(onStatusChange).toHaveBeenCalled())
    expect(onStatusChange).toHaveBeenLastCalledWith({ dirty: false, sectionsWithErrors: [] })
  })

  it('reports dirty as soon as an edit would change what the server holds', async () => {
    const onStatusChange = vi.fn<(status: ExerciseSettingsStatus) => void>()
    const user = userEvent.setup()
    await renderLoadedPanel({ onStatusChange })

    await user.type(screen.getByLabelText('World name'), '!')

    await waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith({ dirty: true, sectionsWithErrors: [] }),
    )
  })

  it('reports clean again after a revert', async () => {
    const onStatusChange = vi.fn<(status: ExerciseSettingsStatus) => void>()
    const user = userEvent.setup()
    await renderLoadedPanel({ onStatusChange })

    await user.type(screen.getByLabelText('World name'), '!')
    await user.click(screen.getByRole('button', { name: /revert changes/i }))

    await waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith({ dirty: false, sectionsWithErrors: [] }),
    )
  })

  it('names EVERY section holding a validation error, in nav order', async () => {
    // Without this the page nav could not mark a section the planner cannot see,
    // and the server only ever reports its FIRST failure.
    const onStatusChange = vi.fn<(status: ExerciseSettingsStatus) => void>()
    const user = userEvent.setup()
    const { show } = await renderLoadedPanel({ section: 'identity', onStatusChange })

    await user.clear(screen.getByLabelText(/^exercise name/i))
    show('theming')
    await user.type(screen.getByLabelText('Accent color'), 'burnt orange')
    show('channels')
    await user.click(screen.getByRole('checkbox', { name: 'Social' }))

    await user.click(saveButton())

    await waitFor(() =>
      expect(onStatusChange).toHaveBeenLastCalledWith({
        dirty: true,
        sectionsWithErrors: ['identity', 'channels', 'theming'],
      }),
    )
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('asks the page for the first offending section when the error is OFF SCREEN', async () => {
    const onRequestSection = vi.fn<(section: ExerciseSettingsSectionId) => void>()
    const user = userEvent.setup()
    const { show } = await renderLoadedPanel({ section: 'identity', onRequestSection })

    await user.clear(screen.getByLabelText(/^exercise name/i))
    show('theming')
    await user.click(saveButton())

    expect(onRequestSection).toHaveBeenCalledWith('identity')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('does NOT move the planner when the error is already on screen', async () => {
    const onRequestSection = vi.fn<(section: ExerciseSettingsSectionId) => void>()
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity', onRequestSection })

    await user.clear(screen.getByLabelText(/^exercise name/i))
    await user.click(saveButton())

    expect(onRequestSection).not.toHaveBeenCalled()
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('names the offending sections in the blocked-save alert, not just in the nav', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    await user.clear(screen.getByLabelText(/^exercise name/i))
    await user.click(saveButton())

    expect(screen.getByTestId('exercise-settings-client-error')).toHaveTextContent(
      /identity & schedule/i,
    )
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
    await renderLoadedPanel({ section: 'identity' })

    await user.click(saveButton())

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
    await renderLoadedPanel({ section: 'identity' })

    const worldName = screen.getByLabelText('World name')
    await user.clear(worldName)
    await user.type(worldName, 'Savannah Metro')
    await user.click(saveButton())

    await screen.findByTestId('exercise-settings-save-error')
    expect(screen.getByLabelText('World name')).toHaveValue('Savannah Metro')
  })

  it('reports a network failure distinctly from a rejection', async () => {
    mockUpdate.mockRejectedValue(new ExerciseSettingsError('Network Error'))
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    await user.click(saveButton())

    const alert = await screen.findByTestId('exercise-settings-save-error')
    // A transport failure reads differently from a rejection, and says so
    // without naming "the server" at a planner.
    expect(alert).toHaveTextContent(/pulse could not be reached/i)
    expect(alert).toHaveTextContent(/were not saved/i)
  })
})

// ---------------------------------------------------------------------------

describe('ExerciseSettingsPanel — accessibility (NFR-001)', () => {
  it.each<[ExerciseSettingsSectionId, (RegExp | string)[]]>([
    ['identity', [/^exercise name/i, 'World name', 'Locale', /^time zone/i, /scheduled start/i, /scheduled end/i]],
    ['theming', ['Brand name', 'Primary color', 'Accent color', 'Surface color', 'On-surface color', 'News outlet name']],
  ])('gives every control in the %s section a real label', async (section, labels) => {
    await renderLoadedPanel({ section })

    for (const label of labels) {
      expect(screen.getByLabelText(label)).toBeInTheDocument()
    }
  })

  it('gives the channel checkboxes a labeled group', async () => {
    await renderLoadedPanel({ section: 'channels' })

    expect(screen.getByRole('group', { name: /enabled channels/i })).toBeInTheDocument()
  })

  it('associates a required-field error with its field (aria-invalid + aria-describedby)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    await user.clear(screen.getByLabelText(/^exercise name/i))
    await user.click(saveButton())

    const name = screen.getByLabelText(/^exercise name/i)
    expect(name).toHaveAttribute('aria-invalid', 'true')
    expect(describedByText(name)).toMatch(/an exercise name is required/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('associates the IANA time-zone error with the time-zone field, and blocks the write', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    const zone = screen.getByLabelText(/^time zone/i)
    await user.clear(zone)
    await user.type(zone, 'Eastern Standard Time')
    await user.click(saveButton())

    expect(zone).toHaveAttribute('aria-invalid', 'true')
    expect(describedByText(zone)).toMatch(/iana time zone/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('associates a malformed-color error with its own field', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'theming' })

    const accent = screen.getByLabelText('Accent color')
    await user.type(accent, 'burnt orange')
    await user.click(saveButton())

    expect(accent).toHaveAttribute('aria-invalid', 'true')
    expect(describedByText(accent)).toMatch(/hex color/i)
    // A different field must NOT be flagged — errors are per-field, not global.
    expect(screen.getByLabelText('Primary color')).toHaveAttribute('aria-invalid', 'false')
    expect(mockUpdate).not.toHaveBeenCalled()
  })

  it('announces that a blocked save stored nothing', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    await user.clear(screen.getByLabelText(/^exercise name/i))
    await user.click(saveButton())

    const alert = screen.getByTestId('exercise-settings-client-error')
    expect(alert).toHaveAttribute('role', 'alert')
    // The planner is told the write did not happen, and what to do next.
    expect(alert).toHaveTextContent(/nothing was saved/i)
    expect(alert).toHaveTextContent(/then save again/i)
  })

  it('rejects an end date that precedes the start, on the end field', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel({ section: 'identity' })

    const end = screen.getByLabelText(/scheduled end/i)
    // `fireEvent` rather than `user.type`: a `datetime-local` input rejects the
    // partial values a per-keystroke type would produce.
    fireEvent.change(end, { target: { value: '2026-02-01T09:00:00' } })
    await user.click(saveButton())

    expect(describedByText(end)).toMatch(/must not come before the start/i)
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})
