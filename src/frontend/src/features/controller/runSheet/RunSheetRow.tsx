/**
 * features/controller/runSheet/RunSheetRow.tsx
 * ---------------------------------------------------------------------------
 * ONE row of the run sheet (inject-queue story 07, AC "The list"). STAFF world:
 * dense, dark COBRA operator chrome (`consoleChrome` tokens), COBRA buttons,
 * FontAwesome icons, MUI 9 `sx`-only. It never reuses a participant component.
 *
 * WHAT A ROW SHOWS
 *   T+N (`plannedMinute`) · status chip (icon + TEXT, "Firing 3/8" live from
 *   polling, never colour-only) · title · the first post's persona + "+N" for a
 *   burst · the assignee ("(you)" on mine) · for fired/firing items the FIRED
 *   scenario time (`formatScenarioTime`, exercise time zone) with the wall-clock
 *   time as a labelled secondary (staff-only) and who pressed Fire · for a failed
 *   item the server's reason and a Retry.
 *
 * ACTIONS are real buttons with accessible names ("Fire Boil-water advisory"), so
 * every keyboard shortcut has a reachable control. Which ones appear follows the
 * state machine (`injectRules.can*`): Fire (pending) · Hold (pending/firing) ·
 * Release (held) · Skip (pending/held) · Unskip (skipped) · Retry (failed) · Edit
 * (pending/held/failed) or View (fired/firing/skipped, opens read-only) · Delete
 * (pending/held/skipped; an INLINE confirm, not a modal) · Move up/down.
 *
 * FIRE has no confirmation dialog (CTL-034). It is disabled while ANY action on
 * the row is in flight (`busy`) and, under FREEZE, with the reason "World frozen"
 * (the title + `aria-describedby` at the panel's visible reason text). Held rows
 * offer Release, not Fire.
 *
 * SELECTION is roving: the selected row is the tab stop; focusing anything inside
 * a row selects it, so a keyboard shortcut always acts on the row you are in.
 */

import type { Ref } from 'react'
import { Box } from '@mui/material'
import {
  faArrowDown,
  faArrowUp,
  faBolt,
  faEye,
  faForwardStep,
  faPause,
  faPen,
  faPlay,
  faRotateRight,
  faTrash,
  faRotateLeft,
} from '@fortawesome/free-solid-svg-icons'
import type { Persona } from '@/features/personas'
import { formatScenarioTime } from '@/core/clock'
import { consoleChrome as chrome } from '../consoleChrome'
import { RunSheetButton, RunSheetIconButton } from './RunSheetButtons'
import { RunSheetStatusChip } from './RunSheetStatusChip'
import { PersonaLine } from './PersonaLine'
import {
  canDelete,
  canFire,
  canHold,
  canRelease,
  canRetry,
  canSkip,
  canUnskip,
  failureReason,
  isEditable,
  plannedLabel,
} from './injectRules'
import { MESSAGES } from './injectMessages'
import type { InjectItemDto } from './types'

export interface RunSheetRowProps {
  readonly item: InjectItemDto
  readonly selected: boolean
  /** This row is the one tab stop of the list (roving tabindex). */
  readonly tabStop: boolean
  /** An action on this row is in flight — every action button is disabled. */
  readonly busy: boolean
  /** Why Fire/Retry are unavailable ("World frozen"), or `undefined` when they are available. */
  readonly fireDisabledReason: string | undefined
  /** Id of the visible element that carries `fireDisabledReason`. */
  readonly fireReasonId: string
  readonly isMine: boolean
  /** Resolves a persona id to its staff-visible fields. */
  readonly personaOf: (
    personaId: string,
  ) => Pick<Persona, 'displayName' | 'handle' | 'initials' | 'avatarColor'> | undefined
  /** Resolves a staff id to a display name. */
  readonly nameOf: (id: string | undefined) => string | undefined
  readonly timeZone: string
  readonly canMoveUp: boolean
  readonly canMoveDown: boolean
  readonly confirmingDelete: boolean

  readonly onSelect: () => void
  readonly onFire: () => void
  readonly onHold: () => void
  readonly onRelease: () => void
  readonly onSkip: () => void
  readonly onUnskip: () => void
  readonly onRetry: () => void
  /** Opens the editor (read-only when the item is no longer editable). */
  readonly onOpen: () => void
  readonly onRequestDelete: () => void
  readonly onConfirmDelete: () => void
  readonly onCancelDelete: () => void
  readonly onMoveUp: () => void
  readonly onMoveDown: () => void
  readonly rowRef?: Ref<HTMLLIElement>
}

const wallFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' })

/** The wall-clock stamp of the first post that fired (staff-only secondary time). */
function firstWallClock(item: InjectItemDto): string | undefined {
  const iso = item.posts.find(post => post.firedWallClock)?.firedWallClock
  if (!iso) return undefined
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? undefined : wallFormat.format(date)
}

export function RunSheetRow({
  item,
  selected,
  tabStop,
  busy,
  fireDisabledReason,
  fireReasonId,
  isMine,
  personaOf,
  nameOf,
  timeZone,
  canMoveUp,
  canMoveDown,
  confirmingDelete,
  onSelect,
  onFire,
  onHold,
  onRelease,
  onSkip,
  onUnskip,
  onRetry,
  onOpen,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onMoveUp,
  onMoveDown,
  rowRef,
}: RunSheetRowProps) {
  const first = item.posts[0]
  const more = item.kind === 'burst' ? Math.max(0, item.total - 1) : 0
  const reason = item.status === 'failed' ? failureReason(item) : undefined
  const firedScenario = item.firedScenarioTime
    ? formatScenarioTime(item.firedScenarioTime, timeZone)
    : ''
  const wall = firstWallClock(item)
  const firedBy = nameOf(item.firedByHumanId)
  const frozenProps = fireDisabledReason
    ? { title: fireDisabledReason, describedBy: fireReasonId }
    : {}
  const editable = isEditable(item.status)
  const assigneeName = item.assigneeName ?? nameOf(item.assigneeId ?? undefined)

  return (
    <Box
      component="li"
      ref={rowRef}
      data-testid="run-sheet-row"
      data-item-id={item.id}
      data-status={item.status}
      aria-current={selected ? 'true' : undefined}
      tabIndex={tabStop ? 0 : -1}
      onClick={onSelect}
      onFocus={onSelect}
      sx={{
        listStyle: 'none',
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
        bgcolor: chrome.card,
        color: chrome.ink,
        border: `1px solid ${selected ? chrome.blue : chrome.cardBorder}`,
        borderLeft: `4px solid ${selected ? chrome.blue : chrome.line}`,
        borderRadius: '8px',
        outlineOffset: 2,
        '&:focus-visible': { outline: `2px solid ${chrome.blue}` },
      }}
    >
      {/* Line 1 — T+N · status · title */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flexWrap: 'wrap' }}>
        <Box
          component="span"
          data-testid="planned-minute"
          sx={{
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            fontSize: 11.5,
            color: chrome.inkMuted,
            flex: 'none',
          }}
        >
          {plannedLabel(item.plannedMinute)}
        </Box>
        <RunSheetStatusChip item={item} />
        <Box
          component="span"
          data-testid="row-title"
          sx={{ fontSize: 13, fontWeight: 700, minWidth: 0, flex: '1 1 140px', overflowWrap: 'anywhere' }}
        >
          {item.title}
        </Box>
      </Box>

      {/* Line 2 — persona(s) · assignee */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', minWidth: 0 }}>
        {first ? (
          <PersonaLine
            persona={personaOf(first.personaId)}
            personaId={first.personaId}
            more={more}
          />
        ) : null}
        <Box component="span" data-testid="row-assignee" sx={{ fontSize: 11.5, color: chrome.inkMuted }}>
          {assigneeName ? (
            <>
              <span>{assigneeName}</span>
              {isMine ? <span>{' (you)'}</span> : null}
            </>
          ) : (
            'Unassigned'
          )}
        </Box>
      </Box>

      {/* Line 3 — fired time / failure reason */}
      {item.firedScenarioTime ? (
        <Box data-testid="row-fired" sx={{ fontSize: 11.5, color: chrome.inkMuted }}>
          <span>{item.status === 'firing' ? 'Released ' : 'Fired '}</span>
          <span data-testid="fired-scenario-time">{firedScenario}</span>
          {wall ? (
            <>
              <span>{' · wall '}</span>
              <span data-testid="fired-wall-time">{wall}</span>
            </>
          ) : null}
          {firedBy ? <span>{` · by ${firedBy}`}</span> : null}
        </Box>
      ) : null}
      {reason ? (
        <Box data-testid="row-error" sx={{ fontSize: 12, color: chrome.ink }}>
          <strong>Failed:</strong> {reason}
        </Box>
      ) : null}

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        {canFire(item.status) ? (
          <RunSheetButton
            kind="primary"
            icon={faBolt}
            label="Fire"
            ariaLabel={`Fire ${item.title}`}
            disabled={busy || Boolean(fireDisabledReason)}
            testId="row-fire"
            onClick={onFire}
            {...frozenProps}
          />
        ) : null}
        {canRetry(item.status) ? (
          <RunSheetButton
            kind="primary"
            icon={faRotateRight}
            label="Retry"
            ariaLabel={`Retry ${item.title}`}
            disabled={busy || Boolean(fireDisabledReason)}
            testId="row-retry"
            onClick={onRetry}
            {...frozenProps}
          />
        ) : null}
        {canRelease(item.status) ? (
          <RunSheetButton
            icon={faPlay}
            label="Release"
            ariaLabel={`Release ${item.title}`}
            disabled={busy}
            testId="row-release"
            onClick={onRelease}
          />
        ) : null}
        {canHold(item.status) ? (
          <RunSheetButton
            icon={faPause}
            label="Hold"
            ariaLabel={`Hold ${item.title}`}
            disabled={busy}
            testId="row-hold"
            onClick={onHold}
          />
        ) : null}
        {canSkip(item.status) ? (
          <RunSheetButton
            icon={faForwardStep}
            label="Skip"
            ariaLabel={`Skip ${item.title}`}
            disabled={busy}
            testId="row-skip"
            onClick={onSkip}
          />
        ) : null}
        {canUnskip(item.status) ? (
          <RunSheetButton
            icon={faRotateLeft}
            label="Unskip"
            ariaLabel={`Unskip ${item.title}`}
            disabled={busy}
            testId="row-unskip"
            onClick={onUnskip}
          />
        ) : null}
        <RunSheetButton
          icon={editable ? faPen : faEye}
          label={editable ? 'Edit' : 'View'}
          ariaLabel={`${editable ? 'Edit' : 'View'} ${item.title}`}
          disabled={busy}
          testId="row-open"
          onClick={onOpen}
        />
        {canDelete(item.status) && !confirmingDelete ? (
          <RunSheetButton
            icon={faTrash}
            label="Delete"
            ariaLabel={`Delete ${item.title}`}
            disabled={busy}
            testId="row-delete"
            onClick={onRequestDelete}
          />
        ) : null}
        <Box sx={{ flex: 1 }} />
        <RunSheetIconButton
          icon={faArrowUp}
          ariaLabel={`Move ${item.title} up`}
          disabled={busy || !canMoveUp}
          testId="row-move-up"
          onClick={onMoveUp}
        />
        <RunSheetIconButton
          icon={faArrowDown}
          ariaLabel={`Move ${item.title} down`}
          disabled={busy || !canMoveDown}
          testId="row-move-down"
          onClick={onMoveDown}
        />
      </Box>

      {/* Inline delete confirm (not a modal) */}
      {confirmingDelete ? (
        <Box
          data-testid="row-delete-confirm"
          role="group"
          aria-label={`Confirm delete ${item.title}`}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
            p: 1,
            border: `1px dashed ${chrome.red}`,
            borderRadius: '6px',
            fontSize: 12,
          }}
        >
          <span>{`Delete "${item.title}"? This can't be undone.`}</span>
          <RunSheetButton
            kind="danger"
            icon={faTrash}
            label="Delete"
            ariaLabel={`Confirm delete ${item.title}`}
            disabled={busy}
            testId="row-delete-confirm-button"
            onClick={onConfirmDelete}
          />
          <RunSheetButton
            label="Cancel"
            ariaLabel={`Cancel delete ${item.title}`}
            icon={faRotateLeft}
            testId="row-delete-cancel"
            onClick={onCancelDelete}
          />
        </Box>
      ) : null}
      {item.status === 'held' && !fireDisabledReason ? (
        <Box component="span" sx={{ fontSize: 11, color: chrome.inkMuted }}>
          {MESSAGES.heldFireHint}
        </Box>
      ) : null}
    </Box>
  )
}
