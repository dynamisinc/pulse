/**
 * features/participantAdmin/dayWord/DayWordPanel.tsx
 * ---------------------------------------------------------------------------
 * The staff "Today's word" panel (feature: easy-login, story 11; EL-9; COR-017
 * in part - credential reset). Staff set ONE word per exercise day and read it to
 * the room; participants then sign in with their sign-in name plus that word
 * (story 09). If the word leaks, staff rotate it and the old one stops working on
 * the next sign-in. This panel is the staff side of that.
 *
 * It is a SELF-CONTAINED component with NO required props. The orchestrator
 * mounts `<DayWordPanel />` into the roster page's `dayWordSlot` (story 10), so
 * this folder is disjoint from the roster page and merges without a conflict.
 *
 * WHAT IT DOES (the acceptance criteria)
 *  - Loads `GET /staff/day-word` and shows today's date, the exercise time zone
 *    by name, when today ends, and either "Today's word is set" (who, when, how
 *    many times it was replaced) or a prominent "No word is set for today".
 *    It never shows or fetches a word - the server keeps only a hash.
 *  - Generate a word / Set my own word -> `PUT /staff/day-word` (omit `word` to
 *    generate) and show the returned word ONCE, in `OneTimeWordResult`. A typed
 *    word is checked live against the server's rule (letters and digits only
 *    once normalised, 6 to 64); a `400` shows the server's reason.
 *  - When a word is already set the action reads "Rotate word" and asks first.
 *  - A date control (today up to 14 days ahead, in the exercise zone) pre-sets a
 *    later day's word; "Upcoming" lists the dates that have one (never the
 *    words) and lets staff clear one.
 *  - "Turn off word sign-in for today" (behind a confirm) -> `DELETE`.
 *
 * THE SECRET. The plaintext word lives ONLY in this component's state, for the
 * one result view. It is never put in the React Query cache (`useSetDayWord`
 * consumes and resets the mutation), `localStorage`, `sessionStorage`, a toast, a
 * log, the document title or a URL, and it is cleared when the result view
 * closes, when the panel unmounts, or when the active exercise changes (the body
 * is re-keyed on the exercise id, so a switch remounts it and drops all state).
 * The status query never contains a word.
 *
 * ISOLATION (XC-001 / COR-001). The panel sends no exercise id. The query key
 * includes the active exercise id from `useExerciseContext()` (see
 * `useDayWord.ts`) so a switch can never paint another exercise's status.
 *
 * TIME. Staff world: real wall-clock dates and instants, in the EXERCISE time
 * zone with the zone named. Scenario time is never used for "today".
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA)
 *  - Labelled controls; the two confirm dialogs are `role="alertdialog"` with
 *    focus on Cancel and focus returned deliberately afterwards.
 *  - One persistent polite live region announces results ("Word set for ...",
 *    "Word copied", "Word sign-in is off") WITHOUT the word; failures are
 *    `role="alert"`.
 *  - "Set" vs "not set" is an icon AND text, never colour alone.
 *
 * TWO WORLDS. STAFF (COBRA): `@/theme/styledComponents` buttons and text field,
 * FontAwesome icons, MUI 9 `sx`-only. The Show large view is still the staff look.
 *
 * Mock-first: reads/writes go through `./dayWordService`, which attaches the
 * in-memory mock adapter behind `USE_MOCK_DATA`.
 */

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Box, CircularProgress, Divider, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faKey,
  faPowerOff,
  faRotate,
  faTriangleExclamation,
  faWandMagicSparkles,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  CobraDeleteButton,
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
  CobraTextField,
} from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { DayWordConfirmDialog } from './DayWordConfirmDialog'
import { OneTimeWordResult } from './OneTimeWordResult'
import { DayWordError } from './dayWordService'
import { formatDateLabel, formatInstant, isPresetDateInRange, presetDateRange } from './dayWordDates'
import { checkDayWord, describeDayWordCheck } from './dayWordNormalize'
import { useClearDayWord, useDayWordStatus, useSetDayWord } from './useDayWord'
import {
  DAY_WORD_MAX_DAYS_AHEAD,
  type DayWordPutBody,
  type DayWordSetResultDto,
  type DayWordStatusDto,
} from './types'

/** The "nothing is set" copy, verbatim from the story's acceptance criteria. */
export const NO_WORD_MESSAGE =
  'No word is set for today. People can only sign in with their personal link.'

