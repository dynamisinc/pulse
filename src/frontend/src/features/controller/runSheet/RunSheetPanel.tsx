/**
 * features/controller/runSheet/RunSheetPanel.tsx
 * ---------------------------------------------------------------------------
 * THE RUN SHEET — the controller console's view of the server-side inject queue
 * (inject-queue story 07, issue #453; backend = story 06). STAFF world: dense,
 * dark COBRA operator chrome (`consoleChrome` tokens), COBRA buttons/fields,
 * FontAwesome icons, MUI 9 `sx`-only. It renders NO participant component and
 * carries NO participant skin — it must never be confusable with a participant view.
 *
 * THE FROZEN MOUNT SEAM. `RunSheetPanel` takes NO props (it is self-contained: it
 * reads the exercise scope, personas and the queue itself). It replaces demo-polish
 * C3's browser-only run sheet and keeps C3's seam name, so the orchestrator mounts
 * `<RunSheetPanel />` in `ControllerConsole`'s `runSheetSlot` unchanged. It needs an
 * `ExerciseContextProvider` and a React Query provider above it (the console route
 * has both).
 *
 * WHAT IT DOES (the ACs of story 07)
 *   - LIST: every item in `order` — T+N, a status chip (icon + text, never colour
 *     alone), title, first persona (+N for a burst), assignee, fired scenario time
 *     (with wall clock as a staff-only secondary), a failed item's server reason.
 *   - MINE / ALL + open/fired/all: filters, not locks (IQ-3). Remembered per exercise
 *     in `localStorage` (try/catch), default All.
 *   - AUTHOR LIVE: Add / Edit open an INLINE editor (`InjectItemEditor`), not a modal.
 *     Fired, firing and skipped items open read-only.
 *   - FIRE ON CUE: Fire / Fire next / Hold / Release / Skip / Unskip / Retry / Delete
 *     (inline confirm). NO confirmation dialog on Fire (CTL-034); it is disabled while
 *     in flight, so a double press fires once. Fire next = the first PENDING item in
 *     the CURRENT filter (held items are passed over). A 409 from a concurrent fire
 *     reads "Already fired by {name}". Under FREEZE Fire/Retry are disabled with the
 *     reason "World frozen"; under PAUSE INJECTS a banner says bursts are suspended
 *     and manual fire still works (IQ-5).
 *   - KEYBOARD: ↑/↓ select, F fire, N fire next, H hold/release, S skip/unskip, E edit,
 *     A add — IGNORED while focus is in an input/textarea/select/contenteditable, and
 *     while the editor is open; auto-repeat is ignored so holding N can never march
 *     through the script. Every action is also a named button. A visible "Keyboard"
 *     help lists them.
 *   - LIVE SYNC: `useInjectQueue` polls every ~3 s and re-reads right after this
 *     console's own action, so another controller's fire/hold/skip/edit appears within
 *     seconds and a burst's "firing n/m" advances live. Status changes are announced
 *     through a polite live region (`useStatusAnnouncer`).
 *
 * WHAT IT NEVER DOES. No `exerciseId` in any request (the server scopes — COR-001);
 * no telemetry for queue actions (the server emits the one `inject_action` event, so
 * there is no double count — IQ-8); no wall-clock "in fiction" time (the fired time
 * is scenario time, formatted in the exercise time zone); no raw HTML (React text).
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBolt,
  faCircleInfo,
  faKeyboard,
  faPause,
  faPlus,
  faRotateRight,
  faSnowflake,
  faTriangleExclamation,
  faXmark,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { useStaffPersonas } from '@/features/personas'
import { consoleChrome as chrome } from '../consoleChrome'
import { RunSheetButton } from './RunSheetButtons'
import { RunSheetRow } from './RunSheetRow'
import { InjectItemEditor, type EditorMode, type EditorSubmitResult } from './InjectItemEditor'
import { KeyboardHelp } from './KeyboardHelp'
import { InjectConflictError, InjectNotFoundError, InjectValidationError } from './injectErrors'
import { describeActionError, MESSAGES, type InjectAction } from './injectMessages'
import {
  canDelete,
  canFire,
  canHold,
  canRelease,
  canRetry,
  canSkip,
  canUnskip,
  filterItems,
  firstPending,
  isEditable,
  type RunSheetFilters,
} from './injectRules'
import { useInjectAssignees } from './useInjectAssignees'
import { CREATE_LOCK, useInjectQueue, type ActionOutcome } from './useInjectQueue'
import { useRunSheetFilters } from './useRunSheetFilters'
import { useStatusAnnouncer } from './useStatusAnnouncer'
import type { InjectItemDto, InjectItemWrite } from './types'

/** The panel. No props: the frozen seam name (see the module header). */
export function RunSheetPanel() {
  const { exerciseId } = useExerciseContext()
  // Keyed by exercise: a re-scope remounts the panel, so selection, an open editor and
  // the remembered filters can never carry one exercise's state into another (COR-001).
  return <RunSheetPanelBody key={exerciseId} exerciseId={exerciseId} />
}

