/**
 * features/staffPasswordReset/components/AwaitingAssignmentPanel.tsx
 * ---------------------------------------------------------------------------
 * The "Your account is ready" state of the invite page (#575b): the invitee set a password but has
 * no grant yet (no org-admin role, no active staff enrollment), so they cannot sign in. Says so in
 * plain words with an icon (never colour alone). The heading takes focus on mount so a screen
 * reader announces the state. STAFF world: COBRA theme comes from the page's ThemeProvider.
 */

import { useEffect, useRef } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faHourglassHalf } from '@fortawesome/free-solid-svg-icons'

export function AwaitingAssignmentPanel() {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <Stack sx={{ gap: 2 }} data-testid="awaiting-assignment" role="status">
      <Typography variant="h5" component="h1" tabIndex={-1} ref={headingRef}>
        Your account is ready
      </Typography>
      <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
        <Box component="span" sx={{ mt: '2px' }}>
          <FontAwesomeIcon icon={faHourglassHalf} aria-hidden />
        </Box>
        <Typography variant="body1">
          An administrator will add you to an exercise. You can sign in once you have been
          assigned.
        </Typography>
      </Stack>
    </Stack>
  )
}
