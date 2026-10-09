/**
 * features/controller/runSheet/RunSheetPanel.tsx
 * ---------------------------------------------------------------------------
 * THE RUN SHEET PANEL (demo-polish C3, story 19 / issue #438; CTL-010 lite, CTL-011
 * lite, CTL-013 lite, CTL-001, COR-018, NFR-001). STAFF world: COBRA components
 * (`@/theme/styledComponents`) and the staff shell tokens (through `runSheetTokens`), dense,
 * desktop-first, keyboard-first, FontAwesome icons only, MUI 9 `sx`-only. It renders no
 * participant skin and no `PostCard`, and nothing in it can be mistaken for a participant view.
 *
 * WHAT IT IS. An MSEL-style list of STAGED POSTS ("beats") a controller can fire with one
 * key press - the misinformation beat of the demo script ("the impersonator posts a
 * brown-tap-water photo, citizen personas pile on"). Browser-side only: the sheet lives in
 * the controller's `localStorage` per exercise (`runSheetStore.ts`) with `pulse.runsheet.v1`
 * JSON import/export (`runSheetSchema.ts`), and firing posts through the existing
 * `POST /api/posts` (`runSheetFire.ts`) - no backend of its own, and NO scheduler: the
 * "intended minute" (T+14m) is information and a sort hint, nothing ever fires on a timer.
 *
 * MOUNTING. Self-contained and prop-less: it reads the exercise scope, the controller
 * identity, the personas and the media library itself. The orchestrator mounts it through
 * the console's `runSheetSlot` (`<RunSheetPanel />`); it needs the usual providers above it
 * (exercise context, React Query) and nothing else. It is keyed by exercise id, so an
 * exercise switch (which does not remount the console) resets the panel's own UI state, and
 * the store only ever hands it that exercise's sheet.
 *
 * KEYBOARD (scoped to this panel; ignored while typing in a field - `runSheetKeyboard.ts`):
 *   ↑ / ↓  select · F  fire selected · N  fire next pending · S  skip / undo skip · E  edit
 * and every action is also a button. The legend is always visible under the list.
 *
 * SAFETY (the demo must not double-post or lie):
 *  - a fire claims the sheet's single fire slot synchronously, so a double-press cannot fire
 *    twice and only one beat is ever in flight;
 *  - a beat is "Fired" only once the server returned its post id; a server refusal is
 *    "Failed" with Retry; an unknown outcome (no response, 5xx, unreadable 2xx, a reload
 *    mid-request) is "Unconfirmed" - the post may be live - and re-firing it needs an
 *    explicit confirmation (POST /api/posts is not idempotent yet; F4 / #455);
 *  - irreversible edits (delete, replace-by-import, fire-again, discard) go through one
 *    confirm step whose default focus is Cancel; everything else is undo-able or harmless;
 *  - import is all-or-nothing and fails closed with a readable message; a storage failure
 *    is a visible warning, never silent loss.
 *
 * TIME. The intended minute reads "T+14m"; a fired stamp is SCENARIO time in the exercise's
 * zone (COR-053). The export's `exportedAt` is wall-clock metadata in the file only.
 */

import { useCallback, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowDownShortWide,
  faFileExport,
  faFileImport,
  faForwardFast,
  faKeyboard,
  faListCheck,
  faPlus,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
  CobraTextField,
} from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { wallClockNowIso } from '@/core/time/wallClock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useMediaLibrary, type StaffMediaAssetView } from '@/core/media'
import { useLibraryAssetLookup } from '@/features/controller/media/useLibraryAssetLookup'
import { BUTTON_KBD_SX, FIELD_SX, KBD_SX, runSheetTokens } from './runSheetTokens'
import { BeatEditor } from './BeatEditor'
import { ConfirmDialog } from './ConfirmDialog'
import { buildLibraryView, type LibraryView } from './libraryView'
import { RunSheetBeatRow } from './RunSheetBeatRow'
import { KEYBOARD_HELP, shortcutFor } from './runSheetKeyboard'
import { downloadTextFile, readFileText, runSheetFilename } from './runSheetFileIO'
import {
  canAddBeat,
  countStatuses,
  deleteBlockReason,
  firstPendingBeat,
  runtimeOf,
  type BeatContent,
} from './runSheetModel'
import {
  RUN_SHEET_LIMITS,
  formatScenarioMinute,
  parseRunSheetFile,
  serializeRunSheetFile,
  sheetNameSchema,
  type RunSheetBeat,
  type RunSheetDefinition,
} from './runSheetSchema'
import {
  addBeatTo,
  deleteBeatFrom,
  duplicateBeatIn,
  moveBeatIn,
  renameSheetIn,
  replaceSheetIn,
  skipBeatIn,
  sortBeatsByMinuteIn,
  startFreshIn,
  unskipBeatIn,
  updateBeatIn,
} from './runSheetStore'
import { useRunSheet, type FireReport } from './useRunSheet'

