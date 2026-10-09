/**
 * features/controller/runSheet/RunSheetBeatRow.tsx
 * ---------------------------------------------------------------------------
 * One beat in the run-sheet list (demo-polish C3, story 19). STAFF world - COBRA
 * buttons, MUI 9 `sx`-only, FontAwesome icons only. A purely presentational row: it
 * renders a beat and its status and calls back; every rule (can it fire? what does
 * Skip do?) lives in the model / hook.
 *
 * STATUS IS TEXT + ICON, NEVER COLOUR ALONE (NFR-001): the chip always reads
 * "Pending", "Fired", "Skipped", "Failed", "Unconfirmed" (a failure whose outcome is
 * unknown - the post may be live) or "Firing", beside an icon. Colour only reinforces.
 *
 * ROVING FOCUS. The row is a focusable `role="group"` named "Beat N: title, status";
 * the panel keeps `tabIndex=0` on the selected row only and moves focus with the arrow
 * keys. Only the SELECTED row renders its action buttons (Fire / Retry, Skip, Edit,
 * Duplicate, Move, Delete), so a dense list stays scannable and Tab reaches exactly the
 * actions of the row you are on. The selected row also shows the beat's full text and
 * notes, so the presenter reads what is about to go out.
 *
 * TIME. The intended minute is shown as "T+14m" (informational, a sort hint only) and a
 * fired stamp as scenario time in the exercise's zone (COR-053) - never wall-clock.
 *
 * Beat text, titles and notes are rendered as plain text (React escapes; no HTML).
 */

import { useEffect, useState, type Ref } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowDown,
  faArrowUp,
  faCircleQuestion,
  faClone,
  faForwardStep,
  faPaperPlane,
  faPen,
  faRotateLeft,
  faRotateRight,
  faTrash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import { formatScenarioTime } from '@/core/clock'
import type { BeatRuntime } from './runSheetModel'
import { formatScenarioMinute, type RunSheetBeat } from './runSheetSchema'
import { SLOW_FIRE_NOTICE, SLOW_FIRE_NOTICE_MS, statusChipFor } from './runSheetStatus'
import { BUTTON_KBD_SX, runSheetTokens } from './runSheetTokens'

/** True once a fire has been in flight for {@link SLOW_FIRE_NOTICE_MS} (resets when it ends). */
function useSlowFire(inFlight: boolean): boolean {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!inFlight) return undefined
    const timer = window.setTimeout(() => setSlow(true), SLOW_FIRE_NOTICE_MS)
    return () => {
      window.clearTimeout(timer)
      setSlow(false)
    }
  }, [inFlight])
  return inFlight && slow
}

const SMALL_BUTTON_SX = { py: '2px', px: 1.25, fontSize: 12, minWidth: 0 } as const

export interface RunSheetBeatRowProps {
  readonly beat: RunSheetBeat
  readonly record: BeatRuntime
  /** Title of the beat this replies to, when `replyTo` is a beat. */
  readonly parentTitle?: string
  readonly parentOrder?: number
  readonly position: number
  readonly total: number
  readonly selected: boolean
  readonly timeZone: string
  /** Why Fire is unavailable (persona unknown, parent not fired, ...). */
  readonly blockedReason?: string
  /** "2 images" / "1 video" / "3 media" - empty when the beat has none. */
  readonly mediaSummary: string
  /** How many of the beat's media ids are not in the loaded library (non-blocking). */
  readonly mediaMissing: number
  /** Another beat of this sheet is mid-fire (only one fire at a time). */
  readonly sheetFiring: boolean
  readonly rowRef: Ref<HTMLDivElement>
  readonly onSelect: () => void
  readonly onFire: () => void
  readonly onSkip: () => void
  readonly onEdit: () => void
  readonly onDuplicate: () => void
  readonly onMove: (direction: -1 | 1) => void
  readonly onDelete: () => void
}

function baselineSummary(beat: RunSheetBeat): string | undefined {
  const baseline = beat.engagementBaseline
  if (baseline === undefined) return undefined
  const parts = [
    baseline.like !== undefined ? `${baseline.like.toLocaleString('en-US')} likes` : undefined,
    baseline.repost !== undefined ? `${baseline.repost.toLocaleString('en-US')} reposts` : undefined,
    baseline.reply !== undefined ? `${baseline.reply.toLocaleString('en-US')} replies` : undefined,
  ].filter((part): part is string => part !== undefined)
  return parts.length === 0 ? undefined : parts.join(', ')
}