/** The rotate confirmation copy, verbatim from the story's acceptance criteria. */
export const ROTATE_CONFIRM_MESSAGE =
  'New sign-ins need the new word at once. People already signed in stay signed in.'

/** Visually hidden but announced: the persistent polite live region. */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

/**
 * COBRA's `text.secondary` (#848482) is 3.75:1 on white, under the 4.5:1 AA floor
 * for small text, and it is what MUI paints a text field's label and helper text
 * with. The live word-rule hint and the date hint are real instructions, not
 * decoration, so on THIS panel's fields they use the primary text colour. (An
 * error keeps its own, already-AA, error colour.)
 */
const READABLE_FIELD_SX = {
  '& .MuiInputLabel-root:not(.Mui-focused):not(.Mui-error)': { color: 'text.primary' },
  '& .MuiFormHelperText-root:not(.Mui-error)': { color: 'text.primary' },
} as const

type WordSource = 'generate' | 'typed'

type ConfirmState =
  | { readonly kind: 'rotate'; readonly source: WordSource; readonly date: string }
  | { readonly kind: 'turnOff' }
  | { readonly kind: 'clearUpcoming'; readonly date: string }

type FocusTarget = 'status' | 'upcoming' | 'trigger'

/** The dialog text for a confirm state. */
interface ConfirmCopy {
  title: string
  body: ReactNode
  label: string
  destructive: boolean
}

/** Maps a thrown failure to plain, status-aware staff copy. */
function describeError(error: unknown): string {
  if (error instanceof DayWordError) {
    switch (error.status) {
      case 400:
        return error.serverMessage
          ? `Not saved: ${error.serverMessage}`
          : 'Not saved: Pulse did not accept that word or date. Check it and try again.'
      case 401:
        return 'Your staff session is not active. Sign in to the console and try again.'
      case 403:
        return 'You do not have permission to manage the day word. ' +
          'Only a controller or planner assigned to this exercise can.'
      case undefined:
        return 'Could not reach the server. Check your connection and try again.'
      default:
        return error.serverMessage ?? 'The request could not be completed. Please try again.'
    }
  }
  return 'The request could not be completed. Please try again.'
}

/** An icon-plus-text error block (never colour alone). */
function ErrorNotice({ message, testId }: { message: string; testId: string }) {
  return (
    <Box
      role="alert"
      data-testid={testId}
      sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, color: 'error.main' }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{message}</Typography>
    </Box>
  )
}

interface StatusBannerProps {
  status: DayWordStatusDto
}

/** "Today's word is set" or the prominent "No word is set" - icon plus text. */
function StatusBanner({ status }: StatusBannerProps) {
  const { timeZone } = status
  if (status.todaySet) {
    const times = status.replacedCount === 1 ? 'time' : 'times'
    return (
      <Box
        data-testid="day-word-status-set"
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: 1.5,
          bgcolor: 'notifications.success',
          color: 'text.primary',
          borderRadius: 1,
          padding: '10px 14px',
        }}
      >
        <Box component="span" sx={{ mt: '3px', color: 'success.main' }}>
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden size="lg" />
        </Box>
        <Box>
          <Typography component="p" sx={{ fontWeight: 700, m: 0 }}>
            Today's word is set
          </Typography>
          <Typography variant="body2" component="p" sx={{ m: 0 }}>
            {status.setByName ? `Set by ${status.setByName}` : 'Set'}
            {status.setAt ? ` on ${formatInstant(status.setAt, timeZone)}` : ''}.
            {' '}Replaced {status.replacedCount} {times}.
          </Typography>
        </Box>
      </Box>
    )
  }
  return (
    <Box
      data-testid="day-word-status-unset"
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        bgcolor: 'notifications.warning',
        color: 'text.primary',
        borderLeft: '6px solid #6F4E37',
        borderRadius: 1,
        padding: '12px 14px',
      }}
    >
      <Box component="span" sx={{ mt: '3px', color: 'notifications.warningText' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden size="lg" />
      </Box>
      <Typography component="p" sx={{ fontWeight: 700, m: 0 }}>
        {NO_WORD_MESSAGE}
      </Typography>
    </Box>
  )
}

/** The whole panel, re-keyed on the active exercise so a switch remounts it clean. */
export function DayWordPanel() {
  const { exerciseId } = useExerciseContext()
  return <DayWordPanelBody key={exerciseId} />
}

