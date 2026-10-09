/**
 * features/controller/console/CommandPalette.tsx
 * ---------------------------------------------------------------------------
 * The controller console's ⌘K / Ctrl+K palette shell (feature: console-shell,
 * story 01 — "Toolstrip + flyouts"; D5-004/015/017/018; see
 * docs/features/console-shell/01-toolstrip-flyouts.md AC "⌘K command palette").
 *
 * A keyboard-first, searchable, focus-TRAPPED overlay whose PERSONAS section is
 * the entry point to the "post as persona" flow. It ships the palette shell +
 * the PERSONAS section as a search/SELECT surface only — the searchable
 * persona LIST itself is `persona-operation/02`'s, rendered into the
 * `renderPersonaResults` slot by the console route (an INPUT contract, never an
 * import of `persona-operation`'s files).
 *
 * ## Honest about what it does (demo-polish C4)
 * PERSONAS is the ONLY section and there are no commands: the search field's
 * placeholder and accessible name say "Search personas", never "personas and
 * commands", and there is no dead/placeholder entry. When a real command set
 * exists it adds its own section; the focus trap, Esc and focus return below
 * are independent of that.
 *
 * ## A11y (NFR-001) — fully keyboard-operable, no pointer required
 * `role="dialog"` + `aria-modal` + `aria-label`. On open, focus moves to the
 * search field; Tab/Shift+Tab are TRAPPED inside the panel; Esc closes; on
 * close, focus returns to whatever opened the palette (the ⌘K-focused element
 * or the "Personas" toolstrip button), captured on open. Every step
 * (open → type → select) is reachable without a pointer.
 *
 * ## Stands aside for other modals (core/a11y/modalPriority.ts)
 * The palette is a channel-level layer, so it follows the product's one-way modal rule:
 * while any OTHER `[aria-modal="true"]` element is mounted (a dialog opened over it, a
 * shell-level overlay that declares itself modal) it does not fight for focus - no Tab cycling,
 * and no focus-on-open. (Its trap is a Tab handler on its own panel, not a pull-back, so it
 * cannot ping-pong with MUI's trap; this keeps a dialog rendered inside the palette's
 * React tree from having its Tab presses hijacked.) The console's ⌘K handler additionally
 * refuses to OPEN the palette over another modal - see `ControllerConsole`.
 *
 * ## What this file does NOT own
 * The ⌘K key binding + open/close state live in `ControllerConsole` (the
 * composition owner); this component is a controlled overlay (`open`/`onClose`).
 * The persona list + persona content live in `persona-operation`.
 *
 * World: staff (COBRA/Cadence) — `@/theme/styledComponents` (CobraTextField)
 * + FontAwesome; never a participant surface (XC-002).
 */

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faMagnifyingGlass, faMasksTheater } from '@fortawesome/free-solid-svg-icons'
import { hasOtherModalMounted } from '@/core/a11y/modalPriority'
import { CobraTextField } from '@/theme/styledComponents'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'

/** Focusable-element selector for the focus trap (visible, tabbable nodes). */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** The palette's own panel, so focus tracking can tell "inside the palette" from "before it". */
const PALETTE_SELECTOR = '[data-command-palette]'

/** True when keyboard focus has nowhere useful to be: on <body>, nothing, or a detached node. */
function focusIsLost(): boolean {
  const active = document.activeElement
  return active === null || active === document.body || !active.isConnected
}

/**
 * The elements focus may return to, best first, when the opener is gone by the time the palette
 * closes. Captured when it OPENS, while they all still exist:
 *  1. the control the opener's layer names as its home (`data-focus-return-to="<id>"` on the
 *     layer: a popup that closes itself when focus leaves it points back at its own button);
 *  2. the Live world row that control sits in;
 *  3. the console root (`data-console-root`), a stable region around everything.
 */
function focusFallbacks(opener: Element | null, panel: Element | null): readonly Element[] {
  const found: Element[] = []
  const homeId = opener?.closest('[data-focus-return-to]')?.getAttribute('data-focus-return-to')
  const home = homeId ? document.getElementById(homeId) : null
  if (home !== null) {
    found.push(home)
    const row = home.closest('[data-live-world-row]')
    if (row !== null) found.push(row)
  }
  const root = panel?.closest('[data-console-root]') ?? document.querySelector('[data-console-root]')
  if (root !== null) found.push(root)
  return found
}

/**
 * The context the PERSONAS-section slot receives: the live search `query` and
 * an `onSelectPersona` callback that hands the chosen persona back to the
 * console (→ persona-dock host) and closes the palette.
 */
export interface CommandPalettePersonaSlot {
  /** The live search text — `persona-operation/02` filters its list by this. */
  query: string
  /** Called with the chosen persona id when a persona is selected. */
  onSelectPersona: (personaId: string) => void
}

export interface CommandPaletteProps {
  /** Whether the palette is open (console-owned state). */
  open: boolean
  /** Close the palette (Esc, backdrop click, or after a selection). */
  onClose: () => void
  /**
   * Called with the chosen persona id when the controller selects a persona
   * from the PERSONAS section. Wired at integration to open the persona-dock
   * host for that persona (COR-018 attribution flows from there).
   */
  onSelectPersona?: (personaId: string) => void
  /**
   * Renders the searchable persona LIST into the PERSONAS section
   * (`persona-operation/02`, wired at integration). Receives the live query +
   * a select callback. When absent (the palette rendered on its own), the
   * section shows a short hint instead of a list.
   */
  renderPersonaResults?: (slot: CommandPalettePersonaSlot) => ReactNode
}

