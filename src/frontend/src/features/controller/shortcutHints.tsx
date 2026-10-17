/**
 * features/controller/shortcutHints.tsx
 * ---------------------------------------------------------------------------
 * The console's visible KEYBOARD HINTS, platform- and pointer-aware (mobile-tablet story 14,
 * D5-024, TABLET-AMENDMENT section 4). STAFF world (COBRA chrome tokens), FontAwesome icons.
 *
 * Two rules, applied in ONE place so no surface hand-writes a chord:
 *   1. ONE keycap, the platform's own: `⌘K` on Apple platforms (macOS, iOS and iPadOS, where Safari
 *      reports `MacIntel` + touch points), `Ctrl+K` everywhere else. Never both. See
 *      `core/hooks/platformModifier.ts`. The key HANDLERS are unchanged and accept either modifier.
 *   2. On a COARSE pointer a hint must not promise a keyboard that may not be there. The command
 *      strip becomes a TAP hint ("Tap PERSONAS or press ⌘K": the toolstrip tool is the touch
 *      control, and an iPad with a Magic Keyboard still has the chord). The compose-send hint is
 *      HIDDEN on coarse because the labelled Post / Send button is already the touch control.
 *
 * Exports:
 *  - {@link ConsoleShortcutStrip}  the strip under the console header (replaces the hard-coded
 *                                  "⌘K / Ctrl+K" strip that lived in `ControllerConsole`);
 *  - {@link ComposeSendHint}       "Ctrl+Enter to post", hidden on a coarse pointer;
 */

import { Box, Stack } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faKeyboard } from '@fortawesome/free-solid-svg-icons'
import { usePlatformModifier } from '@/core/hooks/usePlatformModifier'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'

/** A keycap (`<kbd>`) in the console chrome. */
const KBD_SX = {
  fontFamily: staffShellTokens.classificationTag.fontFamily,
  fontSize: 11,
  fontWeight: 700,
  color: staffShellTokens.header.background,
  border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
  borderRadius: '4px',
  bgcolor: staffShellTokens.toolstrip.background,
  px: 0.75,
  py: 0.125,
} as const

/** The strip under the console header: how to open the persona palette. One keycap. */
export function ConsoleShortcutStrip() {
  const { chord, coarse } = usePlatformModifier()
  return (
    <Stack
      direction="row"
      data-testid="console-shortcut-strip"
      data-pointer={coarse ? 'coarse' : 'fine'}
      sx={{
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
        fontSize: 12,
        color: staffShellTokens.accent.secondaryText,
      }}
    >
      <FontAwesomeIcon icon={faKeyboard} aria-hidden="true" />
      {coarse ? (
        <>
          <Box component="span">Tap PERSONAS or press</Box>
          <Box component="kbd" sx={KBD_SX}>{chord('K')}</Box>
        </>
      ) : (
        <>
          <Box component="kbd" sx={KBD_SX}>{chord('K')}</Box>
          <Box component="span">Post as a persona</Box>
        </>
      )}
    </Stack>
  )
}

/** "Ctrl+Enter to post" next to a Post / Send button. Hidden on a coarse pointer. */
export function ComposeSendHint({ verb = 'post' }: { readonly verb?: string }) {
  const { chord, coarse } = usePlatformModifier()
  if (coarse) return null
  return (
    <Box
      component="span"
      data-testid="compose-send-hint"
      sx={{ fontSize: 11, color: staffShellTokens.accent.secondaryText }}
    >
      <Box component="kbd" sx={KBD_SX}>{chord('Enter')}</Box>
      {` to ${verb}`}
    </Box>
  )
}
