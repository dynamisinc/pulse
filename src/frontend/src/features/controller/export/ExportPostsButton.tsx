/**
 * features/controller/export/ExportPostsButton.tsx
 * ---------------------------------------------------------------------------
 * The console's **Export posts** button (demo-feedback story 09 AC3; backend story 02, DF-8). STAFF
 * world: a COBRA button in the console title row, beside the StartEx / EndEx control. FontAwesome
 * icons, MUI 9 `sx`-only.
 *
 * Pressing it downloads `GET /api/staff/exports/posts.xlsx` with the session's bearer token and
 * saves it under the server's file name (`exportService.downloadPostsExport`, which also retries a
 * 429 once). While it runs the button shows a spinner and "Exporting…" and ignores further presses
 * (`aria-disabled`, so it stays focusable and announced); a failure shows the reason as text in an
 * alert region beside the button until the next attempt; a success is announced politely with the
 * saved file name (screen-reader only, so the title row stays quiet).
 *
 * Any staff role may export, evaluators included (DF-8), so there is no role gate here or in 11.
 */

import { useCallback, useRef, useState } from 'react'
import { Box, CircularProgress, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleExclamation, faFileExport } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton } from '@/theme/styledComponents'
import { downloadPostsExport, type ExportDependencies } from './exportService'

/** Visually hidden but read by screen readers. */
const SR_ONLY_SX = {
  position: 'absolute',
  width: 1,
  height: 1,
  p: 0,
  m: '-1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

export interface ExportPostsButtonProps {
  /** Test seam: replaces the wait and the browser save. */
  readonly dependencies?: ExportDependencies
}

export function ExportPostsButton({ dependencies }: ExportPostsButtonProps = {}) {
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedFileName, setSavedFileName] = useState<string | null>(null)
  // A ref guard as well as state: two presses in one tick both see `running === false`.
  const inFlight = useRef(false)

  const run = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    setError(null)
    setSavedFileName(null)
    try {
      setSavedFileName(await downloadPostsExport(dependencies))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The export failed. Try again.')
    } finally {
      inFlight.current = false
      setRunning(false)
    }
  }, [dependencies])

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, position: 'relative' }}>
      <CobraSecondaryButton
        size="small"
        data-testid="export-posts"
        startIcon={
          running ? (
            <CircularProgress size={12} color="inherit" aria-hidden="true" data-testid="export-posts-spinner" />
          ) : (
            <FontAwesomeIcon icon={faFileExport} aria-hidden="true" />
          )
        }
        onClick={() => void run()}
        aria-disabled={running}
        aria-busy={running}
      >
        {running ? 'Exporting…' : 'Export posts'}
      </CobraSecondaryButton>

      {error !== null && (
        <Typography
          role="alert"
          component="span"
          data-testid="export-posts-error"
          sx={{ fontSize: 12, display: 'inline-flex', gap: 0.75, alignItems: 'center', maxWidth: 360 }}
        >
          <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" />
          <span>
            <strong>Export failed.</strong> {error}
          </span>
        </Typography>
      )}

      <Box component="span" role="status" aria-live="polite" sx={SR_ONLY_SX}>
        {savedFileName !== null ? `Export saved as ${savedFileName}` : ''}
      </Box>
    </Box>
  )
}