/** A confirm step waiting for the controller's answer. */
type ConfirmState =
  | { readonly kind: 'delete'; readonly beatId: string }
  | { readonly kind: 'fire-again'; readonly beatId: string }
  | { readonly kind: 'import'; readonly sheet: RunSheetDefinition; readonly fileName: string }
  | { readonly kind: 'start-fresh' }

const HEADER_BUTTON_SX = { py: '3px', px: 1.5, fontSize: 12, minWidth: 0 } as const

/** "2 images", "1 video", or "3 media" when the library does not know every id. */
function describeMedia(
  beat: RunSheetBeat,
  library: ReadonlyMap<string, StaffMediaAssetView> | undefined,
): string {
  const media = beat.media ?? []
  if (media.length === 0) return ''
  const assets = media.map(item => library?.get(item.mediaId))
  if (assets.every(asset => asset !== undefined)) {
    const videos = assets.filter(asset => asset?.kind === 'video').length
    if (videos > 0) return videos === 1 && media.length === 1 ? '1 video' : `${media.length} media`
    return `${media.length} ${media.length === 1 ? 'image' : 'images'}`
  }
  return `${media.length} media`
}

/** Every media id the sheet's beats reference (deduplicated, in first-use order). */
function snapshotMediaIds(beats: readonly RunSheetBeat[]): readonly string[] {
  const ids = new Set<string>()
  for (const beat of beats) for (const item of beat.media ?? []) ids.add(item.mediaId)
  return [...ids]
}

/** Entry point. Keys the body by exercise so a switch cannot leave stale UI state behind. */
export function RunSheetPanel() {
  const { exerciseId } = useExerciseContext()
  return <RunSheetPanelBody key={exerciseId} />
}

