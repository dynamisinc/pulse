/**
 * features/planner/components/ComplianceChromePanel.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (compliance chrome — exercise-configuration; #41 / story #68): the
 * COBRA staff chrome editor.
 *
 * The SERVICE is mocked (keeping the real `ChromeSettingsError` class, the real
 * field-bound constants and the real `violatesWatermarkInvariant` via
 * `importOriginal`), so every test drives the panel through a controlled seam
 * and `@/core/services/api` is never touched — no real axios sink, no Vitest
 * worker-teardown footgun.
 *
 * Two centrepieces:
 *  - the NFR-008 mutual guard reaching the planner as a FIELD-ASSOCIATED,
 *    icon-and-text message (never colour-only), with nothing sent to the server;
 *  - the FULL-REPLACE round trip: `PUT` is a replace, not a patch, so editing
 *    ONE field must still submit every other field unchanged — hence the
 *    whole-body `toEqual` assertion rather than a `toMatchObject`.
 *
 * Rendered inside the COBRA `ThemeProvider` (this is a STAFF surface — COBRA is
 * correct here) + a React Query client, exactly as `ExerciseSettingsPage` mounts
 * it.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ComplianceChromePanel } from './ComplianceChromePanel'
import {
  ChromeSettingsError,
  getChromeSettings,
  updateChromeSettings,
  type ChromeSettings,
} from '../services/chromeSettingsService'

vi.mock('../services/chromeSettingsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/chromeSettingsService')>()
  return { ...actual, getChromeSettings: vi.fn(), updateChromeSettings: vi.fn() }
})

const mockGet = vi.mocked(getChromeSettings)
const mockUpdate = vi.mocked(updateChromeSettings)

/**
 * A PART-CONFIGURED exercise — the interesting case. Every bottom-banner field
 * and both top colours are `null` ("not configured"), so the participant world
 * falls back to a shipped constant for each. The editor must show those EMPTY.
 */
const SETTINGS: ChromeSettings = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  chromeEnabled: true,
  watermarkEnabled: true,
  topText: 'UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY',
  topFg: null,
  topBg: null,
  bottomText: null,
  bottomFg: null,
  bottomBg: null,
}

/** The complete body a save of the UNTOUCHED fixture must produce. */
const UNTOUCHED_BODY = {
  chromeEnabled: true,
  watermarkEnabled: true,
  topText: 'UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY',
  topFg: null,
  topBg: null,
  bottomText: null,
  bottomFg: null,
  bottomBg: null,
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
  return render(<ComplianceChromePanel />, { wrapper: Wrapper })
}

/** Waits for the loaded form. */
async function renderLoadedPanel() {
  renderPanel()
  await screen.findByTestId('compliance-chrome-form')
}

/** The single body the panel submitted (fails loudly if it never submitted). */
function submittedBody(): Record<string, unknown> {
  const call = mockUpdate.mock.calls[0]
  if (!call) throw new Error('the panel did not submit a chrome update')
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

describe('ComplianceChromePanel — load states', () => {
  it('announces loading in a status region while the config is in flight', () => {
    mockGet.mockReturnValue(new Promise<ChromeSettings>(() => {}))
    renderPanel()

    const loading = screen.getByTestId('compliance-chrome-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(loading).toHaveTextContent(/loading compliance chrome/i)
  })

  it('reports a 403 load failure in an alert region, with text and not colour alone', async () => {
    mockGet.mockRejectedValue(new ChromeSettingsError('nope', { status: 403 }))
    renderPanel()

    const alert = await screen.findByTestId('compliance-chrome-load-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/not assigned to this exercise/i)
    expect(alert.querySelector('svg')).not.toBeNull()
  })

  it('renders no form while the load has failed, so nothing can be saved blind', async () => {
    mockGet.mockRejectedValue(new ChromeSettingsError('nope', { status: 401 }))
    renderPanel()

    await screen.findByTestId('compliance-chrome-load-error')
    expect(screen.queryByTestId('compliance-chrome-form')).toBeNull()
  })
})

describe('ComplianceChromePanel — rendering the loaded config', () => {
  it('shows a NOT-CONFIGURED banner field as EMPTY, never as the shipped constant', async () => {
    await renderLoadedPanel()

    // The participant fallback for an unconfigured bottom banner is 'PULSE
    // TRAINING ENVIRONMENT — …'. Pre-filling it here and saving would turn a
    // fallback into stored configuration.
    expect(screen.getByLabelText('Bottom banner text')).toHaveValue('')
    expect(screen.getByLabelText('Top banner text colour')).toHaveValue('')
    expect(screen.getByLabelText('Top banner background colour')).toHaveValue('')
  })

  it('shows a configured banner field with its stored value', async () => {
    await renderLoadedPanel()

    expect(screen.getByLabelText('Top banner text')).toHaveValue(
      'UNCLASSIFIED // FOR EXERCISE PURPOSES ONLY',
    )
  })

  it('reflects both markings switches from the server', async () => {
    mockGet.mockResolvedValue({ ...SETTINGS, chromeEnabled: false })
    await renderLoadedPanel()

    expect(screen.getByRole('checkbox', { name: /compliance chrome banners/i })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /exercise watermark/i })).toBeChecked()
  })
})

describe('ComplianceChromePanel — NFR-008 mutual guard', () => {
  it('refuses to submit when both markings are turned off, and explains why', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('checkbox', { name: /compliance chrome banners/i }))
    await user.click(screen.getByRole('checkbox', { name: /exercise watermark/i }))
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    expect(mockUpdate).not.toHaveBeenCalled()

    const help = screen.getByText(/must not both be off/i)
    expect(help).toHaveTextContent(/NFR-008/)
    expect(screen.getByTestId('compliance-chrome-client-error')).toHaveAttribute('role', 'alert')
  })

  it('binds the NFR-008 message to the switches with aria-describedby (never colour-only)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('checkbox', { name: /compliance chrome banners/i }))
    await user.click(screen.getByRole('checkbox', { name: /exercise watermark/i }))
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    const chromeSwitch = screen.getByRole('checkbox', { name: /compliance chrome banners/i })
    expect(describedByText(chromeSwitch)).toMatch(/must not both be off/i)
  })

  it('allows chrome-off on its own — a legal per-exercise state (D7-008)', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('checkbox', { name: /compliance chrome banners/i }))
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody()).toEqual({ ...UNTOUCHED_BODY, chromeEnabled: false })
  })

  it('allows watermark-off on its own', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('checkbox', { name: /exercise watermark/i }))
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody()).toEqual({ ...UNTOUCHED_BODY, watermarkEnabled: false })
  })

  it('surfaces the SERVER 400 verbatim when the server rejects a pair the client let through', async () => {
    // The client mirror is a courtesy; the server is the authority. If the two
    // ever diverge, the planner still sees the server's own reason.
    const user = userEvent.setup()
    mockUpdate.mockRejectedValue(
      new ChromeSettingsError('bad request', {
        status: 400,
        serverMessage: 'Compliance chrome and the in-content EXERCISE watermark must not both be off (NFR-008).',
      }),
    )
    await renderLoadedPanel()

    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    const alert = await screen.findByTestId('compliance-chrome-save-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/must not both be off/i)
  })
})

