/**
 * features/controller/liveWorld/LiveWorldMedia.tsx
 * ---------------------------------------------------------------------------
 * Compact STAFF thumbnails for a post's media in the LIVE WORLD column
 * (demo-polish C2, docs/features/demo-polish/18-live-world-column.md; NFR-001,
 * NFR-004). Staff world — a small bordered tile plus a MONOSPACED text label per
 * attachment ("IMAGE", "VIDEO 0:24"); it deliberately does NOT reuse the
 * participant media components (`MediaGrid`, `VideoPlayer`, `MediaViewer`), whose
 * rounded, full-bleed, playable treatment is the fiction. Here a controller only
 * needs to see WHAT was attached, at a glance, without any playback or layout
 * shift.
 *
 *   - IMAGE  the image itself, scaled to the tile.
 *   - VIDEO  its poster frame with a play glyph and the label "VIDEO m:ss".
 *            No `<video>` element is ever created, so a burst of video posts can
 *            never start a decoder, autoplay, or make noise in the console.
 *   - No usable picture (no poster, or the URL failed the allow-list): a plain
 *     placeholder tile with a type icon — the label and the alt text still tell
 *     the controller what the attachment is.
 *
 * CONTENT SECURITY (NFR-004). A media `url`/`posterUrl` is an opaque string off
 * the wire; every one passes `resolveSafeMediaUrl` (the same allow-list the
 * participant media components use) before it becomes an `<img src>`. A rejected
 * URL is dropped and the placeholder shows instead; a hostile URL is never
 * requested. `alt` text is rendered as text (React-escaped), as an `<img alt>` on
 * a real picture and as the accessible name of a placeholder — it is the only
 * text alternative an attachment has (DP-12: no captions).
 *
 * The label carries the attachment type in TEXT (never an icon or colour alone).
 */

import { Box, Stack } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faImage, faPlay, faVideo } from '@fortawesome/free-solid-svg-icons'
import type { PostMedia } from '@/features/social'
import { resolveSafeMediaUrl } from '@/features/social/components/media/safeMediaUrl'
import { mediaLabel } from './liveWorldModel'
import { liveWorldTokens, monoMeta } from './liveWorldStyles'

const TILE_WIDTH_PX = 64
const TILE_HEIGHT_PX = 44

export interface LiveWorldMediaProps {
  readonly media: readonly PostMedia[]
}

/** The picture URL a tile may show (image url / video poster), allow-listed, or `undefined`. */
function pictureUrl(item: PostMedia): string | undefined {
  return resolveSafeMediaUrl(item.kind === 'image' ? item.url : item.posterUrl)
}

export function LiveWorldMedia({ media }: LiveWorldMediaProps) {
  return (
    <Stack
      component="ul"
      direction="row"
      aria-label="Attachments"
      data-testid="live-world-media"
      sx={{ gap: 1, flexWrap: 'wrap', listStyle: 'none', m: 0, p: 0 }}
    >
      {media.map(item => {
        const src = pictureUrl(item)
        const label = mediaLabel(item)
        return (
          <Stack
            component="li"
            key={item.id}
            data-testid="live-world-media-item"
            data-kind={item.kind}
            title={item.alt}
            sx={{ gap: '2px', alignItems: 'flex-start' }}
          >
            <Box
              sx={{
                position: 'relative',
                width: TILE_WIDTH_PX,
                height: TILE_HEIGHT_PX,
                border: `1px solid ${liveWorldTokens.panelBorder}`,
                borderRadius: '2px',
                bgcolor: liveWorldTokens.toolbar,
                color: liveWorldTokens.meta,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {src !== undefined ? (
                <Box
                  component="img"
                  src={src}
                  alt={item.alt}
                  loading="lazy"
                  decoding="async"
                  referrerPolicy="no-referrer"
                  sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
              ) : (
                <Box
                  role="img"
                  aria-label={item.alt}
                  sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <FontAwesomeIcon icon={item.kind === 'video' ? faVideo : faImage} />
                </Box>
              )}
              {item.kind === 'video' && src !== undefined && (
                <Box
                  aria-hidden="true"
                  sx={{
                    position: 'absolute',
                    right: '2px',
                    bottom: '2px',
                    width: 16,
                    height: 16,
                    borderRadius: '2px',
                    bgcolor: liveWorldTokens.barBackground,
                    color: liveWorldTokens.barText,
                    fontSize: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <FontAwesomeIcon icon={faPlay} />
                </Box>
              )}
            </Box>
            <Box component="span" sx={{ ...monoMeta, fontWeight: 700, letterSpacing: '0.04em' }}>
              {label}
            </Box>
          </Stack>
        )
      })}
    </Stack>
  )
}
