/**
 * features/participantAdmin/components/people/RosterImportPanel.tsx
 * ---------------------------------------------------------------------------
 * "Import CSV" — provision many people at once from a roster file (feature:
 * easy-login, story 10; COR-011, COR-018; decisions EL-3, EL-4).
 *
 *   [Choose CSV file]  roster.csv (3 KB)   Download template
 *   [Validate]  [Import]
 *
 * ## Validate, then Import — without picking the file twice
 * **Validate** posts with `?dryRun=true`: the server reports exactly what Import
 * would do, per row, and writes NOTHING. **Import** posts `?dryRun=false`. The
 * chosen file is KEPT after a validate, so Import needs no second pick. A real
 * import refetches the roster (the mutation hook does); a `400` shows the
 * server's reason. A new pick clears the previous result so a stale outcome never
 * sits against a different file.
 *
 * ## The size / type check runs BEFORE upload
 * With the server's own wording (see `AccountEndpoints.cs`): over 1 MB, not a
 * CSV, empty. The server re-checks; this is for fast feedback.
 *
 * ## Per-row result
 * Counts, then a table: row number, name, sign-in name, status (text + icon:
 * created / updated / unchanged / failed), the persona the row bound or created,
 * and the message. In a DRY RUN the words are "Would create" / "Would update":
 * nothing was written, and the screen never says otherwise.
 *
 * ## Explaining the rules
 * A native `<details>` states the frozen derivation + matching rules plainly
 * (derived sign-in names and collisions, auto personas, the identity key,
 * "a blank cell never clears a value") so staff are never surprised by what a
 * re-upload does. It is the template's documentation, in the place they use it.
 *
 * ## Accessibility
 * The outcome sentence is in a `role="status"` region; failures are
 * `role="alert"` with an icon. Per-row status is icon + text. The file input is
 * a real labelled `<input type="file">` behind the visible COBRA button, so it is
 * keyboard- and screen-reader-operable.
 *
 * ## No CSV library
 * The template is a string and the server parses uploads. Nothing here parses
 * CSV.
 *
 * World: STAFF. COBRA buttons from `@/theme/styledComponents`; FontAwesome only;
 * MUI 9 `sx`-only system props. Content from the server is rendered as React
 * text, never as HTML (NFR-004).
 */

import { useRef, useState, type ChangeEvent, type Ref } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { styled } from '@mui/material/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faDownload,
  faFileCsv,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
} from '@/theme/styledComponents'
import { useImportRoster } from '../../hooks/useRosterMutations'
import {
  ROSTER_CSV_TEMPLATE_HEADER,
  ROSTER_IMPORT_ACCEPT,
  type RosterError,
} from '../../services/rosterService'
import type { RosterImportResultDto } from '../../types'
import { ImportRowStatusBadge } from './RosterBadges'
import { describeImportResult, ROSTER_TEMPLATE_HREF, validateRosterFile } from './rosterImport'
import { CELL_SX, MUTED_TEXT } from './rosterStyles'

/** Keeps the real input in the accessibility tree (clip, not `display: none`). */
const VisuallyHiddenInput = styled('input')({
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
  height: 1,
  overflow: 'hidden',
  position: 'absolute',
  bottom: 0,
  left: 0,
  whiteSpace: 'nowrap',
  width: 1,
})

function friendlyImportError(error: RosterError): string {
  if (error.status === 401 || error.status === 403) {
    return 'You don\'t have access to import a roster.'
  }
  if (error.status === 400) {
    return error.serverMessage
      ? `The file could not be imported: ${error.serverMessage}`
      : 'The file could not be imported. Check that it is a valid CSV with a name column.'
  }
  if (error.status === undefined) {
    return 'Could not reach the server. Check your connection and try again.'
  }
  return error.serverMessage ?? 'The import could not be completed. Try again.'
}

const TH_SX = {
  ...CELL_SX,
  fontWeight: 700,
  fontSize: 12.5,
  backgroundColor: 'grid.light',
  whiteSpace: 'nowrap',
} as const