describe('ComplianceChromePanel — the full-replace round trip', () => {
  it('submits EVERY managed field when only one changed', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    const bottom = screen.getByLabelText('Bottom banner text')
    await user.type(bottom, 'ATLANTA CIE 2026 — SIMULATED')
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody()).toEqual({
      ...UNTOUCHED_BODY,
      bottomText: 'ATLANTA CIE 2026 — SIMULATED',
    })
  })

  it('sends null for a field the planner cleared, so it falls back to the shipped default', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.clear(screen.getByLabelText('Top banner text'))
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody()).toEqual({ ...UNTOUCHED_BODY, topText: null })
  })

  it('re-renders from the SERVER response, not from local form state', async () => {
    const user = userEvent.setup()
    mockUpdate.mockResolvedValue({ ...SETTINGS, topText: 'SANITIZED BY THE SERVER' })
    await renderLoadedPanel()

    const top = screen.getByLabelText('Top banner text')
    await user.clear(top)
    await user.type(top, 'anything')
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    await screen.findByTestId('compliance-chrome-saved')
    expect(screen.getByLabelText('Top banner text')).toHaveValue('SANITIZED BY THE SERVER')
  })

  it('announces a successful save in a status region', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    const saved = await screen.findByTestId('compliance-chrome-saved')
    expect(saved).toHaveAttribute('role', 'status')
  })

  it('reverts every edited field back to the server config', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.type(screen.getByLabelText('Bottom banner text'), 'scratch')
    await user.click(screen.getByRole('checkbox', { name: /exercise watermark/i }))
    await user.click(screen.getByRole('button', { name: /revert changes/i }))

    expect(screen.getByLabelText('Bottom banner text')).toHaveValue('')
    expect(screen.getByRole('checkbox', { name: /exercise watermark/i })).toBeChecked()
    expect(mockUpdate).not.toHaveBeenCalled()
  })
})

describe('ComplianceChromePanel — field validation (NFR-001 association)', () => {
  it('rejects a malformed colour with a message bound to that field', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.type(screen.getByLabelText('Top banner background colour'), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    expect(mockUpdate).not.toHaveBeenCalled()

    const field = screen.getByLabelText('Top banner background colour')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(describedByText(field)).toMatch(/hex colour/i)
  })

  it('accepts a valid hex colour', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.type(screen.getByLabelText('Top banner background colour'), '#2e6b2e')
    await user.click(screen.getByRole('button', { name: /save compliance chrome/i }))

    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1))
    expect(submittedBody()).toEqual({ ...UNTOUCHED_BODY, topBg: '#2e6b2e' })
  })
})

describe('ComplianceChromePanel — two worlds', () => {
  it('is a labelled staff section with a heading and no participant branding', async () => {
    await renderLoadedPanel()

    const panel = screen.getByTestId('compliance-chrome-panel')
    expect(panel.tagName).toBe('SECTION')
    expect(screen.getByRole('heading', { name: /compliance chrome/i })).toBeInTheDocument()
    expect(panel.querySelector('[dangerouslysetinnerhtml]')).toBeNull()
  })
})
