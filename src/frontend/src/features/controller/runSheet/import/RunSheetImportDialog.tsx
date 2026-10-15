/**
 * features/controller/runSheet/import/RunSheetImportDialog.tsx
 * ---------------------------------------------------------------------------
 * "Import from Excel" — load a Cadence MSEL export into the run sheet (demo-feedback
 * story 10, the console half of story 03; decisions DF-9, DF-10, DF-11, DF-16).
 *
 * THE FLOW (two steps, nothing written until the second):
 *   1. CHOOSE  a file picker accepting `.xlsx` and `.csv`, the one-line hint "A Cadence MSEL
 *              export works as-is; only social-media rows are imported", and **Preview**.
 *              A fast client check (type, empty, over 2 MB) runs before any upload.
 *   2. PREVIEW posts the file to `POST /api/injects/import?dryRun=true` and shows the counts
 *              (to create, update, unchanged, skipped, failed) and the row table, failed rows
 *              first and skipped rows collapsed (`ImportReportView`). **Import N items** (N =
 *              create + update) re-posts THE SAME FILE with `dryRun=false`.
 *   3. DONE    the result counts and rows; **Done** closes. The run sheet shows the new items
 *              on its next 3 s poll — no extra wiring.
 *   A 400 shows the server's reason (`detail`) in the dialog, as text with an icon in a
 *   `role="alert"`; a 409 says the run sheet changed and to run it again. Picking another
 *   file at any point clears the previous report, so a report never sits against a
 *   different file. `dryRun` is ALWAYS sent (the service guarantees it).
 *
 * ONE REQUEST AT A TIME. A synchronous in-flight ref makes a double click upload once; while
 * a request is in flight the picker and the actions are disabled and the dialog cannot be
 * dismissed (Escape and Cancel are ignored), so the controller never wonders whether an
 * import happened.
 *
 * ACCESSIBILITY. A MUI `Dialog` (COBRA-themed): `aria-modal`, focus trapped inside, Escape
 * closes it (when idle), labelled by its title and described by the hint. Focus starts on
 * the file chooser, moves to **Import N items** after a preview and to **Done** after an
 * import. Outcomes are announced through a polite status region; failures are alerts.
 *
 * STAFF world: COBRA buttons (`@/theme/styledComponents`), FontAwesome only, MUI 9 `sx`-only.
 * Not gated by role here (story 11 hides the button for evaluators). No telemetry (the server
 * emits `injects.imported`).
 */

import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { Box, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material'
import { styled } from '@mui/material/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faFileExcel,
  faFileImport,
  faMagnifyingGlass,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
} from '@/theme/styledComponents'
import { describeImportFailure } from './importErrors'
import { getInjectImportService } from './importService'
import type { InjectImportResultDto } from './importTypes'
import {
  formatFileSize,
  IMPORT_ACCEPT,
  IMPORT_HINT,
  importableCount,
  itemsWord,
  validateImportFile,
} from './importReport'
import { ImportReportView } from './ImportReportView'

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

type Phase = 'choose' | 'previewing' | 'preview' | 'applying' | 'done'

function outcomeSentence(result: InjectImportResultDto): string {
  if (result.dryRun) {
    const n = importableCount(result)
    return n === 0
      ? 'Preview ready. Nothing in this file would create or update a run-sheet item. Nothing has been written.'
      : `Preview ready. Importing would write ${itemsWord(n)}. Nothing has been written yet.`
  }
  return `Import complete: ${result.createdCount} created, ${result.updatedCount} updated, `
    + `${result.unchangedCount} unchanged, ${result.failedCount} failed. `
    + 'The run sheet shows the new items within a few seconds.'
}

export interface RunSheetImportDialogProps {
  /** Closes the dialog (Cancel, Escape when idle, or Done). */
  readonly onClose: () => void
}

