/**
 * features/controller/runSheet/InjectItemEditor.tsx
 * ---------------------------------------------------------------------------
 * The ADD / EDIT / VIEW form of the run sheet (inject-queue story 07, AC "Author
 * live"). STAFF world. An INLINE panel — it renders inside the run sheet, never a
 * blocking modal, so the list's banners (frozen, injects paused, another
 * controller's change) stay visible and polling keeps running while you write.
 *
 * WHAT IT SETS
 *   item:  title (1..120), notes (<= 500), T+N (`plannedMinute`), assignee (from
 *          `GET /api/injects/assignees`), and `post` | `burst` mode.
 *   post:  persona (staff persona data), text with a 280 code-point counter, media
 *          (the `InjectMediaField` adapter; alt required), reply-to (an earlier
 *          scripted post or a pasted post id) and an optional engagement baseline
 *          — see `InjectPostEditor`.
 *   burst: 2..20 posts you can add / remove / reorder (the order IS the release
 *          order), and the window in seconds (30..600, default 90).
 *
 * VALIDATION. Fast, local, and a mirror of the server (`injectRules.validateWrite`):
 * errors appear on the field after a first Save attempt (the 280 / 120 / 500 overruns
 * show as you type) and focus moves to the first invalid field. The SERVER's 400
 * messages come back through `onSubmit`'s result and land on the field (by dotted
 * path) or on the form — the server stays authoritative.
 *
 * MODES. `create` (blank, assigned to me by default) · `edit` (seeded from the item;
 * saved with the item's `version`, so a stale save is a 409 the panel turns into
 * "Changed by someone else. Reloaded." and re-seeds this form with the fresh item) ·
 * `view` (read-only: fired, firing and skipped items are not editable — story 06).
 * A banner tells you when the item changed under you while you were editing.
 *
 * KEYBOARD (NFR-001). Esc cancels, Ctrl/Cmd+Enter saves; every control is native or
 * a COBRA button. The run-sheet shortcut keys are suspended while this form is open
 * (the panel does that), so typing an "f" never fires anything.
 */

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Box, FormControlLabel, Radio, RadioGroup } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faFloppyDisk, faPlus, faXmark } from '@fortawesome/free-solid-svg-icons'
import type { StaffPersona } from '@/features/personas'
import { consoleChrome as chrome } from '../consoleChrome'
import { RunSheetButton, RunSheetIconButton } from './RunSheetButtons'
import { RunSheetField } from './RunSheetField'
import { RunSheetStatusChip } from './RunSheetStatusChip'
import { InjectPostEditor, type ReplyOption } from './InjectPostEditor'
import {
  blankDraft,
  blankPost,
  draftFromItem,
  draftToWrite,
  type Draft,
  type DraftPost,
} from './injectDraft'
import { INJECT_LIMITS, countCodePoints, excerpt, plannedLabel } from './injectRules'
import type { InjectAssigneesDto, InjectItemDto, InjectItemWrite, InjectKind } from './types'

export type EditorMode = 'create' | 'edit' | 'view'

/** What the panel reports back after a save attempt. */
export type EditorSubmitResult =
  | { readonly ok: true }
  | {
    readonly ok: false
    /** A form-level message (a 400 with no field, a generic failure). */
    readonly form?: string
    /** Server validation messages keyed by normalised dotted path. */
    readonly fields?: Readonly<Record<string, string>>
  }

export interface InjectItemEditorProps {
  readonly mode: EditorMode
  /** The snapshot this form is seeded from (edit / view). */
  readonly item?: InjectItemDto
  /** The item as the queue shows it NOW — used to flag "changed since you opened it". */
  readonly liveItem?: InjectItemDto
  /** The whole sheet, for the reply-to options. */
  readonly items: readonly InjectItemDto[]
  readonly assignees: InjectAssigneesDto['assignees']
  /** The caller's staff id: the default assignee of a new item. */
  readonly me?: string
  readonly personas: readonly StaffPersona[]
  readonly personasUnavailable: boolean
  /** A save is in flight. */
  readonly busy: boolean
  readonly onSubmit: (write: InjectItemWrite) => Promise<EditorSubmitResult>
  readonly onCancel: () => void
}

const ID = 'inject-editor'

const byOrder = (a: InjectItemDto, b: InjectItemDto): number => a.order - b.order

