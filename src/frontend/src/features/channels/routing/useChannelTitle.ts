/**
 * features/channels/routing/useChannelTitle.ts
 * ---------------------------------------------------------------------------
 * `useChannelTitle(title)`: a channel page sets `document.title` while it is
 * mounted (channels-foundation 12, focus-and-title AC). The router never sets
 * a title itself; each channel names its own pages. The previous title (the
 * brand's, set by `PwaRoot`) comes back on unmount.
 *
 * Fiction-safe: pass in-fiction words only (no exercise or admin wording).
 *
 * World: participant. No UI.
 */

import { useEffect } from 'react'

/** Sets `document.title` to `title` while the calling component is mounted. */
export function useChannelTitle(title: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = title
    return () => {
      document.title = previous
    }
  }, [title])
}
