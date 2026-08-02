/**
 * features/controller/engine/components/EngineDraftEditComposer.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the queue's edit composer wired end-to-end through `<ReviewQueue>`'s
 * `editSlot` (feature: engine-review-cockpit, integration seam; NFR-004,
 * XC-002, COR-018):
 *
 *  - opening E on a card renders this composer prefilled with the draft's lead
 *    text and the persona identity header;
 *  - "Send in-character" routes the edited text through `ReviewQueue`'s OWN
 *    `submitEdit` -> `useReviewQueue().edit()` -> `reviewActions.edit()` ->
 *    the shipped `createPost` — publishing with `origin: 'engine'` (NOT
 *    `controller-as-persona`, and there is no `engine-edited`);
 *  - a stored-XSS payload typed into the composer is neutralized by the time
 *    it reaches the live feed (NFR-004) — this composer performs NO
 *    sanitization itself; `createPost` is the one sanitizing seam, and this
 *    test proves the composer doesn't bypass it.
 *
 * Rendered through the REAL `ExerciseContextProvider` (mirrors
 * `ReviewQueue.test.tsx`) so `usePersonas()` resolves the seeded cast for both
 * the card and the composer's identity header.
 *
 * ## WHY THE FIELD IS FILLED WITH `fireEvent.change`, NOT `userEvent.type`
 *
 * The two publish tests below used `userEvent.type()` and timed out at full-suite
 * scale (225 files / ~2194 tests) while passing in isolation and at 59-file scale.
 * It was never an assertion mismatch — just cost. Measured on an idle machine,
 * for the SAME 45-character string into this composer:
 *
 *   fireEvent.change (whole string, one render)     ~40ms
 *   userEvent.type into a raw <textarea>           ~660ms   (~15ms/char)
 *   userEvent.type into this composer             ~2600ms   (~58ms/char)
 *
 * `userEvent.type` replays the string one key at a time; each key costs its own
 * `act()` flush + macrotask (the ~15ms/char floor visible on a bare textarea) plus
 * a full controlled re-render of the composer subtree — Avatar, VerifiedMark,
 * CobraTextField and both buttons, every one of them re-serializing its `sx` through
 * emotion (the remaining ~43ms/char). The XSS payload is 84 characters, so that test
 * spent ~5s of its 10s budget replaying keystrokes before asserting anything. Under
 * full-suite CPU oversubscription that margin is gone and the test times out.
 *
 * Neither test is about typing: both assert the PUBLISH path (`origin: 'engine'`)
 * and NFR-004 sanitization, and a controlled field reaches an identical state from
 * one change event. So they set the value in one shot — the same idiom
 * `ReviewQueue.test.tsx` already uses to drive its edit slot, and consistent with
 * this file's `fireEvent` clicks. Keystroke-level behavior that DOES matter (the
 * queue's action keys must stay suppressed while the composer is open) is covered
 * explicitly below rather than incidentally, at the cost of four keydowns.
 *
 * Do not reintroduce `userEvent.type` here to "be more realistic" — it buys no
 * assertion and costs ~58ms per character.
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { listPosts } from '@/features/social'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../services/reviewStore'
import { ReviewQueue } from './ReviewQueue'
import { EngineDraftEditComposer } from './EngineDraftEditComposer'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
})

async function renderQueue() {
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ReviewQueue editSlot={props => <EngineDraftEditComposer {...props} />} />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  // Personas resolve asynchronously (`usePersonas` is a per-instance fetch with no
  // shared cache); under heavy parallel-suite CPU load the resolve + re-render needs
  // more than RTL's out-of-the-box 1000ms findBy window. `src/test/setup.ts` already
  // raises `asyncUtilTimeout` to 5000ms suite-wide (issue #391); this stays explicit
  // so the gate is load-robust on its own terms, and it is well under the 10s
  // testTimeout — a real regression still fails rather than hangs.
  await screen.findByText('Fulton County EM', undefined, { timeout: 5000 })
  return utils
}

/**
 * Fills the composer's controlled field in ONE change event. See the module
 * header: per-character replay costs ~58ms/char here and buys no assertion.
 */
function setDraftText(editor: HTMLElement, value: string): void {
  const field = within(editor).getByLabelText('Edited draft text')
  fireEvent.change(field, { target: { value } })
  expect((field as HTMLTextAreaElement).value).toBe(value)
}

