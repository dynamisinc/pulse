/**
 * features/controller/media/MediaLibraryPicker.tsx
 * ---------------------------------------------------------------------------
 * The staff MEDIA-LIBRARY PICKER (demo-polish C1, story 17 "Attach from the
 * library"; CTL-001, NFR-001). STAFF world (COBRA): used by the controller's
 * post-as-persona composer AND imported by C3's run sheet (implementation.md
 * section 4.1) - so its props are the FROZEN contract of section 1.11, exactly:
 *
 *   interface MediaLibraryPickerProps {
 *     kind?: MediaKind                 // restrict to images or videos (locks the filter)
 *     max: number                      // most items that may be selected
 *     selectedIds: string[]            // CONTROLLED selection, in pick order
 *     onChange(ids: string[]): void    // the next selection
 *   }
 *
 * It lists the exercise's staff library (`useMediaLibrary` -> `GET
 * /api/staff/media`, newest first; poster images are excluded by the server) as a
 * dense, keyboard-operable GRID: each tile shows the thumbnail (a video shows its
 * POSTER, and keeps it when picked - DP-3), the FILE NAME and `uploadedAtScenario`
 * rendered in scenario time in the exercise zone (COR-053). File name and upload
 * time are staff-only library metadata; they never reach a participant payload.
 *
 * KEYBOARD (NFR-001) - the WAI-ARIA multi-select listbox pattern:
 *   - the grid is ONE tab stop (roving tabindex); Arrow keys move between tiles
 *     (Left/Right by one, Up/Down by a row), Home / End jump to the first / last;
 *   - Space or Enter toggles the focused tile; a click does the same;
 *   - the All / Images / Videos filter is a native radio group (arrow keys built in).
 * State is never colour-only: a selected tile has a check + its pick-order number +
 * a thick border (`aria-selected`), an unavailable tile is dimmed AND the reason is
 * said in the polite status line ("2 of 4 selected - Limit reached ...").
 *
 * SELECTION RULES (the same ones the server enforces, `attachmentRules.ts`): at most
 * `max` items; never mix images and a video; at most 1 video. With `max === 1` the
 * picker is SINGLE-SELECT: a new pick replaces the previous one (so a one-slot host,
 * e.g. an avatar chooser, never meets a dead "limit reached" tile). A tile the rules forbid
 * stays focusable (`aria-disabled`) so a keyboard user can discover why - activating
 * it announces the reason instead of silently doing nothing.
 *
 * EXERCISE SCOPE (COR-001): the library query is keyed by the session's exercise and
 * the request carries no exercise id - the server resolves scope from the staff
 * session. Needs a `QueryClientProvider` (it is a `useQuery`).
 *
 * SAFETY (NFR-004 / XC-009): thumbnail URLs are opaque strings from the wire, so each
 * passes the shared media-URL allow-list before it reaches an `<img src>`; a rejected
 * or broken one falls back to an icon tile.
 */

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faFilm, faImage, faPlay } from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton } from '@/theme/styledComponents'
import { formatScenarioTime } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { useMediaLibrary, type MediaKind, type StaffMediaAssetView } from '@/core/media'
import { formatDuration } from '@/features/social/components/media/formatDuration'
import { safeImageUrl } from '@/features/social/utils/safeImageUrl'
import { MAX_VIDEOS, MIXED_MEDIA_MESSAGE, TOO_MANY_VIDEOS_MESSAGE } from './attachmentRules'
import styles from './MediaLibraryPicker.module.css'

/** The frozen props of the picker (implementation.md section 1.11). */
export interface MediaLibraryPickerProps {
  kind?: MediaKind
  max: number
  selectedIds: string[]
  onChange(ids: string[]): void
}

/** Tiles per row - the Up / Down arrow step. Must match the CSS grid's column count. */
const COLUMNS = 3

type Filter = 'all' | MediaKind

const FILTERS: ReadonlyArray<{ readonly value: Filter; readonly label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'image', label: 'Images' },
  { value: 'video', label: 'Videos' },
]

const NO_ASSETS: readonly StaffMediaAssetView[] = []

