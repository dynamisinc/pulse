/**
 * features/exerciseLifecycleAdmin/components/OrgExerciseTable.tsx
 * ---------------------------------------------------------------------------
 * The ORG EXERCISE LIST (feature: exercise-lifecycle-admin, story 02 AC2 —
 * COR-075, NFR-001). Four columns, which is exactly what the AC asks for and
 * exactly what the endpoint serves: name, lifecycle status, hostname, created
 * date — "enough to distinguish exercises without opening each one".
 *
 * ## A REAL table
 * `<table>` / `<thead>` / `<th scope="col">` / `<tbody>`, with a `<caption>`
 * naming it. Not a grid of `<div>`s: a screen-reader user navigating this by
 * column/row header is the whole reason the AC says "a real, labeled
 * table/list structure". MUI's `Table` components would give the same
 * semantics, but there is no COBRA-styled table and the surrounding surfaces
 * hand-roll their structure the same way (`FieldGrid`, the planner section
 * nav), so this stays plain elements inside the COBRA theme.
 *
 * ## Row actions (demo-feedback story 22, DF-35)
 * A fifth column, "Actions", carries Rename and Archive per row
 * (`ExerciseRowActions`). ARCHIVED rows sort LAST (a stable partition: the
 * server's name order is kept within each group), and their status cell reads
 * "Archived" as an icon plus the word, never colour alone.
 *
 * ## Time (COR-053 does not bind here — and this is why)
 * `createdAt` is SERVER WALL-CLOCK administrative metadata on a STAFF surface:
 * when a staff human made this record, not anything that happened in the
 * fiction. The scenario-time-only rule binds participant-visible timestamps;
 * rendering a scenario time for "created" would in fact be a lie, because an
 * exercise in `build` has no scenario clock running at all. Rendered in the
 * viewer's locale via `date-fns`, with the raw ISO value on the `<time>`
 * element's `dateTime` attribute.
 *
 * World: STAFF (COBRA). FontAwesome only; MUI 9 `sx`-only system props.
 */

import { Box, Stack, Typography } from '@mui/material'
import { format, parseISO } from 'date-fns'
import { ExerciseRowActions } from './ExerciseRowActions'
import { sortArchivedLast } from './exerciseRowStatus'
import { ExerciseStatusBadge } from './ExerciseStatusBadge'
import type { OrgExercise } from '../types'

export interface OrgExerciseTableProps {
  /** The organization's exercises, in server order (archived ones are moved last here). */
  readonly exercises: readonly OrgExercise[]
}

/** Cell padding/border shared by header and body cells. */
const CELL_SX = {
  padding: '10px 12px',
  borderBottom: '1px solid',
  borderBottomColor: 'grid.main',
  textAlign: 'left',
  verticalAlign: 'top',
} as const

/**
 * Formats a wire ISO instant for a staff reader, or reports honestly that it is
 * unknown. A row that predates the `CreatedAt` column carries no date, and the
 * backend deliberately sends `null` rather than a fabricated stand-in — so this
 * says "Unknown" rather than inventing one either.
 */
function CreatedCell({ createdAt }: { createdAt: string | undefined }) {
  if (createdAt === undefined) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Unknown
      </Typography>
    )
  }

  const parsed = parseISO(createdAt)
  if (Number.isNaN(parsed.getTime())) {
    // An unparseable instant is a server/contract problem, not something to
    // render as a plausible-looking date.
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Unknown
      </Typography>
    )
  }

  return (
    <Typography component="time" variant="body2" dateTime={createdAt}>
      {format(parsed, 'd MMM yyyy')}
    </Typography>
  )
}

/** The organization's exercises as a real, labelled table. See the module header. */
export function OrgExerciseTable({ exercises }: OrgExerciseTableProps) {
  const rows = sortArchivedLast(exercises)

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'grid.main',
        borderRadius: 1,
        overflowX: 'auto',
        backgroundColor: 'background.paper',
      }}
    >
      <Box
        component="table"
        data-testid="org-exercise-table"
        sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}
      >
        <Box
          component="caption"
          sx={{
            textAlign: 'left',
            padding: '10px 12px',
            color: 'text.secondary',
            fontSize: 12,
          }}
        >
          Exercises owned by your organization.
        </Box>
        <Box component="thead" sx={{ backgroundColor: 'grid.light' }}>
          <Box component="tr">
            <Box component="th" scope="col" sx={{ ...CELL_SX, fontSize: 12, fontWeight: 700 }}>
              Exercise
            </Box>
            <Box component="th" scope="col" sx={{ ...CELL_SX, fontSize: 12, fontWeight: 700 }}>
              Status
            </Box>
            <Box component="th" scope="col" sx={{ ...CELL_SX, fontSize: 12, fontWeight: 700 }}>
              Hostname
            </Box>
            <Box component="th" scope="col" sx={{ ...CELL_SX, fontSize: 12, fontWeight: 700 }}>
              Created
            </Box>
            <Box component="th" scope="col" sx={{ ...CELL_SX, fontSize: 12, fontWeight: 700 }}>
              Actions
            </Box>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map(exercise => (
            <Box
              component="tr"
              key={exercise.exerciseId}
              data-testid={`org-exercise-row-${exercise.exerciseId}`}
            >
              {/*
                `scope="row"` makes the name the row header, so a screen reader
                announces "Harbor Freeze Tabletop, Status, Build" rather than
                reading four unattached cells.
              */}
              <Box component="th" scope="row" sx={{ ...CELL_SX, fontWeight: 600 }}>
                <Stack sx={{ gap: 0.25 }}>
                  {/* Plain text through React — never HTML. The name is free
                      text, sanitized server-side on ingest (NFR-004). */}
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>
                    {exercise.name}
                  </Typography>
                </Stack>
              </Box>
              <Box component="td" sx={CELL_SX}>
                <ExerciseStatusBadge status={exercise.status} />
              </Box>
              <Box component="td" sx={CELL_SX}>
                {exercise.hostname !== undefined
                  ? (
                    <Typography
                      variant="body2"
                      sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                    >
                      {exercise.hostname}
                    </Typography>
                  )
                  : (
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      Not set
                    </Typography>
                  )}
              </Box>
              <Box component="td" sx={CELL_SX}>
                <CreatedCell createdAt={exercise.createdAt} />
              </Box>
              <Box component="td" sx={CELL_SX}>
                <ExerciseRowActions exercise={exercise} />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}
