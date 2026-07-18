/**
 * features/evaluator/components/ParticipantStageFrame.tsx
 * ---------------------------------------------------------------------------
 * A read-only reproduction of the participant stage (Portal / Pulse) at a
 * given scenario moment — the D1/D7 anatomy in miniature: compliance
 * banners, the advisory alert bar, the channel strip, and channel content.
 * Shared by `WorldView` (pinned to "now") and the replay stage (scrubbable).
 *
 * IMPORTANT — two-worlds note: this is a *preview* rendered from inside the
 * COBRA staff surface (like D7's "Preview as participant"), not the actual
 * participant app. It deliberately borrows the participant fonts/colors
 * (Figtree, Libre Franklin, exercise-green banners) so evaluators see what
 * participants really see — but it stays read-only (COR-013/COR-015: no
 * composer, no working like/reply buttons, nothing disabled-but-visible).
 * Trending/like counts are derived snapshots and always carry the amber "≈"
 * mark per D6-006 — no derived number pretends to be replayed exactly.
 */

import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import type { StageContent, WorldChannel } from '../types'

const SEAL_BLUE = '#2D9CDB'

interface ParticipantStageFrameProps {
  stage: StageContent;
  activeChannel: WorldChannel;
  showOrigins: boolean;
  size?: 'sm' | 'lg';
}

