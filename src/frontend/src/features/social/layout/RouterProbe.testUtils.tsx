/**
 * features/social/layout/RouterProbe.testUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY probe for the F1 layout suites: shows the surrounding router's REAL
 * location and drives its history like the browser's Back / Forward buttons, so a
 * suite can tell "the channel moved" from "the real address bar moved". Split out of
 * `renderChannel.testUtils.tsx` because a file may export components OR helpers, not both
 * (`react-refresh/only-export-components`).
 *
 * World: participant test scaffolding -- no COBRA, no MUI.
 */

import { useLocation, useNavigate } from 'react-router-dom'

/** Shows the REAL router location and drives its history like the browser buttons. */
export function RouterProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return (
    <div>
      <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>
      <button type="button" data-testid="probe-back" onClick={() => navigate(-1)}>
        probe back
      </button>
      <button type="button" data-testid="probe-forward" onClick={() => navigate(1)}>
        probe forward
      </button>
    </div>
  )
}