function RunSheetPanelBody() {
  const sheet = useRunSheet()
  const { exerciseId, timeZone, snapshot, firing, personas, personasLoading } = sheet
  // The media library. This `useMediaLibrary()` query STAYS: it is what FETCHES the library, so
  // beat thumbnails and "not in the library" notes resolve even when C1's picker was never
  // opened (`useLibraryAssetLookup()` below only READS the query cache, it never requests).
  // The picker's Images / Videos filters use the same key family
  // (`['staff','media',exerciseId,kind]`), so there is one cache entry per kind, shared. The
  // "All" list is capped, so an asset picked under a filter may be absent from it: the lookup
  // is the fallback for those ids (`libraryView.ts`).
  const libraryQuery = useMediaLibrary()
  const libraryData = libraryQuery.data
  const lookupAsset = useLibraryAssetLookup()
  const referencedMediaIds = useMemo(() => snapshotMediaIds(snapshot.beats), [snapshot.beats])
  const library = useMemo<LibraryView | undefined>(
    () =>
      libraryData === undefined
        ? undefined
        : buildLibraryView(libraryData, referencedMediaIds, lookupAsset),
    [libraryData, referencedMediaIds, lookupAsset],
  )

  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [editor, setEditor] = useState<{ readonly beatId?: string } | undefined>(undefined)
  const [confirm, setConfirm] = useState<ConfirmState | undefined>(undefined)
  const [status, setStatus] = useState('')
  const [alertMessage, setAlertMessage] = useState<string | undefined>(undefined)
  const [importError, setImportError] = useState<string | undefined>(undefined)
  const [importNotice, setImportNotice] = useState<string | undefined>(undefined)
  const [nameError, setNameError] = useState<string | undefined>(undefined)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const focusRowAfterRender = useRef<string | undefined>(undefined)

  const beats = snapshot.beats
  const selected = beats.find(beat => beat.id === selectedId) ?? beats[0]
  const counts = countStatuses(snapshot)
  const nextUp = firstPendingBeat(snapshot)
  const unreadable = snapshot.state === 'unreadable'
  const dialogOpen = editor !== undefined || confirm !== undefined

  // Focus a row once it has rendered in its new place (after a move, a delete, a keyboard
  // selection). Runs after every commit but only acts when a focus was requested.
  useLayoutEffect(() => {
    const id = focusRowAfterRender.current
    if (id === undefined) return
    focusRowAfterRender.current = undefined
    rowRefs.current.get(id)?.focus()
  })

  const select = useCallback((beatId: string, focus: boolean) => {
    setSelectedId(beatId)
    if (focus) focusRowAfterRender.current = beatId
  }, [])

  const announce = useCallback((message: string) => setStatus(message), [])

  // A row button that is replaced by its own action (Fire, Skip) takes keyboard focus with
  // it; put focus back on the row so the next key press still reaches the shortcuts. Only
  // when focus was actually lost (a dialog the action opened keeps it).
  const restoreRowFocus = useCallback((beatId: string) => {
    window.setTimeout(() => {
      if (document.activeElement !== document.body && document.activeElement !== null) return
      rowRefs.current.get(beatId)?.focus()
    }, 0)
  }, [])

  // ---- firing -------------------------------------------------------------------------

  const reportFire = (report: FireReport) => {
    if (
      report.outcome === 'failed'
      || report.outcome === 'unconfirmed'
      || report.outcome === 'unrecorded'
    ) {
      // One announcement, not two: the assertive alert carries the failure, so the polite
      // status region is cleared rather than repeating it.
      setAlertMessage(report.message)
      announce('')
      return
    }
    announce(report.message)
    if (report.outcome === 'fired') setAlertMessage(undefined)
  }

  const runFire = async (beatId: string, confirmed = false) => {
    const report = await sheet.fire(beatId, confirmed ? { confirmedUnconfirmed: true } : undefined)
    reportFire(report)
    if (report.outcome === 'needs-confirmation') setConfirm({ kind: 'fire-again', beatId })
  }

  const runFireNext = async (focus: boolean) => {
    const report = await sheet.fireNext()
    reportFire(report)
    // Follow the beat that was actually sent; a blocked attempt leaves the selection alone.
    if (
      report.beatId !== undefined
      && (report.outcome === 'fired' || report.outcome === 'failed' || report.outcome === 'unconfirmed')
    ) {
      select(report.beatId, focus)
    }
  }

  const toggleSkip = useCallback(
    (beatId: string) => {
      const beat = beats.find(candidate => candidate.id === beatId)
      if (beat === undefined) return
      const record = runtimeOf(snapshot, beatId)
      if (record.status === 'skipped') {
        unskipBeatIn(exerciseId, beatId)
        announce(`Skip undone for "${beat.title}".`)
      } else if (record.status === 'fired') {
        announce(`"${beat.title}" has already been fired.`)
      } else if (record.inFlight === true) {
        announce(`"${beat.title}" is firing right now.`)
      } else {
        skipBeatIn(exerciseId, beatId)
        announce(`Skipped "${beat.title}". Press S again to undo.`)
      }
    },
    [beats, snapshot, exerciseId, announce],
  )

  const openEditor = useCallback(
    (beatId: string) => {
      const beat = beats.find(candidate => candidate.id === beatId)
      if (beat === undefined) return
      const record = runtimeOf(snapshot, beatId)
      if (record.status === 'fired') {
        announce(`"${beat.title}" is already live and cannot be edited. Duplicate it to reuse it.`)
        return
      }
      if (record.inFlight === true) {
        announce(`"${beat.title}" is firing right now.`)
        return
      }
      setEditor({ beatId })
    },
    [beats, snapshot, announce],
  )

  const requestDelete = useCallback(
    (beatId: string) => {
      const reason = deleteBlockReason(snapshot, beatId)
      if (reason !== undefined) {
        announce(reason)
        return
      }
      setConfirm({ kind: 'delete', beatId })
    },
    [snapshot, announce],
  )

  // ---- keyboard -----------------------------------------------------------------------

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Dialogs are portalled: their key events still bubble here through React, but they are
    // not inside this panel's DOM and must never trigger a shortcut.
    if (dialogOpen || unreadable) return
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return
    const shortcut = shortcutFor(event)
    if (shortcut === undefined) return

    const index = selected === undefined ? -1 : beats.findIndex(beat => beat.id === selected.id)
    switch (shortcut) {
      case 'previous':
      case 'next': {
        event.preventDefault()
        if (beats.length === 0) return
        const target = shortcut === 'next' ? Math.min(beats.length - 1, index + 1) : Math.max(0, index - 1)
        const beat = beats[target]
        if (beat !== undefined) select(beat.id, true)
        return
      }
      case 'fire':
        event.preventDefault()
        if (selected !== undefined) void runFire(selected.id)
        return
      case 'fireNext':
        event.preventDefault()
        void runFireNext(true)
        return
      case 'skip':
        event.preventDefault()
        if (selected !== undefined) toggleSkip(selected.id)
        return
      case 'edit':
        event.preventDefault()
        if (selected !== undefined) openEditor(selected.id)
        return
    }
  }

  // ---- editor / confirm results -------------------------------------------------------

  const saveBeat = (content: BeatContent) => {
    const editing = editor?.beatId
    setEditor(undefined)
    if (editing === undefined) {
      const created = addBeatTo(exerciseId, content)
      if (created !== undefined) select(created, false)
      announce(`Added "${content.title}".`)
    } else {
      updateBeatIn(exerciseId, editing, content)
      announce(`Saved "${content.title}".`)
    }
  }

  const confirmAction = async () => {
    const current = confirm
    setConfirm(undefined)
    if (current === undefined) return
    switch (current.kind) {
      case 'delete': {
        const index = beats.findIndex(beat => beat.id === current.beatId)
        const title = beats[index]?.title ?? 'beat'
        const outcome = deleteBeatFrom(exerciseId, current.beatId)
        if (!outcome.ok) {
          announce(outcome.reason)
          return
        }
        const neighbour = beats[index + 1] ?? beats[index - 1]
        if (neighbour !== undefined) select(neighbour.id, true)
        announce(`Deleted "${title}". Its live post, if any, is not affected.`)
        return
      }
      case 'fire-again':
        await runFire(current.beatId, true)
        restoreRowFocus(current.beatId)
        return
      case 'import':
        applyImport(current.sheet, current.fileName)
        return
      case 'start-fresh':
        startFreshIn(exerciseId)
        announce('Started a new empty run sheet. The unreadable data was kept under a backup key.')
        return
    }
  }

  // ---- import / export ----------------------------------------------------------------

  const applyImport = (definition: RunSheetDefinition, fileName: string) => {
    // Refused while a beat is firing (checked again here, on the store's fresh read: the
    // result of that fire must not land on the new sheet).
    const replaced = replaceSheetIn(exerciseId, definition)
    if (!replaced.ok) {
      const message = `Import refused: ${replaced.reason} Nothing was changed.`
      setImportError(message)
      announce(message)
      return
    }
    const first = definition.beats[0]
    setSelectedId(first?.id)
    const withMissing =
      library === undefined
        ? 0
        : definition.beats.filter(beat =>
          (beat.media ?? []).some(item => !library.has(item.mediaId))).length
    const notice =
      `Imported "${definition.name}" from ${fileName}: ${definition.beats.length} `
      + `${definition.beats.length === 1 ? 'beat' : 'beats'}, all pending.`
      + (withMissing > 0
        ? ` Warning: ${withMissing} ${withMissing === 1 ? 'beat uses' : 'beats use'} media that is not `
          + 'in this exercise\'s library (marked on the beat; you can still fire).'
        : '')
    setImportNotice(notice)
    announce(notice)
  }

  const handleImportFile = async (file: File) => {
    setImportError(undefined)
    setImportNotice(undefined)
    if (firing) {
      const message = 'Import refused: a beat is firing right now. Wait for its result.'
      setImportError(message)
      announce(message)
      return
    }
    if (file.size > RUN_SHEET_LIMITS.fileMaxBytes) {
      const message =
        `Import refused: ${file.name} is too large to be a run sheet (over 2 MB). Nothing was changed.`
      setImportError(message)
      announce(message)
      return
    }
    let text: string
    try {
      text = await readFileText(file)
    } catch {
      const message = `Import refused: ${file.name} could not be read. Nothing was changed.`
      setImportError(message)
      announce(message)
      return
    }
    const result = parseRunSheetFile(text)
    if (!result.ok) {
      const message = `Import refused, nothing was changed. ${result.message}`
      setImportError(message)
      announce(message)
      return
    }
    if (beats.length > 0) {
      setConfirm({ kind: 'import', sheet: result.sheet, fileName: file.name })
      return
    }
    applyImport(result.sheet, file.name)
  }

  const handleExport = () => {
    const filename = runSheetFilename(snapshot.name)
    downloadTextFile(
      filename,
      serializeRunSheetFile({ name: snapshot.name, beats }, wallClockNowIso()),
    )
    setImportError(undefined)
    announce(
      `Exported ${beats.length} ${beats.length === 1 ? 'beat' : 'beats'} to ${filename}. `
      + 'Status is not included in the file.',
    )
  }

  const commitName = (value: string) => {
    const parsed = sheetNameSchema.safeParse(value)
    if (!parsed.success) {
      setNameError(`Sheet name ${parsed.error.issues[0]?.message ?? 'is not valid'}.`)
      return
    }
    setNameError(undefined)
    renameSheetIn(exerciseId, parsed.data)
  }

  // ---- render -------------------------------------------------------------------------

  const confirmBeat =
    confirm !== undefined && 'beatId' in confirm
      ? beats.find(beat => beat.id === confirm.beatId)
      : undefined
  const editingBeat = editor?.beatId === undefined
    ? undefined
    : beats.find(beat => beat.id === editor.beatId)
  const atLimit = !canAddBeat(snapshot)

  return (
    <Box
      data-testid="run-sheet-panel"
      data-personas={personasLoading ? 'loading' : 'ready'}
      onKeyDown={handleKeyDown}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        minWidth: 0,
        bgcolor: runSheetTokens.panel,
        border: `1px solid ${runSheetTokens.hairline}`,
        borderRadius: '8px',
        overflow: 'hidden',
        color: 'text.primary',
      }}
    >
      {/* ---- header ---- */}
      <Box
        sx={{
          flex: 'none',
          p: 1.25,
          borderBottom: `1px solid ${runSheetTokens.hairline}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          ...FIELD_SX,
        }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <FontAwesomeIcon icon={faListCheck} color={runSheetTokens.navy} aria-hidden="true" />
          <Typography
            component="h2"
            sx={{
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: '0.1em',
              color: runSheetTokens.navy,
            }}
          >
            RUN SHEET
          </Typography>
          <Typography data-testid="run-sheet-counts" sx={{ fontSize: 12, color: runSheetTokens.mutedText }}>
            {counts.total === 0
              ? 'No beats yet'
              : `${counts.fired} of ${counts.total} fired · ${counts.pending} pending`
                + (counts.skipped > 0 ? ` · ${counts.skipped} skipped` : '')
                + (counts.failed > 0 ? ` · ${counts.failed} failed` : '')
                + (counts.unconfirmed > 0 ? ` · ${counts.unconfirmed} unconfirmed` : '')}
          </Typography>
          <Box sx={{ flex: 1 }} />
          <CobraPrimaryButton
            size="small"
            aria-keyshortcuts="N"
            disabled={unreadable || nextUp === undefined || firing}
            onClick={() => void runFireNext(false)}
            startIcon={<FontAwesomeIcon icon={faForwardFast} />}
            sx={HEADER_BUTTON_SX}
          >
            Fire next
            <Box component="kbd" aria-hidden="true" sx={BUTTON_KBD_SX}>N</Box>
          </CobraPrimaryButton>
        </Stack>

        {nextUp !== undefined && !unreadable && (
          <Typography data-testid="run-sheet-next-up" sx={{ fontSize: 12, color: runSheetTokens.mutedText }}>
            Next up: #{nextUp.order} {formatScenarioMinute(nextUp.scenarioMinute)}{' '}
            "{nextUp.title}" as @{nextUp.persona.handle}
          </Typography>
        )}

        {!unreadable && (
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <CobraTextField
              key={snapshot.name}
              label="Sheet name"
              size="small"
              defaultValue={snapshot.name}
              error={nameError !== undefined}
              helperText={nameError}
              onBlur={event => commitName(event.target.value)}
              onKeyDown={event => {
                // Enter commits (by blurring); Escape stays with the field.
                if (event.key === 'Enter') event.currentTarget.querySelector('input')?.blur()
              }}
              sx={{ flex: '1 1 200px' }}
            />
            <Stack direction="row" sx={{ gap: 0.75, flexWrap: 'wrap', pt: '3px' }}>
              <CobraSecondaryButton
                size="small"
                disabled={atLimit}
                onClick={() => setEditor({})}
                startIcon={<FontAwesomeIcon icon={faPlus} />}
                sx={HEADER_BUTTON_SX}
              >
                Add beat
              </CobraSecondaryButton>
              <CobraSecondaryButton
                size="small"
                disabled={firing}
                onClick={() => fileInputRef.current?.click()}
                startIcon={<FontAwesomeIcon icon={faFileImport} />}
                sx={HEADER_BUTTON_SX}
              >
                Import
              </CobraSecondaryButton>
              <CobraSecondaryButton
                size="small"
                onClick={handleExport}
                startIcon={<FontAwesomeIcon icon={faFileExport} />}
                sx={HEADER_BUTTON_SX}
              >
                Export
              </CobraSecondaryButton>
              <CobraSecondaryButton
                size="small"
                disabled={beats.length < 2}
                onClick={() => {
                  sortBeatsByMinuteIn(exerciseId)
                  announce('Beats re-ordered by intended minute. This changes the order only; nothing fires on a timer.')
                }}
                startIcon={<FontAwesomeIcon icon={faArrowDownShortWide} />}
                sx={HEADER_BUTTON_SX}
              >
                Sort by T+
              </CobraSecondaryButton>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                data-testid="run-sheet-import-input"
                aria-label="Import a run sheet file"
                tabIndex={-1}
                hidden
                onChange={event => {
                  const file = event.target.files?.[0]
                  // Reset so choosing the same file again still fires `change`.
                  event.target.value = ''
                  if (file !== undefined) void handleImportFile(file)
                }}
              />
            </Stack>
          </Stack>
        )}

        {atLimit && (
          <Typography sx={{ fontSize: 12, color: runSheetTokens.mutedText }}>
            A sheet holds at most {RUN_SHEET_LIMITS.beatsMax} beats.
          </Typography>
        )}
      </Box>

      {/* ---- notices ---- */}
      {snapshot.storageWarning !== undefined && (
        <Box
          role="alert"
          data-testid="run-sheet-storage-warning"
          sx={{
            flex: 'none',
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            px: 1.25,
            py: 0.75,
            fontSize: 12.5,
            fontWeight: 600,
            bgcolor: runSheetTokens.warningBanner.background,
            color: runSheetTokens.warningBanner.text,
            borderBottom: `1px solid ${runSheetTokens.hairline}`,
          }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
          <span>Warning: {snapshot.storageWarning}</span>
        </Box>
      )}

      {unreadable && (
        <Box
          role="alert"
          data-testid="run-sheet-unreadable"
          sx={{
            flex: 'none',
            p: 1.25,
            fontSize: 12.5,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
            alignItems: 'flex-start',
          }}
        >
          <Box sx={{ display: 'flex', gap: 1, fontWeight: 600 }}>
            <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
            <span>
              This exercise's saved run sheet could not be read ({snapshot.unreadableReason}).
              It has not been changed or deleted. Starting a new sheet keeps a copy of the old
              data under a backup key.
            </span>
          </Box>
          <CobraSecondaryButton
            size="small"
            onClick={() => setConfirm({ kind: 'start-fresh' })}
            sx={HEADER_BUTTON_SX}
          >
            Start a new sheet...
          </CobraSecondaryButton>
        </Box>
      )}

      {alertMessage !== undefined && (
        <Box
          role="alert"
          data-testid="run-sheet-alert"
          sx={{
            flex: 'none',
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            px: 1.25,
            py: 0.75,
            fontSize: 12.5,
            fontWeight: 600,
            bgcolor: runSheetTokens.errorBanner.background,
            color: runSheetTokens.errorBanner.text,
            borderBottom: `1px solid ${runSheetTokens.hairline}`,
          }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
          <span style={{ flex: 1 }}>{alertMessage}</span>
          <CobraLinkButton size="small" onClick={() => setAlertMessage(undefined)} sx={HEADER_BUTTON_SX}>
            Dismiss
          </CobraLinkButton>
        </Box>
      )}

      {importError !== undefined && (
        <Box
          role="alert"
          data-testid="run-sheet-import-error"
          sx={{
            flex: 'none',
            display: 'flex',
            gap: 1,
            alignItems: 'flex-start',
            px: 1.25,
            py: 0.75,
            fontSize: 12.5,
            fontWeight: 600,
            bgcolor: runSheetTokens.errorBanner.background,
            color: runSheetTokens.errorBanner.text,
            borderBottom: `1px solid ${runSheetTokens.hairline}`,
          }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
          <span style={{ flex: 1 }}>{importError}</span>
          <CobraLinkButton size="small" onClick={() => setImportError(undefined)} sx={HEADER_BUTTON_SX}>
            Dismiss
          </CobraLinkButton>
        </Box>
      )}

      {importNotice !== undefined && importError === undefined && (
        <Typography
          data-testid="run-sheet-import-notice"
          sx={{
            flex: 'none',
            px: 1.25,
            py: 0.75,
            fontSize: 12.5,
            borderBottom: `1px solid ${runSheetTokens.hairline}`,
          }}
        >
          {importNotice}
        </Typography>
      )}

      {/* ---- the list ---- */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          ...CobraStyles.Scrollbar.Styling,
        }}
      >
        {!unreadable && beats.length === 0 && (
          <Typography data-testid="run-sheet-empty" sx={{ p: 2, fontSize: 13, color: runSheetTokens.mutedText }}>
            No beats yet. Add a beat, or import a run sheet file (pulse.runsheet.v1 JSON).
          </Typography>
        )}
        {beats.length > 0 && (
          <Box component="ul" aria-label="Beats" sx={{ m: 0, p: 0 }}>
            {beats.map((beat, position) => {
              const record = runtimeOf(snapshot, beat.id)
              const replyTo = beat.replyTo
              const parent =
                replyTo !== undefined && 'beatId' in replyTo
                  ? beats.find(candidate => candidate.id === replyTo.beatId)
                  : undefined
              const missing =
                library === undefined
                  ? 0
                  : (beat.media ?? []).filter(item => !library.has(item.mediaId)).length
              const blocked = sheet.blockedFor(beat)
              return (
                <RunSheetBeatRow
                  key={beat.id}
                  beat={beat}
                  record={record}
                  {...(parent !== undefined
                    ? { parentTitle: parent.title, parentOrder: parent.order }
                    : {})}
                  position={position}
                  total={beats.length}
                  selected={selected?.id === beat.id}
                  timeZone={timeZone}
                  {...(blocked !== undefined && !blocked.startsWith('Personas are still loading')
                    ? { blockedReason: blocked }
                    : {})}
                  mediaSummary={describeMedia(beat, library)}
                  mediaMissing={missing}
                  sheetFiring={firing}
                  rowRef={element => {
                    if (element === null) rowRefs.current.delete(beat.id)
                    else rowRefs.current.set(beat.id, element)
                  }}
                  onSelect={() => setSelectedId(beat.id)}
                  onFire={() => void runFire(beat.id).then(() => restoreRowFocus(beat.id))}
                  onSkip={() => {
                    toggleSkip(beat.id)
                    restoreRowFocus(beat.id)
                  }}
                  onEdit={() => openEditor(beat.id)}
                  onDuplicate={() => {
                    const created = duplicateBeatIn(exerciseId, beat.id)
                    if (created === undefined) {
                      announce(`A sheet holds at most ${RUN_SHEET_LIMITS.beatsMax} beats.`)
                      return
                    }
                    select(created, false)
                    announce(`Duplicated "${beat.title}".`)
                  }}
                  onMove={direction => {
                    moveBeatIn(exerciseId, beat.id, direction)
                    focusRowAfterRender.current = beat.id
                    announce(`Moved "${beat.title}" ${direction === -1 ? 'up' : 'down'}.`)
                  }}
                  onDelete={() => requestDelete(beat.id)}
                />
              )
            })}
          </Box>
        )}
      </Box>

      {/* ---- live status + keyboard legend ---- */}
      <Box
        sx={{
          flex: 'none',
          borderTop: `1px solid ${runSheetTokens.hairline}`,
          px: 1.25,
          py: 0.75,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Typography
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="run-sheet-status"
          sx={{ fontSize: 12, minHeight: '1.4em', fontWeight: 600 }}
        >
          {status}
        </Typography>
        <Box
          component="div"
          role="group"
          aria-label="Keyboard"
          data-testid="run-sheet-keyboard-help"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            flexWrap: 'wrap',
            fontSize: 11.5,
            color: runSheetTokens.mutedText,
          }}
        >
          <Box component="span" sx={{ display: 'inline-flex', gap: 0.75, alignItems: 'center', fontWeight: 800 }}>
            <FontAwesomeIcon icon={faKeyboard} aria-hidden="true" />
            Keyboard
          </Box>
          {KEYBOARD_HELP.map(entry => (
            <Box key={entry.keys} component="span" sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
              <Box component="kbd" sx={KBD_SX}>{entry.keys}</Box>
              {entry.action}
            </Box>
          ))}
        </Box>
      </Box>

      {/* ---- dialogs ---- */}
      {editor !== undefined && (
        <BeatEditor
          data={snapshot}
          {...(editingBeat !== undefined ? { beat: editingBeat } : {})}
          personas={personas}
          {...(library !== undefined ? { library } : {})}
          onSave={saveBeat}
          onCancel={() => setEditor(undefined)}
        />
      )}

      {confirm?.kind === 'delete' && (
        <ConfirmDialog
          title="Delete this beat?"
          confirmLabel="Delete beat"
          destructive
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(undefined)}
        >
          "{confirmBeat?.title}" will be removed from the sheet.
          {confirmBeat !== undefined && runtimeOf(snapshot, confirmBeat.id).status === 'fired'
            ? ' Its live post stays in the world (use takedown to remove it); beats that reply to it will reply to that post instead.'
            : ' This cannot be undone.'}
        </ConfirmDialog>
      )}

      {confirm?.kind === 'fire-again' && (
        <ConfirmDialog
          title="Fire again?"
          confirmLabel="Fire again"
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(undefined)}
        >
          The server did not confirm whether "{confirmBeat?.title}" went out, so it may already be
          live. Check the Live world first. If the post is there, cancel and skip this beat instead.
          Fire again only if it is not: a second post cannot be un-sent.
        </ConfirmDialog>
      )}

      {confirm?.kind === 'import' && (
        <ConfirmDialog
          title="Replace the current run sheet?"
          confirmLabel="Replace sheet"
          destructive
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(undefined)}
        >
          Importing "{confirm.sheet.name}" ({confirm.sheet.beats.length}{' '}
          {confirm.sheet.beats.length === 1 ? 'beat' : 'beats'}) replaces the {beats.length}{' '}
          {beats.length === 1 ? 'beat' : 'beats'} in this sheet. Every imported beat starts as
          pending, so the current fired / skipped status is lost. Posts that are already live are
          not affected.
        </ConfirmDialog>
      )}

      {confirm?.kind === 'start-fresh' && (
        <ConfirmDialog
          title="Start a new sheet?"
          confirmLabel="Start new sheet"
          destructive
          onConfirm={() => void confirmAction()}
          onCancel={() => setConfirm(undefined)}
        >
          The saved sheet for this exercise cannot be read. A new empty sheet replaces it; a copy of
          the unreadable data is kept under a backup key in this browser.
        </ConfirmDialog>
      )}
    </Box>
  )
}
