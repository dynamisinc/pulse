import { Box, Card, CardContent, Chip, Container, Divider, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faTowerBroadcast,
  faUsers,
  faSliders,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'

interface Surface {
  brand: string;
  role: string;
  anchor: string;
}

// D0 §3 - Brand set (screened defaults, theme-configurable)
const PARTICIPANT_SURFACES: Surface[] = [
  { brand: 'Pulse', role: 'Social', anchor: 'X / Twitter' },
  { brand: '"[City] Today"', role: 'Portal', anchor: 'Local TV-station site' },
  { brand: 'Newsline 7', role: 'TV outlet', anchor: 'Local broadcast news' },
  { brand: 'The Courier-Ledger', role: 'Paper', anchor: 'Local newspaper' },
  { brand: 'The National Wire', role: 'Wire', anchor: 'AP / wire service' },
  { brand: 'The Scoop', role: 'Tabloid', anchor: 'Celebrity / gossip' },
  { brand: 'The Wire Room', role: 'Press wire', anchor: 'Municipal newsroom' },
  { brand: 'The Weather Desk', role: 'Weather', anchor: 'weather.gov / NWS' },
]

const STAFF_SURFACES: Surface[] = [
  { brand: 'Controller console', role: 'Conduct', anchor: 'Cadence conduct views' },
  { brand: 'Evaluator dashboard', role: 'Analytics', anchor: 'Chart-forward Cadence' },
]

/**
 * Scaffold landing page.
 *
 * Placeholder that documents Pulse's two-world architecture (D0 §2) and the
 * screened brand set (D0 §3). Replace with the real router shell as surfaces
 * come online. Rendered here with the COBRA staff theme.
 */
export const HomePage = () => {
  return (
    <Container maxWidth="lg" sx={{ py: 6 }}>
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <FontAwesomeIcon icon={faTowerBroadcast} size="2x" color="#0020c2" />
          <Typography variant="h3" fontWeight={700}>
            Pulse
          </Typography>
          <Chip label="scaffold" size="small" color="info" variant="outlined" />
        </Stack>
        <Typography variant="h6" color="text.secondary" fontWeight={400}>
          A simulated media environment for emergency-management exercises.
        </Typography>
      </Stack>

      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={CobraStyles.Spacing.DashboardWidgets}
        sx={{ mb: 4 }}
      >
        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <FontAwesomeIcon icon={faUsers} />
              <Typography variant="h6">Participant world</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The fiction. Consumer apps that mirror the real thing they simulate — warm,
              familiar, per-exercise brandable. Nothing may break fiction; no default MUI look.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {PARTICIPANT_SURFACES.map(s => (
                <Chip key={s.brand} label={`${s.brand} · ${s.role}`} size="small" />
              ))}
            </Stack>
          </CardContent>
        </Card>

        <Card variant="outlined" sx={{ flex: 1 }}>
          <CardContent>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <FontAwesomeIcon icon={faSliders} />
              <Typography variant="h6">Staff world</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              The machine. Cadence-family operator tooling — dark chrome, dense-on-purpose,
              fixed COBRA look. Never confusable with a participant view.
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {STAFF_SURFACES.map(s => (
                <Chip
                  key={s.brand}
                  label={`${s.brand} · ${s.role}`}
                  size="small"
                  color="primary"
                />
              ))}
            </Stack>
          </CardContent>
        </Card>
      </Stack>

      <Card variant="outlined" sx={{ mb: 4, bgcolor: 'notifications.warning' }}>
        <CardContent>
          <Stack direction="row" spacing={1} alignItems="center">
            <FontAwesomeIcon icon={faTriangleExclamation} color="#6F4E37" />
            <Typography variant="body2" color="#6F4E37">
              Compliance chrome (COR-031) frames the participant world; high-risk templates
              reserve an "EXERCISE" watermark slot (NFR-008). This is a training simulator.
            </Typography>
          </Stack>
        </CardContent>
      </Card>

      <Divider sx={{ mb: 3 }} />

      <Stack direction="row" spacing={2}>
        <CobraPrimaryButton onClick={() => window.open('https://github.com/dynamisinc/pulse', '_blank')}>
          View repository
        </CobraPrimaryButton>
        <CobraSecondaryButton onClick={() => { window.location.hash = '#surfaces' }}>
          Design foundations
        </CobraSecondaryButton>
      </Stack>

      <Box sx={{ mt: 4 }}>
        <Typography variant="caption" color="text.secondary">
          Dynamis · Pulse frontend scaffold · React 19 + Vite + MUI 7 + COBRA
        </Typography>
      </Box>
    </Container>
  )
}

export default HomePage
