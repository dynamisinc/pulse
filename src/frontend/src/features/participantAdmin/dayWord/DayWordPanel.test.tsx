/**
 * features/participantAdmin/dayWord/DayWordPanel.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 11: the staff "Today's word" panel, driven end to end through
 * the SHIPPED mock seam (real hook + service + the in-memory mock adapter that
 * `USE_MOCK_DATA` attaches under Vitest), so the panel is proven to run and to
 * match the frozen contract with no backend. State is put in place and error
 * paths are reached through `dayWordMockControls`.
 *
 * `@/core/exerciseContext` is mocked at the module boundary (as the sibling staff
 * suites do) so each test controls the exercise id synchronously. The panel
 * renders inside the COBRA `ThemeProvider` + a React Query client, as the staff
 * frame will mount it.
 *
 * Secrets (the word is absent from the cache and storage) live in
 * `DayWordPanel.secrets.test.tsx`; the exercise-keyed cache lives in
 * `useDayWord.test.tsx`.
 */
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { DayWordPanel, NO_WORD_MESSAGE, ROTATE_CONFIRM_MESSAGE } from './DayWordPanel'
import { dayWordMockControls } from './dayWordMocks'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

const mockContext = vi.mocked(useExerciseContext)

// These tests mount the full MUI/Emotion panel and drive several async round trips
// through the mock adapter; on a loaded CI box the 10 s default is too tight.
vi.setConfig({ testTimeout: 30_000 })

const NOW = new Date('2026-10-13T16:00:00.000Z') // 12:00 EDT, Tuesday 2026-10-13
const TODAY = '2026-10-13'

function scope(exerciseId = 'ex-A'): ExerciseScope {
  return {
    exerciseId,
    exerciseName: 'Coastal Surge',
    timeZone: 'America/New_York',
    status: 'live',
  }
}

