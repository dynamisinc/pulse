/**
 * features/planner/components/ReadinessPanel.tsx
 * ---------------------------------------------------------------------------
 * The staff-console GO-LIVE READINESS checklist (feature: exercise-build-golive,
 * story 03; COR-042; ADMIN-IDENTITY-MODEL section 5.3). It answers one question
 * for a planner: "can I stage this exercise yet, and if not, what is in the way?"
 *
 * TWO WORLDS - STAFF (D0 section 2). COBRA look via `@/theme/styledComponents`,
 * FontAwesome icons only, MUI system props in `sx` (MUI 9). Self-contained: no
 * props, own query and states, mounted as the FIRST section of
 * `ExerciseSettingsPage`.
 *
 * DRIVEN BY THE PAYLOAD. The server owns which checks exist; this panel renders
 * whatever `blocking` and `warnings` contain, labels included. An item id this
 * file has never heard of still renders. The id is used for exactly one thing:
 * looking up an optional "fix it" link in `FIX_LINKS` below.
 *
 * NEVER COLOR-ONLY (NFR-001, WCAG 2.1 AA). Each row carries a FontAwesome icon
 * (decorative, `aria-hidden`) AND the status in WORDS - "Done", "Needs
 * attention", "Not checked yet" - as real text. Color only decorates, using the
 * COBRA-native text tokens (`notifications.successText` / `warningText` /
 * `errorText`); COBRA defines no `palette.warning`.
 *
 * `notChecked` IS NOT `ok` AND NOT `open`. It is the server saying "I cannot
 * evaluate this yet", so it gets its own icon and words, and it is never counted
 * as blocking (only `open` items are).
 *
 * THE SUMMARY IS THE LIVE REGION. One `role="status"` (polite) block holds the
 * summary line; a refresh that changes the outcome changes its text and is
 * announced once, without re-announcing the unchanged list. A refresh that
 * changes nothing stays silent apart from the button label.
 *
 * FIX LINKS. Only ids with a REAL existing destination are mapped; none are
 * invented. Section links use the page's `?section=` addressing on `/staff/plan`;
 * the roster lives at `/staff/participant-admin`. (The paths are literals here
 * rather than imported from `staffRouteRegistry`, which imports this feature.)
 *
 * SCENARIO TIME (COR-053): not applicable - staff world, no timestamps shown.
 */

import { useNavigate } from 'react-router-dom'
import { Box, CircularProgress, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faArrowRight,
  faCircleCheck,
  faCircleQuestion,
  faClipboardCheck,
  faRotate,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraSecondaryButton } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { useReadiness } from '../hooks/useReadiness'
import type {
  ReadinessError,
  ReadinessItem,
  ReadinessStatus,
} from '../services/readinessService'

// ---------------------------------------------------------------------------
// Fix links (id -> real destination). Omit an id when no destination exists.
// ---------------------------------------------------------------------------

interface FixLink {
  readonly label: string
  readonly to: { readonly pathname: string; readonly search?: string }
}

const PLAN_PATH = '/staff/plan'
const PARTICIPANT_ADMIN_PATH = '/staff/participant-admin'

const FIX_LINKS: Readonly<Record<string, FixLink>> = {
  'schedule-set': {
    label: 'Set the schedule',
    to: { pathname: PLAN_PATH, search: '?section=identity' },
  },
  'chrome-valid': {
    label: 'Fix compliance chrome',
    to: { pathname: PLAN_PATH, search: '?section=chrome' },
  },
  // The roster is where people are added (with their persona handle) and where
  // the view-only/day-word access is managed - the screen that actually fixes both.
  'participant-access': { label: 'Open participants', to: { pathname: PARTICIPANT_ADMIN_PATH } },
  'personas-bound': { label: 'Open participants', to: { pathname: PARTICIPANT_ADMIN_PATH } },
}

// ---------------------------------------------------------------------------
// Status presentation
// ---------------------------------------------------------------------------

