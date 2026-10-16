/**
 * features/controller/report/pages/ExerciseReportPage.tsx
 * ---------------------------------------------------------------------------
 * The printable exercise report page (demo-feedback story 29; DF-40: PDF through the browser's
 * Print / Save as PDF). Route `/staff/console/report` (staff; the same controller-only guard as
 * the console, declared in `staffRouteRegistry.tsx`).
 *
 * TWO WORLDS, ONE PAGE. The screen-only TOOLBAR is COBRA (staff chrome: the post-record
 * filters and "Print / Save as PDF"). The SHEET is a neutral printed document with its
 * own CSS module: no COBRA, no participant skin.
 *
 * HOW IT PRINTS (mirrors the participant card sheet). The page renders in a portal beside
 * `#root`. While mounted it (1) adds `reportOpen` to `<html>` so `report.module.css` hides `#root`
 * and every other body child under `@media print` and lets the sheet flow over many pages,
 * (2) injects the `@page` rule (US Letter) as a `<style>` that exists ONLY while the page does
 * (an `@page` rule cannot be scoped, so it is never in the stylesheet), and (3) makes the rest of
 * the body `inert` so keyboard and screen readers stay on the report. All undone on unmount.
 *
 * DATA. `useExerciseReport(filters)` (story 30): the source checkboxes and the From / To window
 * refetch with `sources`/`from`/`to` (the summary is identical whatever they are; only the post
 * record changes). States: loading, error (readable sentences), empty exercise, report. A 400
 * (bad filter) shows the server's reason beside the filters, keeps the last good sheet on
 * screen, and disables Print; the sheet's own filter statement says what it contains.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Box, CircularProgress, ThemeProvider } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faArrowLeft, faCircleExclamation, faPrint } from '@fortawesome/free-solid-svg-icons'
import { cobraTheme } from '@/theme/cobraTheme'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import { ReportFilterBar } from '../components/ReportFilterBar'
import { ReportSheet } from '../components/ReportSheet'
import styles from '../components/report.module.css'
import { useExerciseReport } from '../hooks/useExerciseReport'
import { DEFAULT_REPORT_FILTERS } from '../services/reportFilters'
import { ReportError } from '../services/reportService'
import type { ExerciseReport, ReportFilters } from '../types/report'
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
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS)
  const overlayRef = useRef<HTMLDivElement>(null)
  usePrintScoping(overlayRef)
  const query = useExerciseReport(filters)
  const navigate = useNavigate()
  // Keep the last good sheet visible when a filter change fails (a 400 clears `query.data`).
  const [lastGood, setLastGood] = useState<ExerciseReport | undefined>(undefined)
  if (query.data !== undefined && query.data !== lastGood) setLastGood(query.data)
  const report = query.data ?? lastGood
  const badFilter =
    query.isError && query.error instanceof ReportError && query.error.status === 400
  const serverError = badFilter && report !== undefined ? query.error.message : null

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
          <ReportFilterBar
            filters={filters}
            onChange={setFilters}
            windowStart={report?.exercise.scenarioStart ?? null}
            serverError={serverError}
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

        <div
          className={styles.stage}
          role="region"
          aria-label="Exercise report preview"
          tabIndex={0}
          data-testid="report-stage"
        >
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
          {report !== undefined && query.isError && !badFilter && (
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