function renderPanel() {
  mockContext.mockReturnValue(scope())
  const queryClient = new QueryClient({
    // `retryDelay: 0` keeps a status query that the hook retries (network / 5xx)
    // from waiting out React Query's real back-off in a test.
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  const utils = render(<DayWordPanel />, { wrapper: Wrapper })
  return { ...utils, queryClient }
}

/** Renders and waits for the status to load. */
async function renderLoaded() {
  const utils = renderPanel()
  await screen.findByTestId('day-word-date-line')
  return utils
}

type User = ReturnType<typeof userEvent.setup>

/**
 * Enters `text` by pasting it. A keystroke-by-keystroke `user.type` re-renders the
 * whole panel (and its Emotion styles) per character, which times out on a loaded
 * CI box; the tests that care about per-keystroke feedback still use `user.type`
 * for a few characters.
 */
async function enter(user: User, field: HTMLElement, text: string) {
  await user.click(field)
  await user.paste(text)
}

const liveRegionText = () => screen.getByTestId('day-word-live-region').textContent ?? ''
const resultWord = () => screen.getByTestId('day-word-value').textContent ?? ''

beforeEach(() => {
  vi.restoreAllMocks()
  dayWordMockControls.reset()
  dayWordMockControls.setNow(NOW)
})

describe('status: not set', () => {
  it('names the date, the exercise time zone and when today ends', async () => {
    await renderLoaded()

    const line = screen.getByTestId('day-word-date-line')
    expect(line).toHaveTextContent('Tuesday, October 13, 2026')
    expect(line).toHaveTextContent('America/New_York')
    expect(line).toHaveTextContent(/Today ends Oct 14, 2026.*12:00.AM.EDT/)
  })

  it('shows the prominent "No word is set" message, with an icon, not colour alone', async () => {
    await renderLoaded()

    const banner = screen.getByTestId('day-word-status-unset')
    expect(banner).toHaveTextContent(NO_WORD_MESSAGE)
    expect(NO_WORD_MESSAGE).toBe(
      'No word is set for today. People can only sign in with their personal link.',
    )
    expect(banner.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
    expect(screen.queryByText(/Today's word is set/)).not.toBeInTheDocument()
  })

  it('takes its accent edge from the theme token (notifications.warningText)', async () => {
    await renderLoaded()
    const banner = screen.getByTestId('day-word-status-unset')
    // #6F4E37 is cobraTheme.palette.notifications.warningText.
    expect(getComputedStyle(banner).borderLeftColor).toBe('rgb(111, 78, 55)')
    expect(cobraTheme.palette.notifications.warningText).toBe('#6F4E37')
  })

  it('offers Generate a word and Set my own word, and no turn-off control', async () => {
    await renderLoaded()

    expect(screen.getByRole('button', { name: 'Generate a word' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Set my own word' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /turn off word sign-in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /rotate/i })).not.toBeInTheDocument()
  })

  it('never shows or fetches a word on load', async () => {
    await renderLoaded()

    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
    expect(screen.queryByTestId('day-word-value')).not.toBeInTheDocument()
    expect(dayWordMockControls.putRequests()).toEqual([])
  })
})

describe('status: set', () => {
  it('says the word is set, who set it, when, and how many times it was replaced', async () => {
    dayWordMockControls.seedWord(TODAY, {
      setByName: 'Alex Rivera',
      setAt: '2026-10-13T13:02:00.000Z',
      replacedCount: 2,
    })
    await renderLoaded()

    const banner = screen.getByTestId('day-word-status-set')
    expect(banner).toHaveTextContent("Today's word is set")
    expect(banner).toHaveTextContent('Set by Alex Rivera')
    expect(banner).toHaveTextContent(/Oct 13, 2026.*9:02.AM.EDT/)
    expect(banner).toHaveTextContent('Replaced 2 times')
    expect(banner.querySelector('svg[data-icon="circle-check"]')).not.toBeNull()
    expect(screen.queryByText(NO_WORD_MESSAGE)).not.toBeInTheDocument()
  })

  it('uses the singular for one replacement', async () => {
    dayWordMockControls.seedWord(TODAY, { replacedCount: 1 })
    await renderLoaded()
    expect(screen.getByTestId('day-word-status-set')).toHaveTextContent('Replaced 1 time.')
  })

  it('reads Rotate word and offers the turn-off control', async () => {
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()

    expect(screen.getByRole('button', { name: 'Rotate word' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Generate a word' })).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Turn off word sign-in for today' }),
    ).toBeEnabled()
  })
})

describe('generate a word', () => {
  it('PUTs with no word but WITH the displayed date, then shows the word once', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const put = vi.spyOn(api, 'put')

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    const result = await screen.findByTestId('day-word-result')
    expect(dayWordMockControls.putRequests()).toEqual([{ hasWord: false, date: TODAY }])
    // "Omit `word` to generate" - but the date the panel displays is ALWAYS named, today
    // included (Gate-2 W-1).
    expect(put.mock.calls[0]?.[0]).toBe('/staff/day-word')
    expect(put.mock.calls[0]?.[1]).toEqual({ date: TODAY })
    expect(within(result).getByText(/This is the only time Pulse shows this word/)).toBeVisible()
    expect(resultWord()).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
    expect(within(result).getByText(/Generated by Pulse/)).toBeInTheDocument()
    expect(within(result).getByText(/Valid until Oct 14, 2026.*12:00.AM.EDT/)).toBeInTheDocument()
    // The status behind it refreshes to "set" and the action becomes a rotation.
    expect(await screen.findByTestId('day-word-status-set')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rotate word' })).toBeInTheDocument()
  })

  it('moves focus to the result heading', async () => {
    const user = userEvent.setup()
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    const heading = await screen.findByRole('heading', { name: /Word set for Tuesday, October 13/ })
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('announces "Word set" in a live region WITHOUT the word', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const region = screen.getByTestId('day-word-live-region')
    expect(region).toHaveAttribute('role', 'status')
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('')

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')

    expect(liveRegionText()).toMatch(/Word set for Tuesday, October 13, 2026/)
    expect(liveRegionText()).not.toContain(resultWord())
    // And the word is not inside any live region.
    expect(screen.getByTestId('day-word-result').closest('[aria-live]')).toBeNull()
  })

  it('copies the word to the clipboard and says so without the word', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await navigator.clipboard.readText()).toBe(resultWord())
    await waitFor(() => expect(liveRegionText()).toMatch(/copied/i))
    expect(liveRegionText()).not.toContain(resultWord())
    expect(screen.getByTestId('day-word-copied')).toHaveTextContent('Copied')
  })

  it('tells staff when the clipboard is refused, and keeps the word on screen', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))

    await user.click(screen.getByRole('button', { name: 'Copy' }))

    expect(await screen.findByText(/Could not copy automatically/)).toBeInTheDocument()
    expect(screen.getByTestId('day-word-value')).toBeInTheDocument()
  })

  it('announces a copy failure ONCE: in its own alert, not also in the live region', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'))

    await user.click(screen.getByRole('button', { name: 'Copy' }))
    await user.click(screen.getByRole('button', { name: 'Copy' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.filter(el => /Could not copy/.test(el.textContent ?? ''))).toHaveLength(1)
    expect(liveRegionText()).not.toMatch(/could not copy/i)
  })

  it('gives the result heading its own generated id, not a fixed one', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    const result = await screen.findByTestId('day-word-result')

    const labelledBy = result.getAttribute('aria-labelledby') ?? ''
    expect(labelledBy).not.toBe('')
    expect(labelledBy).not.toBe('day-word-result-heading')
    expect(document.getElementById(labelledBy)).toHaveTextContent(/Word set for/)
  })

  it('Show large is a toggle that renders the word in very large type', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')

    const toggle = screen.getByRole('button', { name: 'Show large' })
    const word = screen.getByTestId('day-word-value')
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const normalSize = getComputedStyle(word).fontSize

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(word).toHaveAttribute('data-large', 'true')
    expect(getComputedStyle(word).fontSize).not.toBe(normalSize)
    // High-contrast: black type on a white frame, still the staff look.
    expect(getComputedStyle(word).color).toBe('rgb(0, 0, 0)')
    expect(getComputedStyle(screen.getByTestId('day-word-frame')).backgroundColor).toBe(
      'rgb(255, 255, 255)',
    )

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(word).toHaveAttribute('data-large', 'false')
  })

  it('Done closes the result and removes the word from the page', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    const word = resultWord()

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(word)
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: "Today's word" })).toHaveFocus())
  })
})

