/**
 * features/controller/console/CommandPalette.tsx
 * ---------------------------------------------------------------------------
 * The controller console's ⌘K / Ctrl+K COMMAND PALETTE shell (feature:
 * console-shell, story 01 — "Toolstrip + flyouts"; D5-004/015/017/018; see
 * docs/features/console-shell/01-toolstrip-flyouts.md AC "⌘K command palette").
 *
 * A keyboard-first, searchable, focus-TRAPPED overlay whose PERSONAS section is
 * the entry point to the "post as persona" flow. This story ships the palette
 * shell + the PERSONAS section as a search/SELECT surface only — the searchable
 * persona LIST itself is `persona-operation/02`'s, rendered into the
 * `renderPersonaResults` slot at the serial integration step (an INPUT
 * contract, never an import of `persona-operation`'s files).
 *
 * ## A11y (NFR-001) — fully keyboard-operable, no pointer required
 * `role="dialog"` + `aria-modal` + `aria-label`. On open, focus moves to the
 * search field; Tab/Shift+Tab are TRAPPED inside the panel; Esc closes; on
 * close, focus returns to whatever opened the palette (the ⌘K-focused element
 * or the "Personas" toolstrip button), captured on open. Every step
 * (open → type → select) is reachable without a pointer.
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
import { CobraTextField } from '@/theme/styledComponents'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'

/** Focusable-element selector for the focus trap (visible, tabbable nodes). */
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), ' +
  'input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

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
   * a select callback. When absent (during the fan-out), the section shows a
   * neutral placeholder marking the seam.
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

  // Open: capture the trigger, reset the query, and move focus into the field.
  // Close (cleanup): return focus to the trigger if still in the document.
  useEffect(() => {
    if (!open) return
    triggerRef.current = document.activeElement
    setQuery('')
    searchInputRef.current?.focus()
    return () => {
      const trigger = triggerRef.current
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus()
      }
      triggerRef.current = null
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
            placeholder="Search personas and commands…"
            variant="standard"
            fullWidth
            slotProps={{
              input: { disableUnderline: true },
              htmlInput: { 'aria-label': 'Search personas and commands' },
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
                  Search a persona to post as — the persona list mounts here.
                </Typography>
              )}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
