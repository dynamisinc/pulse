/**
 * features/controller/components/PersonaPicker.tsx
 * ---------------------------------------------------------------------------
 * The searchable, keyboard-first persona picker (feature: persona-operation,
 * story 02 "Fast persona switching"; CTL-002, D5-004/015/017/018; see
 * docs/features/persona-operation/02-fast-persona-switching.md).
 *
 * Per D5-017/018, "Personas" is a single toolstrip tool that opens the ⌘K
 * picker directly — there is no separate roster/"Cast" surface. This
 * component IS that picker's content, built standalone so the Wave-1
 * integration step can dock it into `console-shell/01`'s ⌘K
 * palette/persona-dock host PERSONAS section without this file importing
 * that host or the composer (parallel-build contract — this story does not
 * import `CommandPalette.tsx` / `personaDockHost.*`).
 *
 * ## Data source (COR-001 — exercise-scoped only)
 * Defaults to `usePersonas()` (`@/features/personas`) — the shipped,
 * exercise-scoped read seam. NEVER `SEEDED_PERSONAS`/`personaById` (those are
 * mock-fixture-only exports that fail open on a shipped path). The optional
 * `personas` prop exists so the picker is testable in isolation and so a
 * host that already resolved the exercise's cast (e.g. to share one fetch
 * across several dock sections) can hand it a list directly — it never
 * substitutes a different, non-exercise-scoped source.
 *
 * ## Keyboard flow (CTL-002 "<10s reply", NFR-001)
 * Type-to-filter by `displayName`/`handle`/`personaType` (via the search
 * input and the persona-type filter chips), ↑/↓ to move the highlighted row,
 * Enter to select — no pointer required. The full ⌘K → type name → Enter →
 * composer flow this component supports lives one step up (the palette host
 * opens this component and, once `onSelect` fires, would typically hand off
 * to the composer — that hand-off is the integration step's wiring, not this
 * file's job).
 *
 * ## Recents + pinned favorites (AC2)
 * Sourced from `useActivePersona()` (`../hooks/useActivePersona`) — the
 * shared state this story also owns. When the search box is empty and no
 * type filter is active, the list groups into PINNED / RECENT / ALL sections
 * (in that order) so a controller's most-likely next persona is closest to
 * hand; typing a query collapses straight to a flat, ranked RESULTS section.
 * Arrow-key navigation always moves through one flattened, visible order
 * regardless of which sections are showing.
 *
 * ## Selecting a persona
 * `selectPersona()` (from `useActivePersona()`) is called first, so the
 * shared active-persona state updates immediately — this is what lets the
 * sibling composer (persona-operation/01) and persona-context panel
 * (persona-operation/03) stories pick up the new persona without importing
 * this component. The optional `onSelect` prop fires AFTER that, purely so a
 * host (the ⌘K palette) can react to the selection itself (e.g. closing the
 * overlay) without this component needing to know anything about the host.
 *
 * World: staff (COBRA console) — `@/theme/styledComponents` (CobraTextField)
 * + FontAwesome only; never participant-surface chrome (XC-002). This
 * component never touches a post or the participant-visible feed — it is
 * pure staff-side selection state.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBriefcase,
  faBuilding,
  faCircleCheck,
  faCloudSun,
  faMagnifyingGlass,
  faNewspaper,
  faThumbtack,
  faTriangleExclamation,
  faUser,
  faUserTie,
} from '@fortawesome/free-solid-svg-icons'
import { usePersonas, type Persona, type PersonaType } from '@/features/personas'
import { CobraTextField } from '@/theme/styledComponents'
import { useActivePersona } from '../hooks/useActivePersona'

interface PersonaTypeFilterOption {
  value: PersonaType
  label: string
  icon: IconDefinition
}

/** Type-filter chip config, in the fixed display order the chips render. */
const PERSONA_TYPE_FILTERS: readonly PersonaTypeFilterOption[] = [
  { value: 'agency', label: 'Agency', icon: faBuilding },
  { value: 'news-outlet', label: 'News', icon: faNewspaper },
  { value: 'weather-scientific', label: 'Weather/Sci', icon: faCloudSun },
  { value: 'citizen', label: 'Citizen', icon: faUser },
  { value: 'influencer', label: 'Influencer', icon: faUserTie },
  { value: 'business', label: 'Business', icon: faBriefcase },
  { value: 'bad-actor', label: 'Bad actor', icon: faTriangleExclamation },
]