describe('set my own word', () => {
  it('checks the typed word live against the 6-to-64 rule, in text', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const field = screen.getByLabelText('Or type your own word')
    const button = screen.getByRole('button', { name: 'Set my own word' })
    expect(screen.getByText(/6 to 64 letters and digits/)).toBeInTheDocument()

    await user.type(field, 'ab c')
    expect(screen.getByText(/Too short: 3 of 6/)).toBeInTheDocument()
    expect(field).toBeInvalid()
    expect(button).toBeDisabled()

    await user.type(field, 'defg')
    expect(screen.getByText(/Looks good: 7 letters and digits count/)).toBeInTheDocument()
    expect(field).toBeValid()
    expect(button).toBeEnabled()

    await user.clear(field)
    await enter(user, field, 'x'.repeat(65))
    expect(screen.getByText(/Too long: 65/)).toBeInTheDocument()
    expect(button).toBeDisabled()
  })

  it('folds accents like the server: "Ñandú 1" is six characters and accepted', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const field = screen.getByLabelText('Or type your own word')

    await enter(user, field, 'Ñandú 1')

    expect(screen.getByText(/Looks good: 6 letters and digits count/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set my own word' })).toBeEnabled()
  })

  it('does not count capitals, spaces or punctuation (the server normalises)', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const field = screen.getByLabelText('Or type your own word')

    await enter(user, field, 'A-B C-D E')
    expect(screen.getByText(/Too short: 5 of 6/)).toBeInTheDocument()

    await user.type(field, '-F')
    expect(screen.getByText(/Looks good: 6/)).toBeInTheDocument()
  })

  it('keeps the rule hint and field label at AA contrast (not COBRA\'s 3.75:1 grey)', async () => {
    await renderLoaded()

    // text.primary (#1a1a1a), not text.secondary (#848482, 3.75:1 on white).
    expect(getComputedStyle(screen.getByText(/6 to 64 letters and digits/)).color).toBe(
      'rgb(26, 26, 26)',
    )
    expect(getComputedStyle(screen.getByText('Or type your own word', { selector: 'label' })).color)
      .toBe('rgb(26, 26, 26)')
  })

  it('does not autofill or capitalise the field', async () => {
    await renderLoaded()
    const field = screen.getByLabelText('Or type your own word')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('autocapitalize', 'none')
    expect(field).toHaveAttribute('spellcheck', 'false')
  })

  it('PUTs the typed word, shows it once as "typed", and clears the field', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const field = screen.getByLabelText('Or type your own word')

    await enter(user, field, 'Pine Cone 42')
    const put = vi.spyOn(api, 'put')
    await user.click(screen.getByRole('button', { name: 'Set my own word' }))

    const result = await screen.findByTestId('day-word-result')
    expect(dayWordMockControls.putRequests()).toEqual([{ hasWord: true, date: TODAY }])
    expect(put.mock.calls[0]?.[1]).toEqual({ word: 'Pine Cone 42', date: TODAY })
    expect(resultWord()).toBe('Pine Cone 42')
    expect(within(result).getByText(/The word you typed/)).toBeInTheDocument()
    expect(field).toHaveValue('')
  })

  it('shows the server reason on a 400 and keeps what was typed', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const field = screen.getByLabelText('Or type your own word')
    await enter(user, field, 'pinecone42')
    dayWordMockControls.failNext(400, 'That word is on the blocked list.')

    await user.click(screen.getByRole('button', { name: 'Set my own word' }))

    const alert = await screen.findByTestId('day-word-action-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent('Not saved: That word is on the blocked list.')
    expect(field).toHaveValue('pinecone42')
    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()

    // Editing clears the stale error.
    await user.type(field, 'x')
    expect(screen.queryByTestId('day-word-action-error')).not.toBeInTheDocument()
  })
})