function DayWordPanelBody() {
  const headingId = useId()
  const dateFieldId = useId()
  const wordFieldId = useId()

  const statusQuery = useDayWordStatus()
  const { setWord, isPending: isSetting } = useSetDayWord()
  const clearMutation = useClearDayWord()

  const [pickedDate, setPickedDate] = useState('')
  const [typedWord, setTypedWord] = useState('')
  const [result, setResult] = useState<DayWordSetResultDto | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  // `confirm` keeps its last value while the dialog fades out, so its title and
  // text do not blank mid-animation; `confirmOpen` is the real open flag.
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 })
  const [focusRequest, setFocusRequest] = useState<{ target: FocusTarget; id: number } | null>(null)

  const statusHeadingRef = useRef<HTMLHeadingElement>(null)
  const upcomingHeadingRef = useRef<HTMLHeadingElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const status = statusQuery.data
  const busy = isSetting || clearMutation.isPending

  const announce = (text: string) => {
    // Alternate a trailing no-break space so an identical message twice in a row
    // still changes the live region's content and is announced again.
    setAnnouncement(previous => ({ text, count: previous.count + 1 }))
  }

  const requestFocus = (target: FocusTarget) => {
    setFocusRequest(previous => ({ target, id: (previous?.id ?? 0) + 1 }))
  }

  // Focus moves AFTER the commit that closes a dialog or removes a control, so
  // the dialog's focus trap cannot pull it back and the target exists.
  useEffect(() => {
    if (focusRequest === null) return
    if (focusRequest.target === 'status') {
      statusHeadingRef.current?.focus()
    } else if (focusRequest.target === 'upcoming') {
      upcomingHeadingRef.current?.focus()
    } else if (returnFocusRef.current?.isConnected) {
      returnFocusRef.current.focus()
    } else {
      statusHeadingRef.current?.focus()
    }
  }, [focusRequest])

  // ---------------------------------------------------------------- loading / error

  const heading = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
      <FontAwesomeIcon icon={faKey} aria-hidden />
      <Typography
        id={headingId}
        ref={statusHeadingRef}
        tabIndex={-1}
        variant="h6"
        component="h2"
        sx={{ fontWeight: 700, outline: 'none' }}
      >
        Today's word
      </Typography>
    </Box>
  )

  const liveRegion = (
    <Box
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="day-word-live-region"
      sx={VISUALLY_HIDDEN}
    >
      {announcement.text}
      {announcement.count % 2 === 0 ? '' : ' '}
    </Box>
  )

  const shell = (children: ReactNode) => (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="day-word-panel"
      sx={{
        position: 'relative',
        border: 1,
        borderColor: 'border.main',
        borderRadius: 1,
        bgcolor: 'background.paper',
        padding: CobraStyles.Padding.MainWindow,
        maxWidth: 760,
      }}
    >
      {heading}
      {liveRegion}
      {children}
    </Box>
  )

  if (statusQuery.isPending) {
    return shell(
      <Box
        role="status"
        data-testid="day-word-loading"
        sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <CircularProgress size={16} aria-hidden />
        <Typography variant="body2">Loading today's word…</Typography>
      </Box>,
    )
  }

  if (statusQuery.isError || status === undefined) {
    const forbidden = statusQuery.error?.status === 403
    return shell(
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'flex-start' }}>
        <ErrorNotice
          message={describeError(statusQuery.error)}
          testId="day-word-status-error"
        />
        {forbidden ? null : (
          <CobraSecondaryButton onClick={() => void statusQuery.refetch()}>
            Try again
          </CobraSecondaryButton>
        )}
      </Box>,
    )
  }

  // ---------------------------------------------------------------- derived state

  const { timeZone, today } = status
  const dates = presetDateRange(today)
  const effectiveDate = isPresetDateInRange(pickedDate, today) ? pickedDate : today
  const hasWord = (date: string): boolean =>
    date === today ? status.todaySet : status.upcoming.some(item => item.date === date)
  const selectedHasWord = hasWord(effectiveDate)
  const typedCheck = checkDayWord(typedWord)
  const typedInvalid = typedCheck.kind === 'tooShort' || typedCheck.kind === 'tooLong'
  const canSetTyped = typedCheck.kind === 'ok' && !busy

  // ---------------------------------------------------------------- actions

  /** Calls the PUT. Resolves true on success; the error is shown in the panel. */
  const runSet = async (source: WordSource, date: string): Promise<boolean> => {
    setActionError(null)
    setResult(null)
    const body: DayWordPutBody = {
      ...(source === 'typed' ? { word: typedWord.trim() } : {}),
      // Omit the date for today: the server's default is authoritative.
      ...(date !== today ? { date } : {}),
    }
    try {
      const saved = await setWord(body)
      setTypedWord('')
      setResult(saved)
      announce(
        `Word set for ${formatDateLabel(saved.date)}` +
        `${saved.replaced ? ', replacing the previous word' : ''}. ` +
        'It is shown on screen once.',
      )
      return true
    } catch (error) {
      setActionError(describeError(error))
      return false
    }
  }

  /** Calls the DELETE for `date` (omit for today). Resolves true on success. */
  const runClear = async (date: string | undefined): Promise<boolean> => {
    setActionError(null)
    try {
      await clearMutation.mutateAsync(date)
      // A result view for the day that was just turned off is now a dead word.
      if (result !== null && result.date === (date ?? today)) setResult(null)
      announce(
        date === undefined
          ? 'Word sign-in is off for today.'
          : `Word cleared for ${formatDateLabel(date)}.`,
      )
      return true
    } catch (error) {
      setActionError(describeError(error))
      return false
    }
  }

  const openConfirm = (next: ConfirmState) => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setConfirm(next)
    setConfirmOpen(true)
  }

  const requestSet = (source: WordSource) => {
    if (selectedHasWord) {
      openConfirm({ kind: 'rotate', source, date: effectiveDate })
    } else {
      void runSet(source, effectiveDate)
    }
  }

  const cancelConfirm = () => {
    setConfirmOpen(false)
    requestFocus('trigger')
  }

  const submitConfirm = async () => {
    if (confirm === null || !confirmOpen) return
    if (confirm.kind === 'rotate') {
      const ok = await runSet(confirm.source, confirm.date)
      setConfirmOpen(false)
      // On success the result view takes focus itself; on failure go back.
      if (!ok) requestFocus('trigger')
    } else if (confirm.kind === 'turnOff') {
      const ok = await runClear(undefined)
      setConfirmOpen(false)
      requestFocus(ok ? 'status' : 'trigger')
    } else {
      const ok = await runClear(confirm.date)
      setConfirmOpen(false)
      requestFocus(ok ? 'upcoming' : 'trigger')
    }
  }

  // ---------------------------------------------------------------- confirm copy

  const confirmCopy = ((): ConfirmCopy => {
    if (confirm === null) {
      return { title: '', body: null, label: '', destructive: false }
    }
    if (confirm.kind === 'rotate') {
      return {
        title: `Rotate the word for ${formatDateLabel(confirm.date)}?`,
        body: ROTATE_CONFIRM_MESSAGE,
        label: 'Rotate word',
        destructive: false,
      }
    }
    if (confirm.kind === 'turnOff') {
      return {
        title: 'Turn off word sign-in for today?',
        body: 'Today\'s word stops working on the next sign-in. ' +
          'People already signed in stay signed in, and personal links still work.',
        label: 'Turn off word sign-in',
        destructive: true,
      }
    }
    return {
      title: `Clear the word for ${formatDateLabel(confirm.date)}?`,
      body: `Nothing is set for ${formatDateLabel(confirm.date)} afterwards. ` +
        'You can set a new word for that day at any time.',
      label: 'Clear word',
      destructive: true,
    }
  })()

  // ---------------------------------------------------------------- render

  return shell(
    <>
      <Typography variant="body2" component="p" data-testid="day-word-date-line" sx={{ mb: 1.5 }}>
        <strong>{formatDateLabel(today)}</strong> in <strong>{timeZone}</strong>. Today ends{' '}
        {formatInstant(status.todayEndsAt, timeZone)}.
      </Typography>

      <StatusBanner status={status} />

      {result !== null ? (
        <Box sx={{ mt: 2 }}>
          <OneTimeWordResult
            result={result}
            timeZone={timeZone}
            onDone={() => {
              setResult(null)
              requestFocus('status')
            }}
            onAnnounce={announce}
          />
        </Box>
      ) : null}

      <Divider sx={{ my: 2 }} />

      <Box
        component="div"
        role="group"
        aria-labelledby={`${headingId}-set`}
        sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <Typography
          id={`${headingId}-set`}
          variant="subtitle2"
          component="h3"
          sx={{ fontWeight: 700 }}
        >
          {selectedHasWord ? 'Rotate the word' : 'Set the word'}
        </Typography>

        <CobraTextField
          select
          id={dateFieldId}
          label="Word for"
          value={effectiveDate}
          disabled={busy}
          onChange={event => {
            setPickedDate(event.target.value)
            setActionError(null)
          }}
          helperText={
            `Today or up to ${DAY_WORD_MAX_DAYS_AHEAD} days ahead, in ${timeZone}.`
          }
          slotProps={{
            select: { native: true },
            inputLabel: { shrink: true },
          }}
          sx={{ maxWidth: 320, ...READABLE_FIELD_SX }}
        >
          {dates.map(date => (
            <option key={date} value={date}>
              {date === today ? 'Today, ' : ''}
              {formatDateLabel(date, 'short')}
              {hasWord(date) ? ' (word set)' : ''}
            </option>
          ))}
        </CobraTextField>

        <Box>
          <CobraPrimaryButton
            disabled={busy}
            onClick={() => requestSet('generate')}
            startIcon={<FontAwesomeIcon icon={selectedHasWord ? faRotate : faWandMagicSparkles} />}
          >
            {selectedHasWord ? 'Rotate word' : 'Generate a word'}
          </CobraPrimaryButton>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'flex-start', flexWrap: 'wrap', gap: 1.5 }}>
          <CobraTextField
            id={wordFieldId}
            label="Or type your own word"
            value={typedWord}
            disabled={busy}
            error={typedInvalid}
            onChange={event => {
              setTypedWord(event.target.value)
              setActionError(null)
            }}
            helperText={describeDayWordCheck(typedCheck)}
            slotProps={{
              htmlInput: {
                autoComplete: 'off',
                autoCapitalize: 'none',
                spellCheck: false,
                maxLength: 128,
              },
            }}
            sx={{ flex: '1 1 260px', maxWidth: 420, ...READABLE_FIELD_SX }}
          />
          <CobraSecondaryButton
            disabled={!canSetTyped}
            onClick={() => requestSet('typed')}
            sx={{ mt: '2px' }}
          >
            {selectedHasWord ? 'Rotate to my own word' : 'Set my own word'}
          </CobraSecondaryButton>
        </Box>

        {actionError !== null && !confirmOpen ? (
          <ErrorNotice message={actionError} testId="day-word-action-error" />
        ) : null}
      </Box>

      <Divider sx={{ my: 2 }} />

      <Box component="div" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography
          ref={upcomingHeadingRef}
          tabIndex={-1}
          variant="subtitle2"
          component="h3"
          sx={{ fontWeight: 700, outline: 'none' }}
        >
          Upcoming
        </Typography>
        {status.upcoming.length === 0 ? (
          <Typography variant="body2" data-testid="day-word-upcoming-empty">
            No words are pre-set for later dates.
          </Typography>
        ) : (
          <Box
            component="ul"
            data-testid="day-word-upcoming"
            sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}
          >
            {status.upcoming.map(item => (
              <Box
                key={item.date}
                component="li"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1,
                  border: 1,
                  borderColor: 'border.main',
                  borderRadius: 1,
                  padding: '4px 10px',
                }}
              >
                <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatDateLabel(item.date)}
                </Typography>
                <Typography variant="body2" sx={{ flexGrow: 1 }}>
                  Word set {formatInstant(item.setAt, timeZone)}
                </Typography>
                <CobraLinkButton
                  disabled={busy}
                  aria-label={`Clear the word for ${formatDateLabel(item.date)}`}
                  onClick={() => openConfirm({ kind: 'clearUpcoming', date: item.date })}
                >
                  Clear
                </CobraLinkButton>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {status.todaySet ? (
        <>
          <Divider sx={{ my: 2 }} />
          <Box>
            <CobraDeleteButton
              disabled={busy}
              onClick={() => openConfirm({ kind: 'turnOff' })}
              startIcon={<FontAwesomeIcon icon={faPowerOff} />}
            >
              Turn off word sign-in for today
            </CobraDeleteButton>
          </Box>
        </>
      ) : null}

      <DayWordConfirmDialog
        open={confirmOpen}
        title={confirmCopy.title}
        confirmLabel={confirmCopy.label}
        destructive={confirmCopy.destructive}
        pending={busy}
        onConfirm={() => void submitConfirm()}
        onCancel={cancelConfirm}
      >
        {confirmCopy.body}
      </DayWordConfirmDialog>
    </>,
  )
}
