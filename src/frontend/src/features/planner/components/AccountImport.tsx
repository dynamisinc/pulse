/**
 * features/planner/components/AccountImport.tsx
 * ---------------------------------------------------------------------------
 * The staff-console BULK ACCOUNT IMPORT panel (feature: identity-auth-roles,
 * story 02 — named participant accounts; COR-011). A planner selects a CSV of
 * named participant accounts and uploads it to
 * `POST /api/staff/accounts/import`; the panel then renders the per-row result
 * summary (total / created / failed, plus each failed row's reason).
 *
 * TWO WORLDS — this is the STAFF world (D0 §2 / CLAUDE.md). It uses the COBRA
 * look: `@/theme/styledComponents` (`CobraPrimaryButton` / `CobraSecondaryButton`)
 * + `CobraStyles` spacing, and it renders inside a COBRA `ThemeProvider` (the
 * later app-shell/planner story mounts it — this component OWNs only itself,
 * its hook, and its service, never the route table). It must NEVER read as a
 * participant skin. Icons are FontAwesome only (never `@mui/icons-material`);
 * MUI system props go through `sx` (MUI 9).
 *
 * ACCESSIBILITY (NFR-001, WCAG 2.1 AA):
 *  - Per-row status is NEVER color-only: `created` / `failed` each pair a
 *    distinct FontAwesome icon (a check vs an x) with a visible text label, and
 *    color is only a third, redundant cue.
 *  - The result region is an `aria-live="polite"` status region so a screen
 *    reader announces the outcome after an upload; validation / server errors
 *    are `role="alert"`.
 *  - The file picker is a real, labeled `<input type="file">` triggered by the
 *    visible COBRA button (the repo's `Composer.tsx` ref + hidden-input
 *    pattern), so it is keyboard- and screen-reader-operable.
 *
 * CONTENT SECURITY (NFR-004): display names / handles are sanitized on the
 * server at ingest; the echoed handles + reasons rendered here are React text
 * nodes ({value}), which React escapes — this panel never uses
 * `dangerouslySetInnerHTML`, so a stored script in an imported field cannot
 * execute in the console.
 *
 * SCENARIO TIME (COR-053): not applicable — staff world, and the import result
 * carries no timestamps.
 */

import { useRef, useState, type ChangeEvent } from 'react'
import { Box, CircularProgress, Divider, Stack, Typography } from '@mui/material'
import { styled } from '@mui/material/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faCircleXmark,
  faFileCsv,
  faTriangleExclamation,
  faUpload,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { useAccountImport } from '../hooks/useAccountImport'
import {
  IMPORT_FILE_ACCEPT,
  MAX_IMPORT_FILE_BYTES,
  type AccountImportError,
} from '../services/accountImportService'
import type { AccountImportResult, AccountImportRowStatus } from '../types'

/**
 * Visually-hidden native file input (the MUI-documented accessible
 * file-upload pattern). Hidden via the clip technique — NOT `display: none` —
 * so it stays in the accessibility tree and reachable by keyboard + tests,
 * while the visible COBRA button carries the affordance.
 */
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

/** Validates the chosen file client-side (fast feedback that mirrors the
 * server guards); returns an error string, or `null` when acceptable. */
function validateFile(file: File): string | null {
  const isCsv =
    file.name.toLowerCase().endsWith('.csv') ||
    file.type === 'text/csv' ||
    file.type === 'application/vnd.ms-excel'
  if (!isCsv) {
    return 'Choose a .csv file. Other file types are not accepted.'
  }
  if (file.size === 0) {
    return 'That file is empty. Choose a CSV with a header row and at least one account.'
  }
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    return 'That file is larger than the 1 MB import limit.'
  }
  return null
}

/** Maps a thrown import error to clear, status-aware staff-facing copy. */
function friendlyImportErrorMessage(error: AccountImportError): string {
  switch (error.status) {
    case 401:
      return 'Your staff session is not active. Sign in to the console and run the import again.'
    case 400:
      return error.serverMessage
        ? `The file could not be imported: ${error.serverMessage}`
        : 'The file could not be imported. Check that it is a valid, non-empty CSV under 1 MB.'
    case 413:
      return 'The file is too large. The import limit is 1 MB.'
    default:
      return error.status === undefined
        ? 'Could not reach the server. Check your connection and run the import again.'
        : (error.serverMessage ?? 'The import could not be completed. Please try again.')
  }
}

/** A status indicator that is NEVER color-only: icon + text label + color. */
function ImportStatusBadge({ status }: { status: AccountImportRowStatus }) {
  const created = status === 'created'
  return (
    <Stack
      direction="row"
      data-testid={`account-import-status-${status}`}
      sx={{ alignItems: 'center', gap: 0.5, color: created ? 'success.main' : 'error.main' }}
    >
      <FontAwesomeIcon icon={created ? faCircleCheck : faCircleXmark} aria-hidden />
      <Typography component="span" sx={{ fontWeight: 600, fontSize: '0.8125rem' }}>
        {created ? 'Created' : 'Failed'}
      </Typography>
    </Stack>
  )
}

