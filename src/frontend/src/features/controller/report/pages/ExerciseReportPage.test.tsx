/**
 * features/controller/report/pages/ExerciseReportPage.test.tsx
 * ---------------------------------------------------------------------------
 * Story 29 (printable exercise report), the page: every section renders from a fixture, the noise
 * source checkbox refetches with noise in `sources` (story 30 filter tests are at the end),
 * every media item prints its alt text, a poster-less
 * video is a plain tile, the edited tag appears only when editCount > 0, the lookalike section is
 * omitted when empty, the print button calls window.print, and the `@page` rule exists only while
 * the page is mounted. Error states read as sentences.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AxiosError, AxiosHeaders, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { RESPONSE_METHOD_NOTE } from '../components/InjectResponseTable'
import { DEFAULT_REPORT_FILTERS } from '../services/reportFilters'
import { REPORT_PAGE_STYLE_ATTR } from '../services/reportFormat'
import { MOCK_REPORT, filtersFromParams, mockReportFor } from '../services/reportMock'
import type { ExerciseReport, ReportFilters } from '../types/report'
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

function stubApi(responder: (filters: ReportFilters) => ExerciseReport = mockReportFor) {
  return vi.spyOn(api, 'get').mockImplementation((_url, config) =>
    Promise.resolve(ok(responder(filtersFromParams(config?.params)))))
}

const NOISE_LABEL = 'Background noise'
const PRINT = 'Print / Save as PDF'

/** The From/To pickers (native `datetime-local`: no textbox role). */
function timeInput(name: 'From' | 'To'): HTMLInputElement {
  return screen.getByLabelText(`${name} (scenario time)`)
}

/** Sets a scenario time ("yyyy-MM-dd HH:mm") in a picker, as the browser's picker does. */
function pick(input: HTMLInputElement, stamp: string) {
  fireEvent.change(input, { target: { value: stamp.replace(' ', 'T') } })
}

/** A half-typed value: the browser reports `badInput` and an empty value. */
function halfType(input: HTMLInputElement) {
  Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true, valid: false } })
  fireEvent.change(input, { target: { value: '' } })
}