export function RunSheetBeatRow({
  beat,
  record,
  parentTitle,
  parentOrder,
  position,
  total,
  selected,
  timeZone,
  blockedReason,
  mediaSummary,
  mediaMissing,
  sheetFiring,
  rowRef,
  onSelect,
  onFire,
  onSkip,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
}: RunSheetBeatRowProps) {
  const chip = statusChipFor(record)
  const inFlight = record.inFlight === true
  const slowFire = useSlowFire(inFlight)
  const unconfirmed = record.status === 'failed' && record.failure?.kind === 'unconfirmed'
  const canFire = (record.status === 'pending' || record.status === 'failed') && !inFlight
  const fireLabel = unconfirmed ? 'Fire again...' : record.status === 'failed' ? 'Retry' : 'Fire'
  const baseline = baselineSummary(beat)
  const replyTo = beat.replyTo
  const showBlocked = blockedReason !== undefined && canFire

  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <Box
        ref={rowRef}
        role="group"
        tabIndex={selected ? 0 : -1}
        aria-label={`Beat ${beat.order}: ${beat.title}, ${chip.label}`}
        aria-current={selected ? 'true' : undefined}
        data-testid={`beat-row-${beat.id}`}
        data-selected={selected ? 'true' : 'false'}
        data-status={inFlight ? 'firing' : unconfirmed ? 'unconfirmed' : record.status}
        onClick={onSelect}
        sx={{
          px: 1.25,
          py: 0.875,
          borderLeft: `${selected ? 4 : 1}px solid ${
            selected ? runSheetTokens.navy : runSheetTokens.hairline
          }`,
          borderBottom: `1px solid ${runSheetTokens.hairline}`,
          bgcolor: selected ? runSheetTokens.selectedRow : 'transparent',
          cursor: 'pointer',
          outlineOffset: -2,
          '&:focus-visible': { outline: `2px solid ${runSheetTokens.navy}` },
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography
            component="span"
            sx={{ fontSize: 11, fontWeight: 800, color: runSheetTokens.mutedText }}
          >
            #{beat.order}
          </Typography>
          <Typography
            component="span"
            data-testid="beat-minute"
            sx={{
              fontFamily: runSheetTokens.mono,
              fontSize: 11,
              fontWeight: 700,
              color: runSheetTokens.navy,
            }}
          >
            {formatScenarioMinute(beat.scenarioMinute)}
          </Typography>
          <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, flex: 1, minWidth: 0 }}>
            {beat.title}
          </Typography>
          <Box
            component="span"
            data-testid="beat-status"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: chip.color,
              border: '1px solid currentColor',
              borderRadius: '10px',
              px: 0.875,
              py: '1px',
              whiteSpace: 'nowrap',
            }}
          >
            <FontAwesomeIcon icon={chip.icon} spin={chip.spin === true} aria-hidden="true" />
            {chip.label}
          </Box>
        </Stack>

        <Stack
          direction="row"
          sx={{
            gap: 1.25,
            flexWrap: 'wrap',
            mt: 0.25,
            fontSize: 12,
            color: runSheetTokens.mutedText,
          }}
        >
          <span>@{beat.persona.handle}</span>
          {mediaSummary !== '' && <span>{mediaSummary}</span>}
          {replyTo !== undefined && 'beatId' in replyTo && (
            <span>
              Replies to {parentOrder === undefined ? '' : `#${parentOrder} `}
              {parentTitle === undefined ? 'a missing beat' : `"${parentTitle}"`}
            </span>
          )}
          {replyTo !== undefined && 'postId' in replyTo && (
            <span>Replies to post {replyTo.postId}</span>
          )}
          {baseline !== undefined && <span>Starting engagement: {baseline}</span>}
        </Stack>

        {beat.text !== '' && (
          <Typography
            data-testid="beat-text"
            sx={{
              mt: 0.5,
              fontSize: 12.5,
              lineHeight: 1.4,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              ...(selected
                ? {}
                : {
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }),
            }}
          >
            {beat.text}
          </Typography>
        )}

        {selected && beat.notes !== undefined && (
          <Typography sx={{ mt: 0.5, fontSize: 12, fontStyle: 'italic' }}>
            Notes: {beat.notes}
          </Typography>
        )}

        {record.status === 'fired' && record.firedAtScenario !== undefined && (
          <Typography
            data-testid="beat-fired-at"
            sx={{ mt: 0.5, fontSize: 12, color: runSheetTokens.firedText, fontWeight: 700 }}
          >
            Fired {formatScenarioTime(record.firedAtScenario, timeZone)}
            {record.firedPostId !== undefined && (
              <Box component="span" sx={{ fontWeight: 400, color: runSheetTokens.mutedText }}>
                {' '}
                - post {record.firedPostId}
              </Box>
            )}
          </Typography>
        )}

        {inFlight && (
          <Typography sx={{ mt: 0.5, fontSize: 12, fontWeight: 700 }}>
            Firing... waiting for the server to confirm.
          </Typography>
        )}

        {slowFire && (
          <Box
            role="status"
            data-testid="beat-slow-notice"
            sx={{ mt: 0.5, display: 'flex', gap: 0.75, alignItems: 'flex-start', fontSize: 12, fontWeight: 600 }}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 2 }} />
            <span>{SLOW_FIRE_NOTICE}</span>
          </Box>
        )}

        {!inFlight && record.failure !== undefined && record.status !== 'fired' && (
          <Box
            data-testid="beat-failure"
            sx={{
              mt: 0.5,
              display: 'flex',
              gap: 0.75,
              alignItems: 'flex-start',
              fontSize: 12,
              fontWeight: 600,
              color: unconfirmed ? runSheetTokens.unconfirmedText : runSheetTokens.failedText,
            }}
          >
            <FontAwesomeIcon
              icon={unconfirmed ? faCircleQuestion : faTriangleExclamation}
              aria-hidden="true"
              style={{ marginTop: 2 }}
            />
            <span>
              {unconfirmed ? 'Unconfirmed - ' : 'Failed - '}
              {record.failure.message}
            </span>
          </Box>
        )}

        {showBlocked && (
          <Box
            data-testid="beat-blocked"
            sx={{ mt: 0.5, display: 'flex', gap: 0.75, alignItems: 'flex-start', fontSize: 12, fontWeight: 600 }}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 2 }} />
            <span>{blockedReason}</span>
          </Box>
        )}

        {mediaMissing > 0 && (
          <Box
            data-testid="beat-media-warning"
            sx={{ mt: 0.5, display: 'flex', gap: 0.75, alignItems: 'flex-start', fontSize: 12 }}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 2 }} />
            <span>
              Warning: {mediaMissing} of this beat's media {mediaMissing === 1 ? 'item is' : 'items are'}{' '}
              not in this exercise's media library, so firing it may be refused.
            </span>
          </Box>
        )}

        {selected && (
          <Stack
            role="group"
            aria-label={`Actions for ${beat.title}`}
            direction="row"
            sx={{ gap: 0.75, flexWrap: 'wrap', mt: 1, alignItems: 'center' }}
          >
            {canFire && (
              <CobraPrimaryButton
                size="small"
                aria-keyshortcuts="F"
                disabled={blockedReason !== undefined || sheetFiring}
                onClick={onFire}
                startIcon={<FontAwesomeIcon icon={unconfirmed || record.status === 'failed' ? faRotateRight : faPaperPlane} />}
                sx={SMALL_BUTTON_SX}
              >
                {fireLabel}
                <Box component="kbd" aria-hidden="true" sx={BUTTON_KBD_SX}>F</Box>
              </CobraPrimaryButton>
            )}
            {inFlight && (
              <CobraPrimaryButton size="small" disabled sx={SMALL_BUTTON_SX}>
                Firing...
              </CobraPrimaryButton>
            )}
            {(record.status === 'pending' || record.status === 'failed') && !inFlight && (
              <CobraSecondaryButton
                size="small"
                aria-keyshortcuts="S"
                onClick={onSkip}
                startIcon={<FontAwesomeIcon icon={faForwardStep} />}
                sx={SMALL_BUTTON_SX}
              >
                Skip
                <Box component="kbd" aria-hidden="true" sx={BUTTON_KBD_SX}>S</Box>
              </CobraSecondaryButton>
            )}
            {record.status === 'skipped' && (
              <CobraSecondaryButton
                size="small"
                aria-keyshortcuts="S"
                onClick={onSkip}
                startIcon={<FontAwesomeIcon icon={faRotateLeft} />}
                sx={SMALL_BUTTON_SX}
              >
                Undo skip
                <Box component="kbd" aria-hidden="true" sx={BUTTON_KBD_SX}>S</Box>
              </CobraSecondaryButton>
            )}
            <CobraSecondaryButton
              size="small"
              aria-keyshortcuts="E"
              disabled={record.status === 'fired' || inFlight}
              onClick={onEdit}
              startIcon={<FontAwesomeIcon icon={faPen} />}
              sx={SMALL_BUTTON_SX}
            >
              Edit
              <Box component="kbd" aria-hidden="true" sx={BUTTON_KBD_SX}>E</Box>
            </CobraSecondaryButton>
            <CobraLinkButton
              size="small"
              onClick={onDuplicate}
              startIcon={<FontAwesomeIcon icon={faClone} />}
              sx={SMALL_BUTTON_SX}
            >
              Duplicate
            </CobraLinkButton>
            <CobraLinkButton
              size="small"
              disabled={position === 0}
              onClick={() => onMove(-1)}
              startIcon={<FontAwesomeIcon icon={faArrowUp} />}
              sx={SMALL_BUTTON_SX}
            >
              Move up
            </CobraLinkButton>
            <CobraLinkButton
              size="small"
              disabled={position >= total - 1}
              onClick={() => onMove(1)}
              startIcon={<FontAwesomeIcon icon={faArrowDown} />}
              sx={SMALL_BUTTON_SX}
            >
              Move down
            </CobraLinkButton>
            <CobraLinkButton
              size="small"
              disabled={inFlight}
              onClick={onDelete}
              startIcon={<FontAwesomeIcon icon={faTrash} />}
              sx={SMALL_BUTTON_SX}
            >
              Delete
            </CobraLinkButton>
          </Stack>
        )}
      </Box>
    </Box>
  )
}
