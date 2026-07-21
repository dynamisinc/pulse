/**
 * features/planner/components/AccountImport.errors.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (named participant accounts) — the panel's failure feedback. The
 * import SERVICE is mocked (keeping the real `AccountImportError` class via
 * `importOriginal`) so `importAccounts` rejects with a controlled, typed error
 * for each transport case. Because the service is mocked, `@/core/services/api`
 * is never touched — no real axios sink, no worker-teardown footgun.
 *
 * Covers the 401 (no staff session) and 400 (rejected upload) paths: each must
 * render a clear, role="alert" message (icon + text, never color alone).
 */
import type { ReactNode } from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { AccountImport } from './AccountImport'
import { AccountImportError, importAccounts } from '../services/accountImportService'

vi.mock('../services/accountImportService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/accountImportService')>()
  return { ...actual, importAccounts: vi.fn() }
})

const mockImport = vi.mocked(importAccounts)

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

function chooseCsvAndImport() {
  fireEvent.change(screen.getByTestId('account-import-file-input'), {
    target: {
      files: [new File(['username,displayName,role\na,A,pio'], 'accounts.csv', { type: 'text/csv' })],
    },
  })
  return userEvent.setup().click(screen.getByRole('button', { name: /import accounts/i }))
}

beforeEach(() => {
  mockImport.mockReset()
})

describe('AccountImport — error feedback', () => {
  it('renders a clear alert when the staff session is missing (401)', async () => {
    mockImport.mockRejectedValue(new AccountImportError('Unauthorized', { status: 401 }))
    renderPanel()

    await chooseCsvAndImport()

    const alert = await screen.findByTestId('account-import-server-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/staff session is not active/i)
    // Icon + text, never color alone.
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
    expect(screen.queryByTestId('account-import-result')).not.toBeInTheDocument()
  })

  it('renders the server reason when the upload is rejected (400)', async () => {
    mockImport.mockRejectedValue(
      new AccountImportError('Bad Request', {
        status: 400,
        serverMessage: 'the CSV file exceeds the maximum size of 1048576 bytes.',
      }),
    )
    renderPanel()

    await chooseCsvAndImport()

    const alert = await screen.findByTestId('account-import-server-error')
    expect(alert).toHaveTextContent(/could not be imported/i)
    expect(alert).toHaveTextContent(/exceeds the maximum size/i)
  })
})