export function RunSheetImportDialog({ onClose }: RunSheetImportDialogProps) {
  const titleId = useId()
  const hintId = useId()
  const [file, setFile] = useState<File | null>(null)
  const [clientError, setClientError] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('choose')
  const [result, setResult] = useState<InjectImportResultDto | null>(null)
  const inFlight = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const chooseRef = useRef<HTMLButtonElement>(null)
  const importRef = useRef<HTMLButtonElement>(null)
  const doneRef = useRef<HTMLButtonElement>(null)

  const busy = phase === 'previewing' || phase === 'applying'
  const toImport = result && result.dryRun ? importableCount(result) : 0
  const canPreview = file !== null && clientError === null

  // Move focus to the next decision once a step lands (the button that had it may be gone).
  useEffect(() => {
    if (phase === 'preview') {
      const apply = importRef.current
      const target = apply && !apply.disabled ? apply : chooseRef.current
      target?.focus()
    }
    if (phase === 'done') doneRef.current?.focus()
  }, [phase])

  const close = (): void => {
    if (!busy) onClose()
  }

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>): void => {
    if (busy) {
      event.target.value = ''
      return
    }
    const picked = event.target.files?.[0] ?? null
    setFile(picked)
    setClientError(picked ? validateImportFile(picked) : null)
    setFailure(null)
    setResult(null)
    setPhase('choose')
    // So picking the same file again still fires `change`.
    event.target.value = ''
  }

  const run = async (dryRun: boolean): Promise<void> => {
    if (inFlight.current || file === null || clientError !== null) return
    inFlight.current = true
    setFailure(null)
    setPhase(dryRun ? 'previewing' : 'applying')
    try {
      const answer = await getInjectImportService().importFile(file, { dryRun })
      setResult(answer)
      setPhase(dryRun ? 'preview' : 'done')
    } catch (error) {
      setFailure(describeImportFailure(error, dryRun ? 'preview' : 'import'))
      // A failed preview goes back to choosing; a failed import keeps its preview on screen.
      setPhase(dryRun ? 'choose' : 'preview')
    } finally {
      inFlight.current = false
    }
  }

  return (
    <Dialog
      open
      onClose={close}
      maxWidth="md"
      fullWidth
      aria-labelledby={titleId}
      aria-describedby={hintId}
      data-testid="run-sheet-import-dialog"
      // The dialog is portalled but React events still bubble up the COMPONENT tree, into the
      // run sheet's single-key shortcuts (A add, N fire next...). Keys typed here stay here.
      // MUI's own Escape handling runs on this same element, so Escape still closes.
      onKeyDown={event => event.stopPropagation()}
    >
      <DialogTitle id={titleId} sx={{ fontSize: 16, fontWeight: 800 }}>
        Import from Excel
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5 }}>
        <Typography id={hintId} data-testid="import-hint" sx={{ fontSize: 13, color: 'text.secondary' }}>
          {IMPORT_HINT}
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1.5 }}>
          <CobraSecondaryButton
            ref={chooseRef}
            type="button"
            autoFocus
            disabled={busy || phase === 'done'}
            onClick={() => inputRef.current?.click()}
            startIcon={<FontAwesomeIcon icon={faFileExcel} aria-hidden="true" />}
            data-testid="import-choose-file"
          >
            {file ? 'Choose another file' : 'Choose file'}
          </CobraSecondaryButton>
          <VisuallyHiddenInput
            ref={inputRef}
            type="file"
            accept={IMPORT_ACCEPT}
            aria-label="MSEL file (.xlsx or .csv)"
            data-testid="import-file-input"
            disabled={busy || phase === 'done'}
            onChange={handleFileChange}
          />
          <Typography
            data-testid="import-file-name"
            sx={{ fontSize: 13, color: file ? 'text.primary' : 'text.secondary', overflowWrap: 'anywhere' }}
          >
            {file ? `${file.name} (${formatFileSize(file.size)})` : 'No file chosen'}
          </Typography>
        </Box>

        {clientError !== null || failure !== null ? (
          <Box
            role="alert"
            data-testid="import-error"
            sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', fontSize: 13, color: 'text.primary' }}
          >
            <Box component="span" sx={{ mt: '2px', color: 'error.main' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />
            </Box>
            <span>{clientError ?? failure}</span>
          </Box>
        ) : null}

        <Box
          role="status"
          aria-live="polite"
          data-testid="import-status"
          sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', fontSize: 13, fontWeight: 600 }}
        >
          {busy ? (
            <span>{phase === 'previewing' ? 'Reading the file…' : 'Importing…'}</span>
          ) : result && (phase === 'preview' || phase === 'done') ? (
            <>
              <Box component="span" sx={{ mt: '2px', color: 'success.main' }}>
                <FontAwesomeIcon icon={faCircleCheck} aria-hidden="true" />
              </Box>
              <span>{outcomeSentence(result)}</span>
            </>
          ) : null}
        </Box>

        {result && (phase === 'preview' || phase === 'applying' || phase === 'done') ? (
          <ImportReportView result={result} />
        ) : null}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        {phase === 'done' ? (
          <CobraPrimaryButton ref={doneRef} type="button" onClick={onClose} data-testid="import-done">
            Done
          </CobraPrimaryButton>
        ) : (
          <>
            <CobraLinkButton
              type="button"
              onClick={close}
              aria-disabled={busy}
              data-testid="import-cancel"
              sx={{ '&[aria-disabled="true"]': { opacity: 0.6, cursor: 'default' } }}
            >
              Cancel
            </CobraLinkButton>
            {phase === 'choose' || phase === 'previewing' ? (
              <CobraPrimaryButton
                type="button"
                // While in flight: aria-disabled, not disabled, so the focused button keeps focus.
                disabled={!canPreview}
                aria-disabled={busy}
                aria-busy={phase === 'previewing'}
                onClick={() => void run(true)}
                startIcon={<FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />}
                data-testid="import-preview"
              >
                {phase === 'previewing' ? 'Previewing…' : 'Preview'}
              </CobraPrimaryButton>
            ) : (
              <CobraPrimaryButton
                ref={importRef}
                type="button"
                disabled={toImport === 0}
                aria-disabled={busy}
                aria-busy={phase === 'applying'}
                title={toImport === 0 ? 'Nothing to import: no row would create or update an item' : undefined}
                onClick={() => void run(false)}
                startIcon={<FontAwesomeIcon icon={faFileImport} aria-hidden="true" />}
                data-testid="import-apply"
              >
                {phase === 'applying' ? 'Importing…' : `Import ${itemsWord(toImport)}`}
              </CobraPrimaryButton>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
