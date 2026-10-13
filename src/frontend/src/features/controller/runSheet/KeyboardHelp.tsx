/**
 * features/controller/runSheet/KeyboardHelp.tsx
 * ---------------------------------------------------------------------------
 * The visible "Keyboard" help of the run sheet (inject-queue story 07, AC
 * "Keyboard (NFR-001)": "A visible 'Keyboard' help lists them"). STAFF world.
 * The shortcut table lives in `runSheetShortcuts.ts` so the panel's key handler and
 * this list can never drift apart: one source, two readers.
 */

import { Box } from '@mui/material'
import { consoleChrome as chrome } from '../consoleChrome'
import { RUN_SHEET_SHORTCUTS } from './runSheetShortcuts'

export interface KeyboardHelpProps {
  readonly id: string
}

export function KeyboardHelp({ id }: KeyboardHelpProps) {
  return (
    <Box
      id={id}
      data-testid="keyboard-help"
      role="region"
      aria-label="Keyboard shortcuts"
      sx={{
        p: 1.25,
        border: `1px solid ${chrome.cardBorder}`,
        borderRadius: '8px',
        bgcolor: chrome.card,
        fontSize: 12,
        color: chrome.inkMuted,
      }}
    >
      <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 12px' }}>
        {RUN_SHEET_SHORTCUTS.map(shortcut => (
          <Box key={shortcut.keys} sx={{ display: 'contents' }}>
            <Box component="dt" sx={{ m: 0 }}>
              <Box
                component="kbd"
                sx={{
                  px: 0.75,
                  py: '1px',
                  fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  fontSize: 11,
                  color: chrome.ink,
                  border: `1px solid ${chrome.line}`,
                  borderRadius: '4px',
                }}
              >
                {shortcut.keys}
              </Box>
            </Box>
            <Box component="dd" sx={{ m: 0 }}>
              {shortcut.action}
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ mt: 1, color: chrome.inkFaint }}>
        Shortcuts are ignored while you are typing in a field. Every action is also a button.
      </Box>
    </Box>
  )
}
