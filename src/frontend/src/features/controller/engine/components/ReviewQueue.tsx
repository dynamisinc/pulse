/**
 * features/controller/engine/components/ReviewQueue.tsx
 * ---------------------------------------------------------------------------
 * The engine REVIEW QUEUE column (feature: engine-review-cockpit, story 01;
 * ADP-040, D5 README §6 "REVIEW QUEUE (336px, sole tenant)", D5-014/1.1/2.1,
 * NFR-001). STAFF world — dark COBRA operator chrome (D5 design tokens), MUI 9
 * `sx`-only system props, FontAwesome icons only. The published OUTPUT of an
 * approved draft is a participant post (scenario-time, sanitized, `origin:
 * 'engine'`, provenance never participant-visible) — never drawn here (XC-002).
 *
 * ONE card per engine burst (D5 §6): persona avatar/name/handle (the cross-surface
 * `<Avatar>`/`<VerifiedMark>` primitives, so the persona reads identically to
 * every participant surface — a trust signal is never re-themed per world), the
 * action label ("reply → @handle"), preview text, storyline tag, and a countdown
 * state that is one of "holds in M:SS" (+ a depleting bar) | "needs review" |
 * "timer expired — held for you". Every disposition/countdown carries a TEXT label,
 * never colour alone (NFR-001). Held/priority items get a red left border AND the
 * held text.
 *
 * FULLY KEYBOARD-OPERABLE (NFR-001), roving-tabindex grid:
 *   ↑ / ↓  move focus between cards
 *   A      approve the focused burst (publish via the E2 pipeline)
 *   V      veto the focused burst
 *   E      edit — opens the composer slot prefilled with the draft text
 *   R      re-roll — request a fresh draft
 *   B      batch-approve (the selected bursts, or all outstanding if none selected)
 *   Space  toggle the focused card's batch selection (also a click target)
 * The focused card shows a blue ring + the A/V/E/R action buttons.
 *
 * SINGLE COUNT SOURCE (D5-014/2.1). The header's "N need review" / "N timers <60s"
 * / "N held" all come from `useReviewQueue()` — the ONE source the (future)
 * NEEDS-YOU bar + queue-pressure meter will read, rather than recomputing.
 *
 * EDIT SLOT (decoupled, mirrors `ControllerConsole`'s `dockSlots`). Editing opens
 * a caller-supplied `editSlot` render prop — so this file need NOT import
 * persona-operation internals; the integration step wires the real composer, whose
 * submit routes the new text back through `edit()` (→ `createPost`, which
 * sanitizes it, NFR-004; published as `origin: 'engine'`). Without an `editSlot`
 * (standalone), E is inert.
 */

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCheck,
  faXmark,
  faPen,
  faRotate,
  faListCheck,
  faSquare,
  faSquareCheck,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { Avatar, VerifiedMark, type AvatarPersona } from '@/features/social'
import { usePersonas } from '@/features/personas'
import type { Persona } from '@/features/personas'
import { DraftDisposition, type EngineReviewItem } from '../models/reviewContracts'
import { useReviewQueue } from '../hooks/useReviewQueue'
// D5 dark operator-chrome tokens (README §"Design Tokens"). Staff-only.
import { consoleChrome as chrome } from '../../consoleChrome'

export interface ReviewQueueEditSlotProps {
  /** The burst being edited. */
  readonly item: EngineReviewItem
  /** The draft text to prefill the composer with (the lead post). */
  readonly initialText: string
  /** Publish the burst with the edited lead text (routes through `edit()`). */
  readonly onSubmit: (newText: string) => void
  /** Dismiss the composer without publishing. */
  readonly onCancel: () => void
}

export interface ReviewQueueProps {
  /**
   * Renders the edit composer for the E action — a render-prop slot (mirrors
   * `ControllerConsole`'s `dockSlots`) so this component need not import
   * persona-operation internals. Absent in isolation (E is then inert).
   */
  readonly editSlot?: (props: ReviewQueueEditSlotProps) => ReactNode
}

