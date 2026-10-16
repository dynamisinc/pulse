/**
 * features/controller/liveWorld/LiveWorldEditHistory.tsx
 * ---------------------------------------------------------------------------
 * The staff view of a post's edit history (demo-feedback story 20; DF-31): a COBRA-skinned
 * dialog the Live world row's "Edited" chip opens. STAFF world: COBRA paper surface, monospaced
 * metadata (`liveWorldTokens`), a COBRA button, MUI's built-in modal (focus trap, Esc, focus
 * return to the chip). It is deliberately NOT the participant `EditHistoryDialog` (that one wears
 * the brand skin and must never appear in the console).
 *
 * Content: every version NEWEST FIRST with its SCENARIO time in the exercise zone (COR-053; no
 * wall-clock) and the words "Current" / "Original" (text, never colour alone), over the same
 * `usePostEditHistory` read the participant dialog uses (staff sessions may read it). Version text
 * renders as plain React text. Key events are stopped at the dialog so the column's J / K / R
 * shortcuts (handled on the list container, which a portal still bubbles to) never fire from it.
 */

import { useId } from 'react'
import { Box, Dialog, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { formatScenarioTime } from '@/core/clock'
import { CobraLinkButton } from '@/theme/styledComponents'
import { usePostEditHistory, versionLabel } from '@/features/social/edit/usePostEditHistory'
import { liveWorldTokens, monoMeta } from './liveWorldStyles'

export interface LiveWorldEditHistoryProps {
  readonly postId: string
  /** The exercise's IANA zone for the scenario times (COR-053). */
  readonly timeZone: string
  readonly onClose: () => void
}

export function LiveWorldEditHistory({ postId, timeZone, onClose }: LiveWorldEditHistoryProps) {
  const titleId = useId()
  const { history, isLoading, isError, refetch } = usePostEditHistory(postId)
  const versions = history === undefined
    ? []
    : [...history.versions].sort((a, b) => b.editNumber - a.editNumber)
  const newest = versions[0]?.editNumber ?? 0

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby={titleId}
      data-testid="live-world-edit-history"
      onKeyDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <DialogTitle
        id={titleId}
        sx={{
          fontFamily: liveWorldTokens.mono,
          fontSize: 14,
          fontWeight: 700,
          color: liveWorldTokens.ink,
        }}
      >
        Edit history
      </DialogTitle>
      <DialogContent sx={{ bgcolor: liveWorldTokens.surface }}>
        {isLoading && (
          <Typography role="status" sx={monoMeta}>Loading edit history…</Typography>
        )}
        {isError && (
          <Stack direction="row" role="alert" sx={{ alignItems: 'center', gap: 1 }}>
            <Typography sx={{ ...monoMeta, color: liveWorldTokens.ink }}>
              Couldn't load the edit history.
            </Typography>
            <CobraLinkButton size="small" onClick={refetch}>Try again</CobraLinkButton>
          </Stack>
        )}
        {versions.length > 0 && (
          <Box
            component="ol"
            data-testid="live-world-edit-history-list"
            sx={{ listStyle: 'none', m: 0, p: 0 }}
          >
            {versions.map(version => {
              const label = versionLabel(version.editNumber, newest)
              const when = formatScenarioTime(version.scenarioTime, timeZone, {
                format: 'absolute',
              })
              return (
                <Box
                  component="li"
                  key={version.editNumber}
                  data-testid="live-world-edit-version"
                  sx={{
                    py: '8px',
                    borderBottom: `1px solid ${liveWorldTokens.hairline}`,
                    '&:last-child': { borderBottom: 'none' },
                  }}
                >
                  <Stack direction="row" sx={{ alignItems: 'baseline', gap: '8px' }}>
                    {label !== null && (
                      <Box
                        component="span"
                        sx={{
                          ...monoMeta,
                          px: '5px',
                          fontWeight: 700,
                          color: liveWorldTokens.ink,
                          border: `1px solid ${liveWorldTokens.focus}`,
                          borderRadius: '2px',
                        }}
                      >
                        {label}
                      </Box>
                    )}
                    <Box component="time" dateTime={version.scenarioTime} sx={monoMeta}>
                      {when === '' ? '—' : when}
                    </Box>
                  </Stack>
                  <Typography
                    sx={{
                      mt: '4px',
                      fontSize: 13,
                      lineHeight: 1.4,
                      color: liveWorldTokens.ink,
                      whiteSpace: 'pre-wrap',
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {version.text}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        )}
        <Stack direction="row" sx={{ justifyContent: 'flex-end', mt: 1 }}>
          <CobraLinkButton size="small" onClick={onClose} aria-label="Close edit history">
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
            Close
          </CobraLinkButton>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}