/** The "no type filter applied" sentinel — distinct from any real `PersonaType`. */
type TypeFilter = PersonaType | 'all'

interface PickerRow {
  persona: Persona
  pinned: boolean
}

interface PickerSection {
  key: string
  label: string
  rows: PickerRow[]
}

function matchesQuery(persona: Persona, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true
  return (
    persona.displayName.toLowerCase().includes(normalizedQuery) ||
    persona.handle.toLowerCase().includes(normalizedQuery)
  )
}

export interface PersonaPickerProps {
  /**
   * Exercise-scoped candidate personas. Defaults to `usePersonas()`. Pass
   * explicitly to test this component in isolation, or when a host has
   * already resolved the exercise's cast — never a substitute for the
   * exercise-scoped read seam on a shipped path.
   */
  personas?: readonly Persona[]
  /** Initial search text (uncontrolled after mount unless `onQueryChange` is supplied). */
  query?: string
  /** Notified on every keystroke, for a host that wants to mirror the query elsewhere. */
  onQueryChange?: (query: string) => void
  /**
   * Called AFTER the persona has been set active via `useActivePersona()`.
   * Optional — lets a host (the ⌘K palette) react to the selection (e.g.
   * close itself) without this component knowing about the host.
   */
  onSelect?: (persona: Persona) => void
  /** Autofocus the search input on mount (the palette-opened case). Defaults `true`. */
  autoFocus?: boolean
}

/**
 * The searchable persona picker. See module header for the full contract.
 * Requires an `<ActivePersonaProvider>` ancestor (via `useActivePersona()`).
 */