const enter = (input: HTMLInputElement) => fireEvent.keyDown(input, { key: 'Enter' })

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
    expect(screen.getByText('2026-10-14 16:20 – 2026-10-15 10:30 (Eastern Time)')).toBeInTheDocument()
    expect(screen.getByText('Wed 14 Oct 2026')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument()
    expect(screen.getByText('Participants')).toBeInTheDocument()
    expect(screen.getByText('Posts taken down')).toBeInTheDocument()
    expect(screen.getByText('Posts edited')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: `Where the ${MOCK_REPORT.summary.posts} posts came from` })).toBeInTheDocument()

    const chart = screen.getByTestId('activity-chart')
    expect(chart).toHaveAttribute('aria-label', expect.stringContaining('stacked by source'))
    expect(screen.getByText('Numbered dashed lines mark key injects')).toBeInTheDocument()
    expect(screen.getByText('5 · 15 Oct 09:40 · #4 Lookalike says "don\'t boil"')).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /Inject response times/ })).toBeInTheDocument()
    expect(screen.getAllByText('NO RESPONSE IN 30 MIN').length).toBeGreaterThan(0)
    expect(screen.getByText(RESPONSE_METHOD_NOTE)).toBeInTheDocument()
    expect(RESPONSE_METHOD_NOTE).not.toMatch(/hashtag/i)

    expect(screen.getByRole('heading', { name: /Verified vs\. lookalike/ })).toBeInTheDocument()
    // Story 33: the controller-named pair (no shared prefix) appears, labeled in text.
    expect(screen.getByText(/@TapWaterTruth ·/)).toBeInTheDocument()
    expect(screen.getAllByTestId('lookalike-basis').map(n => n.textContent))
      .toEqual(['Handle match', 'Handle match', 'Named by a controller'])
    expect(screen.getByRole('heading', { name: /Post record/ })).toBeInTheDocument()
    expect(screen.getByTestId('omitted-noise-note')).toHaveTextContent('Background noise (2 posts)')
    expect(screen.getByText('15 Oct 2026 · 09:30')).toBeInTheDocument() // a half-hour group heading
    // Story 34 (DF-50): the mock's 6-post engine burst prints as 3 cards.
    expect(screen.getAllByTestId('report-post')).toHaveLength(MOCK_REPORT.posts.length - 3)
    expect(screen.getByTestId('merged-note')).toHaveTextContent(
      `these ${MOCK_REPORT.posts.length} posts appear as ${MOCK_REPORT.posts.length - 3} cards`)
    expect(screen.getAllByTestId('report-post-repeats').map(n => n.textContent))
      .toEqual(['Posted 3 times, 15 Oct 10:10–10:12', 'Posted 2 times, 15 Oct 10:10–10:11'])
    expect(screen.getByText('All times are scenario time')).toBeInTheDocument()
  })

  it('refetches with noise in sources when Background noise is ticked', async () => {
    const get = stubApi()
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')
    expect(get).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { sources: 'participant,scripted,engine' } }),
    )

    await user.click(screen.getByRole('checkbox', { name: NOISE_LABEL }))

    await waitFor(() => expect(get).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ params: { sources: 'participant,scripted,engine,noise' } }),
    ))
    await waitFor(() =>
      expect(screen.getAllByTestId('report-post')).toHaveLength(MOCK_REPORT.posts.length + 2 - 3))
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

    expect(screen.getByText('Edited 2× · last at 15 Oct 09:55')).toBeInTheDocument()
    expect(screen.getByText('Edited 1× · last at 15 Oct 10:16')).toBeInTheDocument()
    expect(screen.getAllByText(/^Edited \d+×/)).toHaveLength(2)
    expect(screen.getByText('Taken down at 15 Oct 10:21')).toBeInTheDocument()
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
    // Story 31 (DF-46): zero page margin removes the browser header/footer.
    expect(rule?.textContent).toMatch(/margin:\s*0\s*;/)
    expect(rule?.textContent).not.toMatch(/0\.\d+in/)
    expect(document.documentElement).toHaveClass('reportOpen')

    unmount()

    expect(document.head.querySelector(`style[${REPORT_PAGE_STYLE_ATTR}]`)).toBeNull()
    expect(document.documentElement).not.toHaveClass('reportOpen')
  })

  it('shows a loading state, then the empty-exercise state for a report with no posts', async () => {
    stubApi(() => ({
      ...MOCK_REPORT,
      exercise: { ...MOCK_REPORT.exercise, latestDay: null },
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
        ...(MOCK_REPORT.injectResponses[1] as ExerciseReport['injectResponses'][number]),
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
    expect(screen.getAllByText('15 Oct 2026')).toHaveLength(1) // the prepared date, once
    expect(screen.getAllByText('Wed 14 Oct 2026')).toHaveLength(1) // conducted, once
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
      filtersFromParams(config?.params).sources.includes('noise')
        ? new Promise(resolve => { release = resolve })
        : Promise.resolve(ok(MOCK_REPORT)))
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled()

    await user.click(screen.getByRole('checkbox', { name: NOISE_LABEL }))
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeDisabled()

    release(ok(mockReportFor({ ...DEFAULT_REPORT_FILTERS, sources: ['participant', 'scripted', 'engine', 'noise'] })))
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
      return Promise.resolve(ok(mockReportFor(filtersFromParams(config?.params))))
    })
    const user = userEvent.setup()
    renderPage()
    await screen.findByTestId('report-sheet')
    const checkbox = screen.getByRole('checkbox', { name: NOISE_LABEL })

    await user.click(checkbox)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeEnabled())

    // Back to the cached setting: its data shows at once (not placeholder)
    // while staleTime 0 refetches it.
    await user.click(checkbox)
    expect(screen.getByRole('button', { name: 'Print / Save as PDF' })).toBeDisabled()

    release(ok(mockReportFor()))
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

  describe('story 30 filters', () => {
    const lastParams = (get: ReturnType<typeof stubApi>) =>
      (get.mock.lastCall?.[1] as { params: Record<string, string> }).params

    it('has four labelled source checkboxes with the first three checked', async () => {
      stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      for (const name of ['Participant', 'Scripted inject', 'Engine']) {
        expect(screen.getByRole('checkbox', { name })).toBeChecked()
      }
      expect(screen.getByRole('checkbox', { name: NOISE_LABEL })).not.toBeChecked()
    })

    it('refetches with the right sources when one is unticked', async () => {
      const get = stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      await user.click(screen.getByRole('checkbox', { name: 'Engine' }))
      await waitFor(() => expect(lastParams(get)).toEqual({ sources: 'participant,scripted' }))
      await waitFor(() => expect(screen.getByTestId('filter-statement'))
        .toHaveTextContent('Showing participant and scripted inject posts for the whole exercise'))
    })

    it('does not let the last source be unchecked', async () => {
      const get = stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      await user.click(screen.getByRole('checkbox', { name: 'Scripted inject' }))
      await user.click(screen.getByRole('checkbox', { name: 'Engine' }))
      await waitFor(() => expect(lastParams(get)).toEqual({ sources: 'participant' }))
      const last = screen.getByRole('checkbox', { name: 'Participant' })
      expect(last).toBeDisabled()
      expect(last).toBeChecked()
    })

    it('applies a valid window on blur, sends it as written, and Clear removes it', async () => {
      const get = stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      const calls = get.mock.calls.length

      const from = timeInput('From')
      pick(from, '2026-10-15 09:00')
      expect(get.mock.calls.length).toBe(calls) // picking alone never refetches
      fireEvent.blur(from)
      await waitFor(() => expect(lastParams(get)).toEqual({
        sources: 'participant,scripted,engine',
        from: '2026-10-15 09:00',
      }))

      const to = timeInput('To')
      pick(to, '2026-10-15 10:00')
      enter(to)
      await waitFor(() => expect(lastParams(get)).toEqual({
        sources: 'participant,scripted,engine',
        from: '2026-10-15 09:00',
        to: '2026-10-15 10:00',
      }))
      await waitFor(() => expect(screen.getByTestId('filter-statement')).toHaveTextContent(
        'Showing participant, scripted inject and engine posts, 10-15 09:00 – 10-15 10:00'))
      await waitFor(() => expect(screen.getAllByTestId('report-post')).toHaveLength(6))
      // Nothing in 09:00-10:00 repeats, so no merge note (story 34).
      expect(screen.queryByTestId('merged-note')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Clear' }))
      await waitFor(() => expect(lastParams(get)).toEqual({ sources: 'participant,scripted,engine' }))
      expect(from).toHaveValue('')
    })

    it.each([
      ['a half-typed date', null, /Enter a full date and time/],
      ['2026-10-13 23:59', '2026-10-13 23:59', /2026-10-14 00:00 or later/],
    ])('rejects %s with an inline message and does not refetch', async (_case, stamp, message) => {
      const get = stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      const calls = get.mock.calls.length

      const from = timeInput('From')
      if (stamp === null) halfType(from)
      else pick(from, stamp)
      fireEvent.blur(from)

      expect(from).toHaveAccessibleDescription(message)
      expect(from).toBeInvalid()
      expect(get.mock.calls.length).toBe(calls)
    })

    it('rejects a From after the applied To', async () => {
      const get = stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      pick(timeInput('To'), '2026-10-15 09:30')
      enter(timeInput('To'))
      await waitFor(() => expect(lastParams(get).to).toBe('2026-10-15 09:30'))
      const calls = get.mock.calls.length
      pick(timeInput('From'), '2026-10-15 10:00')
      fireEvent.blur(timeInput('From'))
      expect(screen.getByText('From must not be after To.')).toBeInTheDocument()
      expect(get.mock.calls.length).toBe(calls)
    })

    it('allows To after the snapshot scenarioEnd (a live exercise keeps growing)', async () => {
      const get = stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      pick(timeInput('To'), '2026-10-15 11:30')
      enter(timeInput('To'))
      await waitFor(() => expect(lastParams(get).to).toBe('2026-10-15 11:30'))
    })

    // Tom, 10/17: To defaults to "now" (scenario time) but stays an open end until changed.
    it('shows scenario now in an untouched To, but sends no To bound', async () => {
      const get = stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      const to = timeInput('To')
      expect(to).toHaveValue('2026-10-15T10:42')
      expect(to).toHaveAccessibleDescription('Defaults to now')

      const from = timeInput('From')
      pick(from, '2026-10-15 09:00')
      fireEvent.blur(from)
      await waitFor(() => expect(lastParams(get)).toEqual({
        sources: 'participant,scripted,engine',
        from: '2026-10-15 09:00',
      }))
      fireEvent.blur(to) // leaving an untouched To applies nothing either
      expect(lastParams(get)).not.toHaveProperty('to')
    })

    it('refuses a From after the "now" an untouched To shows, and sends nothing', async () => {
      const get = stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      const calls = get.mock.calls.length
      const from = timeInput('From')
      pick(from, '2026-10-15 11:00') // after "now", 10:42
      fireEvent.blur(from)
      expect(from).toHaveAccessibleDescription('From must not be after To.')
      expect(get.mock.calls.length).toBe(calls)
    })

    it('sends To once it is changed, and Clear puts "now" back as an open end', async () => {
      const get = stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      const to = timeInput('To')
      pick(to, '2026-10-15 10:00')
      enter(to)
      await waitFor(() => expect(lastParams(get).to).toBe('2026-10-15 10:00'))
      expect(to).toHaveAccessibleDescription('Scenario time, exercise zone')

      await user.click(screen.getByRole('button', { name: 'Clear' }))
      await waitFor(() => expect(lastParams(get)).toEqual({ sources: 'participant,scripted,engine' }))
      expect(to).toHaveValue('2026-10-15T10:42')
    })

    it('offers date and time pickers that start at the exercise\'s first day', async () => {
      stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      for (const name of ['From', 'To'] as const) {
        expect(timeInput(name)).toHaveAttribute('type', 'datetime-local')
        expect(timeInput(name)).toHaveAttribute('min', '2026-10-14T00:00')
        expect(timeInput(name)).toHaveAttribute('step', '60')
        // A 4-digit year cap, so typing "2026" moves straight on to the hour in Chrome.
        expect(timeInput(name)).toHaveAttribute('max', '9999-12-31T23:59')
      }
    })

    it('leaves To empty when the server sends no scenario now (an older API)', async () => {
      const exercise = { ...MOCK_REPORT.exercise, scenarioNow: undefined }
      stubApi(() => ({ ...MOCK_REPORT, exercise }))
      renderPage()
      await screen.findByTestId('report-sheet')
      expect(timeInput('To')).toHaveValue('')
    })

    it('clears a stale From-after-To error and applies From when To moves later', async () => {
      const get = stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      const from = timeInput('From')
      const to = timeInput('To')
      pick(to, '2026-10-15 09:30')
      enter(to)
      await waitFor(() => expect(lastParams(get).to).toBe('2026-10-15 09:30'))
      pick(from, '2026-10-15 10:00')
      fireEvent.blur(from)
      expect(from).toHaveAccessibleDescription('From must not be after To.')

      pick(to, '2026-10-15 10:30')
      enter(to)

      await waitFor(() => expect(lastParams(get)).toEqual({
        sources: 'participant,scripted,engine',
        from: '2026-10-15 10:00',
        to: '2026-10-15 10:30',
      }))
      expect(from).not.toHaveAccessibleDescription('From must not be after To.')
    })

    it.each([
      ['To', 'From', '2026-10-15 09:30', '2026-10-15 10:00', '2026-10-15 11:00'],
      ['From', 'To', '2026-10-15 11:30', '2026-10-15 10:00', '2026-10-15 11:00'],
    ])('never sends an inverted window when committing %s while %s is invalid',
      async (committing, other, value, appliedFrom, appliedTo) => {
        const get = stubApi()
        renderPage()
        await screen.findByTestId('report-sheet')
        const fieldOf = (name: string) => timeInput(name as 'From' | 'To')
        pick(fieldOf('From'), appliedFrom)
        enter(fieldOf('From'))
        pick(fieldOf('To'), appliedTo)
        enter(fieldOf('To'))
        await waitFor(() => expect(lastParams(get).to).toBe(appliedTo))
        const calls = get.mock.calls.length

        halfType(fieldOf(other))
        pick(fieldOf(committing), value)
        enter(fieldOf(committing))

        expect(get.mock.calls.length).toBe(calls)
        expect(fieldOf(committing)).toHaveAccessibleDescription('From must not be after To.')
        expect(lastParams(get)).toEqual({
          sources: 'participant,scripted,engine',
          from: appliedFrom,
          to: appliedTo,
        })
      })

    it('describes the disabled last source and keeps filters before Print in tab order', async () => {
      stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      await user.click(screen.getByRole('checkbox', { name: 'Scripted inject' }))
      await user.click(screen.getByRole('checkbox', { name: 'Engine' }))
      await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Participant' })).toBeDisabled())
      expect(screen.getByRole('checkbox', { name: 'Participant' }))
        .toHaveAccessibleDescription('At least one source is required.')
      const order = [
        screen.getByRole('button', { name: 'Back to console' }),
        timeInput('From'),
        screen.getByRole('button', { name: PRINT }),
      ]
      expect(order[0]?.compareDocumentPosition(order[1] as Node))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(order[1]?.compareDocumentPosition(order[2] as Node))
        .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    })

    it('states the whole-exercise default above the record', async () => {
      stubApi()
      renderPage()
      expect(await screen.findByTestId('filter-statement')).toHaveTextContent(
        'Showing participant, scripted inject and engine posts for the whole exercise',
      )
    })

    it('withholds the record but still renders summary and charts, with Print enabled', async () => {
      stubApi(() => ({
        ...MOCK_REPORT,
        posts: [],
        postRecord: { ...MOCK_REPORT.postRecord, matching: 5983, withheld: true },
      }))
      renderPage()
      expect(await screen.findByTestId('record-withheld')).toHaveTextContent(
        '5,983 posts match. The printable record holds up to 5,000. Narrow the sources or the time window above.',
      )
      expect(screen.queryAllByTestId('report-post')).toHaveLength(0)
      expect(screen.queryByText('No posts to list.')).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'At a glance' })).toBeInTheDocument()
      expect(screen.getByTestId('activity-chart')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: PRINT })).toBeEnabled()
    })

    it('shows a 400 detail near the filters, keeps the last good sheet, and disables Print', async () => {
      const config = { headers: new AxiosHeaders() } as InternalAxiosRequestConfig
      let calls = 0
      vi.spyOn(api, 'get').mockImplementation(() => {
        calls += 1
        if (calls === 1) return Promise.resolve(ok(MOCK_REPORT))
        return Promise.reject(new AxiosError('bad', 'ERR_BAD_REQUEST', config, null, {
          data: { detail: 'The time window ends before it starts.' },
          status: 400,
          statusText: '',
          headers: new AxiosHeaders(),
          config,
        }))
      })
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')

      await user.click(screen.getByRole('checkbox', { name: 'Engine' }))

      const alert = await screen.findByTestId('filter-server-error')
      expect(alert).toHaveTextContent('The time window ends before it starts.')
      expect(screen.getByTestId('report-sheet')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: PRINT })).toBeDisabled()
    })
  })
  describe('story 31 report scope, print polish and threads', () => {
    const lastParams = (get: ReturnType<typeof stubApi>) =>
      (get.mock.lastCall?.[1] as { params: Record<string, string> }).params
    const LATEST = 'Latest scenario day'

    // Page AC: Latest scenario day fills From/To from exercise.latestDay and applies.
    it('Latest scenario day fills From and To from latestDay and applies them', async () => {
      const get = stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')

      await user.click(screen.getByRole('button', { name: LATEST }))

      await waitFor(() => expect(lastParams(get)).toEqual({
        sources: 'participant,scripted,engine',
        from: '2026-10-15 00:00',
        to: '2026-10-15 23:59',
      }))
      expect(timeInput('From')).toHaveValue('2026-10-15T00:00')
      expect(timeInput('To')).toHaveValue('2026-10-15T23:59')
    })

    // Page AC: ... disabled when null.
    it('disables Latest scenario day when the exercise has no latestDay', async () => {
      stubApi(() => ({ ...MOCK_REPORT, exercise: { ...MOCK_REPORT.exercise, latestDay: null } }))
      renderPage()
      await screen.findByTestId('report-sheet')
      expect(screen.getByRole('button', { name: LATEST })).toBeDisabled()
    })

    // DF-45 scopes summary.posts to the window: a window with no posts is not an empty exercise.
    it('keeps the sheet (and its filter statement) for a window that matches no posts', async () => {
      stubApi(() => ({
        ...MOCK_REPORT,
        summary: { ...MOCK_REPORT.summary, posts: 0 },
        posts: [],
        omittedNoiseCount: 0,
        postRecord: { ...MOCK_REPORT.postRecord, matching: 0, from: '2026-10-15 03:00', to: '2026-10-15 04:00' },
      }))
      renderPage()
      expect(await screen.findByTestId('report-sheet')).toBeInTheDocument()
      expect(screen.queryByTestId('report-empty')).not.toBeInTheDocument()
      expect(screen.getByTestId('filter-statement')).toBeInTheDocument()
    })

    // On a one-day exercise the preset's 00:00 is before the first post; the field must accept
    // the value the button itself filled in.
    it('accepts the preset From on a one-day exercise when the field is blurred', async () => {
      const oneDay = {
        ...MOCK_REPORT,
        exercise: {
          ...MOCK_REPORT.exercise,
          scenarioStart: '2026-10-15 09:00',
          latestDay: { from: '2026-10-15 00:00', to: '2026-10-15 23:59' },
        },
      }
      stubApi(() => oneDay)
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      await user.click(screen.getByRole('button', { name: LATEST }))

      await user.click(timeInput('From'))
      await user.tab()
      expect(screen.queryByText(/or later/)).not.toBeInTheDocument()
    })

    // The window narrows scenarioStart; widening it again must still be accepted back to the
    // real exercise start (kept from the unfiltered report).
    it('still validates From against the exercise start after a window narrowed the header', async () => {
      const get = stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      await user.click(screen.getByRole('button', { name: LATEST }))
      await waitFor(() => expect(screen.getByTestId('window-filtered')).toBeInTheDocument())

      const from = timeInput('From')
      pick(from, '2026-10-14 16:30')
      enter(from)
      await waitFor(() => expect(lastParams(get).from).toBe('2026-10-14 16:30'))
    })

    // Page AC: header window + conducted date reflect the window; "filtered" noted.
    it('shows the window-scoped header and notes "filtered" only when a window is set', async () => {
      stubApi()
      const user = userEvent.setup()
      renderPage()
      await screen.findByTestId('report-sheet')
      expect(screen.queryByTestId('window-filtered')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: LATEST }))

      const filtered = await screen.findByTestId('window-filtered')
      expect(filtered).toHaveTextContent('filtered')
      expect(screen.getByText('09:04 – 10:30 (Eastern Time)')).toBeInTheDocument()
      expect(screen.getByText('Thu 15 Oct 2026')).toBeInTheDocument()
      // The window is one day: nothing below needs a date.
      expect(screen.queryByText(/Taken down at 15 Oct/)).not.toBeInTheDocument()
      expect(screen.getByText('Taken down at 10:21')).toBeInTheDocument()
    })

    // Page AC: inject table title once; ref only when non-null.
    it('prints an inject title once, with the MSEL number before it only when there is one', async () => {
      stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      const table = screen.getByRole('table')
      expect(within(table).getByRole('cell', { name: 'Pressure drop' })).toBeInTheDocument()
      expect(within(table).getByRole('cell', { name: 'Impersonator: brown water' })).toBeInTheDocument()
      expect(within(table).getByRole('cell', { name: '#2 Boil-water advisory issued' })).toBeInTheDocument()
      expect(within(table).queryByText(/Pressure drop Pressure drop/)).not.toBeInTheDocument()
    })

    // Page AC: dates on a multi-day span (inject table, chart key).
    it('puts dates on inject times and the key when the report spans days', async () => {
      stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      const table = screen.getByRole('table')
      expect(within(table).getByText('15 Oct 09:04')).toBeInTheDocument()
      expect(within(table).getByText('7 min · 15 Oct 09:11')).toBeInTheDocument()
      const key = screen.getByTestId('marker-key')
      expect(within(key).getByText('1 · 14 Oct 16:20 · Pressure drop')).toBeInTheDocument()
      expect(within(key).getAllByRole('listitem')).toHaveLength(MOCK_REPORT.activity.injectMarkers.length)
    })

    // Page AC: threads (DF-47): indent, one level, root's group, unlisted parent at own time.
    it('indents replies under their thread root, keeps a thread in its root group, and prints an unlisted-parent reply flat', async () => {
      stubApi()
      renderPage()
      await screen.findByTestId('report-sheet')
      const articleOf = (text: string) => {
        const node = screen.getByText(text).closest('[data-testid="report-post"]')
        if (node === null) throw new Error(`no post for ${text}`)
        return node as HTMLElement
      }
      const reply = articleOf("Is formula OK if I use bottled water? I'm on Birch, which zone is that?")
      const grandchild = articleOf('Birch is Zone 3. Formula made with bottled or boiled water is fine.')
      const lateReply = articleOf('Please ignore this account. It is not affiliated with Fairhaven Water.')
      const orphanReply = articleOf('Pressure is back on Birch, thank you.')
      const root = articleOf('Free bottled water is available now at Elm Street Fire Station and Fairhaven High School until 8 PM. Bring ID showing an Eastside address. #WaterIssues')

      expect(reply).toHaveAttribute('data-nested', 'true')
      expect(grandchild).toHaveAttribute('data-nested', 'true') // a reply to a reply: one level only
      expect(lateReply).toHaveAttribute('data-nested', 'true')
      expect(root).not.toHaveAttribute('data-nested')
      expect(orphanReply).not.toHaveAttribute('data-nested')
      // NFR-001: the structure is in text as well as indentation.
      expect(within(reply).getByText('Replying to @KestrelCoEM')).toBeInTheDocument()
      expect(within(grandchild).getByText('Replying to @mvega_fh')).toBeInTheDocument()
      expect(within(orphanReply).getByText('Replying to @tbrandt41')).toBeInTheDocument()
      // The 10:02 reply sits under its 09:40 root in the same (09:30) group, never split.
      const rootOfLate = articleOf('URGENT: Do NOT boil your water. Boiling concentrates the contaminants. Use only bottled water until further notice. #WaterIssues')
      expect(lateReply.parentElement).toBe(rootOfLate.parentElement)
      // The orphan reply lands in its own 10:30 group.
      expect(orphanReply.parentElement?.previousElementSibling).toHaveTextContent('15 Oct 2026 · 10:30')
    })
  })
})
