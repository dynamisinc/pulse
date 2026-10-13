/**
 * features/participantAdmin/cards/CardSheetPreview.test.tsx
 * ---------------------------------------------------------------------------
 * The preview: portal location, the loaded sheet, the skipped summary, the 409/403/401/400/
 * unreadable-response messages, the on-screen banner (and that it is outside the print
 * subtree), Print, Close, Escape, the focus trap and inert handling, the `@page` rule that
 * exists only while the preview is open, and the no-cache / exercise-keyed query.
 *
 * jsdom cannot evaluate print media, so the paper itself is covered by the CSS guard in
 * `cardSheet.css.test.ts` and the manual checklist in this folder's README.
 */
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CardSheetPreview } from './CardSheetPreview'
import { CARD_SHEET_PAGE_RULE, PAGE_STYLE_ATTR, PERSONAL_LINKS_WARNING } from './cardFormat'
import { PrintCardsButton } from './PrintCardsButton'
import { buildMockCards, resetMockCards, setMockCardsScenario } from './cardsMocks'
import { TEST_EXERCISE_ID, renderWithProviders, spyOnCardsEndpoint } from './cardsTestUtils'
import { ROSTER_CARDS_KEY_ROOT, rosterCardsKey } from './useRosterCards'
import styles from './cardSheet.module.css'

const SHEET_OPEN_CLASS = styles.sheetOpen ?? 'sheetOpen'

let printSpy: ReturnType<typeof vi.spyOn>
let appRoot: HTMLDivElement

beforeEach(() => {
  printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
  // The real app mounts into <div id="root">; the preview is a SIBLING of it.
  appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.appendChild(appRoot)
})

afterEach(() => {
  appRoot.remove()
  resetMockCards()
  vi.restoreAllMocks()
})

async function renderPreview(ids: readonly string[] = [], onClose: () => void = () => {}) {
  return renderWithProviders(<CardSheetPreview participantIds={ids} onClose={onClose} />)
}

async function loaded() {
  return screen.findByTestId('card-sheet')
}

/** A cards request that stays pending until `release()`, so the loading state is observable. */
function holdCards() {
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  spyOnCardsEndpoint(async () => {
    await gate
    return { exerciseName: 'X', cards: buildMockCards(2), skipped: [] }
  })
  return { release }
}

describe('CardSheetPreview - location and dialog semantics', () => {
  it('is a portal appended to document.body, a sibling of #root (not inside the app tree)', async () => {
    await renderPreview()
    const dialog = await screen.findByRole('dialog')
    expect(dialog.parentElement).toBe(document.body)
    expect(document.getElementById('root')?.parentElement).toBe(document.body)
    expect(appRoot.contains(dialog)).toBe(false)
  })

  it('is a modal dialog labelled by its title', async () => {
    await renderPreview()
    const dialog = await screen.findByRole('dialog', { name: 'Print cards' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const labelId = dialog.getAttribute('aria-labelledby')
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId ?? '')).toHaveTextContent('Print cards')
  })

  it('is described by the personal-links warning, so it is read when the dialog opens', async () => {
    await renderPreview()
    const dialog = await screen.findByRole('dialog')
    const describedBy = dialog.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy ?? '')).toBe(screen.getByTestId('card-sheet-banner'))
    expect(dialog).toHaveAccessibleDescription(PERSONAL_LINKS_WARNING)
  })

  it('moves focus into the dialog on open', async () => {
    await renderPreview()
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveFocus()
  })
})