describe('rotate a word that is already set', () => {
  it('asks first, in an alertdialog, with the exact consequence', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Rotate word' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName(/Rotate the word for Tuesday, October 13, 2026\?/)
    expect(dialog).toHaveAccessibleDescription(ROTATE_CONFIRM_MESSAGE)
    expect(ROTATE_CONFIRM_MESSAGE).toBe(
      'New sign-ins need the new word at once. People already signed in stay signed in.',
    )
    // Nothing is sent until confirmed.
    expect(dayWordMockControls.putRequests()).toEqual([])
  })

  it('puts initial focus on Cancel, the least destructive control', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Rotate word' }))

    const dialog = await screen.findByRole('alertdialog')
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus())
  })

  it('Cancel sends nothing and returns focus to the control that opened it', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    const trigger = screen.getByRole('button', { name: 'Rotate word' })
    await user.click(trigger)
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(dayWordMockControls.putRequests()).toEqual([])
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('Escape cancels', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Rotate word' }))
    await screen.findByRole('alertdialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(dayWordMockControls.putRequests()).toEqual([])
  })

  it('on confirm replaces the word the same way and shows the new one once', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Rotate word' }))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'Rotate word' }))

    const result = await screen.findByTestId('day-word-result')
    expect(dayWordMockControls.putRequests()).toEqual([{ hasWord: false, date: TODAY }])
    expect(resultWord()).toMatch(/^[a-z]+-[a-z]+-\d{2}$/)
    expect(liveRegionText()).toMatch(
      /Word set for Tuesday, October 13, 2026, replacing the previous word/,
    )
    // While the dialog fades out the page behind it is aria-hidden; once it is gone
    // the result is reachable and holds focus.
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    const heading = within(result).getByRole('heading', { name: /New word set for/ })
    await waitFor(() => expect(heading).toHaveFocus())
    expect(await screen.findByText(/Replaced 1 time\./)).toBeInTheDocument()
  })

  it('rotates to a typed word through the same confirm', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    await enter(user, screen.getByLabelText('Or type your own word'), 'harbor lights 9')

    await user.click(screen.getByRole('button', { name: 'Rotate to my own word' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Rotate word' }))

    await screen.findByTestId('day-word-result')
    expect(dayWordMockControls.putRequests()).toEqual([{ hasWord: true, date: TODAY }])
    expect(resultWord()).toBe('harbor lights 9')
  })

  it('shows a failed rotation in the panel and puts focus back on the trigger', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    const trigger = screen.getByRole('button', { name: 'Rotate word' })
    await user.click(trigger)
    const dialog = await screen.findByRole('alertdialog')
    dayWordMockControls.failNext(400, 'Not now.')

    await user.click(within(dialog).getByRole('button', { name: 'Rotate word' }))

    expect(await screen.findByTestId('day-word-action-error')).toHaveTextContent('Not now.')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe('pre-set a later date and the Upcoming list', () => {
  it('offers today plus the next 14 days, today first, in the exercise zone', async () => {
    await renderLoaded()

    const select = screen.getByLabelText('Word for') as HTMLSelectElement
    const labels = Array.from(select.options).map(option => option.textContent)

    expect(select.options).toHaveLength(15)
    expect(select.value).toBe(TODAY)
    expect(labels[0]).toBe('Today, Tue, Oct 13')
    expect(labels[1]).toBe('Wed, Oct 14')
    expect(labels[14]).toBe('Tue, Oct 27')
    expect(Array.from(select.options).map(o => o.value)[14]).toBe('2026-10-27')
    expect(screen.getByText(/up to 14 days ahead, in America\/New_York/)).toBeInTheDocument()
  })

  it('PUTs the chosen date, and lists the date (never the word) under Upcoming', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    expect(screen.getByTestId('day-word-upcoming-empty')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Word for'), '2026-10-15')
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    await screen.findByTestId('day-word-result')
    expect(dayWordMockControls.putRequests()).toEqual([{ hasWord: false, date: '2026-10-15' }])
    expect(
      screen.getByRole('heading', { name: /Word set for Thursday, October 15, 2026/ }),
    ).toBeInTheDocument()
    const word = resultWord()

    await user.click(screen.getByRole('button', { name: 'Done' }))
    const list = await screen.findByTestId('day-word-upcoming')
    expect(within(list).getByText('Thursday, October 15, 2026')).toBeInTheDocument()
    expect(list).not.toHaveTextContent(word)
    // Today is unaffected.
    expect(screen.getByTestId('day-word-status-unset')).toBeInTheDocument()
  })

  it('reads Rotate word once the chosen later date already has a word', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord('2026-10-16')
    await renderLoaded()

    const select = screen.getByLabelText('Word for')
    expect(screen.getByRole('button', { name: 'Generate a word' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: 'Fri, Oct 16 (word set)' })).toBeInTheDocument()

    await user.selectOptions(select, '2026-10-16')

    expect(screen.getByRole('button', { name: 'Rotate word' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Rotate word' }))
    expect(await screen.findByRole('alertdialog')).toHaveAccessibleName(
      /Rotate the word for Friday, October 16, 2026\?/,
    )
  })

  it('clears an upcoming date behind a confirm, and only that date', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    dayWordMockControls.seedWord('2026-10-15')
    await renderLoaded()
    const clear = await screen.findByRole('button', {
      name: 'Clear the word for Thursday, October 15, 2026',
    })

    await user.click(clear)

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName(/Clear the word for Thursday, October 15, 2026\?/)
    await user.click(within(dialog).getByRole('button', { name: 'Clear word' }))

    expect(await screen.findByTestId('day-word-upcoming-empty')).toBeInTheDocument()
    expect(liveRegionText()).toMatch(/Word cleared for Thursday, October 15, 2026/)
    // Today's word is untouched.
    expect(screen.getByTestId('day-word-status-set')).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Upcoming' })).toHaveFocus())
  })

  it('leaves an upcoming date alone when the confirm is cancelled', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord('2026-10-15')
    await renderLoaded()
    await user.click(await screen.findByRole('button', { name: /Clear the word for Thursday/ }))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('day-word-upcoming')).toBeInTheDocument()
  })
})

describe('turn off word sign-in for today', () => {
  it('asks first, then DELETEs and returns to the "No word is set" state', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()

    await user.click(screen.getByRole('button', { name: 'Turn off word sign-in for today' }))

    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveAccessibleName('Turn off word sign-in for today?')
    // Still set until confirmed.
    expect(screen.queryByTestId('day-word-status-unset')).not.toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Turn off word sign-in' }))

    expect(await screen.findByTestId('day-word-status-unset')).toHaveTextContent(NO_WORD_MESSAGE)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /turn off word sign-in/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Generate a word' })).toBeInTheDocument()
    expect(liveRegionText()).toMatch(/Word sign-in is off for today/)
    // The control that was pressed is gone, so focus lands on the panel heading.
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: "Today's word" })).toHaveFocus())
  })

  it('also drops a result view for the word that was just turned off', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    await user.click(await screen.findByRole('button', { name: 'Turn off word sign-in for today' }))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'Turn off word sign-in' }))

    await waitFor(() => expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument())
  })

  it('does nothing when cancelled', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Turn off word sign-in for today' }))
    const dialog = await screen.findByRole('alertdialog')

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('day-word-status-set')).toBeInTheDocument()
  })
})