/** The 280 / 120 / 500 / alt overruns that show while typing, before any Save. */
function liveOverLimit(draft: Draft): Record<string, string> {
  const out: Record<string, string> = {}
  const L = INJECT_LIMITS
  if (countCodePoints(draft.title) > L.titleMax) {
    out.title = `Title must be ${L.titleMax} characters or fewer`
  }
  if (countCodePoints(draft.notes) > L.notesMax) {
    out.notes = `Notes must be ${L.notesMax} characters or fewer`
  }
  const shown = draft.kind === 'post' ? draft.posts.slice(0, 1) : draft.posts
  shown.forEach((post, i) => {
    const points = countCodePoints(post.text)
    if (points > L.textMax) out[`posts.${i}.text`] = `Text is ${points - L.textMax} over the ${L.textMax} limit`
  })
  return out
}

export function InjectItemEditor({
  mode,
  item,
  liveItem,
  items,
  assignees,
  me,
  personas,
  personasUnavailable,
  busy,
  onSubmit,
  onCancel,
}: InjectItemEditorProps) {
  const readOnly = mode === 'view'
  const [draft, setDraft] = useState<Draft>(() =>
    item && mode !== 'create' ? draftFromItem(item) : blankDraft(me ?? ''),
  )
  const [attempt, setAttempt] = useState(0)
  const [serverForm, setServerForm] = useState<string | undefined>()
  const [serverFields, setServerFields] = useState<Readonly<Record<string, string>>>({})
  const rootRef = useRef<HTMLDivElement>(null)

  const burst = draft.kind === 'burst'
  const shownPosts = burst ? draft.posts : draft.posts.slice(0, 1)
  const changedUnderYou =
    mode === 'edit' && item !== undefined && liveItem !== undefined && liveItem.version !== item.version

  // Local validation, shown after a Save attempt; over-limit text shows immediately.
  const validation = useMemo(() => draftToWrite(draft).errors, [draft])
  const liveErrors = useMemo(() => liveOverLimit(draft), [draft])
  const errors: Readonly<Record<string, string>> = {
    ...(attempt > 0 ? validation : liveErrors),
    ...serverFields,
  }

  // After a failed attempt, move focus to the first invalid field (keyboard-first).
  useEffect(() => {
    if (attempt === 0) return
    rootRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
  }, [attempt, serverFields])

  const reply = useMemo(() => {
    const sorted = [...items].sort(byOrder)
    const earlier = item ? sorted.filter(i => i.order < item.order) : sorted
    const persona = (id: string): string => personas.find(p => p.id === id)?.handle ?? id
    const options: ReplyOption[] = []
    for (const other of earlier) {
      for (const post of other.posts) {
        options.push({
          value: post.id,
          label:
            `${plannedLabel(other.plannedMinute)} · ${other.title} · #${post.sequence} ` +
            `@${persona(post.personaId)}: ${excerpt(post.text, 40)}`,
        })
      }
    }
    return options
  }, [items, item, personas])

  /** Earlier children of THIS burst (only once it exists on the server, so they have ids). */
  const siblingOptions = (index: number): ReplyOption[] => {
    if (!item || mode === 'create') return []
    return item.posts.slice(0, index).map(post => ({
      value: post.id,
      label: `This burst · #${post.sequence} @${
        personas.find(p => p.id === post.personaId)?.handle ?? post.personaId
      }: ${excerpt(post.text, 40)}`,
    }))
  }

  // ----- draft edits ------------------------------------------------------

  const patch = (changes: Partial<Draft>): void =>
    setDraft(previous => ({ ...previous, ...changes }))

  const patchPost = (index: number, changes: Partial<DraftPost>): void =>
    setDraft(previous => ({
      ...previous,
      posts: previous.posts.map((post, i) => (i === index ? { ...post, ...changes } : post)),
    }))

  const setKind = (kind: InjectKind): void =>
    setDraft(previous => {
      if (kind === previous.kind) return previous
      // Posts typed in the other mode are kept; a burst needs at least two.
      const posts = [...previous.posts]
      while (kind === 'burst' && posts.length < INJECT_LIMITS.burstMinPosts) posts.push(blankPost())
      return { ...previous, kind, posts }
    })

  const movePost = (index: number, delta: number): void =>
    setDraft(previous => {
      const target = index + delta
      if (target < 0 || target >= previous.posts.length) return previous
      const posts = [...previous.posts]
      const moved = posts[index]
      const other = posts[target]
      if (!moved || !other) return previous
      posts[index] = other
      posts[target] = moved
      return { ...previous, posts }
    })

  const removePost = (index: number): void =>
    setDraft(previous =>
      previous.posts.length <= INJECT_LIMITS.burstMinPosts
        ? previous
        : { ...previous, posts: previous.posts.filter((_, i) => i !== index) },
    )

  const addPost = (): void =>
    setDraft(previous =>
      previous.posts.length >= INJECT_LIMITS.burstMaxPosts
        ? previous
        : { ...previous, posts: [...previous.posts, blankPost()] },
    )

  // ----- submit -----------------------------------------------------------

  const submit = async (): Promise<void> => {
    if (readOnly || busy) return
    setServerForm(undefined)
    setServerFields({})
    setAttempt(count => count + 1)
    const { write, errors: found } = draftToWrite(draft)
    if (Object.keys(found).length > 0) return
    const result = await onSubmit(write)
    if (!result.ok) {
      setServerForm(result.form)
      setServerFields(result.fields ?? {})
      setAttempt(count => count + 1)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submit()
    }
  }

  const heading =
    mode === 'create' ? 'NEW SCRIPTED ITEM' : mode === 'edit' ? 'EDIT ITEM' : 'VIEW ITEM (READ-ONLY)'

  return (
    <Box
      ref={rootRef}
      role="form"
      aria-label={heading.toLowerCase()}
      data-testid="inject-editor"
      data-mode={mode}
      onKeyDown={onKeyDown}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        p: 1.5,
        border: `1px solid ${chrome.line}`,
        borderRadius: '8px',
        bgcolor: chrome.panel,
        color: chrome.ink,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="h3" sx={{ m: 0, flex: 1, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em' }}>
          {heading}
        </Box>
        {item && mode !== 'create' ? <RunSheetStatusChip item={item} /> : null}
        <RunSheetIconButton icon={faXmark} ariaLabel="Close editor" onClick={onCancel} />
      </Box>

      {readOnly && item ? (
        <Box
          data-testid="editor-readonly-note"
          role="status"
          sx={{ fontSize: 12, color: chrome.inkMuted }}
        >
          {`This item is ${item.status}, so it can no longer be edited. A fired post is corrected with takedown.`}
        </Box>
      ) : null}

      {changedUnderYou ? (
        <Box
          data-testid="editor-stale-note"
          role="status"
          sx={{ fontSize: 12, color: chrome.amber }}
        >
          <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />{' '}
          Someone else changed this item while you were editing. Saving will reload it.
        </Box>
      ) : null}

      {/* Kind */}
      <RadioGroup
        row
        aria-label="Item type"
        value={draft.kind}
        onChange={(_event, value) => setKind(value === 'burst' ? 'burst' : 'post')}
        sx={{ gap: 2 }}
      >
        {(['post', 'burst'] as const).map(kind => (
          <FormControlLabel
            key={kind}
            value={kind}
            disabled={readOnly}
            sx={{ m: 0, '& .MuiFormControlLabel-label': { fontSize: 12.5, color: chrome.ink } }}
            control={
              <Radio
                size="small"
                sx={{ color: chrome.inkMuted, '&.Mui-checked': { color: chrome.blue } }}
              />
            }
            label={kind === 'post' ? 'Single post' : 'Burst (pile-on)'}
          />
        ))}
      </RadioGroup>

      <RunSheetField
        id={`${ID}-title`}
        label="Title"
        required
        value={draft.title}
        onChange={value => patch({ title: value })}
        disabled={readOnly}
        error={errors.title}
        hint={`${countCodePoints(draft.title)}/${INJECT_LIMITS.titleMax}`}
      />

      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)', gap: 1 }}>
        <RunSheetField
          id={`${ID}-planned`}
          label="T+N (minutes)"
          type="number"
          value={draft.plannedMinute}
          onChange={value => patch({ plannedMinute: value })}
          disabled={readOnly}
          error={errors.plannedMinute}
          inputProps={{ min: 0, step: 1 }}
        />
        <RunSheetField
          id={`${ID}-assignee`}
          label="Assignee"
          select
          value={draft.assigneeId}
          onChange={value => patch({ assigneeId: value })}
          disabled={readOnly}
          error={errors.assigneeId}
        >
          <option value="">Unassigned</option>
          {assignees.map(assignee => (
            <option key={assignee.id} value={assignee.id}>
              {`${assignee.displayName} (${assignee.role})${assignee.id === me ? ' (you)' : ''}`}
            </option>
          ))}
          {draft.assigneeId !== '' && !assignees.some(a => a.id === draft.assigneeId) ? (
            <option value={draft.assigneeId}>{draft.assigneeId}</option>
          ) : null}
        </RunSheetField>
      </Box>

      <RunSheetField
        id={`${ID}-notes`}
        label="Notes"
        multiline
        rows={2}
        value={draft.notes}
        onChange={value => patch({ notes: value })}
        disabled={readOnly}
        error={errors.notes}
        hint={`${countCodePoints(draft.notes)}/${INJECT_LIMITS.notesMax}`}
      />

      {burst ? (
        <RunSheetField
          id={`${ID}-window`}
          label="Burst window (seconds)"
          type="number"
          value={draft.windowSeconds}
          onChange={value => patch({ windowSeconds: value })}
          disabled={readOnly}
          error={errors.burstWindowSeconds}
          hint={`${INJECT_LIMITS.windowMin} to ${INJECT_LIMITS.windowMax}; posts spread across it, 3 s apart at least`}
          inputProps={{ min: INJECT_LIMITS.windowMin, max: INJECT_LIMITS.windowMax, step: 1 }}
        />
      ) : null}

      {errors.posts ? (
        <Box data-testid="editor-posts-error" sx={{ fontSize: 12, color: chrome.amber }}>
          <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" /> {errors.posts}
        </Box>
      ) : null}

      {shownPosts.map((post, index) => {
        const prefix: string = `posts.${index}.`
        const own: Record<string, string> = {}
        for (const [key, message] of Object.entries(errors)) {
          if (key.startsWith(prefix)) own[key.slice(prefix.length)] = message
        }
        return (
          <InjectPostEditor
            key={post.key}
            idPrefix={`${ID}-post-${index}`}
            index={index}
            count={shownPosts.length}
            burst={burst}
            post={post}
            personas={personas}
            personasUnavailable={personasUnavailable}
            replyOptions={[...siblingOptions(index), ...reply]}
            replyHint={
              burst && mode === 'create'
                ? 'To reply to another post in this burst, save it first, then edit.'
                : undefined
            }
            errors={own}
            disabled={readOnly}
            canMoveUp={index > 0}
            canMoveDown={index < shownPosts.length - 1}
            canRemove={shownPosts.length > INJECT_LIMITS.burstMinPosts}
            onChange={changes => patchPost(index, changes)}
            onMoveUp={() => movePost(index, -1)}
            onMoveDown={() => movePost(index, 1)}
            onRemove={() => removePost(index)}
          />
        )
      })}

      {burst && !readOnly ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <RunSheetButton
            icon={faPlus}
            label="Add post"
            ariaLabel="Add post to burst"
            disabled={draft.posts.length >= INJECT_LIMITS.burstMaxPosts}
            testId="editor-add-post"
            onClick={addPost}
          />
          <Box component="span" data-testid="editor-post-count" sx={{ fontSize: 11.5, color: chrome.inkMuted }}>
            {draft.posts.length >= INJECT_LIMITS.burstMaxPosts
              ? `${draft.posts.length} posts (maximum ${INJECT_LIMITS.burstMaxPosts})`
              : `${draft.posts.length} posts (${INJECT_LIMITS.burstMinPosts} to ${INJECT_LIMITS.burstMaxPosts})`}
          </Box>
        </Box>
      ) : null}

      {serverForm ? (
        <Box
          role="alert"
          data-testid="editor-form-error"
          sx={{ fontSize: 12.5, p: 1, border: `1px solid ${chrome.amber}`, borderRadius: '6px' }}
        >
          <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" /> {serverForm}
        </Box>
      ) : null}

      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <RunSheetButton
          icon={faXmark}
          label={readOnly ? 'Close' : 'Cancel'}
          ariaLabel={readOnly ? 'Close editor' : 'Cancel editing'}
          testId="editor-cancel"
          onClick={onCancel}
        />
        {!readOnly ? (
          <RunSheetButton
            kind="primary"
            icon={faFloppyDisk}
            label={mode === 'create' ? 'Add to run sheet' : 'Save changes'}
            disabled={busy}
            testId="editor-save"
            onClick={() => void submit()}
          />
        ) : null}
      </Box>
    </Box>
  )
}