describe('CardSheetPreview - the loaded sheet', () => {
  it('shows every card and a count', async () => {
    await renderPreview()
    await loaded()
    expect(screen.getAllByTestId('roster-card')).toHaveLength(20)
    expect(screen.getByTestId('card-sheet-status')).toHaveTextContent('20 cards ready to print')
  })

  it('announces through a polite live region that exists from the first render', async () => {
    const { release } = holdCards()
    await renderPreview()
    const status = screen.getByTestId('card-sheet-status')
    expect(status).toHaveAttribute('role', 'status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Loading cards')
    expect(screen.getByTestId('card-sheet-loading')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    release()
    await loaded()
    // The SAME element updated in place, which is what makes a live region announce.
    expect(screen.getByTestId('card-sheet-status')).toBe(status)
    expect(status).toHaveTextContent('2 cards ready to print')
    expect(screen.getByRole('button', { name: 'Print' })).toBeEnabled()
  })

  it('says how many were left out and why, by reason, and what to do', async () => {
    await renderPreview()
    await loaded()
    const skipped = screen.getByTestId('card-sheet-skipped')
    expect(skipped).toHaveTextContent('4 people were left out of this sheet:')
    for (const line of [
      '1 with no active link',
      '1 disabled',
      '1 whose link needs reissue',
      '1 not found',
    ]) {
      expect(within(skipped).getByText(line)).toBeInTheDocument()
    }
    expect(skipped).toHaveTextContent('Fix them in the roster, then print again.')
    // Inside the same live region, so it is announced with the count.
    expect(screen.getByTestId('card-sheet-status')).toContainElement(skipped)
  })

  it('shows no skipped summary when nobody was left out', async () => {
    await renderPreview(['a', 'b'])
    await loaded()
    expect(screen.getByTestId('card-sheet-status')).toHaveTextContent('2 cards ready to print')
    expect(screen.queryByTestId('card-sheet-skipped')).not.toBeInTheDocument()
  })

  it('uses the singular for one card and one skipped person', async () => {
    spyOnCardsEndpoint(() => ({
      exerciseName: 'X',
      cards: [{
        participantId: 'a', name: 'A', signInName: 'a1', joinUrl: 'https://h/join/t', qrSvgDataUri: 'x',
      }],
      skipped: [{ participantId: 'b', reason: 'disabled' }],
    }))
    await renderPreview(['a', 'b'])
    await loaded()
    expect(screen.getByTestId('card-sheet-status')).toHaveTextContent('1 card ready to print')
    expect(screen.getByTestId('card-sheet-skipped')).toHaveTextContent('1 person was left out')
  })

  it('says so, and disables Print, when every requested person was skipped', async () => {
    spyOnCardsEndpoint(() => ({
      exerciseName: 'X',
      cards: [],
      skipped: [{ participantId: 'b', reason: 'noActiveLink' }],
    }))
    await renderPreview(['b'])
    expect(await screen.findByTestId('card-sheet-empty')).toHaveTextContent('There are no cards to print')
    expect(screen.getByTestId('card-sheet-skipped')).toHaveTextContent('1 with no active link')
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
  })
})

describe('CardSheetPreview - errors replace the sheet', () => {
  it('409 (links not configured): a clear message, no sheet, no Print, no retry', async () => {
    setMockCardsScenario('notConfigured')
    await renderPreview()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Personal links are not set up on this server')
    expect(screen.queryByTestId('card-sheet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('403: a clear access message, no sheet', async () => {
    setMockCardsScenario('forbidden')
    await renderPreview()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('You do not have access to print cards')
    expect(alert).toHaveTextContent('controllers and planners')
    expect(screen.queryByTestId('card-sheet')).not.toBeInTheDocument()
  })

  it('401 (staff session ended): says so and tells staff to sign in again, no retry', async () => {
    setMockCardsScenario('unauthorized')
    await renderPreview()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Your staff session has ended')
    expect(alert).toHaveTextContent('Sign in again')
    expect(screen.queryByTestId('card-sheet')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('400 (the request itself was refused): does not blame the connection, no retry', async () => {
    // A non-empty input with nothing usable is refused as a bad request, nothing is sent.
    await renderPreview([''])
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The server did not accept this card request')
    expect(alert).toHaveTextContent('select the people again')
    expect(alert.textContent).not.toMatch(/connection/i)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('an unreadable 200 body: says the page could not read it, not "check your connection"', async () => {
    spyOnCardsEndpoint(() => ({ nothing: 'like the contract' }))
    await renderPreview()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The server sent cards this page could not read')
    expect(alert).toHaveTextContent('different versions')
    expect(alert.textContent).not.toMatch(/connection/i)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('a network or server failure: the generic message with Try again', async () => {
    setMockCardsScenario('serverError')
    await renderPreview()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The cards could not be loaded')
    expect(alert).toHaveTextContent('Check your connection')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('anything else: a generic message with Try again, which refetches', async () => {
    const user = userEvent.setup()
    setMockCardsScenario('serverError')
    await renderPreview()
    expect(await screen.findByRole('alert')).toHaveTextContent('The cards could not be loaded')
    setMockCardsScenario('ok')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await loaded()).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keeps Close working in every error state', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    setMockCardsScenario('forbidden')
    await renderPreview([], onClose)
    await screen.findByRole('alert')
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('CardSheetPreview - the on-screen warning banner', () => {
  it('reads the specified sentence', async () => {
    await renderPreview()
    await loaded()
    expect(screen.getByTestId('card-sheet-banner')).toHaveTextContent(PERSONAL_LINKS_WARNING)
  })

  it('is present while loading and in an error state too', async () => {
    const { release } = holdCards()
    await renderPreview()
    expect(screen.getByTestId('card-sheet-banner')).toHaveTextContent(PERSONAL_LINKS_WARNING)
    release()
    await loaded()
  })

  it('is present when the cards failed to load', async () => {
    setMockCardsScenario('forbidden')
    await renderPreview()
    await screen.findByRole('alert')
    expect(screen.getByTestId('card-sheet-banner')).toHaveTextContent(PERSONAL_LINKS_WARNING)
  })

  it('is screen-only chrome, outside the printed sheet', async () => {
    await renderPreview()
    const sheet = await loaded()
    const banner = screen.getByTestId('card-sheet-banner')
    const screenOnly = screen.getByTestId('card-sheet-screen-only')
    expect(screenOnly).toContainElement(banner)
    expect(sheet.contains(banner)).toBe(false)
    expect(screenOnly.contains(sheet)).toBe(false)
    expect(sheet).toHaveTextContent(/.+/)
    expect(sheet.textContent).not.toContain('shred any left over')
  })

  it('keeps the toolbar and the skipped summary out of the printed sheet as well', async () => {
    await renderPreview()
    const sheet = await loaded()
    const screenOnly = screen.getByTestId('card-sheet-screen-only')
    expect(screenOnly).toContainElement(screen.getByRole('button', { name: 'Print' }))
    expect(screenOnly).toContainElement(screen.getByRole('button', { name: 'Close' }))
    expect(screenOnly).toContainElement(screen.getByTestId('card-sheet-skipped'))
    expect(within(sheet).queryAllByRole('button')).toHaveLength(0)
    // The stage (the part that prints) holds the sheet and nothing else.
    expect(screen.getByTestId('card-sheet-stage').children).toHaveLength(1)
    expect(screen.getByTestId('card-sheet-stage').firstElementChild).toBe(sheet)
  })

  it('does not use colour alone: it carries an icon and text', async () => {
    await renderPreview()
    await loaded()
    const banner = screen.getByTestId('card-sheet-banner')
    expect(banner.querySelector('svg')).not.toBeNull()
    expect(banner).toHaveTextContent(/personal sign-in links/)
  })
})

describe('CardSheetPreview - Print and Close', () => {
  it('Print calls window.print()', async () => {
    const user = userEvent.setup()
    await renderPreview()
    await loaded()
    await user.click(screen.getByRole('button', { name: 'Print' }))
    expect(printSpy).toHaveBeenCalledTimes(1)
  })

  it('Close calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    await renderPreview([], onClose)
    await loaded()
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape calls onClose', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    await renderPreview([], onClose)
    await loaded()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Escape closes even while the cards are still loading', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { release } = holdCards()
    await renderPreview([], onClose)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    release()
    await loaded()
  })
})

describe('CardSheetPreview - focus and inert handling', () => {
  it('wraps Tab from the last control to the first, and Shift+Tab back', async () => {
    const user = userEvent.setup()
    await renderPreview()
    await loaded()
    const print = screen.getByRole('button', { name: 'Print' })
    const stage = screen.getByTestId('card-sheet-stage')

    stage.focus()
    await user.tab()
    expect(print).toHaveFocus()

    await user.tab({ shift: true })
    expect(stage).toHaveFocus()
  })

  it('keeps Tab order Print, Close, then the scrollable sheet region', async () => {
    const user = userEvent.setup()
    await renderPreview()
    await loaded()
    screen.getByRole('button', { name: 'Print' }).focus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Close' })).toHaveFocus()
    await user.tab()
    expect(screen.getByTestId('card-sheet-stage')).toHaveFocus()
  })

  it('names the scrollable region so a keyboard user can scroll the sheet', async () => {
    await renderPreview()
    await loaded()
    const stage = screen.getByRole('region', { name: 'Printable cards' })
    expect(stage).toHaveAttribute('tabindex', '0')
  })

  it('pulls focus back if it escapes the dialog', async () => {
    await renderPreview()
    await loaded()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    expect(screen.getByRole('dialog')).toHaveFocus()
    outside.remove()
  })

  it('makes everything else on the page inert while open, and restores it on close', async () => {
    const alreadyInert = document.createElement('div')
    alreadyInert.setAttribute('inert', '')
    document.body.appendChild(alreadyInert)

    const { unmount } = await renderPreview()
    await screen.findByRole('dialog')
    expect(appRoot).toHaveAttribute('inert')
    expect(screen.getByRole('dialog')).not.toHaveAttribute('inert')

    unmount()
    expect(appRoot).not.toHaveAttribute('inert')
    // One it did not set stays as it found it.
    expect(alreadyInert).toHaveAttribute('inert')
    alreadyInert.remove()
  })

  it('scopes the print rules to "preview open" with a class on <html>, removed on close', async () => {
    expect(document.documentElement.classList.contains(SHEET_OPEN_CLASS)).toBe(false)
    const { unmount } = await renderPreview()
    await screen.findByRole('dialog')
    expect(document.documentElement.classList.contains(SHEET_OPEN_CLASS)).toBe(true)
    unmount()
    expect(document.documentElement.classList.contains(SHEET_OPEN_CLASS)).toBe(false)
  })

  it('removes the dialog from the document on unmount', async () => {
    const { unmount } = await renderPreview()
    await screen.findByRole('dialog')
    unmount()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

/** The text of every `<style>` in the document that holds an `@page` rule. */
function pageRules(): string[] {
  return Array.from(document.querySelectorAll('style'))
    .map(style => style.textContent ?? '')
    .filter(text => text.includes('@page'))
}

describe('CardSheetPreview - the @page rule exists only while the preview is open', () => {
  it('there is no @page rule anywhere while the preview is closed', async () => {
    // The button (closed) is what the roster mounts; this loads the whole module graph,
    // including the stylesheet, exactly as the eagerly-imported route does.
    await renderWithProviders(<PrintCardsButton selection={[]} />)
    expect(pageRules()).toHaveLength(0)
    expect(document.querySelector(`style[${PAGE_STYLE_ATTR}]`)).toBeNull()
  })

  it('adds exactly one @page rule (Letter portrait, 0.5in) when it opens', async () => {
    await renderPreview()
    await screen.findByRole('dialog')
    expect(pageRules()).toEqual([CARD_SHEET_PAGE_RULE])
    expect(document.querySelectorAll(`style[${PAGE_STYLE_ATTR}]`)).toHaveLength(1)
    expect(document.head).toContainElement(document.querySelector(`style[${PAGE_STYLE_ATTR}]`))
  })

  it('removes it when the preview closes, leaving none behind', async () => {
    const { unmount } = await renderPreview()
    await screen.findByRole('dialog')
    unmount()
    expect(pageRules()).toHaveLength(0)
  })

  it('leaves none behind after opening and closing it through the button, twice', async () => {
    const user = userEvent.setup()
    spyOnCardsEndpoint(() => ({ exerciseName: 'X', cards: buildMockCards(1), skipped: [] }))
    await renderWithProviders(<PrintCardsButton selection={[]} />)
    for (let round = 0; round < 2; round += 1) {
      await user.click(screen.getByRole('button', { name: 'Print all cards' }))
      await screen.findByTestId('card-sheet')
      expect(pageRules()).toHaveLength(1)
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
      expect(pageRules()).toHaveLength(0)
    }
  })
})

describe('CardSheetPreview - secrets and isolation', () => {
  it('keys the query by the active exercise id and the sorted participant ids', async () => {
    const { queryClient } = await renderPreview(['b', 'a'])
    await loaded()
    const keys = queryClient.getQueryCache().findAll().map(query => query.queryKey)
    expect(keys).toEqual([[ROSTER_CARDS_KEY_ROOT, TEST_EXERCISE_ID, ['a', 'b']]])
  })

  it('keys an empty selection ("everyone") as all', async () => {
    const { queryClient } = await renderPreview([])
    await loaded()
    const keys = queryClient.getQueryCache().findAll().map(query => query.queryKey)
    expect(keys).toEqual([[ROSTER_CARDS_KEY_ROOT, TEST_EXERCISE_ID, 'all']])
  })

  it('does not cache: stale at once, collected at once, and gone when the preview closes', async () => {
    const { queryClient, unmount } = await renderPreview(['a'])
    await loaded()
    const query = queryClient.getQueryCache().find({
      queryKey: rosterCardsKey(TEST_EXERCISE_ID, ['a']),
    })
    // `staleTime` lives on the observer's options; `gcTime` and `retry` on the query's.
    expect(query?.observers[0]?.options.staleTime).toBe(0)
    expect(query?.options.gcTime).toBe(0)
    expect(query?.options.retry).toBe(false)

    unmount()
    await waitFor(() => expect(queryClient.getQueryCache().findAll()).toHaveLength(0))
  })

  it('writes no card data to storage and puts no join URL in the title, the address or the console', async () => {
    const logs = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
    ]
    await renderPreview()
    await loaded()

    expect(window.localStorage).toHaveLength(0)
    expect(window.sessionStorage).toHaveLength(0)
    expect(document.title).not.toContain('/join/')
    expect(window.location.href).not.toContain('/join/')
    for (const log of logs) {
      expect(JSON.stringify(log.mock.calls)).not.toContain('/join/')
    }
    // No element carries the link in an attribute (title, aria-label, data-*, href).
    const leaky = Array.from(document.body.querySelectorAll('*')).filter(element =>
      Array.from(element.attributes).some(attr =>
        attr.name !== 'src' && attr.value.includes('/join/')))
    expect(leaky).toHaveLength(0)
  })
})
