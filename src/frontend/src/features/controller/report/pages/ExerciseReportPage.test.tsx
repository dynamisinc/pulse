/**
 * features/controller/report/pages/ExerciseReportPage.test.tsx
 * ---------------------------------------------------------------------------
 * Story 29 (printable exercise report), the page: every section renders from a fixture, the noise
 * checkbox refetches with includeNoise=true, every media item prints its alt text, a poster-less
 * video is a plain tile, the edited tag appears only when editCount > 0, the lookalike section is
 * omitted when empty, the print button calls window.print, and the `@page` rule exists only while
 * the page is mounted. Error states read as sentences.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { RESPONSE_METHOD_NOTE } from '../components/InjectResponseTable'
import { REPORT_PAGE_STYLE_ATTR } from '../services/reportFormat'
import { MOCK_REPORT, mockReportFor } from '../services/reportMock'
import type { ExerciseReport } from '../types/report'
import { ExerciseReportPage } from './ExerciseReportPage'

afterEach(() => {
  vi.restoreAllMocks()
})

function ok(data: ExerciseReport): AxiosResponse<ExerciseReport> {
  return {
    data,
    status: 200,
    statusText: 'OK',
    headers: new AxiosHeaders(),
    config: { headers: new AxiosHeaders() },
  }
}

function stubApi(responder: (includeNoise: boolean) => ExerciseReport = mockReportFor) {
  return vi.spyOn(api, 'get').mockImplementation((_url, config) =>
    Promise.resolve(ok(responder(config?.params?.includeNoise === true))))
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/staff/console/report']}>
        <Routes>
          <Route path="/staff/console/report" element={<ExerciseReportPage />} />
          <Route path="/staff/console" element={<p>CONSOLE HOME</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ExerciseReportPage', () => {
  it('renders every section from the fixture', async () => {
    stubApi()
    renderPage()

    expect(await screen.findByRole('heading', { level: 1, name: MOCK_REPORT.exercise.name }))
      .toBeInTheDocument()
    expect(screen.getByText(/EXERCISE · EXERCISE · EXERCISE/)).toBeInTheDocument()
    expect(screen.getByText('09:00 – 11:00 (Eastern Time)')).toBeInTheDocument()
    expect(screen.getByText('Thu 15 Oct 2026')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument()
    expect(screen.getByText('Participants')).toBeInTheDocument()
    expect(screen.getByText('Posts taken down')).toBeInTheDocument()
    expect(screen.getByText('Posts edited')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Where the 10 posts came from' })).toBeInTheDocument()

    const chart = screen.getByTestId('activity-chart')
    expect(chart).toHaveAttribute('aria-label', expect.stringContaining('stacked by source'))
    expect(screen.getByText('Dashed lines mark key injects')).toBeInTheDocument()
    expect(screen.getByText('#4 Lookalike rumor')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /Inject response times/ })).toBeInTheDocument()
    expect(screen.getByText('NO RESPONSE IN 30 MIN')).toBeInTheDocument()
    expect(screen.getByText(RESPONSE_METHOD_NOTE)).toBeInTheDocument()
    expect(RESPONSE_METHOD_NOTE).not.toMatch(/hashtag/i)

    expect(screen.getByRole('heading', { name: /Verified vs\. lookalike/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Post record/ })).toBeInTheDocument()
    expect(screen.getByTestId('omitted-noise-note')).toHaveTextContent('Background noise (2 posts)')
    expect(screen.getByText('09:30')).toBeInTheDocument() // a half-hour group heading
    expect(screen.getAllByTestId('report-post')).toHaveLength(MOCK_REPORT.posts.length)
    expect(screen.getByText('All times are scenario time')).toBeInTheDocument()
  })

  it('refetches with includeNoise=true when the checkbox is ticked', async () => {
    const get = stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')
    expect(get).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { includeNoise: false } }),
    )

    await user.click(screen.getByRole('checkbox', { name: 'Include background noise' }))

    await waitFor(() => expect(get).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { includeNoise: true } }),
    ))
    await waitFor(() =>
      expect(screen.getAllByTestId('report-post')).toHaveLength(MOCK_REPORT.posts.length + 2))
    expect(screen.queryByTestId('omitted-noise-note')).not.toBeInTheDocument()
  })

  it('prints the alt text of every media item', async () => {
    stubApi()
    renderPage()
    await screen.findByTestId('report-sheet')

    const expected = MOCK_REPORT.posts.flatMap(post => post.media)
    expect(expected.length).toBeGreaterThanOrEqual(3)
    const items = screen.getAllByTestId('report-media')
    expect(items).toHaveLength(expected.length)
    items.forEach((item, index) => {
      expect(within(item).getByText('ALT TEXT')).toBeInTheDocument()
      expect(item).toHaveTextContent(expected[index]?.alt ?? 'missing')
    })
    // Pictures are plain eager <img>s, empty alt, described by the visible ALT TEXT caption.
    const image = items[0]?.querySelector('img')
    expect(image).toHaveAttribute('loading', 'eager')
    expect(image).toHaveAttribute('alt', '')
    const captionId = image?.getAttribute('aria-describedby') ?? ''
    expect(document.getElementById(captionId)).toHaveTextContent('Stacks of shrink-wrapped')
  })

  it('shows a video poster with a VIDEO label and duration, and a plain tile without a poster', async () => {
    stubApi()
    renderPage()
    await screen.findByTestId('report-sheet')

    const withPoster = screen.getAllByTestId('report-media')
      .find(item => item.textContent?.includes('News footage'))
    expect(withPoster).toBeDefined()
    expect(within(withPoster as HTMLElement).getByText('VIDEO')).toBeInTheDocument()
    expect(within(withPoster as HTMLElement).getByText('0:15')).toBeInTheDocument()
    expect((withPoster as HTMLElement).querySelector('img')).toHaveAttribute('loading', 'eager')

    const tile = screen.getByTestId('report-media-tile')
    expect(within(tile).getByText('VIDEO')).toBeInTheDocument()
    expect(within(tile).getByText('1:02')).toBeInTheDocument()
    expect(tile.querySelector('img')).toBeNull()
    expect(tile.closest('figure')).toHaveTextContent('A utility truck with flashing amber lights')
  })

  it('shows the edited tag only when editCount is above zero, and labels takedowns', async () => {
    stubApi()
    renderPage()
    await screen.findByTestId('report-sheet')

    expect(screen.getByText('Edited 2× · last at 09:55')).toBeInTheDocument()
    expect(screen.getByText('Edited 1× · last at 10:16')).toBeInTheDocument()
    expect(screen.getAllByText(/^Edited \d+×/)).toHaveLength(2)
    expect(screen.getByText('Taken down at 10:21')).toBeInTheDocument()
    expect(screen.getByText('Replying to @KestrelCoEM')).toBeInTheDocument()
    expect(screen.getAllByText('Participant · posted by R. Okafor').length).toBeGreaterThan(0)
    expect(screen.getAllByText('UNVERIFIED').length).toBeGreaterThan(0)
  })

  it('omits the lookalike section when there are no pairs, and hides nothing else', async () => {
    stubApi(() => ({ ...MOCK_REPORT, lookalikes: [] }))
    renderPage()
    await screen.findByTestId('report-sheet')

    expect(screen.queryByRole('heading', { name: /Verified vs\. lookalike/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Post record/ })).toBeInTheDocument()
  })

  it('hides Posts edited when an older server sends null', async () => {
    stubApi(() => ({ ...MOCK_REPORT, summary: { ...MOCK_REPORT.summary, postsEdited: null } }))
    renderPage()
    await screen.findByTestId('report-sheet')

    expect(screen.queryByText('Posts edited')).not.toBeInTheDocument()
  })

  it('shows Posts edited when the count is not null', async () => {
    stubApi(() => ({ ...MOCK_REPORT, summary: { ...MOCK_REPORT.summary, postsEdited: 3 } }))
    renderPage()
    await screen.findByTestId('report-sheet')
    expect(screen.getByText('Posts edited')).toBeInTheDocument()
  })

  it('calls window.print from the Print / Save as PDF button', async () => {
    stubApi()
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')

    await user.click(screen.getByRole('button', { name: 'Print / Save as PDF' }))

    expect(print).toHaveBeenCalledTimes(1)
  })

  it('injects the @page rule on mount and removes it on unmount', async () => {
    stubApi()
    const { unmount } = renderPage()
    await screen.findByTestId('report-sheet')

    const rule = document.head.querySelector(`style[${REPORT_PAGE_STYLE_ATTR}]`)
    expect(rule).not.toBeNull()
    expect(rule?.textContent).toContain('@page')
    expect(rule?.textContent).toContain('letter')
    expect(document.documentElement).toHaveClass('reportOpen')

    unmount()

    expect(document.head.querySelector(`style[${REPORT_PAGE_STYLE_ATTR}]`)).toBeNull()
    expect(document.documentElement).not.toHaveClass('reportOpen')
  })

  it('shows a loading state, then the empty-exercise state for a report with no posts', async () => {
    stubApi(() => ({
      ...MOCK_REPORT,
      summary: { ...MOCK_REPORT.summary, posts: 0 },
      posts: [],
      omittedNoiseCount: 0,
    }))
    renderPage()
    expect(screen.getByText('Building the report…')).toBeInTheDocument()
    expect(await screen.findByTestId('report-empty')).toHaveTextContent('nothing to report')
  })

  it.each([
    [401, /session has expired/],
    [404, /no longer exists/],
    [413, /too many posts/],
  ])('shows a readable message for a %i', async (status, message) => {
    const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
    vi.spyOn(api, 'get').mockRejectedValue(
      new AxiosError(String(status), 'ERR_BAD_REQUEST', config, null, {
        data: '',
        status,
        statusText: '',
        headers: new AxiosHeaders(),
        config,
      }),
    )
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeDisabled()
  })

  it('rounds decimal response minutes to whole minutes in the table and the median stat', async () => {
    stubApi(() => ({
      ...MOCK_REPORT,
      summary: { ...MOCK_REPORT.summary, medianResponseMinutes: 5.7 },
      injectResponses: [{
        ...(MOCK_REPORT.injectResponses[0] as ExerciseReport['injectResponses'][number]),
        responseMinutes: 5.7,
      }],
    }))
    renderPage()
    await screen.findByTestId('report-sheet')
    expect(screen.getAllByText('6 min', { exact: false }).length).toBe(2)
    expect(screen.queryByText(/5\.7/)).not.toBeInTheDocument()
  })

  it('prints the prepared date once', async () => {
    stubApi()
    renderPage()
    await screen.findByTestId('report-sheet')
    expect(screen.getAllByText(/15 Oct 2026/)).toHaveLength(2) // conducted + prepared, once each
    expect(screen.queryByText(/^Prepared 15 Oct 2026$/)).not.toBeInTheDocument()
  })

  it('Back to console navigates to the console', async () => {
    stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')
    await user.click(screen.getByRole('button', { name: 'Back to console' }))
    expect(screen.getByText('CONSOLE HOME')).toBeInTheDocument()
  })

  it('disables Print while the previous report is shown for a refetch', async () => {
    let release: (value: AxiosResponse<ExerciseReport>) => void = () => undefined
    vi.spyOn(api, 'get').mockImplementation((_url, config) =>
      config?.params?.includeNoise === true
        ? new Promise(resolve => { release = resolve })
        : Promise.resolve(ok(MOCK_REPORT)))
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: 'Include background noise' }))
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeDisabled()

    release(ok(mockReportFor(true)))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled())
  })

  it('disables Print while a cached report refreshes, so a stale record cannot be saved', async () => {
    let calls = 0
    let release: (value: AxiosResponse<ExerciseReport>) => void = () => undefined
    vi.spyOn(api, 'get').mockImplementation((_url, config) => {
      calls += 1
      // The third call is the refresh of the cached includeNoise=false result: hold it open.
      if (calls === 3) return new Promise(resolve => { release = resolve })
      return Promise.resolve(ok(mockReportFor(config?.params?.includeNoise === true)))
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')
    const checkbox = screen.getByRole('checkbox', { name: 'Include background noise' })

    await user.click(checkbox)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled())

    // Back to the cached setting: its data shows at once (not placeholder)
    // while staleTime 0 refetches it.
    await user.click(checkbox)
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeDisabled()

    release(ok(mockReportFor(false)))
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled())
  })

  it('has a named, focusable scroll region', async () => {
    stubApi()
    renderPage()
    await screen.findByTestId('report-sheet')
    const region = screen.getByRole('region', { name: 'Exercise report preview' })
    expect(region).toHaveAttribute('tabindex', '0')
    region.focus()
    expect(region).toHaveFocus()
  })

  it('lays a four-image post out as a grid with all four captions', async () => {
    const media = Array.from({ length: 4 }, (_, index) => ({
      kind: 'image' as const,
      url: null,
      alt: `Photo ${index + 1} long description`,
      durationSec: null,
      width: null,
      height: null,
    }))
    const base = MOCK_REPORT.posts[0] as ExerciseReport['posts'][number]
    stubApi(() => ({ ...MOCK_REPORT, posts: [{ ...base, id: 'four', media }] }))
    renderPage()
    await screen.findByTestId('report-sheet')
    const grid = screen.getByTestId('report-media-grid')
    expect(grid.className).toContain('mediaGrid')
    expect(within(grid).getAllByText('ALT TEXT')).toHaveLength(4)
    for (let n = 1; n <= 4; n += 1) {
      expect(within(grid).getByText(`Photo ${n} long description`)).toBeInTheDocument()
    }
  })

  it('does not use the grid for a single attachment', async () => {
    stubApi()
    renderPage()
    await screen.findByTestId('report-sheet')
    // The fixture's posts each carry at most one item.
    expect(screen.queryByTestId('report-media-grid')).not.toBeInTheDocument()
  })
})