export function ParticipantStageFrame({ stage, activeChannel, showOrigins, size = 'sm' }: ParticipantStageFrameProps) {
  const lg = size === 'lg'
  const bannerHeight = lg ? 20 : 18
  const avatarSize = lg ? 32 : 30

  return (
    <Box
      sx={{
        border: lg ? undefined : '1px solid #dcdcdc',
        borderRadius: lg ? '8px' : '10px',
        bgcolor: '#fff',
        overflow: 'hidden',
        boxShadow: lg ? '0 18px 50px rgba(0,0,0,.22)' : '0 10px 28px rgba(0,0,0,.1)',
        width: lg ? 640 : '100%',
      }}
    >
      <Box
        sx={{
          height: bannerHeight,
          bgcolor: '#2e6b2e',
          color: '#eaf5e6',
          font: `700 ${lg ? 9 : 8.5}px/${bannerHeight}px Figtree,sans-serif`,
          textAlign: 'center',
          letterSpacing: '.14em',
        }}
      >
        UNCLASSIFIED // EXERCISE · EXERCISE · EXERCISE — ALL CONTENT SIMULATED
      </Box>

      {stage.alert && (
        <Stack
          direction="row"
          sx={{
            alignItems: 'center',
            gap: 1.25,
            px: lg ? 1.75 : 1.5,
            py: lg ? 1 : 0.875,
            font: `500 ${lg ? 12.5 : 11.5}px Figtree,sans-serif`,
            bgcolor: '#fff3dd',
            borderBottom: '1px solid #e3b25f',
            color: '#6b4300',
          }}
        >
          <Stack
            direction="row"
            sx={{
              alignItems: 'center',
              gap: 0.5,
              font: `800 ${lg ? 9.5 : 9}px Figtree,sans-serif`,
              letterSpacing: '.1em',
              px: 0.875,
              py: 0.25,
              borderRadius: '5px',
              // Advisory chip — the AA-darkened advisory amber: #8a5a00 (not #b97a00)
              // so white-on-amber clears WCAG AA (D7-012), matching the participant
              // shell's advisory severity chip.
              bgcolor: '#8a5a00',
              color: '#fff',
              flex: 'none',
            }}
          >
            <FontAwesomeIcon icon={faTriangleExclamation} size="2xs" />
            <span>ADVISORY</span>
          </Stack>
          <span>{stage.alertMessage}</span>
        </Stack>
      )}

      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          gap: 0.25,
          px: 1.25,
          height: lg ? 32 : 28,
          bgcolor: '#fbfcfd',
          borderBottom: '1px solid #e3e7ea',
          font: `600 ${lg ? 11 : 10}px Figtree,sans-serif`,
          color: '#5a6a76',
        }}
      >
        <Box
          sx={{
            px: 0.875,
            py: 0.5,
            color: activeChannel === 'portal' ? '#101b23' : '#5a6a76',
            fontWeight: activeChannel === 'portal' ? 800 : 600,
            boxShadow: activeChannel === 'portal' ? 'inset 0 -2px 0 #101b23' : 'none',
          }}
        >
          Fairhaven Today
        </Box>
        <Box
          sx={{
            px: 0.875,
            py: 0.5,
            color: activeChannel === 'pulse' ? '#101b23' : '#5a6a76',
            fontWeight: activeChannel === 'pulse' ? 800 : 600,
            boxShadow: activeChannel === 'pulse' ? 'inset 0 -2px 0 #101b23' : 'none',
          }}
        >
          Pulse
        </Box>
        <Box sx={{ px: 0.875, py: 0.5 }}>The Wire Room</Box>
        <Box sx={{ px: 0.875, py: 0.5 }}>Weather Desk</Box>
        <Box sx={{ ml: 'auto', font: `500 ${lg ? 10 : 9.5}px Figtree,sans-serif`, color: '#8a97a1' }}>
          {stage.dateline}
        </Box>
      </Stack>

      {activeChannel === 'portal' && (
        <Box sx={{ fontFamily: "'Libre Franklin',sans-serif", color: '#1c2833' }}>
          <Box
            sx={{
              bgcolor: '#123a63',
              color: '#fff',
              px: lg ? 2 : 1.75,
              py: lg ? 1.25 : 1.125,
              font: `800 ${lg ? 17 : 15}px 'Libre Franklin',sans-serif`,
              letterSpacing: '.04em',
            }}
          >
            FAIRHAVEN <Box component="b" sx={{ color: '#e8b437' }}>TODAY</Box>
          </Box>
          <Box sx={{ px: lg ? 2 : 1.75, py: lg ? 1.75 : 1.5 }}>
            <Typography sx={{ color: '#c8102e', font: `800 ${lg ? 9 : 8.5}px 'Libre Franklin',sans-serif`, letterSpacing: '.12em' }}>
              {stage.kicker}
            </Typography>
            <Typography sx={{ font: `800 ${lg ? 17 : 15}px/1.3 'Libre Franklin',sans-serif`, margin: '4px 0 6px' }}>
              {stage.headline}
            </Typography>
            <Typography sx={{ font: `400 ${lg ? 11.5 : 11}px/1.5 'Libre Franklin',sans-serif`, color: '#46545f' }}>
              {stage.dek}
            </Typography>
            <Typography
              sx={{
                font: `700 ${lg ? 12 : 11.5}px 'Libre Franklin',sans-serif`,
                mt: 1.25,
                pt: 1.25,
                borderTop: '1px solid #e6eaee',
              }}
            >
              {stage.row1}
            </Typography>
            <Typography
              sx={{
                font: `700 ${lg ? 12 : 11.5}px 'Libre Franklin',sans-serif`,
                mt: 1,
                pt: 1,
                borderTop: '1px solid #e6eaee',
              }}
            >
              {stage.row2}
            </Typography>
          </Box>
        </Box>
      )}

      {activeChannel === 'pulse' && (
        <Box sx={{ fontFamily: 'Figtree,sans-serif', color: '#0e1518' }}>
          {stage.posts.map((post, i) => (
            <Stack
              key={`${post.handle}-${i}`}
              direction="row"
              sx={{ gap: lg ? 1.25 : 1.125, px: lg ? 1.875 : 1.625, py: lg ? 1.375 : 1.25, borderBottom: '1px solid #eef1f3' }}
            >
              <Box
                sx={{
                  width: avatarSize,
                  height: avatarSize,
                  borderRadius: '50%',
                  flex: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  font: '800 12px Figtree,sans-serif',
                  color: '#fff',
                  bgcolor: post.avatarBg,
                }}
              >
                {post.avatarText}
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" sx={{ alignItems: 'center', gap: 0.625 }}>
                  <Typography sx={{ font: `700 ${lg ? 12.5 : 11.5}px Figtree,sans-serif` }}>
                    {post.name}
                  </Typography>
                  {post.verified && (
                    <FontAwesomeIcon
                      icon={faCircleCheck}
                      style={{ color: SEAL_BLUE, width: 12, height: 12 }}
                    />
                  )}
                  <Typography sx={{ font: `500 ${lg ? 10.5 : 10}px Figtree,sans-serif`, color: '#7b8a94' }}>
                    {post.handle} · {post.age}
                  </Typography>
                </Stack>
                <Typography sx={{ font: `400 ${lg ? 12.5 : 11.5}px/1.45 Figtree,sans-serif`, mt: 0.25 }}>
                  {post.text}
                </Typography>
                <Stack direction="row" sx={{ gap: lg ? 2.5 : 2.25, font: `500 ${lg ? 10.5 : 10}px Figtree,sans-serif`, color: '#7b8a94', mt: 0.75 }}>
                  <span>↩ {post.replies}</span>
                  <span>↺ {post.reposts}</span>
                  <Box component="span" title={lg ? 'Snapshot-approximate' : undefined}>
                    ♡ {lg ? '≈' : ''}{post.likes}
                  </Box>
                </Stack>
                {showOrigins && (
                  <Typography
                    sx={{
                      font: '600 9px ui-monospace,Menlo,monospace',
                      letterSpacing: '.06em',
                      color: '#848482',
                      mt: 0.625,
                      borderTop: '1px dashed #e3e7ea',
                      pt: 0.5,
                    }}
                  >
                    {post.origin}
                  </Typography>
                )}
              </Box>
            </Stack>
          ))}
          <Stack
            direction="row"
            sx={{ px: lg ? 1.875 : 1.625, py: lg ? 1.25 : 1.125, font: `600 ${lg ? 11 : 10.5}px Figtree,sans-serif`, color: '#536471', bgcolor: '#f7f9fa' }}
          >
            <span>
              Trending · <b>#WaterIssues</b>
            </span>
            <Box
              component="span"
              title="Derived state — snapshot-approximate, not replayed exactly (EVL-003)"
              sx={{ ml: 0.75, font: '700 9px ui-monospace,Menlo,monospace', color: '#8a5300', bgcolor: '#fff3dd', borderRadius: '4px', px: 0.5 }}
            >
              ≈ {stage.trend}
            </Box>
          </Stack>
        </Box>
      )}

      <Box
        sx={{
          height: bannerHeight,
          bgcolor: '#2e6b2e',
          color: '#eaf5e6',
          font: `700 ${lg ? 9 : 8.5}px/${bannerHeight}px Figtree,sans-serif`,
          textAlign: 'center',
          letterSpacing: '.14em',
        }}
      >
        PULSE TRAINING ENVIRONMENT — SIMULATED INFORMATION SPACE
      </Box>
    </Box>
  )
}
