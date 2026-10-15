/**
 * core/emoji/EmojiPicker.tsx
 * ---------------------------------------------------------------------------
 * The shared emoji picker panel (demo-feedback story 12, DF-15). A search box over a
 * grid of NATIVE emoji from the bundled set (`emojiData.ts`) - no images, no fonts to
 * download, no network request of any kind (exercise networks are locked down).
 *
 * World-neutral. Its look comes from `EmojiPicker.module.css`, which reads
 * `--emoji-*` custom properties with neutral defaults; a host skins it by passing a
 * `className` that sets them (the Social composer maps them to its participant
 * `--pc-*` tokens; the persona composer in 12b will map them to COBRA). No MUI, no
 * COBRA import here, so it is safe on a participant path.
 *
 * KEYBOARD (NFR-001). Focus lands in the search box when the panel mounts and stays
 * there - the grid is a combobox-style listbox driven by `aria-activedescendant`:
 *   type            filter by name/keyword (the first match becomes active)
 *   arrow keys      move the active emoji through the grid (`gridNavigation.ts`)
 *   Enter           insert the active emoji (never submits the surrounding form;
 *                   ignored while an IME is composing)
 *   Escape          close; the host returns focus to the text field. Propagation
 *                   stops here, so a dialog around the composer stays open.
 *   Tab             leaves the picker, which closes it.
 * A pointer press on an emoji inserts it. No press inside the panel (other than on the
 * search box) moves focus; a press anywhere outside the picker and its trigger closes it.
 *
 * Screen readers hear the search box as a combobox, each emoji by its name ("thumbs
 * up"), and a polite count of matches while searching.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react'
import { EMOJI_CATEGORIES, EMOJI_COLUMNS, type EmojiCategory } from './emojiData'
import { isSearching, searchEmoji } from './emojiSearch'
import { isGridKey, moveInGrid } from './gridNavigation'
import styles from './EmojiPicker.module.css'

export interface EmojiPickerProps {
  /** `id` of the panel (the trigger's `aria-controls`). */
  readonly id?: string
  /** Called with the chosen emoji (Enter, or a press on an emoji). */
  readonly onPick: (emoji: string) => void
  /** Escape was pressed: the host closes the picker and refocuses the text field. */
  readonly onEscape: () => void
  /** Focus or a press went outside the picker: the host closes it quietly. */
  readonly onDismiss: () => void
  /** An element that is not "outside" (the trigger button). */
  readonly anchorRef?: RefObject<HTMLElement | null>
  /** Host skin: a class that sets the `--emoji-*` custom properties. */
  readonly className?: string
  /** Accessible name of the panel. */
  readonly label?: string
}

/** Flat index of each group's first emoji (groups are drawn back to back). */
function groupStarts(groups: readonly EmojiCategory[]): number[] {
  const starts: number[] = []
  let next = 0
  for (const group of groups) {
    starts.push(next)
    next += group.emoji.length
  }
  return starts
}

export function EmojiPicker({
  id,
  onPick,
  onEscape,
  onDismiss,
  anchorRef,
  className,
  label = 'Emoji picker',
}: EmojiPickerProps) {
  const baseId = useId()
  const listboxId = `${baseId}-listbox`
  const optionId = (index: number) => `${baseId}-option-${index}`
  const rootRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)

  const searching = isSearching(query)
  // Browsing: every emoji, in category order. Searching: the matches, in that order.
  const results = useMemo(() => searchEmoji(query), [query])
  const groups: readonly EmojiCategory[] = searching
    ? [{ id: 'results', label: 'Search results', emoji: results }]
    : EMOJI_CATEGORIES
  const activeIndex = results.length === 0 ? -1 : Math.min(active, results.length - 1)
  const activeOptionId = activeIndex >= 0 ? optionId(activeIndex) : undefined

  // Focus the search box when the panel opens.
  useEffect(() => {
    searchRef.current?.focus()
  }, [])

  // Keep the active emoji visible as the arrows move it through the scrolling grid.
  useEffect(() => {
    if (activeOptionId === undefined) return
    document.getElementById(activeOptionId)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeOptionId])

  // A press anywhere outside the picker (and its trigger) closes it.
  useEffect(() => {
    const handlePress = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || anchorRef?.current?.contains(target)) return
      onDismiss()
    }
    document.addEventListener('mousedown', handlePress)
    return () => document.removeEventListener('mousedown', handlePress)
  }, [anchorRef, onDismiss])

  const handleQuery = (event: ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value)
    setActive(0)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onEscape()
      return
    }
    if (event.key === 'Enter') {
      // Never let Enter submit the composer's form from inside the picker.
      event.preventDefault()
      event.stopPropagation()
      // An IME is composing (e.g. Japanese input in the search box): Enter commits
      // the composition, it does not pick.
      if (event.nativeEvent.isComposing) return
      const entry = results[activeIndex]
      if (entry !== undefined) onPick(entry.emoji)
      return
    }
    if (isGridKey(event.key)) {
      event.preventDefault()
      setActive(moveInGrid(activeIndex, event.key, results.length, EMOJI_COLUMNS))
    }
  }

  // Tab (or anything else) moving focus out of the picker closes it. A null
  // `relatedTarget` (focus fell nowhere) is left to the outside-press listener.
  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (!(next instanceof Node)) return
    if (rootRef.current?.contains(next) || anchorRef?.current?.contains(next)) return
    onDismiss()
  }

  // A press anywhere in the panel except the search box (an emoji, a heading, the
  // padding, a grid gap, the "no match" line) must not take focus: focus stays in the
  // search box, so Escape and the arrows keep working and a surrounding dialog never
  // receives it. The search box itself is left alone so its caret can be placed.
  const handleMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.target !== searchRef.current) event.preventDefault()
  }

  const starts = groupStarts(groups)

  return (
    <div
      ref={rootRef}
      id={id}
      role="dialog"
      aria-label={label}
      className={className === undefined ? styles.picker : `${styles.picker} ${className}`}
      data-testid="emoji-picker"
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onMouseDown={handleMouseDown}
    >
      <input
        ref={searchRef}
        type="text"
        className={styles.search}
        role="combobox"
        aria-label="Search emoji"
        aria-expanded="true"
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeOptionId}
        placeholder="Search emoji"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={handleQuery}
      />

      {/* tabIndex -1: Chrome makes a scrollable box a Tab stop of its own; the grid is
          driven from the search box, so Tab must leave the picker instead. */}
      <div
        id={listboxId}
        role="listbox"
        aria-label="Emoji"
        className={styles.list}
        tabIndex={-1}
      >
        {groups.map((group, groupIndex) => {
          const start = starts[groupIndex] ?? 0
          if (group.emoji.length === 0) return null
          return (
            <div key={group.id} role="group" aria-label={group.label} className={styles.group}>
              <div className={styles.heading} aria-hidden="true">{group.label}</div>
              <div className={styles.grid}>
                {group.emoji.map((entry, i) => {
                  const index = start + i
                  const isActive = index === activeIndex
                  return (
                    <div
                      key={entry.emoji}
                      id={optionId(index)}
                      role="option"
                      aria-selected={isActive}
                      aria-label={entry.name}
                      title={entry.name}
                      className={isActive ? `${styles.option} ${styles.active}` : styles.option}
                      onClick={() => onPick(entry.emoji)}
                    >
                      {entry.emoji}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      {searching && results.length === 0 && (
        <p className={styles.empty}>No emoji match that search.</p>
      )}

      <p className={styles.srOnly} role="status">
        {searching ? `${results.length} emoji found` : ''}
      </p>
    </div>
  )
}
