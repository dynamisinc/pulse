/**
 * features/controller/export/ExportPostsButton.test.tsx
 * ---------------------------------------------------------------------------
 * Story 09 AC3, the button: a spinner and "Exporting…" while the download runs (a second press is
 * ignored), the blob saved under the server's file name, and the error text on failure.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import { ExportPostsButton } from './ExportPostsButton'
import type { ExportDependencies } from './exportService'

const SERVER_NAME = 'pulse-posts-kestrel-20261020-1432.xlsx'

function fileResponse(): AxiosResponse<Blob> {
  return {
    data: new Blob(['PK-fake-xlsx']),
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders({ 'content-disposition': `attachment; filename="${SERVER_NAME}"` }),
    config: { headers: new AxiosHeaders() },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

function renderButton() {
  const dependencies = {
    wait: vi.fn<ExportDependencies['wait']>(() => Promise.resolve()),
    save: vi.fn<ExportDependencies['save']>(),
  }
  render(
    <ThemeProvider theme={cobraTheme}>
      <ExportPostsButton dependencies={dependencies} />
    </ThemeProvider>,
  )
  return dependencies
}

describe('ExportPostsButton', () => {
  it('shows a spinner while it runs, then saves the blob under the server file name', async () => {
    const user = userEvent.setup()
    let finish: (response: AxiosResponse<Blob>) => void = () => undefined
    const get = vi.spyOn(api, 'get').mockImplementation(
      () => new Promise(resolve => {
        finish = resolve
      }),
    )
    const dependencies = renderButton()

    await user.click(screen.getByRole('button', { name: 'Export posts' }))

    const busy = screen.getByRole('button', { name: 'Exporting…' })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByTestId('export-posts-spinner')).toBeInTheDocument()

    await user.click(busy)
    expect(get).toHaveBeenCalledTimes(1)

    const response = fileResponse()
    finish(response)

    await waitFor(() => expect(dependencies.save).toHaveBeenCalledWith(response.data, SERVER_NAME))
    expect(await screen.findByRole('button', { name: 'Export posts' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    )
    expect(screen.queryByTestId('export-posts-spinner')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(`Export saved as ${SERVER_NAME}`)
  })

  it('shows the error text on failure', async () => {
    const user = userEvent.setup()
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
    vi.spyOn(api, 'get').mockRejectedValue(
      new AxiosError('413', 'ERR_BAD_REQUEST', config, null, {
        data: new Blob([JSON.stringify({ detail: 'This exercise has 60,000 posts.' })]),
        status: 413,
        statusText: 'Payload Too Large',
        headers: new AxiosHeaders(),
        config,
      }),
    )
    const dependencies = renderButton()

    await user.click(screen.getByRole('button', { name: 'Export posts' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Export failed. This exercise has 60,000 posts.',
    )
    expect(dependencies.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Export posts' })).toBeInTheDocument()
  })
})