describe('the date it displays is ALWAYS sent (Gate-2 W-1)', () => {
  /** A moment after the local-midnight rollover: the server's "today" is now Oct 14. */
  const AFTER_ROLLOVER = new Date('2026-10-14T05:00:00.000Z') // 01:00 EDT, Wednesday 2026-10-14
  const NEXT_DAY = '2026-10-14'

  it('generate sends the displayed date on the wire (today included)', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    const put = vi.spyOn(api, 'put')

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')

    expect(put).toHaveBeenCalledTimes(1)
    expect(put.mock.calls[0]?.[1]).toHaveProperty('date', TODAY)
  })

  it('rotate-today sends the displayed date on the wire, with a typed word too', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    await enter(user, screen.getByLabelText('Or type your own word'), 'harbor lights 9')
    const put = vi.spyOn(api, 'put')

    await user.click(screen.getByRole('button', { name: 'Rotate to my own word' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Rotate word' }))
    await screen.findByTestId('day-word-result')

    expect(put.mock.calls[0]?.[1]).toEqual({ word: 'harbor lights 9', date: TODAY })
  })

  it('turn-off sends ?date= for today, and words the announcement from that date', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    const del = vi.spyOn(api, 'delete')

    await user.click(screen.getByRole('button', { name: 'Turn off word sign-in for today' }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Turn off word sign-in' }))
    await screen.findByTestId('day-word-status-unset')

    expect(del).toHaveBeenCalledTimes(1)
    expect(del.mock.calls[0]?.[0]).toBe('/staff/day-word')
    expect(del.mock.calls[0]?.[1]).toMatchObject({ params: { date: TODAY } })
    expect(liveRegionText()).toContain(
      'Word sign-in is off for today, Tuesday, October 13, 2026.',
    )
  })

  it('clearing an upcoming date sends that date and names it in the announcement', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord('2026-10-15')
    await renderLoaded()
    const del = vi.spyOn(api, 'delete')

    await user.click(screen.getByRole('button', { name: /Clear the word for/ }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: 'Clear word' }))
    await screen.findByTestId('day-word-upcoming-empty')

    expect(del.mock.calls[0]?.[1]).toMatchObject({ params: { date: '2026-10-15' } })
    expect(liveRegionText()).toContain('Word cleared for Thursday, October 15, 2026.')
  })

  it('a stale panel GENERATING after the rollover fails safe: past-date 400, then it re-reads', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    expect(screen.getByTestId('day-word-date-line')).toHaveTextContent('Tuesday, October 13, 2026')
    // The panel was left open; the server has since rolled to Wednesday.
    dayWordMockControls.setNow(AFTER_ROLLOVER)

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    expect(await screen.findByTestId('day-word-action-error')).toHaveTextContent(
      'Not saved: A word cannot be set for a date in the past.',
    )
    // No word was shown, and none was set for the NEW day behind the staff member's back.
    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
    // The status was re-read, so the panel moves to the new day by itself.
    await waitFor(() =>
      expect(screen.getByTestId('day-word-date-line')).toHaveTextContent(
        'Wednesday, October 14, 2026',
      ))
    expect(await screen.findByTestId('day-word-status-unset')).toBeInTheDocument()
    expect(dayWordMockControls.putRequests()).toEqual([{ hasWord: false, date: TODAY }])
  })

  it('a stale panel ROTATING after the rollover cannot replace the new day\'s word', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    // Wednesday's word was pre-set the day before, and must survive a stale click.
    dayWordMockControls.seedWord(NEXT_DAY)
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Rotate word' }))
    const dialog = await screen.findByRole('alertdialog')
    dayWordMockControls.setNow(AFTER_ROLLOVER)

    await user.click(within(dialog).getByRole('button', { name: 'Rotate word' }))

    expect(await screen.findByTestId('day-word-action-error')).toHaveTextContent(
      'A word cannot be set for a date in the past.',
    )
    await waitFor(() =>
      expect(screen.getByTestId('day-word-date-line')).toHaveTextContent(
        'Wednesday, October 14, 2026',
      ))
    // Wednesday's word is set and was NOT replaced.
    const banner = await screen.findByTestId('day-word-status-set')
    expect(banner).toHaveTextContent('Replaced 0 times')
    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
  })

  it('a stale panel TURNING OFF after the rollover cannot clear the new day\'s word', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    dayWordMockControls.seedWord(NEXT_DAY)
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Turn off word sign-in for today' }))
    const dialog = await screen.findByRole('alertdialog')
    dayWordMockControls.setNow(AFTER_ROLLOVER)

    await user.click(within(dialog).getByRole('button', { name: 'Turn off word sign-in' }))

    // Before W-1 this DELETE named no date and silently cleared Wednesday's word.
    expect(await screen.findByTestId('day-word-action-error')).toHaveTextContent(
      'The date must be today or up to 14 days ahead.',
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    await waitFor(() =>
      expect(screen.getByTestId('day-word-date-line')).toHaveTextContent(
        'Wednesday, October 14, 2026',
      ))
    expect(await screen.findByTestId('day-word-status-set')).toBeInTheDocument()
    expect(liveRegionText()).not.toMatch(/off for today/)
  })
})