function cardById(draftId: string): HTMLElement {
  const card = document.querySelector(`[data-draft-id="${draftId}"]`)
  if (!card) throw new Error(`card ${draftId} not found`)
  return card as HTMLElement
}

async function openEditor(draftId: string) {
  const card = cardById(draftId)
  fireEvent.click(card)
  fireEvent.click(within(card).getByLabelText('Edit (E)'))
  return screen.findByTestId('engine-draft-edit-composer')
}

describe('EngineDraftEditComposer — opened from the queue', () => {
  it('prefills the draft text and shows the persona identity', async () => {
    await renderQueue()
    const editor = await openEditor('draft-fulco-reassure')

    // The composer mounts its OWN `usePersonas()` instance, which resolves the
    // identity header asynchronously — so await it (findBy) rather than a one-shot
    // getBy that races the resolve and intermittently misses under parallel load.
    expect(
      await within(editor).findByText('Fulton County EM', undefined, { timeout: 5000 }),
    ).toBeInTheDocument()
    const field = within(editor).getByLabelText('Edited draft text') as HTMLTextAreaElement
    expect(field.value).toContain('boil-water advisory')
  })

  it('Cancel closes the composer without publishing', async () => {
    await renderQueue()
    const editor = await openEditor('draft-fulco-reassure')
    const baseline = listPosts().length

    fireEvent.click(within(editor).getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.queryByTestId('engine-draft-edit-composer')).not.toBeInTheDocument()
    })
    expect(postStore.getPosts()).toHaveLength(baseline)
    expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'counting-down')
  })

  it('typing an action letter into the field never fires the queue action (A/V/R/B stay suppressed)', async () => {
    await renderQueue()
    const editor = await openEditor('draft-fulco-reassure')
    const baseline = listPosts().length
    const field = within(editor).getByLabelText('Edited draft text')

    // `ReviewQueue`'s container-level keyboard grid is suspended while the composer
    // is open, so ordinary prose containing these letters is just text. Previously
    // this was only covered INCIDENTALLY, by the publish tests replaying every
    // character of "Boil water..." (which contains a, v, r and b) through
    // `userEvent.type` — 84 keystrokes to assert something four can. Asserted
    // directly here so the cheap publish tests do not have to carry it.
    for (const key of ['a', 'v', 'r', 'b']) {
      fireEvent.keyDown(field, { key })
    }

    expect(screen.getByTestId('engine-draft-edit-composer')).toBeInTheDocument()
    expect(postStore.getPosts()).toHaveLength(baseline)
    expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'counting-down')
  })
})

describe('EngineDraftEditComposer — publishes origin: engine (never controller-as-persona / engine-edited)', () => {
  it('Send in-character publishes the edited text with origin engine and marks the draft published', async () => {
    await renderQueue()
    const editor = await openEditor('draft-fulco-reassure')
    const baseline = listPosts().length

    setDraftText(editor, 'Boil water in Zones 2-4 until further notice.')
    fireEvent.click(within(editor).getByRole('button', { name: 'Send in-character' }))

    await waitFor(() => {
      expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'published')
    })

    const posts = postStore.getPosts()
    expect(posts.length).toBe(baseline + 1)
    const published = posts[posts.length - 1]
    if (!published) throw new Error('expected an appended post')
    expect(published.text).toBe('Boil water in Zones 2-4 until further notice.')
    expect(published.origin).toBe('engine')
    // No 'engine-edited' origin exists on the shared model — approve and edit
    // both publish `engine`; only telemetry distinguishes them.
    expect(published.origin).not.toBe('controller-as-persona')
  })

  it('NEVER publishes an unsanitized edited draft: a stored-XSS payload is neutralized (NFR-004)', async () => {
    await renderQueue()
    const editor = await openEditor('draft-fulco-reassure')

    setDraftText(
      editor,
      '<script>alert(document.cookie)</script>Boil water now<img src=x onerror="alert(1)">',
    )
    fireEvent.click(within(editor).getByRole('button', { name: 'Send in-character' }))

    await waitFor(() => {
      expect(cardById('draft-fulco-reassure')).toHaveAttribute('data-disposition', 'published')
    })

    const posts = postStore.getPosts()
    const published = posts[posts.length - 1]
    if (!published) throw new Error('expected an appended post')
    expect(published.text).toBe('Boil water now')
    expect(published.text).not.toContain('<script')
    expect(published.text).not.toContain('onerror')
    expect(published.text).not.toMatch(/<[a-z]/i)
  })
})