export function PersonaPicker({
  personas: personasProp,
  query: initialQuery,
  onQueryChange,
  onSelect,
  autoFocus = true,
}: PersonaPickerProps) {
  const { personas: resolvedPersonas } = usePersonas()
  const candidatePersonas = personasProp ?? resolvedPersonas

  const {
    activePersona,
    recentPersonaIds,
    pinnedPersonaIds,
    selectPersona,
    togglePinned,
    isPinned,
  } = useActivePersona()

  const [searchQuery, setSearchQuery] = useState(initialQuery ?? '')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const isBrowsing = normalizedQuery === '' && typeFilter === 'all'

  const filteredPersonas = useMemo(
    () => candidatePersonas.filter(persona => (
      (typeFilter === 'all' || persona.personaType === typeFilter) &&
      matchesQuery(persona, normalizedQuery)
    )),
    [candidatePersonas, typeFilter, normalizedQuery],
  )

  const sections = useMemo<PickerSection[]>(() => {
    if (!isBrowsing) {
      return [{
        key: 'results',
        label: 'Results',
        rows: filteredPersonas.map(persona => ({ persona, pinned: isPinned(persona.id) })),
      }]
    }

    const byId = new Map(candidatePersonas.map(persona => [persona.id, persona]))
    const pinnedRows: PickerRow[] = pinnedPersonaIds
      .map(id => byId.get(id))
      .filter((persona): persona is Persona => persona !== undefined)
      .map(persona => ({ persona, pinned: true }))
    const pinnedIdSet = new Set(pinnedPersonaIds)

    const recentRows: PickerRow[] = recentPersonaIds
      .map(id => byId.get(id))
      .filter((persona): persona is Persona => persona !== undefined)
      .filter(persona => !pinnedIdSet.has(persona.id))
      .map(persona => ({ persona, pinned: false }))
    const recentIdSet = new Set(recentRows.map(row => row.persona.id))

    const allRows: PickerRow[] = candidatePersonas
      .filter(persona => !pinnedIdSet.has(persona.id) && !recentIdSet.has(persona.id))
      .map(persona => ({ persona, pinned: false }))

    const result: PickerSection[] = []
    if (pinnedRows.length > 0) result.push({ key: 'pinned', label: 'Pinned', rows: pinnedRows })
    if (recentRows.length > 0) result.push({ key: 'recent', label: 'Recent', rows: recentRows })
    result.push({ key: 'all', label: 'All personas', rows: allRows })
    return result
  }, [
    isBrowsing,
    filteredPersonas,
    candidatePersonas,
    pinnedPersonaIds,
    recentPersonaIds,
    isPinned,
  ])

  const flatRows = useMemo(() => sections.flatMap(section => section.rows), [sections])

  // The visible list changes shape on every keystroke/filter change — reset
  // the highlight to the top rather than let it point at a row that just
  // scrolled out of the filtered set.
  useEffect(() => {
    setHighlightedIndex(0)
  }, [flatRows.length, typeFilter, normalizedQuery])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const handleQueryChange = useCallback((value: string) => {
    setSearchQuery(value)
    onQueryChange?.(value)
  }, [onQueryChange])

  const handleSelect = useCallback((persona: Persona) => {
    selectPersona(persona)
    onSelect?.(persona)
  }, [selectPersona, onSelect])

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex(prev => Math.min(prev + 1, Math.max(flatRows.length - 1, 0)))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex(prev => Math.max(prev - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const row = flatRows[highlightedIndex]
      if (row) handleSelect(row.persona)
    }
  }, [flatRows, highlightedIndex, handleSelect])

  let rowCursor = -1

  return (
    <Stack
      data-testid="persona-picker"
      role="combobox"
      aria-expanded="true"
      aria-owns="persona-picker-listbox"
      sx={{ gap: 1.25, width: '100%' }}
    >
      <CobraTextField
        inputRef={inputRef}
        placeholder="Search personas by name, handle, or type…"
        size="small"
        fullWidth
        autoComplete="off"
        value={searchQuery}
        onChange={event => handleQueryChange(event.target.value)}
        onKeyDown={handleKeyDown}
        slotProps={{
          input: {
            startAdornment: (
              <FontAwesomeIcon icon={faMagnifyingGlass} size="xs" style={{ marginRight: 8, opacity: 0.6 }} />
            ),
          },
          // Native <input> attributes — MUST go through `htmlInput` rather
          // than as top-level TextField props: TextField spreads unrecognized
          // top-level props onto the ROOT FormControl div, not the actual
          // <input>, so `data-testid`/`aria-controls`/`aria-activedescendant`
          // given at the top level would land on the wrong element (this bit
          // a first draft of this component's own tests — `data-testid`
          // resolved to the wrapper div, not something `userEvent.type()`
          // could type into).
          htmlInput: {
            'data-testid': 'persona-picker-search',
            'aria-label': 'Search personas',
            'aria-controls': 'persona-picker-listbox',
            'aria-activedescendant': flatRows[highlightedIndex]
              ? `persona-picker-option-${flatRows[highlightedIndex].persona.id}`
              : undefined,
          },
        }}
      />

      <Stack
        direction="row"
        data-testid="persona-picker-type-filters"
        sx={{ flexWrap: 'wrap', gap: 0.75 }}
      >
        <TypeFilterChip
          label="All types"
          icon={undefined}
          active={typeFilter === 'all'}
          onClick={() => setTypeFilter('all')}
        />
        {PERSONA_TYPE_FILTERS.map(filter => (
          <TypeFilterChip
            key={filter.value}
            label={filter.label}
            icon={filter.icon}
            active={typeFilter === filter.value}
            onClick={() => setTypeFilter(prev => (prev === filter.value ? 'all' : filter.value))}
          />
        ))}
      </Stack>

      <Box
        component="ul"
        id="persona-picker-listbox"
        role="listbox"
        aria-label="Personas"
        data-testid="persona-picker-list"
        sx={{ m: 0, p: 0, listStyle: 'none', maxHeight: 360, overflowY: 'auto' }}
      >
        {flatRows.length === 0 && (
          <Typography
            data-testid="persona-picker-empty"
            sx={{ px: 1, py: 1.5, fontSize: 12.5, color: 'text.secondary' }}
          >
            No personas match this search.
          </Typography>
        )}

        {sections.map(section => (
          section.rows.length === 0 ? null : (
            <Box key={section.key} component="li" sx={{ listStyle: 'none' }}>
              <Typography
                aria-hidden="true"
                data-testid={`persona-picker-section-${section.key}`}
                sx={{
                  px: 1,
                  pt: 1,
                  pb: 0.5,
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: 'text.secondary',
                }}
              >
                {section.label.toUpperCase()}
              </Typography>
              <Box component="ul" sx={{ m: 0, p: 0, listStyle: 'none' }}>
                {section.rows.map(row => {
                  rowCursor += 1
                  const index = rowCursor
                  return (
                    <PersonaPickerRow
                      key={row.persona.id}
                      row={row}
                      highlighted={index === highlightedIndex}
                      isActive={activePersona?.id === row.persona.id}
                      onSelect={() => handleSelect(row.persona)}
                      onTogglePin={() => togglePinned(row.persona.id)}
                    />
                  )
                })}
              </Box>
            </Box>
          )
        ))}
      </Box>
    </Stack>
  )
}

