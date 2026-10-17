/**
 * features/controller/components/PersonaComposer.emoji.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 12b (#508, DF-15): the shared `core/emoji` button in the
 * controller's persona composer (STAFF world, COBRA skin):
 *  - a FontAwesome face-smile button under the persona text field, skinned by
 *    `PersonaComposerEmoji.module.css` (no participant skin);
 *  - a chosen emoji goes in at the caret, or over the selection, and focus stays in
 *    the text field with the caret just past it;
 *  - the emoji counts toward the character limit like any typed character (the
 *    counter, and Post blocked when over);
 *  - keyboard: Enter on the button opens it with focus in the search box, typing
 *    filters, arrows move the active emoji, Enter inserts it;
 *  - INSIDE THE REAL PERSONA DOCK: Escape closes only the picker and returns focus to
 *    the text field (selection intact) - it never closes the dock; Escape on the open
 *    trigger likewise; the next Escape from the text field is the dock's again;
 *  - NO NETWORK: no fetch / XMLHttpRequest while the picker is used;
 *  - the COBRA skin sets EVERY `--emoji-*` property the picker reads (both sets are
 *    parsed from the stylesheets on disk, so a property added to the picker later
 *    fails here until the skin sets it), each value is the COBRA palette entry it
 *    claims to mirror, and the text/edge pairs meet WCAG AA contrast; the trigger's
 *    rest / hover / active / focus colours mirror `CobraSecondaryButton`'s.
 *  - Ctrl/Cmd+Enter in the picker's search box inserts the emoji and never posts (the
 *    `onPublished` spy; the same chord from the text field does post).
 * The in-flight lock (button disabled, an open picker closed while a post is out) is
 * in `PersonaComposer.emoji.inFlight.test.tsx` (it needs the live-mode module mocks).
 */
import { useState, type ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetMockMediaRegistry } from '@/core/media/mockMediaRegistry'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { contrastRatio } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import type { StaffPersona } from '@/features/personas'
import type { Post } from '@/features/social'
import { PersonaDockHost } from '../console/personaDockHost.tsx'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer } from './PersonaComposer'
import emojiSkin from './PersonaComposerEmoji.module.css'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is fixed to "controller" here.
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

const POST_FIELD = 'Post as Fairhaven Water'

const PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-mock-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

interface DockOptions {
  readonly onClose?: () => void
  readonly onPublished?: (post: Post) => void
  readonly charLimit?: number
}

/** The composer mounted in the real persona dock (whose Escape closes it). */
async function renderInDock({ onClose = () => {}, onPublished, charLimit }: DockOptions = {}) {
  render(
    <Providers>
      <PersonaDockHost
        open
        onClose={onClose}
        slots={{
          composer: (
            <PersonaComposer
              activePersona={PERSONA}
              actingHumanId="human-ctl-7"
              callSign="SIMCELL-3"
              {...(charLimit !== undefined ? { charLimit } : {})}
              {...(onPublished !== undefined ? { onPublished } : {})}
            />
          ),
        }}
      />
    </Providers>,
  )
  await waitFor(() => expect(screen.getByTestId('persona-composer')).toBeInTheDocument())
  return asTextArea(screen.getByLabelText(POST_FIELD))
}

function asTextArea(element: HTMLElement): HTMLTextAreaElement {
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('not a textarea')
  return element
}

/** A class name from the COBRA skin module (throws if the module does not define it). */
function skinClass(name: 'button' | 'picker'): string {
  const className = emojiSkin[name]
  if (className === undefined || className === '') throw new Error(`no .${name} in the skin`)
  return className
}

function emojiButton(): HTMLElement {
  return within(screen.getByTestId('persona-composer')).getByRole('button', { name: 'Add emoji' })
}

