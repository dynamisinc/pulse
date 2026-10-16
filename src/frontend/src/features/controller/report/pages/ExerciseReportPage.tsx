/**
 * features/controller/report/pages/ExerciseReportPage.tsx
 * ---------------------------------------------------------------------------
 * The printable exercise report page (demo-feedback story 29; DF-40: PDF through the browser's
 * Print / Save as PDF). Route `/staff/console/report` (staff; the same controller-only guard as
 * the console, declared in `staffRouteRegistry.tsx`).
 *
 * TWO WORLDS, ONE PAGE. The screen-only TOOLBAR is COBRA (staff chrome: the "Include background
 * noise" checkbox and "Print / Save as PDF"). The SHEET is a neutral printed document with its
 * own CSS module: no COBRA, no participant skin.
 *
 * HOW IT PRINTS (mirrors the participant card sheet). The page renders in a portal beside
 * `#root`. While mounted it (1) adds `reportOpen` to `<html>` so `report.module.css` hides `#root`
 * and every other body child under `@media print` and lets the sheet flow over many pages,
 * (2) injects the `@page` rule (US Letter) as a `<style>` that exists ONLY while the page does
 * (an `@page` rule cannot be scoped, so it is never in the stylesheet), and (3) makes the rest of
 * the body `inert` so keyboard and screen readers stay on the report. All undone on unmount.
 *
 * DATA. `useExerciseReport(includeNoise)`: ticking the checkbox refetches with
 * `includeNoise=true` (metrics are identical either way; only the post list grows). States:
 * loading, error (401/404/413 and the rest as readable sentences), empty exercise, report.
 */

import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Box, Checkbox, CircularProgress, FormControlLabel, ThemeProvider } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faCircleExclamation, faPrint } from '@fortawesome/free-solid-svg-icons'
import { cobraTheme } from '@/theme/cobraTheme'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import { ReportSheet } from '../components/ReportSheet'
import styles from '../components/report.module.css'
import { useExerciseReport } from '../hooks/useExerciseReport'
import { REPORT_PAGE_RULE, REPORT_PAGE_STYLE_ATTR } from '../services/reportFormat'

/** The global class the print rules in `report.module.css` key on (`:global(.reportOpen)`). */
const PRINT_SCOPE_CLASS = 'reportOpen'

/** While mounted: print scoping class, `@page` rule, inert siblings. Undone on unmount. */
function usePrintScoping(overlayRef: React.RefObject<HTMLDivElement | null>): void {
  useEffect(() => {
    const overlay = overlayRef.current
    const html = document.documentElement
    html.classList.add(PRINT_SCOPE_CLASS)
    const pageStyle = document.createElement('style')
    pageStyle.setAttribute(REPORT_PAGE_STYLE_ATTR, '')
    pageStyle.textContent = REPORT_PAGE_RULE
    document.head.appendChild(pageStyle)

    const madeInert: Element[] = []
    for (const child of Array.from(document.body.children)) {
      if (child === overlay || child.hasAttribute('inert')) continue
      if (['SCRIPT', 'STYLE', 'LINK'].includes(child.tagName)) continue
      child.setAttribute('inert', '')
      madeInert.push(child)
    }
    overlay?.focus()

    return () => {
      for (const element of madeInert) element.removeAttribute('inert')
      html.classList.remove(PRINT_SCOPE_CLASS)
      pageStyle.remove()
    }
  }, [overlayRef])
}

export function ExerciseReportPage() {
  const [includeNoise, setIncludeNoise] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)
  const noiseId = useId()
  usePrintScoping(overlayRef)
  const query = useExerciseReport(includeNoise)
  const navigate = useNavigate()
  const report = query.data

  return createPortal(
    <ThemeProvider theme={cobraTheme}>
      <div
        ref={overlayRef}
        className={styles.overlay}
        role="main"
        aria-label="Exercise report"
        tabIndex={-1}
      >
        <div className={styles.toolbar}>
          <CobraSecondaryButton
            size="small"
            startIcon={<FontAwesomeIcon icon={faArrowLeft} aria-hidden="true" />}
            onClick={() => void navigate('/staff/console')}
          >
            Back to console
          </CobraSecondaryButton>
          <FormControlLabel
            control={
              <Checkbox
                id={noiseId}
                size="small"
                checked={includeNoise}
                onChange={event => setIncludeNoise(event.target.checked)}
              />
            }
            label="Include background noise"
            sx={{ m: 0 }}
          />
          <Box sx={{ flex: 1 }} />
          {query.isFetching && report !== undefined && (
            <Box role="status" sx={{ fontSize: 12, display: 'inline-flex', gap: 0.75, alignItems: 'center' }}>
              <CircularProgress size={12} color="inherit" aria-hidden="true" />
              Updating…
            </Box>
          )}
          <CobraPrimaryButton
            size="small"
            startIcon={<FontAwesomeIcon icon={faPrint} aria-hidden="true" />}
            onClick={() => window.print()}
            disabled={
              report === undefined || query.isError || query.isPlaceholderData || query.isFetching
            }
          >
            Print / Save as PDF
          </CobraPrimaryButton>
        </div>

        <div className={styles.stage}>
          {report === undefined && query.isError && (
            <div className={styles.state} role="alert">
              <h2>
                <FontAwesomeIcon icon={faCircleExclamation} aria-hidden="true" /> The report could not be shown
              </h2>
              <p>{query.error instanceof Error ? query.error.message : 'Try again.'}</p>
            </div>
          )}
          {report === undefined && !query.isError && (
            <div className={styles.state} role="status" aria-busy="true">
              <h2>
                <CircularProgress size={18} color="inherit" aria-hidden="true" /> Building the report…
              </h2>
              <p>
                Collecting every post, the metrics and the media. A large exercise takes a moment.
              </p>
            </div>
          )}
          {report !== undefined && query.isError && (
            <div className={styles.state} role="alert">
              <p>{query.error instanceof Error ? query.error.message : 'The refresh failed.'}</p>
            </div>
          )}
          {report !== undefined && report.summary.posts === 0 && report.posts.length === 0 && (
            <div className={styles.state} data-testid="report-empty">
              <h2>{report.exercise.name}</h2>
              <p>
                No posts have been published in this exercise yet, so there is nothing to report.
              </p>
            </div>
          )}
          {report !== undefined && !(report.summary.posts === 0 && report.posts.length === 0) && (
            <ReportSheet report={report} />
          )}
        </div>
      </div>
    </ThemeProvider>,
    document.body,
  )
}