describe('errors', () => {
  it('403 on load: explains the role, and offers no controls', async () => {
    dayWordMockControls.forbid()
    renderPanel()

    const alert = await screen.findByTestId('day-word-status-error')

    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/do not have permission/i)
    expect(alert).toHaveTextContent(/controller or planner/i)
    expect(screen.queryByRole('button', { name: 'Generate a word' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('403 on set: shows the permission message in the panel', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    dayWordMockControls.forbid()

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    expect(await screen.findByTestId('day-word-action-error')).toHaveTextContent(
      /do not have permission/i,
    )
    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
  })

  it('403 on turn-off: closes the dialog and shows the message; the word stays set', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Turn off word sign-in for today' }))
    const dialog = await screen.findByRole('alertdialog')
    dayWordMockControls.forbid()

    await user.click(within(dialog).getByRole('button', { name: 'Turn off word sign-in' }))

    expect(await screen.findByTestId('day-word-action-error')).toHaveTextContent(
      /do not have permission/i,
    )
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('day-word-status-set')).toBeInTheDocument()
  })

  it('a definite failure on load can be retried', async () => {
    const user = userEvent.setup()
    dayWordMockControls.failNext(401, 'Session ended.')
    renderPanel()

    expect(await screen.findByTestId('day-word-status-error')).toHaveTextContent(
      /staff session is not active/i,
    )
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByTestId('day-word-date-line')).toBeInTheDocument()
    expect(screen.queryByTestId('day-word-status-error')).not.toBeInTheDocument()
  })
})