beforeEach(() => {
  resetTelemetryBuffer()
  resetMockMediaRegistry()
  composeAsPersonaDraftStore.resetForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PersonaComposer — emoji picker (story 12b)', () => {
  it('has a face-smile button under the text field, with the COBRA skin', async () => {
    const user = userEvent.setup()
    const input = await renderInDock()
    const button = emojiButton()
    // After the text field in document (and so Tab) order.
    expect(
      input.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(button.querySelector('svg.fa-face-smile')).toHaveAttribute('aria-hidden', 'true')
    expect(button).toHaveClass(skinClass('button'))

    await user.click(button)
    const picker = within(screen.getByTestId('persona-composer')).getByTestId('emoji-picker')
    expect(picker).toHaveClass(skinClass('picker'))
    // Staff world: never the participant composer's skin.
    expect(picker.className).not.toMatch(/emojiPicker/)
  })

  it('inserts at the caret, keeps focus, and counts toward the limit', async () => {
    const user = userEvent.setup()
    const input = await renderInDock()

    await user.type(input, 'Shelter open')
    input.setSelectionRange(7, 7)
    await user.click(emojiButton())
    await user.click(
      within(screen.getByRole('dialog', { name: 'Emoji picker' })).getByRole('option', {
        name: 'house',
      }),
    )

    expect(input).toHaveValue('Shelter🏠 open')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(7 + '🏠'.length)
    // 12 typed characters + 1 emoji (code points, as the composer counts text).
    expect(screen.getByTestId('char-counter')).toHaveAttribute(
      'aria-label',
      '267 characters remaining',
    )
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()

    // Typing carries on at the caret, after the emoji.
    await user.keyboard('!')
    expect(input).toHaveValue('Shelter🏠! open')
  })

  it('replaces a selection, and emoji can push the draft over the limit', async () => {
    const user = userEvent.setup()
    const input = await renderInDock({ charLimit: 10 })

    await user.type(input, 'Stay safe!')
    // Positive control: at the limit (10 of 10) Post is still available.
    expect(screen.getByTestId('char-counter')).toHaveAttribute(
      'aria-label',
      '0 characters remaining',
    )
    await waitFor(() => expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled())
    input.setSelectionRange(5, 9)
    await user.click(emojiButton())
    await user.keyboard('folded{Enter}')
    expect(input).toHaveValue('Stay 🙏!')
    expect(input).toHaveFocus()
    expect(screen.getByTestId('char-counter')).toHaveAttribute(
      'aria-label',
      '3 characters remaining',
    )

    input.setSelectionRange(input.value.length, input.value.length)
    for (let i = 0; i < 4; i++) {
      await user.click(emojiButton())
      await user.keyboard('fire{Enter}')
    }
    expect(input).toHaveValue('Stay 🙏!🔥🔥🔥🔥')
    expect(screen.getByTestId('char-counter')).toHaveAttribute('data-state', 'over')
    expect(screen.getByTestId('char-counter')).toHaveAttribute(
      'aria-label',
      '1 characters over the limit',
    )
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })

  it('is keyboard-operable: Enter opens, typing searches, arrows move, Enter inserts', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    const input = await renderInDock({ onPublished })
    await user.type(input, 'Rain ')

    emojiButton().focus()
    await user.keyboard('{Enter}')
    const picker = screen.getByRole('dialog', { name: 'Emoji picker' })
    const search = within(picker).getByRole('combobox', { name: 'Search emoji' })
    expect(search).toHaveFocus()
    expect(emojiButton()).toHaveAttribute('aria-expanded', 'true')

    // Browsing: the arrows move the active emoji through the grid.
    const firstActive = within(picker).getByRole('option', { selected: true })
    await user.keyboard('{ArrowRight}')
    const moved = within(picker).getByRole('option', { selected: true })
    expect(moved).not.toBe(firstActive)
    await user.keyboard('{ArrowLeft}')
    expect(within(picker).getByRole('option', { selected: true })).toBe(firstActive)

    // Searching narrows the grid; Enter inserts the active match.
    await user.keyboard('umbrella')
    expect(within(picker).getByRole('status')).toHaveTextContent(/emoji found/)
    const active = within(picker).getByRole('option', { selected: true })
    expect(active).toHaveAccessibleName('umbrella with rain drops')
    await user.keyboard('{Enter}')

    expect(input).toHaveValue('Rain ☔')
    expect(input).toHaveFocus()

    // Ctrl/Cmd+Enter in the search box - the form's "post now" chord - inserts the
    // active emoji instead: the picker keeps it from reaching the form.
    await user.click(emojiButton())
    await user.keyboard('fire')
    await user.keyboard('{Control>}{Enter}{/Control}')
    expect(input).toHaveValue('Rain ☔🔥')
    await user.click(emojiButton())
    await user.keyboard('thumbs')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(input).toHaveValue('Rain ☔🔥👍')
    expect(onPublished).not.toHaveBeenCalled()
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()

    // The same chord from the text field does post (so the spy above could catch one).
    expect(input).toHaveFocus()
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(onPublished).toHaveBeenCalledTimes(1))
    expect(onPublished.mock.calls[0]?.[0]?.text).toBe('Rain ☔🔥👍')
  })

  it('Escape closes only the picker and returns focus to the text field, never the dock', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    const input = await renderInDock({ onClose })

    await user.type(input, 'Boil water notice')
    input.setSelectionRange(5, 10)
    await user.click(emojiButton())
    expect(screen.getByRole('combobox', { name: 'Search emoji' })).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(input).toHaveFocus()
    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 10])
    expect(input).toHaveValue('Boil water notice')
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('persona-dock-host')).toBeInTheDocument()

    // Escape on the trigger while the picker is open closes only the picker too.
    await user.click(emojiButton())
    emojiButton().focus()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()

    // With the picker closed, Escape from the text field is the dock's again.
    input.focus()
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('makes no network request while the picker is used', async () => {
    const user = userEvent.setup()
    const input = await renderInDock()
    await waitFor(() => expect(emojiButton()).toBeEnabled())

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open')
    await user.click(emojiButton())
    await user.keyboard('umbrella{ArrowRight}{ArrowLeft}{Enter}')
    await user.click(emojiButton())
    await user.click(screen.getByRole('option', { name: 'thumbs up' }))

    expect(input).toHaveValue('☔👍')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// The COBRA skin, read off disk (Vitest blanks `*.css` imports).
// ---------------------------------------------------------------------------

const pickerCss = readSrcFile('core/emoji/EmojiPicker.module.css')
const skinCss = readSrcFile('features/controller/components/PersonaComposerEmoji.module.css')

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')
  const match = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(stripComments(css))
  if (match?.[1] === undefined) throw new Error(`rule ${selector} not found`)
  return match[1]
}

/**
 * The value of `property` in the first rule whose selector LIST contains `selector`
 * (so `.button:hover` is found in `.button:hover, .button[aria-expanded='true'] {...}`).
 */
function declaration(css: string, selector: string, property: string): string {
  for (const rule of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = (rule[1] ?? '').split(',').map(part => part.trim())
    if (!selectors.includes(selector)) continue
    for (const decl of (rule[2] ?? '').split(';')) {
      const colon = decl.indexOf(':')
      if (colon < 0) continue
      if (decl.slice(0, colon).trim() !== property) continue
      return decl.slice(colon + 1).trim().toLowerCase()
    }
  }
  throw new Error(`${selector} { ${property} } not found`)
}

/** Every `--emoji-*` name the picker reads through `var(...)`. */
function emojiPropertiesRead(css: string): string[] {
  const names = new Set<string>()
  for (const match of stripComments(css).matchAll(/var\(\s*(--emoji-[a-z0-9-]+)/g)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  return [...names].sort()
}

/** Every `--emoji-*` declaration in a rule body, name -> value. */
function emojiDeclarations(body: string): Map<string, string> {
  const declared = new Map<string, string>()
  for (const match of body.matchAll(/(--emoji-[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (match[1] !== undefined && match[2] !== undefined) declared.set(match[1], match[2].trim())
  }
  return declared
}

describe('PersonaComposerEmoji.module.css — the COBRA picker skin (story 12b)', () => {
  const read = emojiPropertiesRead(pickerCss)
  const skin = emojiDeclarations(ruleBody(skinCss, '.picker'))

  it('sets every --emoji-* property the picker reads, and nothing else', () => {
    // Guard against a vacuous pass: the picker reads ten today.
    expect(read.length).toBeGreaterThanOrEqual(10)
    expect([...skin.keys()].sort()).toEqual(read)
  })

  it('takes each value from the COBRA theme entry it mirrors', () => {
    const { palette, shape, typography } = cobraTheme
    const expected: Record<string, string> = {
      '--emoji-bg': palette.background.paper,
      '--emoji-panel': palette.background.default,
      '--emoji-line': palette.divider,
      '--emoji-control-line': palette.primary.dark,
      '--emoji-ink': palette.text.primary,
      '--emoji-ink-muted': palette.text.muted,
      '--emoji-accent': palette.buttonPrimary.main,
      '--emoji-hover': palette.linkButton.light,
      '--emoji-radius': `${String(shape.borderRadius)}px`,
      '--emoji-font': String(typography.fontFamily),
    }
    expect([...skin.keys()].sort()).toEqual(Object.keys(expected).sort())
    for (const [name, value] of skin) {
      expect({ name, value: value.toLowerCase() }).toEqual({
        name,
        value: expected[name]?.toLowerCase(),
      })
    }
  })

  it("draws the trigger in CobraSecondaryButton's colours (rest, hover/open, active, focus)", () => {
    const { buttonPrimary, linkButton } = cobraTheme.palette
    const at = (selector: string, property: string) => declaration(skinCss, selector, property)
    const main = buttonPrimary.main.toLowerCase()

    expect(at('.button', 'border')).toBe(`1px solid ${main}`)
    expect(at('.button', 'color')).toBe(main)
    for (const selector of ['.button:hover', ".button[aria-expanded='true']"]) {
      expect(at(selector, 'background')).toBe(linkButton.light.toLowerCase())
      expect(at(selector, 'border-color')).toBe(buttonPrimary.light.toLowerCase())
    }
    expect(at('.button:active', 'background')).toBe(buttonPrimary.dark.toLowerCase())
    expect(at('.button:active', 'color')).toBe(buttonPrimary.contrastText.toLowerCase())
    expect(at('.button:focus-visible', 'outline')).toBe(`2px solid ${main}`)

    // The icon is a graphic: >= 3:1 on the dock's white, on the hover tint, and pressed.
    expect(contrastRatio(main, cobraTheme.palette.background.paper)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(main, linkButton.light)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(buttonPrimary.contrastText, buttonPrimary.dark)).toBeGreaterThanOrEqual(3)
  })

  it('meets WCAG AA: text 4.5:1 and the search edge / focus ring 3:1', () => {
    const color = (name: string): string => {
      const value = skin.get(name)
      if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error(`${name} is not a #rrggbb colour`)
      }
      return value
    }
    const surfaces = [color('--emoji-bg'), color('--emoji-panel')]
    for (const surface of surfaces) {
      expect(contrastRatio(color('--emoji-ink'), surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(color('--emoji-ink-muted'), surface)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(color('--emoji-control-line'), surface)).toBeGreaterThanOrEqual(3)
      expect(contrastRatio(color('--emoji-accent'), surface)).toBeGreaterThanOrEqual(3)
    }
    // The active emoji's ring is drawn on the hover tint.
    expect(contrastRatio(color('--emoji-accent'), color('--emoji-hover'))).toBeGreaterThanOrEqual(3)
  })
})
