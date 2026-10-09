/**
 * features/controller/runSheet/StaffDialog.tsx
 * ---------------------------------------------------------------------------
 * The run sheet's modal shell (demo-polish C3, Gate-1 "focus-trap contract"). STAFF world.
 * A MUI `Dialog` that STANDS ASIDE for any other modal in the document, per
 * `core/a11y/modalPriority.ts`.
 *
 * WHY. MUI's focus trap pulls focus back into the dialog whenever it leaves, but it only
 * knows about MUI modals. If a different layer is on top - the shell's Pause / EndEx /
 * break-fiction overlay (`[aria-modal="true"]`, `data-shell-layer`) - two traps that each
 * "pull focus back" fight forever (the first F2 cut overflowed the stack), or focus sits
 * in the dialog UNDER the overlay. The product rule is one-way: a channel's own modal
 * stands aside COMPLETELY while any other `aria-modal` element is mounted - no pull-back,
 * no auto-focus on open, no focus restore.
 *
 * HOW. `hasOtherModalMounted(paper)` is re-evaluated whenever the DOM changes (a
 * `MutationObserver` on `document.body` watching added / removed nodes and `aria-modal`
 * flips), and `disableEnforceFocus` / `disableAutoFocus` / `disableRestoreFocus` follow it.
 * MUI re-reads those props on every change, so the trap releases the moment an overlay
 * appears and engages again when it goes. When an overlay is ALREADY up as the dialog
 * opens, auto-focus is off from the first render.
 *
 * MUI also `aria-hidden`s every other child of `<body>` when a modal opens; while standing
 * aside that is undone for the other modal layers so an overlay stays visible to assistive tech.
 *
 * `initialFocus` (a CSS selector inside the dialog) replaces the `autoFocus` attribute, which
 * would take focus even while standing aside: StaffDialog focuses that element itself, and
 * only when no other modal is up.
 *
 * Both `BeatEditor` and `ConfirmDialog` use this instead of a bare `Dialog`.
 */

import { useEffect, useState } from 'react'
import { Dialog, type DialogProps } from '@mui/material'
import { hasOtherModalMounted } from '@/core/a11y/modalPriority'

const ANY_MODAL = '[aria-modal="true"]'

/** Tracks whether another modal is mounted alongside the dialog whose Paper is `own`. */
function useStandAside(): {
  readonly paperRef: (node: HTMLElement | null) => void
  readonly standAside: boolean
  readonly own: HTMLElement | null
} {
  const [own, setOwn] = useState<HTMLElement | null>(null)
  // Before our own Paper exists, ANY modal in the document is "another" one.
  const [standAside, setStandAside] = useState(
    () => typeof document !== 'undefined' && document.querySelector(ANY_MODAL) !== null,
  )

  useEffect(() => {
    if (own === null) return undefined
    const check = () => setStandAside(hasOtherModalMounted(own))
    check()
    const observer = new MutationObserver(check)
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-modal'],
    })
    return () => observer.disconnect()
  }, [own])

  return { paperRef: setOwn, standAside, own }
}

export interface StaffDialogProps extends DialogProps {
  /** CSS selector (within the dialog) of the element to focus on open. */
  readonly initialFocus?: string
}

export function StaffDialog({ slotProps, initialFocus, ...props }: StaffDialogProps) {
  const { paperRef, standAside, own } = useStandAside()

  // Focus the first element - unless another modal is up, or focus is already inside the
  // dialog (e.g. the overlay just went away while the controller was typing).
  useEffect(() => {
    if (own === null || standAside || initialFocus === undefined) return
    const active = document.activeElement
    if (active !== null && active !== own && own.contains(active)) return
    own.querySelector<HTMLElement>(initialFocus)?.focus()
  }, [own, standAside, initialFocus])

  // MUI marks every other child of <body> `aria-hidden` when a modal opens, which would hide an
  // overlay that was already up from assistive technology. While standing aside, undo that for
  // the other modal layers (the overlay wins, per modalPriority).
  useEffect(() => {
    if (own === null || !standAside) return
    for (const modal of document.querySelectorAll(ANY_MODAL)) {
      if (modal === own || own.contains(modal) || modal.contains(own)) continue
      if (modal.getAttribute('aria-hidden') === 'true') modal.removeAttribute('aria-hidden')
    }
  }, [own, standAside])

  return (
    <Dialog
      disableEnforceFocus={standAside}
      disableAutoFocus={standAside}
      disableRestoreFocus={standAside}
      {...props}
      slotProps={{
        ...slotProps,
        paper: { ...(typeof slotProps?.paper === 'object' ? slotProps.paper : {}), ref: paperRef },
      }}
    />
  )
}