function ImportResultTable({ result }: { readonly result: RosterImportResultDto }) {
  return (
    <Box
      sx={{
        mt: 1.5,
        maxHeight: 360,
        overflow: 'auto',
        border: '1px solid',
        borderColor: 'grid.main',
        borderRadius: 1,
      }}
    >
      <Box
        component="table"
        data-testid="roster-import-rows"
        sx={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}
      >
        <Box
          component="caption"
          sx={{ textAlign: 'left', padding: '6px 10px', fontSize: 12.5, color: MUTED_TEXT }}
        >
          {result.dryRun ? 'What importing this file would do, row by row.' : 'What the import did, row by row.'}
        </Box>
        <Box component="thead">
          <Box component="tr">
            <Box component="th" scope="col" sx={TH_SX}>Row</Box>
            <Box component="th" scope="col" sx={TH_SX}>Name</Box>
            <Box component="th" scope="col" sx={TH_SX}>Sign-in name</Box>
            <Box component="th" scope="col" sx={TH_SX}>Status</Box>
            <Box component="th" scope="col" sx={TH_SX}>Persona</Box>
            <Box component="th" scope="col" sx={TH_SX}>Message</Box>
          </Box>
        </Box>
        <Box component="tbody">
          {result.rows.map(row => (
            <Box component="tr" key={row.rowNumber} data-testid={`roster-import-row-${row.rowNumber}`}>
              <Box component="th" scope="row" sx={{ ...CELL_SX, fontWeight: 600 }}>
                {row.rowNumber}
              </Box>
              <Box component="td" sx={CELL_SX}>{row.name || '(no name)'}</Box>
              <Box component="td" sx={{ ...CELL_SX, fontFamily: 'monospace' }}>
                {row.signInName ?? '—'}
              </Box>
              <Box component="td" sx={CELL_SX}>
                <ImportRowStatusBadge status={row.status} dryRun={result.dryRun} />
              </Box>
              <Box component="td" sx={CELL_SX}>
                {row.personaHandle !== undefined
                  ? (
                    <Stack sx={{ gap: '1px' }}>
                      <span>@{row.personaHandle}</span>
                      {row.personaCreated
                        ? (
                          <Box component="span" sx={{ fontSize: 12, color: MUTED_TEXT }}>
                            {result.dryRun ? 'Citizen persona would be created' : 'New citizen persona'}
                          </Box>
                        )
                        : null}
                    </Stack>
                  )
                  : '—'}
              </Box>
              <Box component="td" sx={CELL_SX}>{row.message ?? ''}</Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

/** The staff-facing explanation of how the file is read. Mirrors the frozen rules. */
function HowTheFileIsRead() {
  return (
    <Box
      component="details"
      data-testid="roster-import-rules"
      sx={{ mb: 2, fontSize: 13, '& summary': { cursor: 'pointer', fontWeight: 600, padding: '2px 0' } }}
    >
      <summary>How the file is read</summary>
      <Box component="ul" sx={{ m: '6px 0 0', pl: 2.5, display: 'grid', gap: 0.75 }}>
        <li>
          <strong>Columns:</strong> <code>{ROSTER_CSV_TEMPLATE_HEADER}</code>. Only{' '}
          <code>name</code> is required. <code>role</code> is a job title such as &ldquo;EOC
          Liaison&rdquo;, not a permission. <code>email</code> is for staff only.
        </li>
        <li>
          <strong>Sign-in names:</strong> left blank, it is the first initial plus the last name,
          lower-case: Jane Smith becomes <code>jsmith</code>. If that is taken (or an earlier row
          in the same file took it), a number is added: <code>jsmith2</code>. A sign-in name you
          type is never changed; if it is invalid or taken, that row fails.
        </li>
        <li>
          <strong>Personas:</strong> a row with a <code>personaHandle</code> (like{' '}
          <code>FulcoEM</code>) operates that organization persona, which must already exist in
          this exercise. Everyone else gets a new citizen persona named for them, such as{' '}
          <code>@jane_smith</code>.
        </li>
        <li>
          <strong>Uploading again is safe.</strong> People are matched by sign-in name, else
          email, else name plus agency, and shown as Updated or Unchanged, never duplicated. A
          blank cell never erases what is already stored.
        </li>
        <li>
          <strong>Validate first.</strong> It shows exactly what Import would do and writes
          nothing. Rows that fail are skipped; the rest still import.
        </li>
      </Box>
    </Box>
  )
}

export interface RosterImportPanelProps {
  /** For the page to move focus here when it opens the panel (React 19 ref-as-prop). */
  readonly ref?: Ref<HTMLElement>
  /** The DOM id, so a toggle button can `aria-controls` it. */
  readonly id?: string
}

/** The roster CSV import panel. See the module header. */
export function RosterImportPanel({ ref, id = 'roster-import-panel' }: RosterImportPanelProps) {
  const [file, setFile] = useState<File | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mutation = useImportRoster()

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files?.[0] ?? null
    // A fresh pick clears the previous result so it never sits against another file.
    mutation.reset()
    setFile(picked)
    setClientError(picked ? validateRosterFile(picked) : null)
    // So picking the same file again still fires `change`.
    event.target.value = ''
  }

  const canRun = file !== null && clientError === null && !mutation.isPending
  const run = (dryRun: boolean) => {
    if (file !== null && clientError === null) mutation.mutate({ file, dryRun })
  }

  const pendingDryRun = mutation.isPending ? mutation.variables?.dryRun : undefined

  return (
    <Box
      component="section"
      ref={ref}
      id={id}
      tabIndex={-1}
      aria-labelledby={`${id}-heading`}
      data-testid="roster-import-panel"
      sx={{
        border: '1px solid',
        borderColor: 'grid.main',
        borderRadius: 1,
        backgroundColor: 'background.paper',
        padding: CobraStyles.Padding.DialogContent,
        '&:focus-visible': { outline: '2px solid', outlineColor: 'info.main' },
      }}
    >
      <Typography id={`${id}-heading`} variant="h6" component="h2" sx={{ fontWeight: 700, fontSize: 16 }}>
        Import a CSV roster
      </Typography>
      <Typography variant="body2" sx={{ color: MUTED_TEXT, mt: 0.5, mb: 1.5 }}>
        Add many people at once. Up to 1 MB. Choose a file, <strong>Validate</strong> it to see
        what would happen without changing anything, then <strong>Import</strong>.
      </Typography>

      <HowTheFileIsRead />

      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <CobraSecondaryButton
          type="button"
          onClick={() => inputRef.current?.click()}
          startIcon={<FontAwesomeIcon icon={faFileCsv} />}
        >
          Choose CSV file
        </CobraSecondaryButton>
        <VisuallyHiddenInput
          ref={inputRef}
          type="file"
          accept={ROSTER_IMPORT_ACCEPT}
          aria-label="Choose a CSV roster file"
          data-testid="roster-import-file-input"
          onChange={handleFileChange}
        />
        <Typography
          variant="body2"
          data-testid="roster-import-file-name"
          sx={{ color: file ? 'text.primary' : MUTED_TEXT }}
        >
          {file ? `${file.name} (${Math.max(1, Math.round(file.size / 1024))} KB)` : 'No file chosen'}
        </Typography>
        <CobraLinkButton
          href={ROSTER_TEMPLATE_HREF}
          // `download` is a valid anchor attribute (MUI renders an <a> when `href` is set), but
          // `styled(Button)` types only the button props, so it is spread to get past the types.
          {...{ download: 'roster-template.csv' }}
          startIcon={<FontAwesomeIcon icon={faDownload} />}
        >
          Download template
        </CobraLinkButton>
      </Stack>

      {clientError !== null
        ? (
          <Stack
            role="alert"
            direction="row"
            data-testid="roster-import-client-error"
            sx={{ mt: 1.5, gap: 1, color: 'notifications.errorText', alignItems: 'flex-start' }}
          >
            <Box component="span" sx={{ mt: '2px' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
            </Box>
            <Typography variant="body2">{clientError}</Typography>
          </Stack>
        )
        : null}

      <Stack direction="row" sx={{ mt: 2, gap: 1.5 }}>
        <CobraSecondaryButton type="button" disabled={!canRun} onClick={() => run(true)}>
          {pendingDryRun === true ? 'Validating…' : 'Validate'}
        </CobraSecondaryButton>
        <CobraPrimaryButton type="button" disabled={!canRun} onClick={() => run(false)}>
          {pendingDryRun === false ? 'Importing…' : 'Import'}
        </CobraPrimaryButton>
      </Stack>

      <Box role="status" aria-live="polite" data-testid="roster-import-status" sx={{ mt: 1.5 }}>
        {mutation.isSuccess
          ? (
            <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start' }}>
              <Box component="span" sx={{ mt: '2px', color: 'success.main' }}>
                <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
              </Box>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {describeImportResult(mutation.data)}
              </Typography>
            </Stack>
          )
          : null}
      </Box>

      {mutation.isError
        ? (
          <Stack
            role="alert"
            direction="row"
            data-testid="roster-import-server-error"
            sx={{ mt: 1.5, gap: 1, color: 'notifications.errorText', alignItems: 'flex-start' }}
          >
            <Box component="span" sx={{ mt: '2px' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
            </Box>
            <Typography variant="body2">{friendlyImportError(mutation.error)}</Typography>
          </Stack>
        )
        : null}

      {mutation.isSuccess && mutation.data.rows.length > 0
        ? <ImportResultTable result={mutation.data} />
        : null}
    </Box>
  )
}
