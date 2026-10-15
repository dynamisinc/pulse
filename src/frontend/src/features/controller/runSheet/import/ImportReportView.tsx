/**
 * features/controller/runSheet/import/ImportReportView.tsx
 * ---------------------------------------------------------------------------
 * The import dialog's report (demo-feedback story 10): the five counts, then a table of
 * rows — row number, Inject #, title, persona, planned minute, status, message — with
 * FAILED rows first, and the skipped (not social media) rows collapsed under a native
 * `<details>` "N rows skipped (not social media)". The same view serves the dry-run
 * preview ("Will create") and the applied result ("Created").
 *
 * STAFF world, inside a COBRA (light) dialog: theme tokens only, FontAwesome icons, MUI 9
 * `sx`-only. ACCESSIBILITY: real `<table>`s with a `<caption>` and `<th scope="col">`
 * headers (each row's number is its `<th scope="row">`); every status is icon + text, never
 * colour alone (NFR-001). Server text (titles, handles, messages) renders as React text,
 * never HTML (NFR-004).
 */

import { Box, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faCircleExclamation,
  faCirclePlus,
  faEquals,
  faForward,
  faPen,
} from '@fortawesome/free-solid-svg-icons'
import type { InjectImportResultDto, InjectImportRowDto, InjectImportRowStatus } from './importTypes'
import {
  countLines,
  IMPORT_MUTED_TEXT,
  skippedSummary,
  splitReportRows,
  statusLabel,
} from './importReport'

const STATUS_ICON: Readonly<Record<InjectImportRowStatus, IconDefinition>> = {
  created: faCirclePlus,
  updated: faPen,
  unchanged: faEquals,
  skipped: faForward,
  failed: faCircleExclamation,
}

const CELL_SX = {
  padding: '6px 10px',
  borderBottom: '1px solid',
  borderColor: 'divider',
  textAlign: 'left',
  verticalAlign: 'top',
  fontSize: 13,
} as const

const TH_SX = {
  ...CELL_SX,
  fontWeight: 700,
  fontSize: 12.5,
  whiteSpace: 'nowrap',
  backgroundColor: 'grid.light',
  position: 'sticky',
  top: 0,
} as const

function personaText(row: InjectImportRowDto): string {
  if (!row.personaHandle) return '—'
  // A resolved persona is a handle; a failed row echoes the From / Source cell as read.
  if (row.status === 'failed' || row.personaHandle.startsWith('@') || /\s/.test(row.personaHandle)) {
    return row.personaHandle
  }
  return `@${row.personaHandle}`
}

function RowsTable({
  rows,
  dryRun,
  caption,
  testId,
}: {
  readonly rows: readonly InjectImportRowDto[]
  readonly dryRun: boolean
  readonly caption: string
  readonly testId: string
}) {
  return (
    <Box sx={{ overflow: 'auto', maxHeight: 320, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
      <Box component="table" data-testid={testId} sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
        <Box
          component="caption"
          sx={{
            captionSide: 'top',
            textAlign: 'left',
            p: '6px 10px',
            fontSize: 12.5,
            color: IMPORT_MUTED_TEXT,
          }}
        >
          {caption}
        </Box>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" scope="col" sx={TH_SX}>Row</Box>
            <Box component="th" scope="col" sx={TH_SX}>Inject #</Box>
            <Box component="th" scope="col" sx={TH_SX}>Title</Box>
            <Box component="th" scope="col" sx={TH_SX}>Persona</Box>
            <Box component="th" scope="col" sx={TH_SX}>Planned</Box>
            <Box component="th" scope="col" sx={TH_SX}>Status</Box>
            <Box component="th" scope="col" sx={TH_SX}>Message</Box>
          </Box>
        </Box>
        <Box component="tbody">
          {rows.map(row => (
            <Box
              component="tr"
              key={row.rowNumber}
              data-testid={`import-row-${row.rowNumber}`}
              data-status={row.status}
            >
              <Box component="th" scope="row" sx={{ ...CELL_SX, fontWeight: 600 }}>{row.rowNumber}</Box>
              <Box component="td" sx={{ ...CELL_SX, whiteSpace: 'nowrap' }}>{row.injectNumber ?? '—'}</Box>
              <Box component="td" sx={{ ...CELL_SX, overflowWrap: 'anywhere' }}>{row.title ?? '—'}</Box>
              <Box component="td" sx={{ ...CELL_SX, overflowWrap: 'anywhere' }}>{personaText(row)}</Box>
              <Box component="td" sx={{ ...CELL_SX, whiteSpace: 'nowrap' }}>
                {row.plannedMinute === undefined ? '—' : `T+${row.plannedMinute}`}
              </Box>
              <Box
                component="td"
                sx={{ ...CELL_SX, whiteSpace: 'nowrap', fontWeight: row.status === 'failed' ? 700 : 400 }}
              >
                <FontAwesomeIcon icon={STATUS_ICON[row.status]} aria-hidden="true" />{' '}
                {statusLabel(row.status, dryRun)}
              </Box>
              <Box component="td" sx={{ ...CELL_SX, overflowWrap: 'anywhere' }}>{row.message ?? ''}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

export interface ImportReportViewProps {
  readonly result: InjectImportResultDto
}

export function ImportReportView({ result }: ImportReportViewProps) {
  const { listed, skipped } = splitReportRows(result.rows)
  return (
    <Box data-testid="import-report" data-dry-run={result.dryRun ? 'true' : 'false'} sx={{ display: 'grid', gap: 1.5 }}>
      <Box
        component="dl"
        data-testid="import-counts"
        sx={{ m: 0, display: 'flex', flexWrap: 'wrap', gap: 1 }}
      >
        {countLines(result).map(line => (
          <Box
            key={line.key}
            data-testid={`import-count-${line.key}`}
            sx={{
              display: 'flex',
              flexDirection: 'column-reverse',
              minWidth: 92,
              px: 1.25,
              py: 0.75,
              border: '1px solid',
              borderColor: 'divider',
              borderRadius: 1,
            }}
          >
            <Box component="dt" sx={{ fontSize: 12, color: IMPORT_MUTED_TEXT }}>{line.label}</Box>
            <Box component="dd" sx={{ m: 0, fontSize: 18, fontWeight: 700 }}>{line.value}</Box>
          </Box>
        ))}
      </Box>

      {listed.length > 0 ? (
        <RowsTable
          rows={listed}
          dryRun={result.dryRun}
          testId="import-rows"
          caption={
            result.dryRun
              ? 'What importing this file would do, failed rows first.'
              : 'What the import did, failed rows first.'
          }
        />
      ) : (
        <Typography data-testid="import-no-social-rows" sx={{ fontSize: 13 }}>
          No social-media rows in this file.
        </Typography>
      )}

      {skipped.length > 0 ? (
        <Box
          component="details"
          data-testid="import-skipped"
          sx={{ fontSize: 13, '& summary': { cursor: 'pointer', fontWeight: 600, py: 0.25 } }}
        >
          <summary>{skippedSummary(skipped.length)}</summary>
          <Box sx={{ mt: 1 }}>
            <RowsTable
              rows={skipped}
              dryRun={result.dryRun}
              testId="import-skipped-rows"
              caption="Rows that are not social-media injects. They are never imported."
            />
          </Box>
        </Box>
      ) : null}
    </Box>
  )
}
