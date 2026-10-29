/**
 * features/social/hooks/useComposeWithLink.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation 21, "Compose with link (news FU-5, SOC-004)":
 *  - `openComposerWithLink(permalink)` opens the participant composer dialog pre-filled
 *    with the host-relative permalink and returns `true`;
 *  - a value with `://`, a leading `//` (or `/\`), or no leading `/` is rejected: `false`,
 *    nothing opens (FC-9.3);
 *  - the dialog renders INSIDE the host's subtree (the content region), not portalled
 *    above the shell, within the Social brand scope and palette (D7, two worlds);
 *  - the post goes through the normal composer (it lands in the mock post store as an
 *    ordinary top-level post) and the dialog closes;
 *  - an observer (read-only) mount returns `false` and opens nothing. (A read-only
 *    SESSION is covered in `useComposeWithLink.readonly.test.tsx`.)
 *  - structural a11y of the opened dialog (no axe dependency in this repo).
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { BrandThemeProvider } from '@/features/participant-shell/BrandThemeProvider'
import {
  ShellContextProvider,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { postStore } from '../services/postStore'
import { SCENARIO_NOW } from '../layout/renderChannel.testUtils'
import { isHostRelativePermalink, useComposeWithLink } from './useComposeWithLink'

const PERMALINK = '/news/newsline-7/boil-water-notice-issued'

/** A stand-in for a news article page: a Share button and the hook's dialog. */
function ArticleHost({ link, onResult }: { link: string; onResult: (opened: boolean) => void }) {
  const { openComposerWithLink, composer, isOpen } = useComposeWithLink()
  return (
    <section data-testid="article-host">
      <div inert={isOpen} data-testid="article-body">
        <button type="button" onClick={() => onResult(openComposerWithLink(link))}>
          Share to Pulse
        </button>
      </div>
      {composer}
    </section>
  )
}

function renderHost(link: string, variant: ShellVariant = 'full') {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const results: boolean[] = []
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>
          <BrandThemeProvider>
            <ShellContextProvider value={{ variant, scenarioNow: SCENARIO_NOW }}>
              <div data-testid="content-region">
                <ArticleHost link={link} onResult={opened => results.push(opened)} />
              </div>
            </ShellContextProvider>
          </BrandThemeProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
  return results
}

async function share(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Share to Pulse' }))
}

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  postStore.resetForTests()
})

describe('useComposeWithLink', () => {
  it('opens the composer pre-filled with the permalink and returns true', async () => {
    const user = userEvent.setup()
    const results = renderHost(PERMALINK)
    await share(user)

    const dialog = await screen.findByRole('dialog', { name: 'New post' })
    expect(results).toEqual([true])
    const box = within(dialog).getByRole('textbox', { name: 'Post text' })
    expect(box).toHaveValue(PERMALINK)
    expect(box).toHaveFocus()
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // The host page behind it is inert while it is open.
    expect(screen.getByTestId('article-body')).toHaveAttribute('inert')
  })

  it('renders inside the host page, within the Social brand scope and palette', async () => {
    const user = userEvent.setup()
    renderHost(PERMALINK)
    await share(user)
    const dialog = await screen.findByRole('dialog')

    // Not portalled to <body>: it lives in the shell content region the host is in (D7).
    expect(screen.getByTestId('content-region')).toContainElement(dialog)
    expect(screen.getByTestId('article-host')).toContainElement(dialog)
    // Social's own skin, never COBRA.
    expect(dialog.closest('[data-testid="social-brand-scope"]')).not.toBeNull()
    expect(dialog.closest('[data-testid="compose-with-link"]')).not.toBeNull()
    expect(dialog.querySelector('[class*="Mui"], [class*="cobra" i]')).toBeNull()
  })

  it('posts through the normal composer, then closes', async () => {
    const user = userEvent.setup()
    renderHost(PERMALINK)
    await share(user)
    const dialog = await screen.findByRole('dialog')

    await user.click(within(dialog).getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const created = postStore.getPosts().find(post => post.text === PERMALINK)
    expect(created).toBeDefined()
    expect(created?.inReplyTo).toBeUndefined()
    expect(created?.origin).toBe('participant')
  })

  it('Esc over the pre-filled draft asks before discarding it', async () => {
    const user = userEvent.setup()
    renderHost(PERMALINK)
    await share(user)
    const dialog = await screen.findByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(await screen.findByText('Discard this draft?')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByTestId('article-body')).not.toHaveAttribute('inert')
  })

  it.each([
    ['https://newsline7.example/a'],
    ['//evil.example/a'],
    ['/\\evil.example/a'],
    ['/news/a?next=https://evil.example'],
    ['news/a'],
    [''],
    ['/news/a b'],
    ['/news/a\nb'],
  ])('rejects %j: returns false and opens nothing', async link => {
    const user = userEvent.setup()
    const results = renderHost(link)
    await share(user)

    expect(results).toEqual([false])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('an observer (read-only) mount returns false and opens nothing', async () => {
    const user = userEvent.setup()
    const results = renderHost(PERMALINK, 'readOnly')
    await share(user)

    expect(results).toEqual([false])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('isHostRelativePermalink', () => {
  it('accepts host-relative in-sim paths only', () => {
    expect(isHostRelativePermalink('/news/newsline-7/a-story')).toBe(true)
    expect(isHostRelativePermalink('/i/status/p-1')).toBe(true)
    expect(isHostRelativePermalink('/news/a?ref=share#top')).toBe(true)
    expect(isHostRelativePermalink('http://x/a')).toBe(false)
    expect(isHostRelativePermalink('//x/a')).toBe(false)
    expect(isHostRelativePermalink('javascript:alert(1)')).toBe(false)
  })
})
