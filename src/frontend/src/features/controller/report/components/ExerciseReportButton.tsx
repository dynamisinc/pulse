/**
 * features/controller/report/components/ExerciseReportButton.tsx
 * ---------------------------------------------------------------------------
 * The console's **Exercise report** button (demo-feedback story 29), beside Export posts in the
 * title row. STAFF world: a COBRA button, FontAwesome icon, MUI 9 `sx`-only.
 *
 * It navigates to the printable report (`/staff/console/report`) in the SAME tab. Staff tokens
 * live in per-tab sessionStorage, so a new tab would open with no session (CR-001). The report's
 * toolbar has a "Back to console" control.
 */

import { useInRouterContext, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFilePdf } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton } from '@/theme/styledComponents'

/** The report's route; `staffRouteRegistry.tsx` registers the same path. */
export const EXERCISE_REPORT_PATH = '/staff/console/report'

/** Outside a router there is nowhere to navigate to, so nothing renders (isolated unit mounts). */
export function ExerciseReportButton() {
  return useInRouterContext() ? <NavigatingButton /> : null
}

function NavigatingButton() {
  const navigate = useNavigate()
  return (
    <CobraSecondaryButton
      size="small"
      data-testid="exercise-report"
      startIcon={<FontAwesomeIcon icon={faFilePdf} aria-hidden="true" />}
      onClick={() => void navigate(EXERCISE_REPORT_PATH)}
    >
      Exercise report
    </CobraSecondaryButton>
  )
}