/** Renders the total / created / failed aggregate and the per-row list. */
function ImportResultSummary({ result }: { result: AccountImportResult }) {
  return (
    <Box
      role="status"
      aria-live="polite"
      data-testid="account-import-result"
      sx={{ mt: 2 }}
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        Import complete
      </Typography>

      <Stack
        direction="row"
        sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 2, mb: 1.5 }}
      >
        <Typography variant="body2">
          {result.totalRows} row{result.totalRows === 1 ? '' : 's'} processed
        </Typography>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: 'success.main' }}>
          <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {result.createdCount} created
          </Typography>
        </Stack>
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 0.5,
            color: result.failedCount > 0 ? 'error.main' : 'text.secondary',
          }}
        >
          <FontAwesomeIcon icon={faCircleXmark} aria-hidden />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {result.failedCount} failed
          </Typography>
        </Stack>
      </Stack>

      <Box
        component="ul"
        sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
      >
        {result.rows.map(row => (
          <Box
            key={`${row.rowNumber}-${row.username}`}
            component="li"
            sx={{
              border: 1,
              borderColor: 'border.main',
              borderRadius: 1,
              p: 1,
            }}
          >
            <Stack
              direction="row"
              sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1 }}
            >
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', minWidth: 48 }}
              >
                Row {row.rowNumber}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600, flexGrow: 1 }}>
                {row.username || '(no username)'}
              </Typography>
              <ImportStatusBadge status={row.status} />
            </Stack>
            {row.status === 'failed' && row.message ? (
              <Typography
                variant="body2"
                sx={{ color: 'error.main', mt: 0.5 }}
              >
                {row.message}
              </Typography>
            ) : null}
          </Box>
        ))}
      </Box>
    </Box>
  )
}

/** A `role="alert"` block pairing an icon with a message (never color-only). */
function ImportAlert({ message, testId }: { message: string; testId: string }) {
  return (
    <Stack
      role="alert"
      direction="row"
      data-testid={testId}
      sx={{ alignItems: 'flex-start', gap: 1, color: 'error.main', mt: 1.5 }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Typography variant="body2">{message}</Typography>
    </Stack>
  )
}

/**
 * The bulk account-import panel. Self-contained COBRA staff surface: choose a
 * CSV, upload it, and read the per-row result. Mounted by the later
 * app-shell/planner story.
 */
export function AccountImport() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const importMutation = useAccountImport()

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null
    // A fresh selection clears any prior result/error so stale outcomes never
    // linger against a newly-chosen file.
    importMutation.reset()
    setSelectedFile(file)
    setClientError(file ? validateFile(file) : null)
    // Reset so re-picking the same file still fires a change event.
    event.target.value = ''
  }

  const handleImport = () => {
    if (selectedFile && !clientError) {
      importMutation.mutate(selectedFile)
    }
  }

  const canImport = selectedFile !== null && clientError === null && !importMutation.isPending

  return (
    <Box
      component="section"
      aria-labelledby="account-import-heading"
      data-testid="account-import-panel"
      sx={{ padding: CobraStyles.Padding.MainWindow, maxWidth: 720 }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, mb: 0.5 }}>
        <FontAwesomeIcon icon={faUsers} aria-hidden />
        <Typography id="account-import-heading" variant="h6" sx={{ fontWeight: 700 }}>
          Import participant accounts
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2 }}>
        Upload a CSV to provision named participant accounts in this exercise. Include a header
        row with columns username, displayName, role (participant or pio), and an optional
        password. Up to 1 MB.
      </Typography>

      <Stack direction="row" sx={{ alignItems: 'center', flexWrap: 'wrap', gap: 1.5 }}>
        <CobraSecondaryButton
          onClick={() => fileInputRef.current?.click()}
          startIcon={<FontAwesomeIcon icon={faFileCsv} />}
        >
          Choose CSV file
        </CobraSecondaryButton>
        <VisuallyHiddenInput
          ref={fileInputRef}
          type="file"
          accept={IMPORT_FILE_ACCEPT}
          aria-label="Choose a CSV file of participant accounts"
          data-testid="account-import-file-input"
          onChange={handleFileChange}
        />
        <Typography
          variant="body2"
          data-testid="account-import-file-name"
          sx={{ color: selectedFile ? 'text.primary' : 'text.secondary' }}
        >
          {selectedFile
            ? `${selectedFile.name} (${Math.max(1, Math.round(selectedFile.size / 1024))} KB)`
            : 'No file selected'}
        </Typography>
      </Stack>

      {clientError ? <ImportAlert message={clientError} testId="account-import-client-error" /> : null}

      <Box sx={{ mt: 2 }}>
        <CobraPrimaryButton
          onClick={handleImport}
          disabled={!canImport}
          startIcon={
            importMutation.isPending
              ? <CircularProgress size={16} color="inherit" />
              : <FontAwesomeIcon icon={faUpload} />
          }
        >
          {importMutation.isPending ? 'Importing…' : 'Import accounts'}
        </CobraPrimaryButton>
      </Box>

      {importMutation.isError ? (
        <ImportAlert
          message={friendlyImportErrorMessage(importMutation.error)}
          testId="account-import-server-error"
        />
      ) : null}

      {importMutation.isSuccess ? (
        <>
          <Divider sx={{ mt: 2 }} />
          <ImportResultSummary result={importMutation.data} />
        </>
      ) : null}
    </Box>
  )
}
