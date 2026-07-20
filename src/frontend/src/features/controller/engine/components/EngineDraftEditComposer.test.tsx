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
 */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
  await screen.findByText('Fulton County EM')
  return utils
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

    expect(within(editor).getByText('Fulton County EM')).toBeInTheDocument()
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
})

describe('EngineDraftEditComposer — publishes origin: engine (never controller-as-persona / engine-edited)', () => {
  it('Send in-character publishes the edited text with origin engine and marks the draft published', async () => {
    const user = userEvent.setup()
    await renderQueue()
    const editor = await openEditor('draft-fulco-reassure')
    const baseline = listPosts().length

    const field = within(editor).getByLabelText('Edited draft text')
    await user.clear(field)
    await user.type(field, 'Boil water in Zones 2-4 until further notice.')
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
    const user = userEvent.setup()
    await renderQueue()
    const editor = await openEditor('draft-fulco-reassure')

    const field = within(editor).getByLabelText('Edited draft text')
    await user.clear(field)
    await user.type(
      field,
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
