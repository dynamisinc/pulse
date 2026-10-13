/**
 * features/staffShell/components/PreviewErrorBoundary.tsx
 * ---------------------------------------------------------------------------
 * The LOCAL error boundary around the participant render inside "Preview as participant"
 * (demo-polish C6, Gate-1 W-3). STAFF world: it is the staff frame's own chrome, drawn on the
 * neutral mat -- it imports nothing from the participant world and renders none of it.
 *
 * WHY IT EXISTS. The preview mounts the REAL Social channel, and a render error anywhere in it
 * (a malformed post, a bad media URL, a hook that throws) would otherwise bubble to the nearest
 * boundary above: the app's `RootFailClosedBoundary`, which treats a throw as "the session or
 * scope is unresolved" and REDIRECTS TO `/login`. A presenter on stage must never be signed out
 * of the console because a participant post failed to draw. So the failure stays here:
 *
 *   - the participant subtree below is replaced by "Participant preview unavailable", in text,
 *     announced (`role="alert"`) -- the console and the rest of the staff frame are untouched;
 *   - the label strip and **Exit preview** (siblings of this boundary, not children) keep
 *     working, so the presenter can leave the preview and carry on;
 *   - everything the failed subtree held is released by React unmounting it -- the preview's
 *     telemetry hold (`PreviewChannelHost`) is an effect cleanup, so it goes with the subtree.
 *
 * It does not retry: whatever threw would throw again, and a loop of failing renders on stage is
 * worse than a plain "unavailable". Exit and re-enter the preview to try again (the boundary,
 * with its state, unmounts with the stage). Only the error's MESSAGE is logged, never its object
 * or component stack, which can carry post text.
 *
 * (A class component because React offers no hook for this; `RootFailClosedBoundary` is the
 * other one in the tree.)
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { Stack, Typography } from '@mui/material'
import { staffShellTokens } from '../staffShellTokens'

export interface PreviewErrorBoundaryProps {
  readonly children: ReactNode
}

interface PreviewErrorBoundaryState {
  readonly failed: boolean
}

export class PreviewErrorBoundary extends Component<
  PreviewErrorBoundaryProps,
  PreviewErrorBoundaryState
> {
  override state: PreviewErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): PreviewErrorBoundaryState {
    return { failed: true }
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    // The message only: the object and component stack can carry post text.
    console.error('[preview] the participant preview failed to render:', error.message)
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <Stack
        role="alert"
        data-testid="preview-unavailable"
        sx={{
          gap: 0.75,
          p: 3,
          bgcolor: '#ffffff',
          color: staffShellTokens.accent.secondaryText,
        }}
      >
        <Typography
          component="div"
          sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 14, fontWeight: 800 }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
          Participant preview unavailable
        </Typography>
        <Typography component="div" sx={{ fontSize: 12.5, lineHeight: 1.5 }}>
          The participant view could not be drawn. The console is not affected. Choose Exit
          preview to return to it.
        </Typography>
      </Stack>
    )
  }
}
