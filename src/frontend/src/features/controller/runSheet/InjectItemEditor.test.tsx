/**
 * features/controller/runSheet/InjectItemEditor.test.tsx
 * ---------------------------------------------------------------------------
 * The inline Add / Edit / View form (inject-queue story 07, AC "Author live"):
 *  - post and burst modes; a burst needs 2..20 posts (add / remove / reorder), and its window
 *    must be 30..600 s (default 90) — enforced on Save with the message on the field;
 *  - the 280 counter counts CODE POINTS (an emoji is 1) and an overrun shows as you type;
 *  - required fields are refused with field-level errors and focus moves to the first one;
 *  - persona / assignee come from the data passed in; a new item defaults to ME;
 *  - reply-to: an EARLIER scripted post (this sheet; earlier siblings once the burst exists)
 *    or a pasted post id; the wire shape is `{ injectPostId } | { postId }`;
 *  - media: attached ids need ALT text (NFR-001); the baseline is optional and range-checked;
 *  - server messages (400) land on the field / form; a view-mode form is read-only;
 *  - keyboard: Esc cancels, Ctrl/Cmd+Enter saves.
 *
 * Presentational: it is driven here directly (no queue, no mock) through `onSubmit`.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { SEEDED_PERSONAS } from '@/features/personas'
import { InjectItemEditor, type InjectItemEditorProps } from './InjectItemEditor'
import { makeItem, makePost } from './runSheetTestHarness'
import type { InjectItemWrite } from './types'

const ME = 'human-controller-01'
const ASSIGNEES = [
  { id: ME, displayName: 'Riley Chen', role: 'controller' },
  { id: 'human-controller-02', displayName: 'Jordan Ames', role: 'controller' },
]
const PERSONA = 'persona-fairhavenwater'

function renderEditor(overrides: Partial<InjectItemEditorProps> = {}) {
  const onSubmit = vi.fn<InjectItemEditorProps['onSubmit']>(async () => ({ ok: true }))
  const onCancel = vi.fn()
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <InjectItemEditor
        mode="create"
        items={[]}
        assignees={ASSIGNEES}
        me={ME}
        personas={SEEDED_PERSONAS}
        personasUnavailable={false}
        busy={false}
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...overrides}
      />
    </ThemeProvider>,
  )
  return { ...utils, onSubmit, onCancel }
}

const field = (label: RegExp | string): HTMLElement => screen.getByLabelText(label)
const change = (label: RegExp | string, value: string): void => {
  fireEvent.change(field(label), { target: { value } })
}
const save = (): void => {
  fireEvent.click(screen.getByTestId('editor-save'))
}
const submitted = (onSubmit: ReturnType<typeof renderEditor>['onSubmit']): InjectItemWrite => {
  const call = onSubmit.mock.calls[0]
  if (!call) throw new Error('onSubmit was not called')
  return call[0]
}

/** A valid single post. */
function fillSingle(): void {
  change(/^Title/, 'Boil-water advisory')
  change(/^Persona/, PERSONA)
  change(/^Text/, 'A boil-water advisory is in effect.')
}

/** Switches to burst mode and fills both default posts. */
function fillBurst(): void {
  change(/^Title/, 'Pile-on')
  fireEvent.click(screen.getByRole('radio', { name: 'Burst (pile-on)' }))
  change(/^Post 1 persona/, PERSONA)
  change(/^Post 1 text/, 'first')
  change(/^Post 2 persona/, 'persona-newsline7')
  change(/^Post 2 text/, 'second')
}