/** M:SS from a millisecond remaining value (e.g. 108000 → "1:48"). */
function formatMSS(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

type CountdownKind = 'holds' | 'review' | 'held' | 'resolved'

interface CountdownState {
  readonly kind: CountdownKind
  readonly label: string
  /** 0..1 remaining fraction for the depleting bar (only for `holds`). */
  readonly fraction?: number
}

/** Derives the card's countdown state + EXACT label from the item + scenario now. */
function countdownStateOf(item: EngineReviewItem, nowMs: number): CountdownState {
  switch (item.disposition) {
    case DraftDisposition.Held:
      return { kind: 'held', label: 'timer expired — held for you' }
    case DraftDisposition.Queued:
      return { kind: 'review', label: 'needs review' }
    case DraftDisposition.Published:
      return { kind: 'resolved', label: 'published to the live world' }
    case DraftDisposition.Vetoed:
      return { kind: 'resolved', label: 'vetoed — not published' }
    case DraftDisposition.CountingDown: {
      const countdown = item.countdown
      if (!countdown) return { kind: 'review', label: 'needs review' }
      const remaining = countdown.remainingMs(nowMs)
      if (remaining <= 0) return { kind: 'review', label: 'needs review' }
      const total = countdown.countdownMinutes * 60_000
      const fraction = total > 0 ? Math.min(1, Math.max(0, remaining / total)) : 0
      return { kind: 'holds', label: `holds in ${formatMSS(remaining)}`, fraction }
    }
    default:
      return { kind: 'review', label: 'needs review' }
  }
}

/** A burst is actionable while it is not yet resolved (published/vetoed). */
function isReviewable(item: EngineReviewItem): boolean {
  return (
    item.disposition !== DraftDisposition.Published &&
    item.disposition !== DraftDisposition.Vetoed
  )
}

export function ReviewQueue({ editSlot }: ReviewQueueProps = {}) {
  const queue = useReviewQueue()
  const { items, nowMs, pendingCount, heldCount, timersUnder60sCount } = queue
  // Common-fields-only read (handle/displayName/avatar) — no `personaType`, so
  // the narrower two-world `Persona` contract is the right one (SOC-052/D1-008).
  const { personas } = usePersonas()

  const personaByHandle = useMemo(() => {
    const map = new Map<string, Persona>()
    for (const persona of personas) map.set(persona.handle.toLowerCase(), persona)
    return map
  }, [personas])

  const [focusIndex, setFocusIndex] = useState(0)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set())
  const [editingDraftId, setEditingDraftId] = useState<string | null>(null)
  const [status, setStatus] = useState('')

  const cardRefs = useRef<(HTMLDivElement | null)[]>([])

  const editingItem = useMemo(
    () => items.find(item => item.draftId === editingDraftId) ?? null,
    [items, editingDraftId],
  )

  const focusCard = useCallback((index: number) => {
    setFocusIndex(index)
    cardRefs.current[index]?.focus()
  }, [])

  const toggleSelected = useCallback((draftId: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(draftId)) next.delete(draftId)
      else next.add(draftId)
      return next
    })
  }, [])

  const runBatchApprove = useCallback(() => {
    const targets = selectedIds.size > 0
      ? items.filter(item => selectedIds.has(item.draftId) && isReviewable(item))
      : items.filter(isReviewable)
    if (targets.length === 0) {
      setStatus('Nothing to batch-approve.')
      return
    }
    const outcomes = queue.batchApprove(targets)
    const published = outcomes.filter(o => o.outcome === 'published').length
    const skipped = outcomes.length - published
    setSelectedIds(new Set())
    setStatus(
      `Batch approved ${published} draft${published === 1 ? '' : 's'}` +
        (skipped > 0 ? ` (${skipped} skipped)` : '') + '.',
    )
  }, [items, selectedIds, queue])

  // Container-level keyboard grid (NFR-001). Suspended while the edit composer is
  // open (so typing in it never triggers an action key) and for modified keys.
  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (editingItem) return
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (items.length > 0) focusCard(Math.min(items.length - 1, focusIndex + 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (items.length > 0) focusCard(Math.max(0, focusIndex - 1))
        return
      }

      const key = event.key.toLowerCase()
      if (key === 'b') {
        event.preventDefault()
        runBatchApprove()
        return
      }

      const item = items[focusIndex]
      if (!item) return
      if (key === ' ') {
        event.preventDefault()
        toggleSelected(item.draftId)
        return
      }
      if (!isReviewable(item)) return

      switch (key) {
        case 'a':
          event.preventDefault()
          queue.approve(item)
          setStatus(`Approved — publishing ${item.actionLabel}.`)
          break
        case 'v':
          event.preventDefault()
          queue.veto(item)
          setStatus('Vetoed — nothing published.')
          break
        case 'e':
          event.preventDefault()
          if (editSlot) setEditingDraftId(item.draftId)
          break
        case 'r':
          event.preventDefault()
          queue.reroll(item)
          setStatus('Re-rolled — a fresh draft is on the way.')
          break
        default:
          break
      }
    },
    [editingItem, items, focusIndex, focusCard, runBatchApprove, toggleSelected, queue, editSlot],
  )

  const submitEdit = useCallback(
    (newText: string) => {
      if (editingItem) {
        queue.edit(editingItem, newText)
        setStatus(`Edited — publishing ${editingItem.actionLabel}.`)
      }
      setEditingDraftId(null)
    },
    [editingItem, queue],
  )

  return (
    <Box
      data-testid="review-queue"
      onKeyDown={handleKeyDown}
      sx={{
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        bgcolor: chrome.panel,
        color: chrome.ink,
        fontFamily: "'Figtree', system-ui, sans-serif",
      }}
    >
      {/* Header — title, single-source counts, batch approve */}
      <Box
        sx={{
          px: 1.75,
          py: 1.5,
          borderBottom: `1px solid ${chrome.line}`,
          flex: 'none',
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <Typography
            component="h2"
            sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', color: chrome.ink }}
          >
            REVIEW QUEUE
          </Typography>
          <Box sx={{ flex: 1 }} />
          <Box
            component="button"
            type="button"
            data-testid="batch-approve"
            onClick={runBatchApprove}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1,
              py: 0.5,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: chrome.ink,
              bgcolor: 'transparent',
              border: `1px solid ${chrome.line}`,
              borderRadius: '7px',
              cursor: 'pointer',
              '&:hover': { borderColor: chrome.blue },
            }}
          >
            <FontAwesomeIcon icon={faListCheck} aria-hidden="true" />
            Batch approve [B]
          </Box>
        </Stack>

        <Typography
          data-testid="review-queue-counts"
          role="status"
          aria-live="polite"
          sx={{ mt: 0.75, fontSize: 11.5, color: chrome.inkMuted }}
        >
          <Box component="span" data-testid="pending-count" sx={{ color: chrome.blue, fontWeight: 700 }}>
            {pendingCount} need review
          </Box>
          <Box component="span" sx={{ color: chrome.inkFaint }}> · </Box>
          <Box component="span" data-testid="timers-under-60s" sx={{ color: chrome.amber }}>
            {timersUnder60sCount} timer{timersUnder60sCount === 1 ? '' : 's'} under 60s
          </Box>
          <Box component="span" sx={{ color: chrome.inkFaint }}> · </Box>
          <Box component="span" data-testid="held-count" sx={{ color: chrome.red }}>
            {heldCount} held
          </Box>
        </Typography>

        <Typography sx={{ mt: 0.5, fontSize: 10.5, color: chrome.inkFaint, lineHeight: 1.4 }}>
          Engine drafts awaiting your call — approve (A) or veto (V). Expired timers hold the draft
          for you; nothing posts without a decision.
        </Typography>
      </Box>

      {/* The card list (roving-tabindex grid) */}
      <Box
        role="list"
        aria-label="Engine review queue"
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25, display: 'flex', flexDirection: 'column', gap: 1.25 }}
      >
        {items.length === 0 && (
          <Typography data-testid="review-queue-empty" sx={{ p: 2, fontSize: 12, color: chrome.inkFaint }}>
            All clear — no engine drafts awaiting review.
          </Typography>
        )}

        {items.map((item, index) => (
          <ReviewCard
            key={item.draftId}
            ref={el => { cardRefs.current[index] = el }}
            item={item}
            focused={index === focusIndex}
            selected={selectedIds.has(item.draftId)}
            countdown={countdownStateOf(item, nowMs)}
            persona={personaByHandle.get(item.leadPersonaHandle.toLowerCase())}
            editable={Boolean(editSlot)}
            onFocusCard={() => setFocusIndex(index)}
            onToggleSelected={() => toggleSelected(item.draftId)}
            onApprove={() => { queue.approve(item); setStatus(`Approved — publishing ${item.actionLabel}.`) }}
            onVeto={() => { queue.veto(item); setStatus('Vetoed — nothing published.') }}
            onEdit={() => { if (editSlot) setEditingDraftId(item.draftId) }}
            onReroll={() => { queue.reroll(item); setStatus('Re-rolled — a fresh draft is on the way.') }}
          />
        ))}
      </Box>

      {/* Status announcements (batch outcomes + single actions) */}
      <Box
        data-testid="review-queue-status"
        role="status"
        aria-live="polite"
        sx={{ px: 1.75, py: 0.75, borderTop: `1px solid ${chrome.line}`, fontSize: 11, color: chrome.inkMuted, minHeight: 24, flex: 'none' }}
      >
        {status}
      </Box>

      {/* Edit composer slot (caller-supplied) */}
      {editingItem && editSlot && (
        <Box
          data-testid="review-queue-edit-slot"
          sx={{
            position: 'absolute',
            inset: 0,
            bgcolor: 'rgba(10, 16, 23, 0.86)',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 20,
          }}
        >
          {editSlot({
            item: editingItem,
            initialText: editingItem.previewText,
            onSubmit: submitEdit,
            onCancel: () => setEditingDraftId(null),
          })}
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

interface ReviewCardProps {
  readonly item: EngineReviewItem
  readonly focused: boolean
  readonly selected: boolean
  readonly countdown: CountdownState
  readonly persona: Persona | undefined
  readonly editable: boolean
  readonly onFocusCard: () => void
  readonly onToggleSelected: () => void
  readonly onApprove: () => void
  readonly onVeto: () => void
  readonly onEdit: () => void
  readonly onReroll: () => void
  readonly ref?: Ref<HTMLDivElement>
}

/** Fallback avatar identity when the persona isn't resolved yet (loading). */
function fallbackAvatar(handle: string): AvatarPersona {
  const initials = handle.slice(0, 2).toUpperCase()
  return { kind: 'org', avatarColor: '#33455c', initials, displayName: handle }
}

function ReviewCard({
  ref,
  item,
  focused,
  selected,
  countdown,
  persona,
  editable,
  onFocusCard,
  onToggleSelected,
  onApprove,
  onVeto,
  onEdit,
  onReroll,
}: ReviewCardProps) {
  const isHeld = item.disposition === DraftDisposition.Held
  const reviewable = isReviewable(item)
  const avatarPersona: AvatarPersona = persona ?? fallbackAvatar(item.leadPersonaHandle)
  const displayName = persona?.displayName ?? item.leadPersonaHandle

  return (
    <Box
      ref={ref}
      role="listitem"
      data-testid="review-card"
      data-draft-id={item.draftId}
      data-disposition={item.disposition}
      data-priority={isHeld ? 'true' : 'false'}
      tabIndex={focused ? 0 : -1}
      onFocus={onFocusCard}
      onClick={onFocusCard}
      sx={{
        position: 'relative',
        bgcolor: chrome.card,
        border: `1px solid ${focused ? chrome.blue : chrome.cardBorder}`,
        borderLeft: isHeld ? `3px solid ${chrome.red}` : `1px solid ${focused ? chrome.blue : chrome.cardBorder}`,
        borderRadius: '9px',
        boxShadow: focused ? `0 0 0 2px ${chrome.blue}55` : 'none',
        p: 1.25,
        outline: 'none',
        cursor: 'pointer',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        {/* Batch-selection toggle */}
        <Box
          component="button"
          type="button"
          data-testid="select-toggle"
          aria-pressed={selected}
          aria-label={selected ? `Deselect ${displayName} draft` : `Select ${displayName} draft`}
          onClick={e => { e.stopPropagation(); onToggleSelected() }}
          sx={{ mt: 0.25, bgcolor: 'transparent', border: 'none', p: 0, cursor: 'pointer', color: selected ? chrome.blue : chrome.inkFaint }}
        >
          <FontAwesomeIcon icon={selected ? faSquareCheck : faSquare} aria-hidden="true" />
        </Box>

        <Box sx={{ mt: 0.25, flex: 'none' }}>
          <Avatar persona={avatarPersona} size={34} />
        </Box>

        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Identity */}
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
            <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 700, color: chrome.ink }}>
              {displayName}
            </Typography>
            {persona?.verified && <VerifiedMark size={13} />}
            <Typography component="span" sx={{ fontSize: 11.5, color: chrome.inkFaint }}>
              @{item.leadPersonaHandle}
            </Typography>
          </Stack>

          {/* Action label + storyline tag */}
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, mt: 0.25, flexWrap: 'wrap' }}>
            <Typography component="span" data-testid="action-label" sx={{ fontSize: 11, color: chrome.inkMuted }}>
              {item.actionLabel}
            </Typography>
            <Box
              component="span"
              data-testid="storyline-tag"
              sx={{ fontSize: 10, fontWeight: 700, color: chrome.blue, border: `1px solid ${chrome.line}`, borderRadius: '20px', px: 0.75, py: 0.1 }}
            >
              {item.storylineTag}
            </Box>
          </Stack>

          {/* Preview text */}
          <Typography data-testid="preview-text" sx={{ fontSize: 12, color: chrome.ink, mt: 0.5, lineHeight: 1.4 }}>
            {item.previewText}
          </Typography>

          {/* Storyline brief (mocked context) */}
          <Typography sx={{ fontSize: 10.5, color: chrome.inkFaint, mt: 0.5, lineHeight: 1.35 }}>
            {item.storylineBrief}
          </Typography>

          {/* Countdown state (always text; never colour-only) */}
          <CountdownRow countdown={countdown} isHeld={isHeld} />

          {/* Action row — only on the focused, reviewable card */}
          {focused && reviewable && (
            <Stack direction="row" data-testid="card-actions" sx={{ gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
              <ActionButton icon={faCheck} label="Approve" hint="A" tone={chrome.green} onClick={e => { e.stopPropagation(); onApprove() }} />
              <ActionButton icon={faXmark} label="Veto" hint="V" tone={chrome.red} onClick={e => { e.stopPropagation(); onVeto() }} />
              {editable && (
                <ActionButton icon={faPen} label="Edit" hint="E" tone={chrome.blue} onClick={e => { e.stopPropagation(); onEdit() }} />
              )}
              <ActionButton icon={faRotate} label="Re-roll" hint="R" tone={chrome.amber} onClick={e => { e.stopPropagation(); onReroll() }} />
            </Stack>
          )}
        </Box>
      </Stack>
    </Box>
  )
}

interface CountdownRowProps {
  readonly countdown: CountdownState
  readonly isHeld: boolean
}

function CountdownRow({ countdown, isHeld }: CountdownRowProps) {
  const tone =
    countdown.kind === 'held' ? chrome.red
      : countdown.kind === 'holds' ? chrome.amber
        : countdown.kind === 'review' ? chrome.blue
          : chrome.inkFaint

  return (
    <Box data-testid="countdown-state" data-countdown-kind={countdown.kind} sx={{ mt: 0.75 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
        {isHeld && <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.red} aria-hidden="true" />}
        <Typography component="span" sx={{ fontSize: 11, fontWeight: 700, color: tone }}>
          {countdown.label}
        </Typography>
      </Stack>
      {countdown.kind === 'holds' && countdown.fraction !== undefined && (
        <Box sx={{ mt: 0.4, height: 3, borderRadius: 2, bgcolor: chrome.line, overflow: 'hidden' }}>
          <Box
            data-testid="countdown-bar"
            sx={{ height: '100%', width: `${Math.round(countdown.fraction * 100)}%`, bgcolor: chrome.amber }}
          />
        </Box>
      )}
    </Box>
  )
}

interface ActionButtonProps {
  readonly icon: IconDefinition
  readonly label: string
  readonly hint: string
  readonly tone: string
  readonly onClick: (event: MouseEvent<HTMLButtonElement>) => void
}

function ActionButton({ icon, label, hint, tone, onClick }: ActionButtonProps) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={`${label} (${hint})`}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.4,
        fontSize: 11,
        fontWeight: 700,
        color: chrome.ink,
        bgcolor: 'transparent',
        border: `1px solid ${chrome.line}`,
        borderRadius: '7px',
        cursor: 'pointer',
        '&:hover': { borderColor: tone },
      }}
    >
      <FontAwesomeIcon icon={icon} color={tone} aria-hidden="true" />
      {label}
      <Box component="span" sx={{ color: chrome.inkFaint, fontWeight: 600 }}>{hint}</Box>
    </Box>
  )
}
