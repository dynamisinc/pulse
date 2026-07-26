/**
 * features/planner/pages/ExerciseSettingsPage.tsx
 * ---------------------------------------------------------------------------
 * The staff-console EXERCISE SETTINGS page (feature: exercise-configuration,
 * story 01b; COR-030; issue #41 / story #67). The planner's one place to see
 * and change everything that configures a single exercise.
 *
 * TWO WORLDS — STAFF (D0 §2 / CLAUDE.md). Desktop-first COBRA: it renders
 * inside the app's COBRA `ThemeProvider` and mounts NO participant/brand theme,
 * even though the values edited here are what the participant world is skinned
 * from. It draws no app chrome of its own — the shared staff shell (D7) owns the
 * header and toolstrip; this page is work-area content, exactly like
 * `features/evaluator/pages/EvaluatorDashboardPage.tsx`.
 *
 * ============================================================================
 * THIS PAGE IS A COMPOSITION POINT — KEEP IT THAT WAY
 * ============================================================================
 * Per `docs/features/exercise-configuration/implementation.md` → "Integration
 * seams", from wave 3 on this file is where the feature's other stories hang
 * their panels, one line each:
 *
 *   story 02 (compliance chrome)  ->  <ComplianceChromePanel />
 *   story 04 (practice/sandbox)   ->  <PracticeModePanel />
 *
 * Each of those panels is SELF-CONTAINED: it owns its own hook, service, query
 * and states, so mounting it is a single JSX line the ORCHESTRATOR adds at merge
 * time — two wave-3 builders never edit the same file, and no panel needs a prop
 * threaded through this page.
 *
 * So this page deliberately holds NO state, NO data fetching and NO
 * cross-panel coordination: it is a titled, `<main>`-scoped stack of panels
 * separated by dividers. Anything that looks like chrome configuration or
 * practice-mode behaviour belongs in those stories' own panels, never here — a
 * page that starts owning a panel's concerns is what turns a one-line mount into
 * a merge conflict.
 *
 * ROUTING is orchestrator-owned (`src/frontend/src/App.tsx` + the planner
 * barrel): this feature exports the page and never edits the route table.
 *
 * ACCESSIBILITY (NFR-001): the page is a single `<main>` landmark with one `h1`;
 * each panel below is its own `<section>` with its own heading, so a screen
 * reader can jump panel to panel. Every state/severity signal lives inside the
 * panels and is icon + text, never color alone.
 *
 * SCENARIO TIME (COR-053): not applicable — staff world throughout.
 */

import { Box, Divider, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGears } from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { ExerciseSettingsPanel } from '../components/ExerciseSettingsPanel'

/**
 * Work-area content for the planner's exercise-settings route: a page title and
 * the stack of settings panels. Mounted by `App.tsx` (orchestrator-owned)
 * inside the shared staff shell, a COBRA `ThemeProvider` and a React Query
 * `QueryClientProvider`.
 */
export function ExerciseSettingsPage() {
  return (
    <Box
      component="main"
      data-testid="exercise-settings-page"
      sx={{ padding: CobraStyles.Padding.MainWindow, height: '100%', overflowY: 'auto' }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <FontAwesomeIcon icon={faGears} aria-hidden />
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          Exercise configuration
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 860 }}>
        Everything that configures this exercise. Changes apply to the exercise your console is
        currently working in — the server decides which one that is, so nothing here can reach
        another exercise.
      </Typography>

      <Divider sx={{ mt: 2 }} />

      <Stack sx={{ gap: 0 }} divider={<Divider />}>
        <ExerciseSettingsPanel />

        {/*
          WAVE 3 MOUNT POINTS (orchestrator-owned, one line each — see the
          module header):
            <ComplianceChromePanel />   story 02
            <PracticeModePanel />       story 04
        */}
      </Stack>
    </Box>
  )
}