describe('a failed background refresh of the status', () => {
  it('keeps the one-time word on screen and shows an inline notice, not the error state', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    // The PUT succeeds; the status re-read that follows fails on every attempt
    // (the hook retries a 5xx twice, so three failures = the query ends in error).
    dayWordMockControls.failNext(503, 'Down for a moment.', { method: 'get', times: 3 })

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    const result = await screen.findByTestId('day-word-result')
    const word = resultWord()
    const notice = await screen.findByTestId('day-word-stale-warning')
    expect(notice).toHaveTextContent('Status could not be refreshed')
    expect(within(notice).getByRole('button', { name: 'Try again' })).toBeEnabled()
    // The word is still there, and so is the rest of the panel: no full error state.
    expect(result).toBeInTheDocument()
    expect(resultWord()).toBe(word)
    expect(screen.queryByTestId('day-word-status-error')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Rotate word|Generate a word/ })).toBeInTheDocument()
    expect(screen.getByTestId('day-word-date-line')).toBeInTheDocument()
  })

  it('recovers: Try again re-reads the status, drops the notice, and keeps the word', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    dayWordMockControls.failNext(503, 'Down for a moment.', { method: 'get', times: 3 })
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    const word = resultWord()
    const notice = await screen.findByTestId('day-word-stale-warning')

    await user.click(within(notice).getByRole('button', { name: 'Try again' }))

    await waitFor(() =>
      expect(screen.queryByTestId('day-word-stale-warning')).not.toBeInTheDocument())
    expect(await screen.findByTestId('day-word-status-set')).toBeInTheDocument()
    expect(resultWord()).toBe(word)
  })

  it('is a polite status, with an icon and text rather than colour alone', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    dayWordMockControls.failNext(503, 'Down for a moment.', { method: 'get', times: 3 })
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    const notice = await screen.findByTestId('day-word-stale-warning')

    expect(notice).toHaveAttribute('role', 'status')
    expect(notice.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
  })

  it('still shows the FULL error state when there is no status at all', async () => {
    dayWordMockControls.failNext(503, 'Down.', { method: 'get', times: 3 })
    renderPanel()

    expect(await screen.findByTestId('day-word-status-error')).toBeInTheDocument()
    expect(screen.queryByTestId('day-word-stale-warning')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Generate a word' })).not.toBeInTheDocument()
  })
})

