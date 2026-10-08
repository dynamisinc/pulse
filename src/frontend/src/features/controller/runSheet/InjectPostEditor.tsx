/**
 * features/controller/runSheet/InjectPostEditor.tsx
 * ---------------------------------------------------------------------------
 * The fields of ONE scripted post inside the run-sheet editor (inject-queue story
 * 07, AC "Author live"): persona, text with a 280 CODE-POINT counter, media (via
 * the `InjectMediaField` adapter), reply-to, and an optional engagement baseline.
 * STAFF world: COBRA fields (`RunSheetField` -> `CobraTextField`), COBRA buttons,
 * FontAwesome icons, MUI 9 `sx`-only.
 *
 *   - PERSONA: a native select over the staff persona list (`useStaffPersonas`,
 *     passed in). The `@handle` is in every option label so the verified account is
 *     never confused with its unverified lookalike (SOC-052).
 *   - TEXT: counted in Unicode code points (an emoji is 1). Over the limit is an
 *     error you see as you type, as text with an icon, never colour alone.
 *   - REPLY TO: "Not a reply" | an EARLIER scripted post in this sheet | "A post id…"
 *     (paste an existing post's id). The server validates both in scope.
 *   - BASELINE: optional starting likes / reposts / replies (0..1,000,000), off by
 *     default.
 *
 * Presentational: it owns no state beyond what its parent passes; every change goes
 * out through `onChange(patch)`. Errors arrive keyed RELATIVE to this post
 * (`personaId`, `text`, `media`, `media.0.alt`, `replyTo`, `engagementBaseline`).
 */

import { memo } from 'react'
import { Box, Checkbox, FormControlLabel } from '@mui/material'
import { faArrowDown, faArrowUp, faTrash } from '@fortawesome/free-solid-svg-icons'
import type { StaffPersona } from '@/features/personas'
import { consoleChrome as chrome } from '../consoleChrome'
import { RunSheetField } from './RunSheetField'
import { RunSheetIconButton } from './RunSheetButtons'
import { InjectMediaField } from './media/InjectMediaField'
import type { DraftPost, DraftReply } from './injectDraft'
import { INJECT_LIMITS, countCodePoints } from './injectRules'

export interface ReplyOption {
  /** The scripted post's id (`replyTo.injectPostId`). */
  readonly value: string
  readonly label: string
}

export interface InjectPostEditorProps {
  readonly idPrefix: string
  /** 0-based position within the burst. */
  readonly index: number
  /** How many posts are shown (1 in post mode). */
  readonly count: number
  readonly burst: boolean
  readonly post: DraftPost
  readonly personas: readonly StaffPersona[]
  readonly personasUnavailable: boolean
  readonly replyOptions: readonly ReplyOption[]
  /** Shown under the reply select (e.g. why a sibling can't be picked yet). */
  readonly replyHint?: string
  readonly errors: Readonly<Record<string, string>>
  readonly disabled: boolean
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
  readonly canRemove: boolean
  readonly onChange: (patch: Partial<DraftPost>) => void
  readonly onMoveUp: () => void
  readonly onMoveDown: () => void
  readonly onRemove: () => void
}

const NOT_A_REPLY = ''
const PASTE_ID = '__post-id'
const SCRIPTED_PREFIX = 'inj:'

function replySelectValue(reply: DraftReply): string {
  if (reply.kind === 'scripted') return `${SCRIPTED_PREFIX}${reply.injectPostId}`
  if (reply.kind === 'postId') return PASTE_ID
  return NOT_A_REPLY
}