/** The staff media-library picker. See the module header for the contract. */
export function MediaLibraryPicker({ kind, max, selectedIds, onChange }: MediaLibraryPickerProps) {
  const { exerciseId, timeZone } = useExerciseContext()
  const groupName = useId()

  const [filter, setFilter] = useState<Filter>('all')
  const effectiveFilter: Filter = kind ?? filter
  const requestedKind: MediaKind | undefined = kind ?? (filter === 'all' ? undefined : filter)
  const library = useMediaLibrary(requestedKind)

  // Each filter (and a host-imposed `kind`) is its own query, so switching one starts a
  // fresh request. Until it lands, keep showing the LAST list narrowed to the requested
  // kind instead of unmounting the grid: otherwise the tile you just picked disappears
  // and keyboard focus falls to <body> every time the host narrows `kind` after your
  // first pick. The carried list is only ever this exercise's (COR-001).
  const [lastList, setLastList] = useState<
    { readonly exerciseId: string; readonly assets: readonly StaffMediaAssetView[] } | undefined
  >(undefined)
  useEffect(() => {
    if (library.data !== undefined) setLastList({ exerciseId, assets: library.data })
  }, [library.data, exerciseId])
  const carried = useMemo(
    () => {
      if (lastList === undefined || lastList.exerciseId !== exerciseId) return NO_ASSETS
      return lastList.assets.filter(
        asset => requestedKind === undefined || asset.kind === requestedKind,
      )
    },
    [lastList, exerciseId, requestedKind],
  )
  const assets = library.data ?? carried

  // The kind of every asset this picker has shown, so a selected asset's kind is still
  // known after the filter hides it (the no-mixing rule needs the SELECTION's kind).
  const [seenKinds, setSeenKinds] = useState<Readonly<Record<string, MediaKind>>>({})
  useEffect(() => {
    setSeenKinds(previous => {
      let changed = false
      const next = { ...previous }
      for (const asset of assets) {
        if (next[asset.id] !== asset.kind) {
          next[asset.id] = asset.kind
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [assets])

  const kindOf = (id: string): MediaKind | undefined =>
    assets.find(asset => asset.id === id)?.kind ?? seenKinds[id]
  const selectionKind: MediaKind | undefined = selectedIds.length === 0
    ? undefined
    : selectedIds.map(kindOf).find(found => found !== undefined) ?? kind

  // The reason the last refused pick gave. It is stale as soon as the selection or the
  // limit changes (e.g. the composer removed an item), so it is dropped then.
  const [hint, setHint] = useState<string | undefined>(undefined)
  const selectionSignature = selectedIds.join('|')
  useEffect(() => {
    setHint(undefined)
  }, [selectionSignature, max])
  const [brokenIds, setBrokenIds] = useState<ReadonlySet<string>>(new Set())

  // Roving tabindex: the active tile is the grid's one tab stop.
  const [activeId, setActiveId] = useState<string | undefined>(undefined)
  const tabStopId = assets.some(asset => asset.id === activeId) ? activeId : assets[0]?.id
  const tileRefs = useRef<Array<HTMLDivElement | null>>([])

  /** Why `asset` cannot be added right now, or `undefined` when it can. */
  const unavailableReason = (asset: StaffMediaAssetView): string | undefined => {
    if (selectedIds.includes(asset.id)) return undefined
    // Single-select (an avatar / banner chooser, or a host with one slot left): a new
    // pick REPLACES the old one, so nothing is ever "unavailable".
    if (max === 1) return undefined
    if (selectedIds.length >= max) {
      return max <= 0
        ? 'No more media can be added to this post.'
        : `Limit reached (${max}). Deselect one to pick another.`
    }
    if (selectionKind !== undefined && asset.kind !== selectionKind) return MIXED_MEDIA_MESSAGE
    if (asset.kind === 'video' && selectedIds.length >= MAX_VIDEOS) return TOO_MANY_VIDEOS_MESSAGE
    return undefined
  }

  const toggle = (asset: StaffMediaAssetView) => {
    if (selectedIds.includes(asset.id)) {
      setHint(undefined)
      onChange(selectedIds.filter(id => id !== asset.id))
      return
    }
    const reason = unavailableReason(asset)
    if (reason !== undefined) {
      setHint(reason)
      return
    }
    setHint(undefined)
    onChange(max === 1 ? [asset.id] : [...selectedIds, asset.id])
  }

  const focusTile = (index: number) => {
    const clamped = Math.min(assets.length - 1, Math.max(0, index))
    tileRefs.current[clamped]?.focus()
  }

  const handleTileKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    asset: StaffMediaAssetView,
    index: number,
  ) => {
    // Ctrl/Cmd/Alt chords belong to the host form (Ctrl/Cmd+Enter fires the post).
    if (event.ctrlKey || event.metaKey || event.altKey) return
    switch (event.key) {
      case ' ':
      case 'Enter':
        event.preventDefault()
        toggle(asset)
        return
      case 'ArrowRight':
        event.preventDefault()
        focusTile(index + 1)
        return
      case 'ArrowLeft':
        event.preventDefault()
        focusTile(index - 1)
        return
      case 'ArrowDown':
        event.preventDefault()
        focusTile(index + COLUMNS <= assets.length - 1 ? index + COLUMNS : index)
        return
      case 'ArrowUp':
        event.preventDefault()
        focusTile(index - COLUMNS >= 0 ? index - COLUMNS : index)
        return
      case 'Home':
        event.preventDefault()
        focusTile(0)
        return
      case 'End':
        event.preventDefault()
        focusTile(assets.length - 1)
        return
      default:
    }
  }

  return (
    <div className={styles.picker} data-testid="media-library-picker">
      <fieldset className={styles.filter}>
        <legend className={styles.srOnly}>Filter the media library</legend>
        {FILTERS.map(option => {
          const checked = effectiveFilter === option.value
          const locked = kind !== undefined && !checked
          const className = [
            styles.filterOption,
            checked ? styles.filterOptionChecked : '',
            locked ? styles.filterOptionDisabled : '',
          ].filter(Boolean).join(' ')
          return (
            <label key={option.value} className={className}>
              <input
                type="radio"
                name={groupName}
                value={option.value}
                checked={checked}
                disabled={locked}
                onChange={() => setFilter(option.value)}
              />
              <span>{option.label}</span>
            </label>
          )
        })}
      </fieldset>

      {library.isPending && assets.length === 0 && (
        <p className={styles.message} role="status" data-testid="media-library-loading">
          Loading the media library...
        </p>
      )}

      {library.isError && (
        <div className={`${styles.message} ${styles.messageError}`} role="alert">
          <span>The media library could not be loaded.</span>
          <CobraLinkButton type="button" size="small" onClick={() => void library.refetch()}>
            Retry
          </CobraLinkButton>
        </div>
      )}

      {library.isSuccess && assets.length === 0 && (
        <p className={styles.message} role="status" data-testid="media-library-empty">
          {effectiveFilter === 'all'
            ? 'The library is empty. Upload a file to add it here.'
            : `No ${effectiveFilter === 'image' ? 'images' : 'videos'} in the library.`}
        </p>
      )}

      {assets.length > 0 && (
        <div
          role="listbox"
          aria-label="Media library"
          aria-multiselectable="true"
          className={styles.grid}
          data-testid="media-library-grid"
        >
          {assets.map((asset, index) => {
            const selected = selectedIds.includes(asset.id)
            const unavailable = !selected && unavailableReason(asset) !== undefined
            const order = selectedIds.indexOf(asset.id) + 1
            const thumbUrl = safeImageUrl(asset.kind === 'video' ? asset.posterUrl : asset.url)
            const showImage = thumbUrl !== undefined && !brokenIds.has(asset.id)
            const duration = asset.kind === 'video' && asset.durationSec !== undefined
              ? formatDuration(asset.durationSec)
              : undefined
            const uploaded = formatScenarioTime(asset.uploadedAtScenario, timeZone, {
              format: 'absolute',
            })
            const label = [
              asset.fileName,
              asset.kind,
              ...(duration !== undefined ? [duration] : []),
              `uploaded ${uploaded}`,
            ].join(', ')
            const className = [
              styles.tile,
              selected ? styles.tileSelected : '',
              unavailable ? styles.tileUnavailable : '',
            ].filter(Boolean).join(' ')

            return (
              <div
                key={asset.id}
                ref={element => {
                  tileRefs.current[index] = element
                }}
                role="option"
                aria-selected={selected}
                aria-disabled={unavailable ? true : undefined}
                aria-label={label}
                tabIndex={asset.id === tabStopId ? 0 : -1}
                className={className}
                data-testid="media-tile"
                data-media-id={asset.id}
                onClick={() => toggle(asset)}
                onFocus={() => setActiveId(asset.id)}
                onKeyDown={event => handleTileKeyDown(event, asset, index)}
              >
                <span className={styles.thumb}>
                  {showImage ? (
                    <img
                      src={thumbUrl}
                      alt=""
                      loading="lazy"
                      draggable={false}
                      onError={() => setBrokenIds(current => new Set(current).add(asset.id))}
                    />
                  ) : (
                    <FontAwesomeIcon icon={asset.kind === 'video' ? faFilm : faImage} />
                  )}
                  {asset.kind === 'video' && (
                    <span className={styles.kindBadge}>
                      <FontAwesomeIcon icon={faPlay} />
                      VIDEO{duration !== undefined ? ` ${duration}` : ''}
                    </span>
                  )}
                  {selected && (
                    <span className={styles.order} data-testid="media-tile-order">
                      <FontAwesomeIcon icon={faCheck} />
                      {order}
                    </span>
                  )}
                </span>
                <span className={styles.name} title={asset.fileName}>{asset.fileName}</span>
                <time className={styles.when} dateTime={asset.uploadedAtScenario}>{uploaded}</time>
              </div>
            )
          })}
        </div>
      )}

      <p
        className={styles.status}
        role="status"
        aria-live="polite"
        data-testid="media-library-status"
      >
        {selectedIds.length} of {max} selected{hint !== undefined ? ` - ${hint}` : ''}
      </p>
    </div>
  )
}
