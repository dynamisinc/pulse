/**
 * features/orgDirectory/components/OneTimeLinkPanel.tsx
 * ---------------------------------------------------------------------------
 * The shared "copy this one-time link" presentation used by the reset-link action
 * (`PersonActionDialog`) and the invite dialog (`InvitePersonDialog`): a label carrying the
 * "shown once" warning, the link in a monospace block, and a Copy button.
 * `useCopyLink` (in `useCopyLink.ts`) holds the
 * clipboard state so each dialog can speak the result in its own always-mounted status region
 * (a modal hides the page from assistive tech). The link is a bearer credential: never logged.
 * STAFF world: COBRA button, FontAwesome only.
 */

import { Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCheck, faCopy } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton } from '@/theme/styledComponents'

export interface OneTimeLinkPanelProps {
  readonly link: string
  /** e.g. "Reset link" / "Invite link". */
  readonly label: string
  readonly recipientName: string
  readonly copied: boolean
  readonly onCopy: () => void
  readonly testIds?: { readonly panel: string; readonly link: string; readonly copy: string }
}

export function OneTimeLinkPanel({
  link,
  label,
  recipientName,
  copied,
  onCopy,
  testIds = { panel: 'reset-link-panel', link: 'reset-link', copy: 'copy-reset-link' },
}: OneTimeLinkPanelProps) {
  return (
    <div data-testid={testIds.panel} style={{ marginTop: 12 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
        {label} (shown once; give it to {recipientName} directly)
      </Typography>
      <Typography
        component="code"
        data-testid={testIds.link}
        sx={{ display: 'block', fontSize: 12, wordBreak: 'break-all', mt: 0.5 }}
      >
        {link}
      </Typography>
      <CobraSecondaryButton
        type="button"
        size="small"
        onClick={onCopy}
        startIcon={<FontAwesomeIcon icon={copied ? faCheck : faCopy} aria-hidden="true" />}
        sx={{ mt: 1 }}
        data-testid={testIds.copy}
      >
        {copied ? 'Copied' : 'Copy link'}
      </CobraSecondaryButton>
    </div>
  )
}