interface StatusPresentation {
  readonly icon: IconDefinition
  readonly words: string
  readonly color: string
}

const STATUS_PRESENTATION: Readonly<Record<ReadinessStatus, StatusPresentation>> = {
  ok: { icon: faCircleCheck, words: 'Done', color: 'notifications.successText' },
  open: {
    icon: faTriangleExclamation,
    words: 'Needs attention',
    color: 'notifications.errorText',
  },
  notChecked: {
    icon: faCircleQuestion,
    words: 'Not checked yet',
    color: 'text.secondary',
  },
}

/** Staff-facing copy for a failed load. */
function friendlyErrorMessage(error: ReadinessError): string {
  switch (error.status) {
    case 401:
      return 'Your staff session is not active. Sign in to the console and try again.'
    case 403:
      return 'Your account is not allowed to see this exercise’s readiness.'
    default:
      return error.status === undefined
        ? 'Readiness could not be loaded. Check your connection and try again.'
        : 'Readiness could not be loaded. Try again.'
  }
}

/** The summary sentence. Counts `open` items itself: `notChecked` never blocks. */
function summaryText(ready: boolean, openBlocking: number): string {
  if (openBlocking > 0) {
    return `${openBlocking} blocking ${openBlocking === 1 ? 'item' : 'items'} open`
  }
  return ready ? 'Ready to stage' : 'Not ready to stage'
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function ReadinessRow({ item }: { item: ReadinessItem }) {
  const navigate = useNavigate()
  const presentation = STATUS_PRESENTATION[item.status]
  const fix = item.status === 'ok' ? undefined : FIX_LINKS[item.id]

  return (
    <Box
      component="li"
      data-testid={`readiness-item-${item.id}`}
      data-status={item.status}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.25,
        padding: '8px 0',
        borderBottom: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Box component="span" sx={{ color: presentation.color, mt: '3px', flexShrink: 0 }}>
        <FontAwesomeIcon icon={presentation.icon} aria-hidden fixedWidth />
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Stack direction="row" sx={{ alignItems: 'baseline', flexWrap: 'wrap', gap: 1 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {item.label}
          </Typography>
          <Typography
            variant="body2"
            component="span"
            data-testid={`readiness-status-${item.id}`}
            sx={{ color: presentation.color, fontWeight: 700 }}
          >
            {presentation.words}
          </Typography>
        </Stack>
        {item.detail !== null && item.detail.length > 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {item.detail}
          </Typography>
        ) : null}
      </Box>
      {fix !== undefined ? (
        <CobraLinkButton
          // A real anchor (so it can be opened in a new tab); a plain click is
          // routed in-app instead of reloading the page.
          href={`${fix.to.pathname}${fix.to.search ?? ''}`}
          onClick={event => {
            if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
            event.preventDefault()
            void navigate(fix.to)
          }}
          size="small"
          endIcon={<FontAwesomeIcon icon={faArrowRight} aria-hidden />}
          sx={{ flexShrink: 0 }}
        >
          {fix.label}
          <Box component="span" sx={visuallyHidden}>
            {`: ${item.label}`}
          </Box>
        </CobraLinkButton>
      ) : null}
    </Box>
  )
}

const visuallyHidden = {
  position: 'absolute',
  width: 1,
  height: 1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

interface ReadinessListProps {
  readonly headingId: string
  readonly heading: string
  readonly blurb: string
  readonly items: readonly ReadinessItem[]
  readonly testId: string
}

function ReadinessList({ headingId, heading, blurb, items, testId }: ReadinessListProps) {
  return (
    <Box component="section" aria-labelledby={headingId} data-testid={testId} sx={{ mt: 2.5 }}>
      <Typography id={headingId} variant="subtitle1" component="h3" sx={{ fontWeight: 700 }}>
        {heading}
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {blurb}
      </Typography>
      {items.length === 0 ? (
        <Typography variant="body2" sx={{ mt: 1 }}>
          Nothing to show.
        </Typography>
      ) : (
        <Box component="ul" sx={{ listStyle: 'none', margin: 0, padding: 0, mt: 0.5 }}>
          {items.map(item => (
            <ReadinessRow key={item.id} item={item} />
          ))}
        </Box>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * The readiness panel. Loads the checklist, renders the summary and the two
 * lists, and offers Refresh. Mounted by `ExerciseSettingsPage` with no props.
 */
export function ReadinessPanel() {
  const query = useReadiness()
  // A failed refetch keeps the last data in the cache; never show it beside the
  // error as if it were current.
  const data = query.isError ? undefined : query.data
  const openBlocking = data?.blocking.filter(item => item.status === 'open').length ?? 0

  return (
    <Box
      component="section"
      aria-labelledby="readiness-heading"
      data-testid="readiness-panel"
      sx={{ paddingBottom: CobraStyles.Padding.MainWindow, maxWidth: 860 }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FontAwesomeIcon icon={faClipboardCheck} aria-hidden />
        <Typography id="readiness-heading" variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          Readiness
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
        Your go-live checklist. Blocking items must be done before this exercise can be staged.
        Warnings are worth a look but never stop you. Items marked &ldquo;Not checked
        yet&rdquo; cannot be evaluated until a later release and do not block.
      </Typography>

      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5, mt: 1.5 }}>
        {/* The live region: its text changes only when the outcome does. */}
        <Box role="status" data-testid="readiness-summary" sx={{ minHeight: 24 }}>
          {query.isPending ? (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="body2">Loading readiness&hellip;</Typography>
            </Stack>
          ) : null}
          {data !== undefined ? (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <Box
                component="span"
                sx={{
                  color:
                    openBlocking === 0 && data.ready
                      ? 'notifications.successText'
                      : 'notifications.errorText',
                }}
              >
                <FontAwesomeIcon
                  icon={openBlocking === 0 && data.ready ? faCircleCheck : faTriangleExclamation}
                  aria-hidden
                />
              </Box>
              <Typography variant="body1" sx={{ fontWeight: 700 }}>
                {summaryText(data.ready, openBlocking)}
              </Typography>
            </Stack>
          ) : null}
        </Box>

        <CobraSecondaryButton
          type="button"
          size="small"
          // aria-disabled, not disabled: disabling the focused button would drop keyboard focus.
          aria-disabled={query.isFetching}
          onClick={() => {
            if (!query.isFetching) void query.refetch()
          }}
          startIcon={
            query.isFetching ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <FontAwesomeIcon icon={faRotate} aria-hidden />
            )
          }
        >
          {query.isFetching ? 'Refreshing…' : 'Refresh'}
        </CobraSecondaryButton>
      </Stack>

      {query.isError ? (
        <Stack
          role="alert"
          data-testid="readiness-load-error"
          sx={{ mt: 1.5, gap: 1, alignItems: 'flex-start', color: 'notifications.errorText' }}
        >
          <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
            <Box component="span" sx={{ mt: '2px' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
            </Box>
            <Typography variant="body2">{friendlyErrorMessage(query.error)}</Typography>
          </Stack>
          <CobraSecondaryButton type="button" size="small" onClick={() => void query.refetch()}>
            Try again
          </CobraSecondaryButton>
        </Stack>
      ) : null}

      {data !== undefined ? (
        <>
          <ReadinessList
            headingId="readiness-blocking-heading"
            heading="Blocking"
            blurb="Each of these must be done before this exercise can be staged."
            items={data.blocking}
            testId="readiness-blocking"
          />
          <ReadinessList
            headingId="readiness-warnings-heading"
            heading="Warnings"
            blurb="Shown so nothing surprises you. These do not stop a stage."
            items={data.warnings}
            testId="readiness-warnings"
          />
        </>
      ) : null}
    </Box>
  )
}