interface TypeFilterChipProps {
  label: string
  icon: IconDefinition | undefined
  active: boolean
  onClick: () => void
}

function TypeFilterChip({ label, icon, active, onClick }: TypeFilterChipProps) {
  return (
    <Box
      component="button"
      type="button"
      data-testid={`persona-picker-type-filter-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
      aria-pressed={active}
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.375,
        borderRadius: '999px',
        border: '1px solid',
        borderColor: active ? 'primary.main' : 'divider',
        bgcolor: active ? 'action.selected' : 'transparent',
        color: active ? 'primary.main' : 'text.secondary',
        fontSize: 11,
        fontWeight: 700,
        cursor: 'pointer',
        lineHeight: 1.4,
      }}
    >
      {icon && <FontAwesomeIcon icon={icon} size="xs" />}
      {label}
    </Box>
  )
}

interface PersonaPickerRowProps {
  row: PickerRow
  highlighted: boolean
  isActive: boolean
  onSelect: () => void
  onTogglePin: () => void
}

function PersonaPickerRow({
  row,
  highlighted,
  isActive,
  onSelect,
  onTogglePin,
}: PersonaPickerRowProps) {
  const { persona, pinned } = row

  return (
    <Stack
      component="li"
      id={`persona-picker-option-${persona.id}`}
      data-testid={`persona-picker-option-${persona.id}`}
      role="option"
      aria-selected={highlighted}
      direction="row"
      onClick={onSelect}
      sx={{
        alignItems: 'center',
        gap: 1,
        px: 1,
        py: 0.75,
        cursor: 'pointer',
        borderRadius: 1,
        bgcolor: highlighted ? 'action.hover' : 'transparent',
        border: highlighted ? '1px solid' : '1px solid transparent',
        borderColor: highlighted ? 'primary.main' : 'transparent',
      }}
    >
      <Box
        aria-hidden="true"
        sx={{
          width: 28,
          height: 28,
          flexShrink: 0,
          borderRadius: '50%',
          bgcolor: persona.avatarColor,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 800,
        }}
      >
        {persona.initials}
      </Box>

      <Stack sx={{ flex: 1, minWidth: 0, gap: '1px' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 12.5,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {persona.displayName}
          </Typography>
          {persona.verified && (
            <FontAwesomeIcon
              icon={faCircleCheck}
              size="xs"
              color="#2D9CDB"
              aria-label="Verified"
            />
          )}
          {isActive && (
            <Typography
              data-testid={`persona-picker-active-badge-${persona.id}`}
              sx={{
                fontSize: 9.5,
                fontWeight: 800,
                letterSpacing: '0.06em',
                color: 'success.main',
                border: '1px solid',
                borderColor: 'success.main',
                borderRadius: '4px',
                px: 0.5,
              }}
            >
              ACTIVE
            </Typography>
          )}
        </Stack>
        <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>
          @{persona.handle} · {persona.personaType}
        </Typography>
      </Stack>

      <Box
        component="button"
        type="button"
        data-testid={`persona-picker-pin-${persona.id}`}
        aria-pressed={pinned}
        aria-label={pinned ? `Unpin ${persona.displayName}` : `Pin ${persona.displayName}`}
        onClick={event => {
          event.stopPropagation()
          onTogglePin()
        }}
        sx={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.375,
          border: 'none',
          background: 'none',
          cursor: 'pointer',
          color: pinned ? 'primary.main' : 'text.disabled',
          fontSize: 10,
          fontWeight: 700,
        }}
      >
        <FontAwesomeIcon icon={faThumbtack} size="xs" />
        {pinned ? 'Pinned' : 'Pin'}
      </Box>
    </Stack>
  )
}