describe('an answer that is not the contract shape', () => {
  it('on a set: says the word may have been set, never "check your connection"', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    dayWordMockControls.malformNext()

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    const alert = await screen.findByTestId('day-word-action-error')
    expect(alert).toHaveTextContent(
      'Pulse answered in an unexpected format. ' +
      'The word may have been set — check the status and rotate if needed.',
    )
    expect(alert.textContent).not.toMatch(/connection/i)
    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
  })

  it('refreshes the status afterwards, so the banner shows what the server did', async () => {
    const user = userEvent.setup()
    await renderLoaded()
    expect(screen.getByTestId('day-word-status-unset')).toBeInTheDocument()
    dayWordMockControls.malformNext()

    await user.click(screen.getByRole('button', { name: 'Generate a word' }))

    // The mock COMMITTED the word before garbling the answer.
    expect(await screen.findByTestId('day-word-status-set')).toBeInTheDocument()
    expect(screen.queryByTestId('day-word-status-unset')).not.toBeInTheDocument()
    // And the action now reads as a rotation, so staff can recover by rotating.
    expect(screen.getByRole('button', { name: 'Rotate word' })).toBeInTheDocument()
  })

  it('on a turn-off: a failure after the server may have committed re-reads the status', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    const get = vi.spyOn(api, 'get')
    await user.click(screen.getByRole('button', { name: 'Turn off word sign-in for today' }))
    const dialog = await screen.findByRole('alertdialog')
    dayWordMockControls.failNext(504, 'Gateway timeout.', { method: 'delete' })

    await user.click(within(dialog).getByRole('button', { name: 'Turn off word sign-in' }))

    expect(await screen.findByTestId('day-word-action-error')).toHaveTextContent(
      'Gateway timeout.',
    )
    // The failed DELETE still triggers a fresh read of the status.
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1))
  })

  it('on the initial status read: says the format was unexpected, not that the network failed', async () => {
    dayWordMockControls.malformNext()
    renderPanel()

    const alert = await screen.findByTestId('day-word-status-error')

    expect(alert).toHaveTextContent('Pulse answered in an unexpected format')
    expect(alert.textContent).not.toMatch(/connection/i)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('a null setAt / setByName from the server is read as absent, not an error', async () => {
    vi.spyOn(api, 'get').mockResolvedValueOnce({
      data: {
        timeZone: 'America/New_York',
        today: TODAY,
        todayEndsAt: '2026-10-14T04:00:00.000Z',
        todaySet: true,
        setAt: null,
        setByName: null,
        replacedCount: 0,
        upcoming: [],
      },
    })
    renderPanel()

    const banner = await screen.findByTestId('day-word-status-set')

    expect(banner).toHaveTextContent("Today's word is set")
    expect(banner).toHaveTextContent('Replaced 0 times')
    expect(screen.queryByTestId('day-word-status-error')).not.toBeInTheDocument()
  })
})

// The in-flight ref is what stops the second click of the CONFIRM dialogs: its
// button stays enabled until the call settles, and removing the ref makes the two
// confirm tests below fail (checked when it was added).
describe('a double click', () => {
  it('sends ONE PUT for a double-clicked Generate', async () => {
    await renderLoaded()
    const button = screen.getByRole('button', { name: 'Generate a word' })

    fireEvent.click(button)
    fireEvent.click(button)

    await screen.findByTestId('day-word-result')
    expect(dayWordMockControls.putRequests()).toHaveLength(1)
  })

  it('sends ONE DELETE for a double-clicked confirm, and the dialog stays until it ends', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    const del = vi.spyOn(api, 'delete')
    await user.click(screen.getByRole('button', { name: 'Turn off word sign-in for today' }))
    const dialog = await screen.findByRole('alertdialog')
    const confirmButton = within(dialog).getByRole('button', { name: 'Turn off word sign-in' })

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    expect(await screen.findByTestId('day-word-status-unset')).toBeInTheDocument()
    expect(del).toHaveBeenCalledTimes(1)
  })

  it('sends ONE PUT for a double-clicked rotate confirm', async () => {
    const user = userEvent.setup()
    dayWordMockControls.seedWord(TODAY)
    await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Rotate word' }))
    const dialog = await screen.findByRole('alertdialog')
    const confirmButton = within(dialog).getByRole('button', { name: 'Rotate word' })

    fireEvent.click(confirmButton)
    fireEvent.click(confirmButton)

    await screen.findByTestId('day-word-result')
    expect(dayWordMockControls.putRequests()).toHaveLength(1)
  })
})

describe('exercise switch', () => {
  it('drops a visible word and all state when the active exercise changes', async () => {
    const user = userEvent.setup()
    const { rerender } = await renderLoaded()
    await user.click(screen.getByRole('button', { name: 'Generate a word' }))
    await screen.findByTestId('day-word-result')
    const word = resultWord()

    mockContext.mockReturnValue(scope('ex-B'))
    rerender(<DayWordPanel />)

    expect(screen.queryByTestId('day-word-result')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(word)
    // The new exercise's status loads fresh.
    expect(await screen.findByTestId('day-word-date-line')).toBeInTheDocument()
  })
})

describe('two worlds', () => {
  it('uses the COBRA button styling and no participant skin', async () => {
    await renderLoaded()
    const button = screen.getByRole('button', { name: 'Generate a word' })
    // CobraPrimaryButton: cobalt blue background, pill radius (cobraTheme).
    expect(getComputedStyle(button).backgroundColor).toBe('rgb(0, 32, 194)')
  })
})