function InjectPostEditorImpl({
  idPrefix,
  index,
  count,
  burst,
  post,
  personas,
  personasUnavailable,
  replyOptions,
  replyHint,
  errors,
  disabled,
  canMoveUp,
  canMoveDown,
  canRemove,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
}: InjectPostEditorProps) {
  const n = index + 1
  const name = (base: string): string => (burst ? `Post ${n} ${base.toLowerCase()}` : base)
  const points = countCodePoints(post.text)
  const personaKnown = personas.some(p => p.id === post.personaId)

  const mediaErrors: Record<string, string> = {}
  for (const [key, message] of Object.entries(errors)) {
    if (key === 'media' || key.startsWith('media.')) mediaErrors[key] = message
  }

  const scriptedId = post.reply.kind === 'scripted' ? post.reply.injectPostId : undefined
  const scriptedKnown = scriptedId === undefined || replyOptions.some(o => o.value === scriptedId)

  const onReplyChange = (value: string): void => {
    if (value === NOT_A_REPLY) onChange({ reply: { kind: 'none' } })
    else if (value === PASTE_ID) {
      onChange({ reply: { kind: 'postId', postId: post.reply.kind === 'postId' ? post.reply.postId : '' } })
    } else onChange({ reply: { kind: 'scripted', injectPostId: value.slice(SCRIPTED_PREFIX.length) } })
  }

  return (
    <Box
      role="group"
      aria-label={burst ? `Post ${n} of ${count}` : 'Post'}
      data-testid="post-editor"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        p: 1.25,
        border: `1px solid ${chrome.cardBorder}`,
        borderRadius: '8px',
        bgcolor: chrome.card,
      }}
    >
      {burst ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{ flex: 1, fontSize: 12, fontWeight: 800, letterSpacing: '0.06em' }}>
            {`POST ${n} OF ${count}`}
          </Box>
          <RunSheetIconButton
            icon={faArrowUp}
            ariaLabel={`Move post ${n} up`}
            disabled={disabled || !canMoveUp}
            onClick={onMoveUp}
          />
          <RunSheetIconButton
            icon={faArrowDown}
            ariaLabel={`Move post ${n} down`}
            disabled={disabled || !canMoveDown}
            onClick={onMoveDown}
          />
          <RunSheetIconButton
            icon={faTrash}
            ariaLabel={`Remove post ${n}`}
            disabled={disabled || !canRemove}
            onClick={onRemove}
          />
        </Box>
      ) : null}

      <RunSheetField
        id={`${idPrefix}-persona`}
        label={name('Persona')}
        select
        required
        value={post.personaId}
        onChange={value => onChange({ personaId: value })}
        disabled={disabled}
        error={errors.personaId}
        hint={personasUnavailable ? 'Personas unavailable' : undefined}
      >
        <option value="">Choose a persona…</option>
        {personas.map(persona => (
          <option key={persona.id} value={persona.id}>
            {`${persona.displayName} (@${persona.handle})`}
          </option>
        ))}
        {post.personaId !== '' && !personaKnown ? (
          <option value={post.personaId}>{post.personaId}</option>
        ) : null}
      </RunSheetField>

      <RunSheetField
        id={`${idPrefix}-text`}
        label={name('Text')}
        required
        multiline
        rows={3}
        value={post.text}
        onChange={value => onChange({ text: value })}
        disabled={disabled}
        error={errors.text}
        hint={
          <span data-testid={`${idPrefix}-counter`}>{`${points}/${INJECT_LIMITS.textMax}`}</span>
        }
      />

      <InjectMediaField
        idPrefix={`${idPrefix}-media`}
        media={post.media}
        onChange={media => onChange({ media })}
        disabled={disabled}
        errors={mediaErrors}
      />

      <RunSheetField
        id={`${idPrefix}-reply`}
        label={name('Reply to')}
        select
        value={replySelectValue(post.reply)}
        onChange={onReplyChange}
        disabled={disabled}
        error={errors.replyTo}
        hint={replyHint}
      >
        <option value={NOT_A_REPLY}>Not a reply</option>
        {replyOptions.map(option => (
          <option key={option.value} value={`${SCRIPTED_PREFIX}${option.value}`}>
            {option.label}
          </option>
        ))}
        {!scriptedKnown && scriptedId !== undefined ? (
          <option value={`${SCRIPTED_PREFIX}${scriptedId}`}>Scripted post (not in the earlier items)</option>
        ) : null}
        <option value={PASTE_ID}>An existing post (paste its id)…</option>
      </RunSheetField>
      {post.reply.kind === 'postId' ? (
        <RunSheetField
          id={`${idPrefix}-reply-post-id`}
          label={name('Reply to post id')}
          value={post.reply.postId}
          onChange={value => onChange({ reply: { kind: 'postId', postId: value } })}
          disabled={disabled}
        />
      ) : null}

      <FormControlLabel
        sx={{ m: 0, color: chrome.ink, '& .MuiFormControlLabel-label': { fontSize: 12.5 } }}
        control={
          <Checkbox
            size="small"
            checked={post.baselineOn}
            disabled={disabled}
            onChange={event => onChange({ baselineOn: event.target.checked })}
            sx={{ color: chrome.inkMuted, '&.Mui-checked': { color: chrome.blue } }}
          />
        }
        label={name('Set engagement baseline')}
      />
      {post.baselineOn ? (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 1 }}>
          <RunSheetField
            id={`${idPrefix}-baseline-like`}
            label="Likes"
            type="number"
            value={post.baselineLike}
            onChange={value => onChange({ baselineLike: value })}
            disabled={disabled}
            inputProps={{ min: 0, max: INJECT_LIMITS.baselineMax }}
          />
          <RunSheetField
            id={`${idPrefix}-baseline-repost`}
            label="Reposts"
            type="number"
            value={post.baselineRepost}
            onChange={value => onChange({ baselineRepost: value })}
            disabled={disabled}
            inputProps={{ min: 0, max: INJECT_LIMITS.baselineMax }}
          />
          <RunSheetField
            id={`${idPrefix}-baseline-reply`}
            label="Replies"
            type="number"
            value={post.baselineReply}
            onChange={value => onChange({ baselineReply: value })}
            disabled={disabled}
            inputProps={{ min: 0, max: INJECT_LIMITS.baselineMax }}
          />
          {errors.engagementBaseline ? (
            <Box sx={{ gridColumn: '1 / -1', fontSize: 12, color: chrome.amber }}>
              {errors.engagementBaseline}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Re-render only the post that changed
// ---------------------------------------------------------------------------

type Errors = Readonly<Record<string, string>>

function sameRecord(a: Errors, b: Errors): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every(key => a[key] === b[key])
}

function sameOptions(a: readonly ReplyOption[], b: readonly ReplyOption[]): boolean {
  return (
    a.length === b.length &&
    a.every((o, i) => o.value === b[i]?.value && o.label === b[i]?.label)
  )
}

/**
 * A burst can have 20 posts, each with a dozen MUI controls; without this, every keystroke in
 * one post re-renders all 20. The draft is updated immutably (an untouched post keeps its object
 * identity), so comparing the data props is enough. The three callbacks are deliberately
 * IGNORED: the editor builds them from `index` alone over a functional `setDraft`, so a
 * callback is interchangeable with its predecessor whenever `index` is unchanged.
 */
function samePostEditorProps(a: InjectPostEditorProps, b: InjectPostEditorProps): boolean {
  return (
    a.idPrefix === b.idPrefix &&
    a.index === b.index &&
    a.count === b.count &&
    a.burst === b.burst &&
    a.post === b.post &&
    a.personas === b.personas &&
    a.personasUnavailable === b.personasUnavailable &&
    a.replyHint === b.replyHint &&
    a.disabled === b.disabled &&
    a.canMoveUp === b.canMoveUp &&
    a.canMoveDown === b.canMoveDown &&
    a.canRemove === b.canRemove &&
    sameOptions(a.replyOptions, b.replyOptions) &&
    sameRecord(a.errors, b.errors)
  )
}

export const InjectPostEditor = memo(InjectPostEditorImpl, samePostEditorProps)