/**
 * The ⌘K command palette overlay. Controlled via `open`/`onClose`; focus-
 * trapped and keyboard-operable while open — see module header. Renders
 * nothing when closed.
 */
export function CommandPalette({
  open,
  onClose,
  onSelectPersona,
  renderPersonaResults,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const triggerRef = useRef<Element | null>(null)
  // Where focus goes if the trigger is GONE by the time the palette closes (see below).
  const fallbacksRef = useRef<readonly Element[]>([])

  // The element that had focus BEFORE the palette opened, tracked while it is closed. It cannot be
  // read from `document.activeElement` when the open effect runs: the persona picker inside the
  // palette autofocuses its own search field during the same commit, so by then focus is already
  // in the palette and the real opener would be lost (which is why Esc used to drop focus to
  // <body> in the console). Focus that lands INSIDE the palette is ignored.
  const lastOutsideFocusRef = useRef<Element | null>(null)
  useEffect(() => {
    const outside = (node: EventTarget | null): node is Element =>
      node instanceof Element && node.closest(PALETTE_SELECTOR) === null
    const active = document.activeElement
    lastOutsideFocusRef.current = outside(active) ? active : null
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) lastOutsideFocusRef.current = event.target
    }
    const onFocusOut = (event: FocusEvent) => {
      // Focus left to nowhere (a click on bare page, a removed node): nothing to return to.
      if (event.relatedTarget === null && outside(event.target)) lastOutsideFocusRef.current = null
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  // Open: capture the trigger, reset the query, and move focus into the field.
  // Close (cleanup): return focus to the trigger if still in the document - and if it is gone
  // (it lived in a layer that closed because focus moved here, e.g. C5's takedown step), to the
  // next best stable place, never <body> (Gate-2 A L-NEW-3): the control that layer says it
  // belongs to (`data-focus-return-to`, an element id), then the Live world row holding it, then
  // the console root.
  useEffect(() => {
    if (!open) return
    const opener = lastOutsideFocusRef.current
    triggerRef.current = opener
    const panel = panelRef.current
    fallbacksRef.current = focusFallbacks(opener, panel)
    setQuery('')
    if (panel === null || !hasOtherModalMounted(panel)) searchInputRef.current?.focus()
    return () => {
      const trigger = triggerRef.current
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus()
      } else if (focusIsLost()) {
        const fallback = fallbacksRef.current.find(
          (candidate): candidate is HTMLElement =>
            candidate instanceof HTMLElement && candidate.isConnected,
        )
        fallback?.focus({ preventScroll: true })
      }
      triggerRef.current = null
      fallbacksRef.current = []
    }
  }, [open])

  if (!open) return null

  const handleSelectPersona = (personaId: string) => {
    onSelectPersona?.(personaId)
    onClose()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return

    const panel = panelRef.current
    if (!panel) return
    // Another modal is on top: its focus is its own business (see module header).
    if (hasOtherModalMounted(panel)) return
    const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    if (focusable.length === 0) {
      // Nothing else to focus — keep focus inside the panel.
      event.preventDefault()
      return
    }

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    const active = document.activeElement

    if (event.shiftKey) {
      if (active === first || !panel.contains(active)) {
        event.preventDefault()
        last.focus()
      }
    } else if (active === last || !panel.contains(active)) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <Box
      data-testid="command-palette-backdrop"
      // Non-focusable scrim; a pointer user can click out, keyboard users use Esc.
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        pt: '12vh',
        px: 2,
        bgcolor: 'rgba(15, 23, 36, 0.42)',
      }}
    >
      <Box
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Console command palette"
        data-command-palette=""
        data-testid="command-palette"
        onKeyDown={handleKeyDown}
        sx={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: staffShellTokens.toolstrip.background,
          border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
          borderRadius: '10px',
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.35)',
          overflow: 'hidden',
        }}
      >
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 1,
            px: 1.75,
            py: 1.25,
            borderBottom: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
          }}
        >
          <FontAwesomeIcon
            icon={faMagnifyingGlass}
            aria-hidden="true"
            color={staffShellTokens.accent.secondaryText}
          />
          <CobraTextField
            inputRef={searchInputRef}
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Search personas…"
            variant="standard"
            fullWidth
            slotProps={{
              input: { disableUnderline: true },
              htmlInput: { 'aria-label': 'Search personas' },
            }}
            data-testid="command-palette-search"
          />
        </Stack>

        <Box sx={{ overflowY: 'auto', flex: 1, minHeight: 0 }}>
          <Box component="section" aria-label="Personas" data-testid="command-palette-personas">
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                gap: 0.75,
                px: 1.75,
                pt: 1.25,
                pb: 0.5,
              }}
            >
              <FontAwesomeIcon
                icon={faMasksTheater}
                aria-hidden="true"
                size="xs"
                color={staffShellTokens.accent.secondaryText}
              />
              <Typography
                sx={{
                  fontSize: 10,
                  fontWeight: 800,
                  letterSpacing: '0.14em',
                  color: staffShellTokens.accent.secondaryText,
                }}
              >
                PERSONAS
              </Typography>
            </Stack>

            {renderPersonaResults
              ? renderPersonaResults({ query, onSelectPersona: handleSelectPersona })
              : (
                <Typography
                  data-testid="command-palette-personas-placeholder"
                  sx={{
                    px: 1.75,
                    pb: 1.5,
                    fontSize: 11.5,
                    color: staffShellTokens.accent.secondaryText,
                  }}
                >
                  Type a name or handle to find a persona to post as.
                </Typography>
              )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