describe('InjectItemEditor — post mode', () => {
  it('opens inline (a form in the panel, not a dialog), blank, assigned to me', () => {
    renderEditor()
    expect(screen.getByRole('form', { name: 'new scripted item' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(field(/^Assignee/)).toHaveValue(ME)
    expect(screen.getByRole('radio', { name: 'Single post' })).toBeChecked()
    expect(screen.queryByTestId('editor-add-post')).toBeNull()
  })

  it('submits a valid single post in the frozen write shape', async () => {
    const { onSubmit } = renderEditor()
    fillSingle()
    change(/^T\+N/, '15')
    change(/^Notes/, 'Opening beat')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(submitted(onSubmit)).toEqual({
      kind: 'post',
      title: 'Boil-water advisory',
      notes: 'Opening beat',
      plannedMinute: 15,
      assigneeId: ME,
      posts: [{ personaId: PERSONA, text: 'A boil-water advisory is in effect.' }],
    })
  })

  it('the assignee select lists the assignees from the data, plus Unassigned', async () => {
    const { onSubmit } = renderEditor()
    const options = within(field(/^Assignee/)).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Unassigned', 'Riley Chen (controller) (you)', 'Jordan Ames (controller)'])
    fillSingle()
    change(/^Assignee/, '')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).assigneeId).toBeNull()
  })

  it('the persona select is the staff persona list, with @handle in every option', () => {
    renderEditor()
    const options = within(field(/^Persona/)).getAllByRole('option').map(o => o.textContent ?? '')
    expect(options[0]).toBe('Choose a persona…')
    expect(options.some(o => o === 'Fairhaven Water Utility (@FairhavenWater)')).toBe(true)
    // The lookalike is distinguishable by its handle alone (SOC-052).
    expect(options.some(o => o.includes('(@FairhavenWaterUpd)'))).toBe(true)
  })

  it('says so when the persona list could not be loaded', () => {
    renderEditor({ personas: [], personasUnavailable: true })
    expect(screen.getByText('Personas unavailable')).toBeInTheDocument()
  })

  it('refuses a blank form with field errors and moves focus to the first invalid field', async () => {
    const { onSubmit } = renderEditor()
    save()
    expect(onSubmit).not.toHaveBeenCalled()
    expect(await screen.findByTestId('inject-editor-title-error')).toHaveTextContent('Give the item a title')
    expect(screen.getByTestId('inject-editor-post-0-persona-error')).toHaveTextContent('Choose a persona')
    expect(screen.getByTestId('inject-editor-post-0-text-error')).toHaveTextContent('Write the post text')
    expect(field(/^Title/)).toHaveAttribute('aria-invalid', 'true')
    expect(document.activeElement).toBe(field(/^Title/))
  })

  it('errors are text with an icon (never colour alone)', async () => {
    renderEditor()
    save()
    const error = await screen.findByTestId('inject-editor-title-error')
    expect(error.parentElement?.querySelector('svg')).not.toBeNull()
    expect(error.textContent).not.toBe('')
  })

  it('does not show required-field errors before the first Save', () => {
    renderEditor()
    expect(screen.queryByTestId('inject-editor-title-error')).toBeNull()
  })
})

describe('InjectItemEditor — the 280 counter counts code points', () => {
  it('starts at 0/280 and counts an emoji as ONE', () => {
    renderEditor()
    expect(screen.getByTestId('inject-editor-post-0-counter')).toHaveTextContent('0/280')
    change(/^Text/, 'hi 😀😀')
    expect(screen.getByTestId('inject-editor-post-0-counter')).toHaveTextContent('5/280')
    expect('hi 😀😀'.length).toBe(7) // UTF-16 units — the counter must NOT report this
  })

  it('280 emoji are exactly at the limit (560 UTF-16 units) and allowed', async () => {
    const { onSubmit } = renderEditor()
    fillSingle()
    change(/^Text/, '😀'.repeat(280))
    expect(screen.getByTestId('inject-editor-post-0-counter')).toHaveTextContent('280/280')
    expect(screen.queryByTestId('inject-editor-post-0-text-error')).toBeNull()
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
  })

  it('281 code points show an overrun error AS YOU TYPE and block Save', async () => {
    const { onSubmit } = renderEditor()
    fillSingle()
    change(/^Text/, 'a'.repeat(281))
    expect(screen.getByTestId('inject-editor-post-0-counter')).toHaveTextContent('281/280')
    expect(screen.getByTestId('inject-editor-post-0-text-error')).toHaveTextContent('1 over the 280 limit')
    save()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('title and notes have their own counters and overrun errors (120 / 500)', () => {
    renderEditor()
    change(/^Title/, 'x'.repeat(121))
    expect(screen.getByTestId('inject-editor-title-error')).toHaveTextContent('120')
    change(/^Notes/, 'n'.repeat(501))
    expect(screen.getByTestId('inject-editor-notes-error')).toHaveTextContent('500')
  })
})

describe('InjectItemEditor — burst mode: 2..20 posts and the window', () => {
  it('switching to burst shows two post forms, a window defaulting to 90, and Add post', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('radio', { name: 'Burst (pile-on)' }))
    expect(screen.getAllByTestId('post-editor')).toHaveLength(2)
    expect(field(/^Burst window/)).toHaveValue(90)
    expect(screen.getByTestId('editor-add-post')).toBeEnabled()
    expect(screen.getByTestId('editor-post-count')).toHaveTextContent('2 posts (2 to 20)')
  })

  it('a burst cannot go below 2 posts (Remove is disabled at 2)', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('radio', { name: 'Burst (pile-on)' }))
    expect(screen.getByRole('button', { name: 'Remove post 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove post 2' })).toBeDisabled()
  })

  it('adds up to 20 posts, then Add post is disabled and the maximum is stated', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('radio', { name: 'Burst (pile-on)' }))
    for (let i = 0; i < 18; i++) fireEvent.click(screen.getByTestId('editor-add-post'))
    expect(screen.getAllByTestId('post-editor')).toHaveLength(20)
    expect(screen.getByTestId('editor-add-post')).toBeDisabled()
    expect(screen.getByTestId('editor-post-count')).toHaveTextContent('20 posts (maximum 20)')
    // Mounting 20 MUI post forms in jsdom is the cost here (~3 s alone): generous timeout so a
    // loaded full-suite run cannot time it out.
  }, 60_000)

  it('removes a post (down to the minimum of 2)', () => {
    renderEditor()
    fireEvent.click(screen.getByRole('radio', { name: 'Burst (pile-on)' }))
    fireEvent.click(screen.getByTestId('editor-add-post'))
    expect(screen.getAllByTestId('post-editor')).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Remove post 3' }))
    expect(screen.getAllByTestId('post-editor')).toHaveLength(2)
  })

  it('reorders posts with up / down; the first cannot go up and the last cannot go down', async () => {
    const { onSubmit } = renderEditor()
    fillBurst()
    expect(screen.getByRole('button', { name: 'Move post 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move post 2 down' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Move post 1 down' }))
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts.map(p => p.text)).toEqual(['second', 'first'])
  })

  it('submits the burst with its window and every post in order', async () => {
    const { onSubmit } = renderEditor()
    fillBurst()
    change(/^Burst window/, '120')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const write = submitted(onSubmit)
    expect(write.kind).toBe('burst')
    expect(write.burstWindowSeconds).toBe(120)
    expect(write.posts).toHaveLength(2)
  })

  it.each([
    ['29', true],
    ['30', false],
    ['90', false],
    ['600', false],
    ['601', true],
    ['abc', false],
  ])('window %s -> error? %s', async (value, hasError) => {
    const { onSubmit } = renderEditor()
    fillBurst()
    change(/^Burst window/, value)
    save()
    if (hasError) {
      expect(await screen.findByTestId('inject-editor-window-error')).toHaveTextContent('30 to 600')
      expect(onSubmit).not.toHaveBeenCalled()
    } else if (value === 'abc') {
      // A non-number cannot even be typed into a number field; it reads as blank = default.
      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    } else {
      await waitFor(() => expect(onSubmit).toHaveBeenCalled())
      expect(screen.queryByTestId('inject-editor-window-error')).toBeNull()
    }
  })

  it('a burst with a post missing its text is refused with the error on THAT post', async () => {
    const { onSubmit } = renderEditor()
    fillBurst()
    change(/^Post 2 text/, '')
    save()
    expect(await screen.findByTestId('inject-editor-post-1-text-error')).toBeInTheDocument()
    expect(screen.queryByTestId('inject-editor-post-0-text-error')).toBeNull()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('toggling burst -> single -> burst keeps what you typed', () => {
    renderEditor()
    fillBurst()
    fireEvent.click(screen.getByRole('radio', { name: 'Single post' }))
    expect(screen.getAllByTestId('post-editor')).toHaveLength(1)
    fireEvent.click(screen.getByRole('radio', { name: 'Burst (pile-on)' }))
    expect(field(/^Post 2 text/)).toHaveValue('second')
  })

  it('in single mode only the first post is submitted', async () => {
    const { onSubmit } = renderEditor()
    fillBurst()
    fireEvent.click(screen.getByRole('radio', { name: 'Single post' }))
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts).toHaveLength(1)
    expect(submitted(onSubmit)).not.toHaveProperty('burstWindowSeconds')
  })
})

describe('InjectItemEditor — the type is fixed once the item has fired', () => {
  const partlyFired = makeItem({
    id: 'inj-fired',
    kind: 'burst',
    status: 'held',
    firedByHumanId: ME,
    posts: [
      makePost({ id: 'a', sequence: 1, status: 'fired' }),
      makePost({ id: 'b', sequence: 2, status: 'pending' }),
    ],
    total: 2,
    firedCount: 1,
  })

  it('locks the kind radios (with a note) when a child has fired', () => {
    renderEditor({ mode: 'edit', item: partlyFired, items: [partlyFired] })
    expect(screen.getByRole('radio', { name: 'Single post' })).toBeDisabled()
    expect(screen.getByRole('radio', { name: 'Burst (pile-on)' })).toBeDisabled()
    expect(screen.getByTestId('kind-locked-note')).toHaveTextContent('fixed once it has fired')
  })

  it('also locks it once Fire was pressed even if nothing published (a failed first release)', () => {
    const failed = makeItem({ id: 'inj-failed', status: 'failed', firedByHumanId: ME })
    renderEditor({ mode: 'edit', item: failed, items: [failed] })
    expect(screen.getByRole('radio', { name: 'Single post' })).toBeDisabled()
    expect(screen.getByTestId('kind-locked-note')).toBeInTheDocument()
  })

  it('does NOT lock it for an item that was never released, or for a new item', () => {
    const fresh = makeItem({ id: 'inj-fresh' })
    const { unmount } = renderEditor({ mode: 'edit', item: fresh, items: [fresh] })
    expect(screen.getByRole('radio', { name: 'Single post' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: 'Burst (pile-on)' })).toBeEnabled()
    expect(screen.queryByTestId('kind-locked-note')).toBeNull()
    unmount()
    renderEditor()
    expect(screen.getByRole('radio', { name: 'Burst (pile-on)' })).toBeEnabled()
  })

  it('a locked kind cannot be switched by a click', () => {
    renderEditor({ mode: 'edit', item: partlyFired, items: [partlyFired] })
    fireEvent.click(screen.getByRole('radio', { name: 'Single post' }))
    expect(screen.getAllByTestId('post-editor')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: 'Burst (pile-on)' })).toBeChecked()
  })
})

