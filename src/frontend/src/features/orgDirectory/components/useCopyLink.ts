/**
 * features/orgDirectory/components/useCopyLink.ts
 * ---------------------------------------------------------------------------
 * Clipboard state for the one-time link panel (`OneTimeLinkPanel`), shared by the reset-link and
 * invite dialogs. The link is a bearer credential: never logged. STAFF world, no UI.
 */

import { useState } from 'react'

export interface CopyLinkState {
  readonly copied: boolean
  readonly copyFailed: boolean
  readonly copy: () => Promise<void>
}

/** Clipboard copy of `link` with success / failure flags. */
export function useCopyLink(link: string | undefined): CopyLinkState {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const copy = async () => {
    if (link === undefined) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setCopyFailed(false)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }
  return { copied, copyFailed, copy }
}

/** The status sentence for a dialog's polite region; `fallback` when neither flag is set. */
export function copyStatusMessage(state: CopyLinkState, fallback: string): string {
  if (state.copied) return 'Link copied to the clipboard.'
  if (state.copyFailed) return 'Could not copy automatically. Select the link and copy it.'
  return fallback
}