export default RunSheetPanel

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type EditorState =
  | { readonly mode: 'create'; readonly key: number }
  | {
    readonly mode: 'edit' | 'view'
    readonly itemId: string
    readonly base: InjectItemDto
    readonly key: number
  }

/** True when the key event came from a control the user is typing in. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return target.closest('[contenteditable=""], [contenteditable="true"]') !== null
}

const byOrder = (a: InjectItemDto, b: InjectItemDto): number => a.order - b.order

interface SegmentOption<T extends string> {
  readonly value: T
  readonly label: string
}

interface SegmentedProps<T extends string> {
  readonly label: string
  readonly value: T
  readonly options: readonly SegmentOption<T>[]
  readonly onChange: (value: T) => void
}

/** A small toggle group: each option is a COBRA button with `aria-pressed` + a check when on. */
function Segmented<T extends string>({ label, value, options, onChange }: SegmentedProps<T>) {
  return (
    <Box role="group" aria-label={label} sx={{ display: 'inline-flex', gap: 0.5, alignItems: 'center' }}>
      {options.map(option => (
        <RunSheetButton
          key={option.value}
          label={option.label}
          ariaLabel={`${label}: ${option.label}`}
          pressed={option.value === value}
          testId={`filter-${option.value}`}
          onClick={() => onChange(option.value)}
        />
      ))}
    </Box>
  )
}

function Banner({
  icon,
  children,
  testId,
  live,
}: {
  readonly icon: typeof faPause
  readonly children: ReactNode
  readonly testId: string
  readonly live?: boolean
}) {
  return (
    <Box
      data-testid={testId}
      role={live ? 'status' : undefined}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: 1.25,
        py: 0.75,
        fontSize: 12,
        color: chrome.ink,
        border: `1px solid ${chrome.amber}`,
        borderRadius: '6px',
      }}
    >
      <FontAwesomeIcon icon={icon} color={chrome.amber} aria-hidden="true" />
      <Box sx={{ minWidth: 0, flex: 1 }}>{children}</Box>
    </Box>
  )
}