describe('InjectItemEditor — the window must hold every 3 s gap', () => {
  const twelve = makeItem({
    id: 'inj-twelve',
    kind: 'burst',
    burstWindowSeconds: 60,
    posts: Array.from({ length: 12 }, (_, i) =>
      makePost({ id: `p${i + 1}`, sequence: i + 1, text: `post ${i + 1}` }),
    ),
    total: 12,
  })

  it('refuses a window below 3 x (posts - 1) with a clear message, and accepts the minimum', async () => {
    const { onSubmit } = renderEditor({ mode: 'edit', item: twelve, items: [twelve] })
    // The hint states the real minimum for this many posts.
    expect(screen.getByText(/33 to 600/)).toBeInTheDocument()
    change(/^Burst window/, '32')
    save()
    expect(await screen.findByTestId('inject-editor-window-error')).toHaveTextContent(
      'A 12-post burst needs at least 33 seconds',
    )
    expect(onSubmit).not.toHaveBeenCalled()

    change(/^Burst window/, '33')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).burstWindowSeconds).toBe(33)
  }, 60_000)
})

describe('InjectItemEditor — reply-to', () => {
  const earlier = [
    makeItem({
      id: 'inj-a',
      order: 1,
      title: 'Advisory',
      plannedMinute: 0,
      posts: [makePost({ id: 'injp-a1', sequence: 1, text: 'Boil water advisory is in effect' })],
    }),
    makeItem({
      id: 'inj-b',
      order: 2,
      title: 'Later one',
      plannedMinute: 20,
      posts: [makePost({ id: 'injp-b1', sequence: 1, text: 'Later post' })],
    }),
  ]

  it('lists the earlier scripted posts of this sheet and submits `injectPostId`', async () => {
    const { onSubmit } = renderEditor({ items: earlier })
    fillSingle()
    const options = within(field(/^Reply to/)).getAllByRole('option').map(o => o.textContent ?? '')
    expect(options[0]).toBe('Not a reply')
    expect(options.some(o => o.includes('Advisory') && o.includes('Boil water advisory'))).toBe(true)
    expect(options.some(o => o.includes('An existing post'))).toBe(true)

    change(/^Reply to/, 'inj:injp-a1')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts[0]?.replyTo).toEqual({ injectPostId: 'injp-a1' })
  })

  it('a pasted post id submits `postId`; an empty one is refused on that field', async () => {
    const { onSubmit } = renderEditor({ items: earlier })
    fillSingle()
    change(/^Reply to$/, '__post-id')
    expect(field(/^Reply to post id/)).toBeInTheDocument()
    save()
    expect(await screen.findByTestId('inject-editor-post-0-reply-error')).toHaveTextContent('Choose the post')
    expect(onSubmit).not.toHaveBeenCalled()

    change(/^Reply to post id/, 'post-1234')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts[0]?.replyTo).toEqual({ postId: 'post-1234' })
  })

  it('only EARLIER items are offered when editing (not itself or later ones)', () => {
    const later = earlier[1]
    if (!later) throw new Error('fixture')
    renderEditor({ mode: 'edit', item: later, items: earlier })
    const options = within(field(/^Reply to/)).getAllByRole('option').map(o => o.textContent ?? '')
    expect(options.some(o => o.includes('Advisory'))).toBe(true)
    expect(options.some(o => o.includes('Later one'))).toBe(false)
  })

  it('offers earlier posts of THIS burst as reply targets — on a NEW burst too — and sends `{ sequence }`', async () => {
    const { onSubmit } = renderEditor()
    fillBurst()
    fireEvent.click(screen.getByTestId('editor-add-post'))
    change(/^Post 3 persona/, PERSONA)
    change(/^Post 3 text/, 'third')

    const first = within(field(/^Post 1 reply to/)).getAllByRole('option').map(o => o.textContent ?? '')
    expect(first.filter(o => o.startsWith('This burst'))).toHaveLength(0)
    const third = within(field(/^Post 3 reply to/)).getAllByRole('option').map(o => o.textContent ?? '')
    expect(third.filter(o => o.startsWith('This burst'))).toHaveLength(2)
    expect(third.some(o => o.includes('#1') && o.includes('first'))).toBe(true)

    fireEvent.change(field(/^Post 3 reply to/), { target: { value: `sib:${siblingKeyFor(3, 1)}` } })
    fireEvent.change(field(/^Post 2 reply to/), { target: { value: `sib:${siblingKeyFor(2, 1)}` } })
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts.map(p => p.replyTo)).toEqual([
      undefined,
      { sequence: 1 },
      { sequence: 1 },
    ])
    // A create sends no child ids.
    expect(submitted(onSubmit).posts.every(p => p.id === undefined)).toBe(true)
  })

  it('the sibling label tracks the live draft text and persona', () => {
    renderEditor()
    fillBurst()
    const option = within(field(/^Post 2 reply to/))
      .getAllByRole('option')
      .find(o => o.textContent?.startsWith('This burst'))
    expect(option?.textContent).toContain('#1')
    expect(option?.textContent).toContain('FairhavenWater')
    expect(option?.textContent).toContain('first')
  })

  it('on edit, existing children echo their id on PUT and an added post has none', async () => {
    const burstItem = makeItem({
      id: 'inj-burst',
      kind: 'burst',
      order: 3,
      version: 4,
      posts: [
        makePost({ id: 'bp1', sequence: 1, text: 'one' }),
        makePost({ id: 'bp2', sequence: 2, text: 'two', replyTo: { injectPostId: 'bp1' } }),
      ],
      total: 2,
    })
    const { onSubmit } = renderEditor({ mode: 'edit', item: burstItem, items: [burstItem] })
    // The server's same-item pointer shows up as a sibling choice on post 2.
    expect((field(/^Post 2 reply to/) as HTMLSelectElement).value.startsWith('sib:')).toBe(true)
    fireEvent.click(screen.getByTestId('editor-add-post'))
    change(/^Post 3 persona/, PERSONA)
    change(/^Post 3 text/, 'third')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    const posts = submitted(onSubmit).posts
    expect(posts.map(p => p.id)).toEqual(['bp1', 'bp2', undefined])
    expect(posts[1]?.replyTo).toEqual({ sequence: 1 })
  })

  /** The draft key behind the nth sibling option of post `forPost` (read off the option value). */
  function siblingKeyFor(forPost: number, target: number): string {
    const options = within(field(new RegExp(`^Post ${forPost} reply to`))).getAllByRole('option')
    const option = options.filter(o => o.getAttribute('value')?.startsWith('sib:'))[target - 1]
    const value = option?.getAttribute('value')
    if (!value) throw new Error('no sibling option')
    return value.slice('sib:'.length)
  }

  it('REORDER keeps a reply correct when its target is still earlier (re-pointed to the new position)', async () => {
    const { onSubmit } = renderEditor()
    fillBurst()
    fireEvent.click(screen.getByTestId('editor-add-post'))
    change(/^Post 3 persona/, PERSONA)
    change(/^Post 3 text/, 'third')
    // Post 3 replies to post 1.
    fireEvent.change(field(/^Post 3 reply to/), { target: { value: `sib:${siblingKeyFor(3, 1)}` } })
    // Move post 2 UP: order becomes [second, first, third]; the target (first) is now #2.
    fireEvent.click(screen.getByRole('button', { name: 'Move post 2 up' }))
    expect(screen.queryByTestId('inject-editor-post-2-reply-notice')).toBeNull()
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts.map(p => p.text)).toEqual(['second', 'first', 'third'])
    expect(submitted(onSubmit).posts[2]?.replyTo).toEqual({ sequence: 2 })
  })

  it('REORDER that puts the target AFTER its reply clears the reply and says so inline', () => {
    renderEditor()
    fillBurst()
    // Post 2 replies to post 1; then move post 1 DOWN: the target now comes after its reply.
    fireEvent.change(field(/^Post 2 reply to/), { target: { value: `sib:${siblingKeyFor(2, 1)}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Move post 1 down' }))
    const notice = screen.getByTestId('inject-editor-post-0-reply-notice')
    expect(notice).toHaveTextContent('now comes after it, so the reply was cleared')
    expect(field(/^Post 1 reply to/)).toHaveValue('')
  })

  it('REMOVING the target clears the reply and says so; unrelated removals keep replies', async () => {
    const { onSubmit } = renderEditor()
    fillBurst()
    fireEvent.click(screen.getByTestId('editor-add-post'))
    change(/^Post 3 persona/, PERSONA)
    change(/^Post 3 text/, 'third')
    fireEvent.change(field(/^Post 3 reply to/), { target: { value: `sib:${siblingKeyFor(3, 2)}` } })
    // Remove post 1 (unrelated): the reply to post 2 stays, now pointing at position 1.
    fireEvent.click(screen.getByRole('button', { name: 'Remove post 1' }))
    expect(screen.queryByTestId('inject-editor-post-1-reply-notice')).toBeNull()
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts[1]?.replyTo).toEqual({ sequence: 1 })
  })

  it('removing the TARGET of a reply clears it with an inline notice', () => {
    renderEditor()
    fillBurst()
    fireEvent.click(screen.getByTestId('editor-add-post'))
    change(/^Post 3 persona/, PERSONA)
    change(/^Post 3 text/, 'third')
    fireEvent.change(field(/^Post 3 reply to/), { target: { value: `sib:${siblingKeyFor(3, 2)}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove post 2' }))
    const notice = screen.getByTestId('inject-editor-post-1-reply-notice')
    expect(notice).toHaveTextContent('was removed, so the reply was cleared')
    expect(field(/^Post 2 reply to/)).toHaveValue('')
  })

  it('choosing a reply again dismisses the notice', () => {
    renderEditor()
    fillBurst()
    fireEvent.change(field(/^Post 2 reply to/), { target: { value: `sib:${siblingKeyFor(2, 1)}` } })
    fireEvent.click(screen.getByRole('button', { name: 'Move post 1 down' }))
    expect(screen.getByTestId('inject-editor-post-0-reply-notice')).toBeInTheDocument()
    fireEvent.change(field(/^Post 1 reply to/), { target: { value: '' } })
    expect(screen.queryByTestId('inject-editor-post-0-reply-notice')).toBeNull()
  })

  it('a post that already FIRED is locked (fields, move, remove) while the others stay editable', () => {
    const partly = makeItem({
      id: 'inj-partly',
      kind: 'burst',
      status: 'held',
      order: 1,
      posts: [
        makePost({ id: 'f1', sequence: 1, status: 'fired', text: 'already out' }),
        makePost({ id: 'f2', sequence: 2, status: 'pending', text: 'not yet' }),
        makePost({ id: 'f3', sequence: 3, status: 'pending', text: 'later' }),
      ],
      total: 3,
      firedCount: 1,
    })
    renderEditor({ mode: 'edit', item: partly, items: [partly] })
    expect(field(/^Post 1 text/)).toBeDisabled()
    expect(field(/^Post 1 persona/)).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove post 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move post 1 down' })).toBeDisabled()
    expect(screen.getByTestId('post-locked')).toHaveTextContent('ALREADY FIRED')
    expect(field(/^Post 2 text/)).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Remove post 2' })).toBeEnabled()
  })

  it('keeps a scripted reply target that is no longer in the list instead of silently dropping it', () => {
    const item = makeItem({
      id: 'inj-x',
      order: 2,
      posts: [makePost({ id: 'px', replyTo: { injectPostId: 'ghost-post' } })],
    })
    renderEditor({ mode: 'edit', item, items: [item] })
    expect(field(/^Reply to/)).toHaveValue('inj:ghost-post')
  })
})

describe('InjectItemEditor — media (alt required) and baseline', () => {
  it('an attached media id with no alt text is refused on the alt field (NFR-001)', async () => {
    const { onSubmit } = renderEditor()
    fillSingle()
    change(/^Add media id/, 'media-123')
    fireEvent.click(screen.getByRole('button', { name: 'Add media' }))
    expect(screen.getByTestId('media-id')).toHaveTextContent('media-123')
    save()
    expect(await screen.findByTestId('inject-editor-post-0-media-alt-0-error'))
      .toHaveTextContent('Alt text is required')
    expect(onSubmit).not.toHaveBeenCalled()

    change(/^Alt text for media-123/, 'Brown water running from a tap')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts[0]?.media).toEqual([
      { mediaId: 'media-123', alt: 'Brown water running from a tap' },
    ])
  })

  it('Enter in the media id box adds it; a duplicate id is refused; Remove detaches it', () => {
    renderEditor()
    const input = field(/^Add media id/)
    fireEvent.change(input, { target: { value: 'm1' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(screen.getAllByTestId('media-entry')).toHaveLength(1)
    fireEvent.change(field(/^Add media id/), { target: { value: 'm1' } })
    expect(screen.getByText('That media is already attached')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add media' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Remove media m1' }))
    expect(screen.queryAllByTestId('media-entry')).toHaveLength(0)
  })

  it('stops at 4 attached media', () => {
    renderEditor()
    for (const id of ['m1', 'm2', 'm3', 'm4']) {
      change(/^Add media id/, id)
      fireEvent.click(screen.getByRole('button', { name: 'Add media' }))
    }
    expect(screen.getAllByTestId('media-entry')).toHaveLength(4)
    expect(field(/^Add media id/)).toBeDisabled()
    expect(screen.getByText('Limit of 4 reached')).toBeInTheDocument()
  })

  it('an optional engagement baseline is off by default and submits whole numbers', async () => {
    const { onSubmit } = renderEditor()
    fillSingle()
    expect(screen.queryByLabelText('Likes')).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set engagement baseline' }))
    change('Likes', '120')
    change('Replies', '4')
    save()
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(submitted(onSubmit).posts[0]?.engagementBaseline).toEqual({ like: 120, reply: 4 })
  })

  it('a baseline out of 0..1,000,000 is refused', async () => {
    const { onSubmit } = renderEditor()
    fillSingle()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Set engagement baseline' }))
    change('Likes', '1000001')
    save()
    expect(await screen.findByText(/Engagement like must be a whole number/)).toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('InjectItemEditor — edit, view and server feedback', () => {
  const existing = makeItem({
    id: 'inj-e',
    order: 2,
    version: 3,
    title: 'Existing',
    plannedMinute: 7,
    assigneeId: 'human-controller-02',
    notes: 'a note',
    posts: [makePost({ id: 'pe', text: 'existing text', personaId: PERSONA })],
  })

  it('edit seeds the form from the item', () => {
    renderEditor({ mode: 'edit', item: existing, items: [existing] })
    expect(screen.getByRole('form', { name: 'edit item' })).toBeInTheDocument()
    expect(field(/^Title/)).toHaveValue('Existing')
    expect(field(/^T\+N/)).toHaveValue(7)
    expect(field(/^Assignee/)).toHaveValue('human-controller-02')
    expect(field(/^Notes/)).toHaveValue('a note')
    expect(field(/^Text/)).toHaveValue('existing text')
    expect(screen.getByTestId('status-chip')).toHaveTextContent('Pending')
  })

  it('warns when the item changed under you while editing', () => {
    renderEditor({
      mode: 'edit',
      item: existing,
      liveItem: { ...existing, version: 4 },
      items: [existing],
    })
    expect(screen.getByTestId('editor-stale-note')).toHaveTextContent('Someone else changed this item')
  })

  it('no stale warning when the live version is the one you opened', () => {
    renderEditor({ mode: 'edit', item: existing, liveItem: existing, items: [existing] })
    expect(screen.queryByTestId('editor-stale-note')).toBeNull()
  })

  it('view mode is read-only: every field disabled, no Save, and it says why', () => {
    renderEditor({ mode: 'view', item: { ...existing, status: 'fired' }, items: [existing] })
    expect(screen.getByRole('form', { name: 'view item (read-only)' })).toBeInTheDocument()
    expect(field(/^Title/)).toBeDisabled()
    expect(field(/^Text/)).toBeDisabled()
    expect(field(/^Persona/)).toBeDisabled()
    expect(field(/^Assignee/)).toBeDisabled()
    expect(screen.queryByTestId('editor-save')).toBeNull()
    expect(screen.queryByTestId('editor-add-post')).toBeNull()
    expect(screen.getByTestId('editor-readonly-note')).toHaveTextContent('This item is fired')
    // Header close + the footer Close button.
    expect(screen.getAllByRole('button', { name: 'Close editor' })).toHaveLength(2)
  })

  it('server validation messages land on the field; a form-level message shows; Save stays available', async () => {
    const onSubmit = vi.fn<InjectItemEditorProps['onSubmit']>(async () => ({
      ok: false,
      form: 'The write was refused.',
      fields: { title: 'Title already used', 'posts.0.personaId': 'Persona is not in this exercise' },
    }))
    renderEditor({ onSubmit })
    fillSingle()
    save()
    expect(await screen.findByTestId('inject-editor-title-error')).toHaveTextContent('Title already used')
    expect(screen.getByTestId('inject-editor-post-0-persona-error'))
      .toHaveTextContent('Persona is not in this exercise')
    expect(screen.getByTestId('editor-form-error')).toHaveTextContent('The write was refused.')
    expect(screen.getByTestId('editor-save')).toBeEnabled()
  })

  it('disables Save while a save is in flight', () => {
    renderEditor({ busy: true })
    expect(screen.getByTestId('editor-save')).toBeDisabled()
  })

  it('Cancel and the close button call onCancel', () => {
    const { onCancel } = renderEditor()
    fireEvent.click(screen.getByTestId('editor-cancel'))
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('Esc cancels; Ctrl+Enter saves', async () => {
    const { onSubmit, onCancel } = renderEditor()
    fillSingle()
    fireEvent.keyDown(field(/^Title/), { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    fireEvent.keyDown(field(/^Title/), { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
