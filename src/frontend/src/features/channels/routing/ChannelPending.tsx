/**
 * features/channels/routing/ChannelPending.tsx
 * ---------------------------------------------------------------------------
 * The quiet, accessible busy placeholder a channel route shows until the
 * enabled set has a current answer (channels-foundation 08 / 12): never a
 * premature not-found, never a blank page. Shared by `<ChannelRoute>` and the
 * router's landing entry.
 *
 * World: participant. No COBRA, no MUI.
 */

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const

/** The channel route's loading placeholder. */
export function ChannelPending() {
  return (
    <div role="status" style={{ minHeight: '50vh', padding: '48px 16px' }}>
      <span style={visuallyHidden}>Loading…</span>
    </div>
  )
}
