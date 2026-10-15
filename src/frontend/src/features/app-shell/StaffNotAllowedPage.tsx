/**
 * features/app-shell/StaffNotAllowedPage.tsx
 * ---------------------------------------------------------------------------
 * The COBRA "not allowed" page (demo-feedback story 15, DF-20, issue #516).
 *
 * ## Why it exists
 * Before this, a signed-in staff member who opened a REGISTERED staff path
 * their role is not admitted to was silently redirected to their own default
 * surface. Tom's UAT controller opened `/staff/exercises`, landed on the
 * console, and nothing said why. Now `StaffRouteTree` renders this page at that
 * path instead: it names the surface, says which roles may open it, and offers
 * one button back to the role's own default page.
 *
 * An UNKNOWN `/staff/*` path still redirects to the default (a typo has no
 * surface to explain), so this page only ever appears for a path the registry
 * actually declares.
 *
 * ## Two worlds
 * STAFF world only. It is rendered exclusively by `StaffRouteTree`, which only
 * mounts after `RoleAwareEntry` has narrowed the resolved role to a staff role,
 * inside the COBRA hand-off — so no participant path can ever reach it
 * (COR-004/XC-002). Like every staff surface it mounts `StaffShellFrame`, the
 * COBRA theme boundary with the navy header (never confusable with a
 * participant view), and uses COBRA components and FontAwesome only. The
 * header reads "Not allowed" — no launcher, switcher or toolstrip tools,
 * because there is no surface here to drive.
 *
 * ## Accessibility (NFR-001)
 * The frame's work area is the page's one `<main>`; the page adds an `<h1>`.
 * `StaffRouteTree` wraps it in a `RouteFocusScope`, so arriving here moves
 * focus to the page and announces it. The lock icon is decorative; the words
 * carry the meaning (never colour or icon alone).
 *
 * It names no concrete surface: the label, the admitted roles and the home path
 * all come from the injected registry (`registryIsTheOnlySeam.test.ts`).
 */

import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faLock } from '@fortawesome/free-solid-svg-icons'
import { useNavigate } from 'react-router-dom'
import { StaffShellFrame } from '@/features/staffShell/StaffShellFrame'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import CobraStyles from '@/theme/CobraStyles'
import { CobraPrimaryButton } from '@/theme/styledComponents'
import { describeRequiredRoles } from './staffRoleWords'
import type { StaffSurfaceRole } from './staffRouting'

export interface StaffNotAllowedPageProps {
  /** The refused surface's label, from its registry entry. */
  surfaceLabel: string
  /** The refused surface's `allowedRoles`, from its registry entry. */
  allowedRoles: readonly StaffSurfaceRole[]
  /** Absolute path of the signed-in role's own default surface. */
  homePath: string
  /** That default surface's label, when the registry has one for `homePath`. */
  homeLabel?: string
}

export function StaffNotAllowedPage({
  surfaceLabel,
  allowedRoles,
  homePath,
  homeLabel,
}: StaffNotAllowedPageProps) {
  const navigate = useNavigate()

  const header = (
    <Stack
      direction="row"
      sx={{ height: '100%', alignItems: 'center', paddingLeft: CobraStyles.Padding.MainWindow }}
    >
      <Typography sx={{ fontWeight: 700, color: staffShellTokens.header.textPrimary }}>
        Not allowed
      </Typography>
    </Stack>
  )

  return (
    <StaffShellFrame header={header}>
      <Box
        data-testid="staff-not-allowed-page"
        sx={{
          padding: CobraStyles.Padding.MainWindow,
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
        }}
      >
        <Stack
          sx={{
            mt: 8,
            maxWidth: 560,
            gap: 1.5,
            padding: '24px',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            bgcolor: 'background.paper',
          }}
        >
          <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <FontAwesomeIcon icon={faLock} aria-hidden />
            <Typography
              variant="h5"
              component="h1"
              sx={{ fontWeight: 700 }}
            >
              Not allowed
            </Typography>
          </Stack>
          <Typography variant="body1">
            {describeRequiredRoles(allowedRoles, surfaceLabel)}
          </Typography>
          <Box>
            <CobraPrimaryButton onClick={() => navigate(homePath)}>
              {homeLabel === undefined ? 'Go to your home page' : `Go to ${homeLabel}`}
            </CobraPrimaryButton>
          </Box>
        </Stack>
      </Box>
    </StaffShellFrame>
  )
}
