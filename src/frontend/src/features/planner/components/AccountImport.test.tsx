/**
 * features/planner/components/AccountImport.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (named participant accounts) — the COBRA bulk-import panel driven
 * end-to-end by the SHIPPED mock seam (no `@/core/services/api` mock): the real
 * hook + service resolve through the canned axios adapter (USE_MOCK_DATA is on
 * under Vitest), proving the panel renders with no backend. The adapter always
 * RESOLVES, so nothing rejects — no worker-teardown footgun. Error paths (which
 * need a rejecting seam) live in `AccountImport.errors.test.tsx`.
 *
 * Renders inside the COBRA `ThemeProvider` (this is a STAFF surface — COBRA is
 * correct here) + a React Query client, exactly as the app-shell/planner story
 * will mount it.
 */
import type { ReactNode } from 'react'
import { render, screen, within, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { AccountImport } from './AccountImport'

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
  return render(<AccountImport />, { wrapper: Wrapper })
}

function csvFile(): File {
  return new File(
    ['username,displayName,role\na.rivera,A Rivera,pio'],
    'accounts.csv',
    { type: 'text/csv' },
  )
}

describe('AccountImport — happy path through the shipped mock seam', () => {
  it('shows no result summary before an import is run', () => {
    renderPanel()
    expect(screen.queryByTestId('account-import-result')).not.toBeInTheDocument()
  })

  it('reflects the chosen file name', () => {
    renderPanel()
    fireEvent.change(screen.getByTestId('account-import-file-input'), {
      target: { files: [csvFile()] },
    })
    expect(screen.getByTestId('account-import-file-name')).toHaveTextContent(/accounts\.csv/)
  })

  it('uploads the file and renders the per-row result summary (created + failed with a reason)', async () => {
    const user = userEvent.setup()
    renderPanel()

    fireEvent.change(screen.getByTestId('account-import-file-input'), {
      target: { files: [csvFile()] },
    })
    await user.click(screen.getByRole('button', { name: /import accounts/i }))

    const region = await screen.findByTestId('account-import-result')
    expect(within(region).getByText(/3 rows processed/)).toBeInTheDocument()
    expect(within(region).getByText(/2 created/)).toBeInTheDocument()
    expect(within(region).getByText(/1 failed/)).toBeInTheDocument()
    // The failed row surfaces its reason, not just a count.
    expect(within(region).getByText(/duplicate username a\.rivera/)).toBeInTheDocument()
  })

  it('conveys per-row status with icon + text, never color alone (NFR-001)', async () => {
    const user = userEvent.setup()
    renderPanel()

    fireEvent.change(screen.getByTestId('account-import-file-input'), {
      target: { files: [csvFile()] },
    })
    await user.click(screen.getByRole('button', { name: /import accounts/i }))

    const region = await screen.findByTestId('account-import-result')

    // Failed row: a distinct x-mark icon AND the word "Failed".
    const failedBadge = within(region).getByTestId('account-import-status-failed')
    expect(within(failedBadge).getByText('Failed')).toBeInTheDocument()
    expect(failedBadge.querySelector('svg[data-icon="circle-xmark"]')).not.toBeNull()

    // Created rows: a distinct check icon AND the word "Created".
    const createdBadges = within(region).getAllByTestId('account-import-status-created')
    expect(createdBadges).toHaveLength(2)
    createdBadges.forEach(badge => {
      expect(within(badge).getByText('Created')).toBeInTheDocument()
      expect(badge.querySelector('svg[data-icon="circle-check"]')).not.toBeNull()
    })

    // The live region announces the outcome to assistive tech.
    expect(region).toHaveAttribute('aria-live', 'polite')
  })

  it('blocks a non-CSV file client-side with a clear, non-color-only message', () => {
    renderPanel()
    fireEvent.change(screen.getByTestId('account-import-file-input'), {
      target: { files: [new File(['x'], 'roster.pdf', { type: 'application/pdf' })] },
    })

    const alert = screen.getByTestId('account-import-client-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/\.csv file/i)
    // The import action stays disabled while the selection is invalid.
    expect(screen.getByRole('button', { name: /import accounts/i })).toBeDisabled()
  })
})
