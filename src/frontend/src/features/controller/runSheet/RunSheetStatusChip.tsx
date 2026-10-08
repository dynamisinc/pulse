/**
 * features/controller/runSheet/RunSheetStatusChip.tsx
 * ---------------------------------------------------------------------------
 * The run sheet's status chip: pending · held · firing n/m · fired · skipped ·
 * failed. STAFF world. NEVER colour-only (NFR-001): every status is an ICON plus
 * its TEXT word (the burst chip also carries its live count — "Firing 3/8").
 * The tone colours the icon and the border; the text stays high-contrast ink so
 * the label is legible whatever the tone.
 */

import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBolt,
  faCheck,
  faClock,
  faForwardStep,
  faPause,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { consoleChrome as chrome } from '../consoleChrome'
import { statusText } from './injectRules'
import type { InjectItemDto, InjectStatus } from './types'

interface Tone {
  readonly icon: IconDefinition
  readonly color: string
}

const TONES: Readonly<Record<InjectStatus, Tone>> = {
  pending: { icon: faClock, color: chrome.inkMuted },
  held: { icon: faPause, color: chrome.amber },
  firing: { icon: faBolt, color: chrome.blue },
  fired: { icon: faCheck, color: chrome.green },
  skipped: { icon: faForwardStep, color: chrome.inkFaint },
  failed: { icon: faTriangleExclamation, color: chrome.red },
}

export interface RunSheetStatusChipProps {
  readonly item: Pick<InjectItemDto, 'status' | 'firedCount' | 'total'>
}

export function RunSheetStatusChip({ item }: RunSheetStatusChipProps) {
  const tone = TONES[item.status]
  return (
    <Box
      component="span"
      data-testid="status-chip"
      data-status={item.status}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: '1px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.03em',
        color: chrome.ink,
        border: `1px solid ${tone.color}`,
        borderRadius: '999px',
        whiteSpace: 'nowrap',
      }}
    >
      <FontAwesomeIcon icon={tone.icon} color={tone.color} aria-hidden="true" data-testid="status-icon" />
      <span data-testid="status-text">{statusText(item)}</span>
    </Box>
  )
}