function RunSheetPanelBody({ exerciseId }: { readonly exerciseId: string }) {
  const { timeZone } = useExerciseContext()
  const queue = useInjectQueue()
  const { me, assignees, nameOf } = useInjectAssignees()
  const { personas, error: personasError } = useStaffPersonas()
  const [filters, updateFilters] = useRunSheetFilters(exerciseId)

  const reasonId = useId()
  const helpId = useId()

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const editorKey = useRef(0)
  // The latest polled items, for decisions made AFTER an await (a render closure would be stale).
  const latestItems = useRef<readonly InjectItemDto[]>([])
  const rowRefs = useRef(new Map<string, HTMLLIElement>())

  const { items, pauseTier } = queue
  const frozen = pauseTier === 'freeze'
  const injectsPaused = pauseTier === 'injects'
  const fireDisabledReason = frozen ? MESSAGES.worldFrozen : undefined

  const personasById = useMemo(() => new Map(personas.map(p => [p.id, p])), [personas])
  const personaOf = useCallback((id: string) => personasById.get(id), [personasById])
  const staffName = useCallback((id: string | undefined) => nameOf(id), [nameOf])

  const visible = useMemo(() => filterItems(items, filters, me), [items, filters, me])
  const nextPending = firstPending(visible)
  const selected = visible.find(item => item.id === selectedId)

  const announcement = useStatusAnnouncer(items, !queue.isLoading && !queue.isError)

  // ----- editor derivation -------------------------------------------------

  const liveEditing =
    editor && editor.mode !== 'create'
      ? items.find(item => item.id === editor.itemId)
      : undefined
  // Someone fired/skipped the item while it was open for edit: it is now read-only.
  const editorMode: EditorMode | undefined = !editor
    ? undefined
    : editor.mode === 'edit' && liveEditing && !isEditable(liveEditing.status)
      ? 'view'
      : editor.mode
  // A read-only view follows the LIVE polled item (so a burst's "Firing n/m" keeps advancing); an
  // edit form keeps the snapshot it was seeded from, so the controller's typing is never reset.
  const editorSnapshot =
    editor && editor.mode !== 'create'
      ? editorMode === 'view' && liveEditing
        ? liveEditing
        : editor.base
      : undefined

  useEffect(() => {
    latestItems.current = items
  }, [items])

  // The item being edited was deleted by another controller: close the editor, say so.
  useEffect(() => {
    if (!editor || editor.mode === 'create' || queue.isLoading) return
    if (!items.some(item => item.id === editor.itemId)) {
      setEditor(null)
      setNotice(MESSAGES.notFound)
    }
  }, [editor, items, queue.isLoading])

  // ----- actions -----------------------------------------------------------

  const report = useCallback(
    (action: InjectAction, outcome: ActionOutcome<unknown>): void => {
      if (outcome.status === 'error') setNotice(describeActionError(action, outcome.error, staffName))
      else if (outcome.status === 'ok') setNotice(null)
    },
    [staffName],
  )

  const fireItem = (item: InjectItemDto): void => {
    if (item.status === 'held') {
      setNotice(MESSAGES.heldFireHint)
      return
    }
    if (!canFire(item.status)) return
    if (frozen) {
      setNotice(`Fire is unavailable: ${MESSAGES.worldFrozen}`)
      return
    }
    void queue.fire(item.id).then(outcome => report('fire', outcome))
  }

  const fireNext = (): void => {
    if (frozen) {
      setNotice(`Fire is unavailable: ${MESSAGES.worldFrozen}`)
      return
    }
    if (!nextPending) {
      setNotice('Nothing pending to fire in this view.')
      return
    }
    setSelectedId(nextPending.id)
    void queue.fire(nextPending.id).then(outcome => report('fire', outcome))
  }

  const retryItem = (item: InjectItemDto): void => {
    if (!canRetry(item.status)) return
    if (frozen) {
      setNotice(`Retry is unavailable: ${MESSAGES.worldFrozen}`)
      return
    }
    void queue.retry(item.id).then(outcome => report('retry', outcome))
  }

  const toggleHold = (item: InjectItemDto): void => {
    if (canRelease(item.status)) void queue.release(item.id).then(outcome => report('release', outcome))
    else if (canHold(item.status)) void queue.hold(item.id).then(outcome => report('hold', outcome))
  }

  const toggleSkip = (item: InjectItemDto): void => {
    if (canUnskip(item.status)) void queue.unskip(item.id).then(outcome => report('unskip', outcome))
    else if (canSkip(item.status)) void queue.skip(item.id).then(outcome => report('skip', outcome))
  }

  const openEditor = (item: InjectItemDto): void => {
    setConfirmDeleteId(null)
    setEditor({
      mode: isEditable(item.status) ? 'edit' : 'view',
      itemId: item.id,
      base: item,
      key: ++editorKey.current,
    })
  }

  const openCreate = (): void => {
    setConfirmDeleteId(null)
    setEditor({ mode: 'create', key: ++editorKey.current })
  }

  const confirmDelete = (item: InjectItemDto): void => {
    if (!canDelete(item.status)) return
    setConfirmDeleteId(null)
    void queue.remove(item.id, item.version).then(outcome => report('delete', outcome))
  }

  const moveItem = (item: InjectItemDto, delta: -1 | 1): void => {
    const index = visible.findIndex(candidate => candidate.id === item.id)
    const neighbour = visible[index + delta]
    if (index === -1 || !neighbour) return
    // Swap the two rows' places in the FULL order (hidden rows stay where they are).
    const ids = [...items].sort(byOrder).map(candidate => candidate.id)
    const a = ids.indexOf(item.id)
    const b = ids.indexOf(neighbour.id)
    ids[a] = neighbour.id
    ids[b] = item.id
    void queue.reorder(ids).then(outcome => report('reorder', outcome))
  }

  /** Saves the editor: create, or update at the version the form was opened/reloaded at. */
  const submitEditor = async (write: InjectItemWrite): Promise<EditorSubmitResult> => {
    if (!editor) return { ok: false }
    const outcome =
      editor.mode === 'create'
        ? await queue.create(write)
        : await queue.update(editor.itemId, write, editor.base.version)

    if (outcome.status === 'busy') return { ok: false }
    if (outcome.status === 'ok') {
      setNotice(null)
      setSelectedId(outcome.value.id)
      setEditor(null)
      return { ok: true }
    }

    const error = outcome.error
    if (error instanceof InjectValidationError) {
      return { ok: false, form: error.detail || undefined, fields: error.fieldErrors }
    }
    if (error instanceof InjectConflictError && editor.mode !== 'create') {
      // The server's current copy: the 409's own `item`, else the polled one (a 409 without an
      // item must not leave us retrying a dead version forever).
      const known =
        error.item ?? latestItems.current.find(candidate => candidate.id === editor.itemId)

      // The version did NOT move: nobody changed the item, the server refused THIS EDIT (an edit
      // that would rewrite a published post, a kind change after release, a post being published
      // right now...). Say why on the form and KEEP the draft: reloading would throw the work away.
      if (known && known.version === editor.base.version) {
        return { ok: false, form: error.detail || 'The server refused this edit.' }
      }

      // The version moved (stale save, or the item stopped being editable): reload the fresh copy.
      setNotice(MESSAGES.changedByOthers)
      if (known) {
        setEditor({
          mode: isEditable(known.status) ? 'edit' : 'view',
          itemId: known.id,
          base: known,
          key: ++editorKey.current,
        })
      }
      return { ok: false }
    }
    if (error instanceof InjectNotFoundError) {
      setNotice(MESSAGES.notFound)
      setEditor(null)
      return { ok: false }
    }
    return { ok: false, form: describeActionError('save', error, staffName) }
  }

  // ----- keyboard ----------------------------------------------------------

  const focusRow = (id: string): void => {
    setSelectedId(id)
    rowRefs.current.get(id)?.focus()
  }

  const moveSelection = (delta: 1 | -1): void => {
    if (visible.length === 0) return
    const index = selected ? visible.findIndex(item => item.id === selected.id) : -1
    const nextIndex =
      index === -1
        ? delta === 1 ? 0 : visible.length - 1
        : Math.min(visible.length - 1, Math.max(0, index + delta))
    const next = visible[nextIndex]
    if (next) focusRow(next.id)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    // The editor owns the keyboard while it is open (its own Esc / Ctrl+Enter).
    if (editor) return
    if (event.metaKey || event.ctrlKey || event.altKey) return
    // Typing in a field must never trigger an action.
    if (isTypingTarget(event.target)) return

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    // Auto-repeat must never repeat an ACTION (holding N would march through the script).
    if (event.repeat || event.key.length !== 1) return

    const key = event.key.toLowerCase()
    if (key === 'n') {
      event.preventDefault()
      fireNext()
    } else if (key === 'a') {
      event.preventDefault()
      openCreate()
    } else if (selected) {
      if (key === 'f') {
        event.preventDefault()
        fireItem(selected)
      } else if (key === 'h') {
        event.preventDefault()
        toggleHold(selected)
      } else if (key === 's') {
        event.preventDefault()
        toggleSkip(selected)
      } else if (key === 'e') {
        event.preventDefault()
        openEditor(selected)
      }
    }
  }

  // ----- render ------------------------------------------------------------

  const setFilters = (patch: Partial<RunSheetFilters>): void => {
    updateFilters(patch)
    setNotice(null)
  }

  const editorBusy =
    queue.busyIds.has(CREATE_LOCK) ||
    (editor !== null && editor.mode !== 'create' && queue.busyIds.has(editor.itemId))
  const total = items.length
  const filteredOut = total > 0 && visible.length === 0

  return (
    <Box
      component="section"
      role="region"
      aria-label="Run sheet"
      data-testid="run-sheet-panel"
      onKeyDown={onKeyDown}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        bgcolor: chrome.panel,
        color: chrome.ink,
        fontFamily: "'Figtree', system-ui, sans-serif",
      }}
    >
      {/* Header + toolbar */}
      <Box sx={{ px: 1.75, py: 1.5, borderBottom: `1px solid ${chrome.line}`, flex: 'none' }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
          <Box component="h2" sx={{ m: 0, fontSize: 11, fontWeight: 800, letterSpacing: '0.12em' }}>
            RUN SHEET
          </Box>
          <Box
            component="span"
            data-testid="run-sheet-count"
            sx={{ fontSize: 11.5, color: chrome.inkMuted }}
          >
            {total === 0 ? 'no items' : `${visible.length} of ${total} shown`}
          </Box>
        </Box>

        <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
          <Segmented<RunSheetFilters['scope']>
            label="Assigned to"
            value={filters.scope}
            options={[
              { value: 'mine', label: 'Mine' },
              { value: 'all', label: 'All' },
            ]}
            onChange={scope => setFilters({ scope })}
          />
          <Segmented<RunSheetFilters['status']>
            label="Status"
            value={filters.status}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'fired', label: 'Fired' },
              { value: 'all', label: 'All' },
            ]}
            onChange={status => setFilters({ status })}
          />
        </Box>

        <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
          <RunSheetButton
            kind="primary"
            icon={faBolt}
            label="Fire next"
            ariaLabel="Fire next pending item"
            disabled={frozen || !nextPending}
            title={frozen ? MESSAGES.worldFrozen : !nextPending ? 'Nothing pending in this view' : undefined}
            describedBy={frozen ? reasonId : undefined}
            testId="fire-next"
            onClick={fireNext}
          />
          <RunSheetButton
            icon={faPlus}
            label="Add"
            ariaLabel="Add item"
            testId="add-item"
            onClick={openCreate}
          />
          <RunSheetButton
            icon={faKeyboard}
            label="Keyboard"
            ariaLabel="Keyboard shortcuts"
            pressed={helpOpen}
            testId="keyboard-toggle"
            onClick={() => setHelpOpen(open => !open)}
          />
          {nextPending ? (
            <Box
              component="span"
              data-testid="next-target"
              sx={{ fontSize: 11.5, color: chrome.inkMuted, minWidth: 0, overflowWrap: 'anywhere' }}
            >
              {`Next: ${nextPending.title}`}
            </Box>
          ) : null}
        </Box>
      </Box>

      {/* Banners */}
      <Box sx={{ px: 1.75, pt: 1, display: 'flex', flexDirection: 'column', gap: 1, flex: 'none' }}>
        {frozen ? (
          <Banner icon={faSnowflake} testId="banner-frozen" live>
            <span id={reasonId}>{MESSAGES.worldFrozen}</span>
            <span>{' — Fire and Retry are disabled until the world resumes.'}</span>
          </Banner>
        ) : null}
        {injectsPaused ? (
          <Banner icon={faPause} testId="banner-injects-paused" live>
            <span>{MESSAGES.injectsPaused}</span>
          </Banner>
        ) : null}
        {queue.connectionLost ? (
          <Banner icon={faTriangleExclamation} testId="banner-connection" live>
            {MESSAGES.connectionLost}
          </Banner>
        ) : null}
        {queue.isError ? (
          <Banner icon={faTriangleExclamation} testId="banner-load-failed" live>
            <span>{MESSAGES.loadFailed}</span>{' '}
            <RunSheetButton
              icon={faRotateRight}
              label="Try now"
              ariaLabel="Try loading the run sheet now"
              testId="reload"
              onClick={() => void queue.refetch()}
            />
          </Banner>
        ) : null}
        {/* The notice region exists from first render so a screen reader announces changes. */}
        <Box
          role="status"
          aria-live="polite"
          data-testid="run-sheet-notice"
          sx={{
            display: notice ? 'flex' : 'none',
            alignItems: 'center',
            gap: 1,
            px: 1.25,
            py: 0.75,
            fontSize: 12.5,
            border: `1px solid ${chrome.blue}`,
            borderRadius: '6px',
          }}
        >
          <FontAwesomeIcon icon={faCircleInfo} color={chrome.blue} aria-hidden="true" />
          <Box component="span" sx={{ flex: 1, minWidth: 0 }}>{notice}</Box>
          <RunSheetButton
            icon={faXmark}
            label="Dismiss"
            ariaLabel="Dismiss message"
            testId="notice-dismiss"
            onClick={() => setNotice(null)}
          />
        </Box>
        {helpOpen ? <KeyboardHelp id={helpId} /> : null}
      </Box>

      {/* Work area: the editor replaces the list while it is open (inline, never a modal) */}
      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.25 }}>
        {editor && editorMode ? (
          <InjectItemEditor
            key={`${editor.key}-${editorMode}`}
            mode={editorMode}
            item={editorSnapshot}
            liveItem={liveEditing}
            items={items}
            assignees={assignees}
            me={me}
            personas={personas}
            personasUnavailable={personasError !== undefined}
            busy={editorBusy}
            onSubmit={submitEditor}
            onCancel={() => setEditor(null)}
          />
        ) : queue.isLoading ? (
          <Box data-testid="run-sheet-loading" sx={{ p: 2, fontSize: 12, color: chrome.inkMuted }}>
            Loading the run sheet…
          </Box>
        ) : total === 0 && !queue.isError ? (
          <Box data-testid="run-sheet-empty" sx={{ p: 2, fontSize: 12.5, color: chrome.inkMuted }}>
            The run sheet is empty. Add a scripted post to get started.
          </Box>
        ) : filteredOut ? (
          <Box data-testid="run-sheet-filtered-empty" sx={{ p: 2, fontSize: 12.5, color: chrome.inkMuted }}>
            <span>Nothing matches this view. </span>
            <RunSheetButton
              icon={faRotateRight}
              label="Show everything"
              ariaLabel="Show everything: all items, all statuses"
              testId="show-all"
              onClick={() => setFilters({ scope: 'all', status: 'all' })}
            />
          </Box>
        ) : (
          <Box
            component="ul"
            role="list"
            aria-label="Run sheet items"
            sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1.25 }}
          >
            {visible.map((item, index) => (
              <RunSheetRow
                key={item.id}
                item={item}
                selected={selected?.id === item.id}
                tabStop={selected ? selected.id === item.id : index === 0}
                busy={queue.busyIds.has(item.id)}
                fireDisabledReason={fireDisabledReason}
                fireReasonId={reasonId}
                isMine={me !== undefined && item.assigneeId === me}
                personaOf={personaOf}
                nameOf={staffName}
                timeZone={timeZone}
                canMoveUp={index > 0}
                canMoveDown={index < visible.length - 1}
                confirmingDelete={confirmDeleteId === item.id}
                onSelect={() => setSelectedId(item.id)}
                onFire={() => fireItem(item)}
                onHold={() => toggleHold(item)}
                onRelease={() => toggleHold(item)}
                onSkip={() => toggleSkip(item)}
                onUnskip={() => toggleSkip(item)}
                onRetry={() => retryItem(item)}
                onOpen={() => openEditor(item)}
                onRequestDelete={() => setConfirmDeleteId(item.id)}
                onConfirmDelete={() => confirmDelete(item)}
                onCancelDelete={() => setConfirmDeleteId(null)}
                onMoveUp={() => moveItem(item, -1)}
                onMoveDown={() => moveItem(item, 1)}
                rowRef={element => {
                  if (element) rowRefs.current.set(item.id, element)
                  else rowRefs.current.delete(item.id)
                }}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* Polite live region: status changes (this console's and everyone else's) */}
      <Box
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="run-sheet-announcer"
        sx={{
          px: 1.75,
          py: 0.75,
          borderTop: `1px solid ${chrome.line}`,
          fontSize: 11,
          color: chrome.inkMuted,
          minHeight: 24,
          flex: 'none',
        }}
      >
        {announcement}
      </Box>
    </Box>
  )
}
