/**
 * features/social/layout/routes/ThreadRoute.tsx
 * ---------------------------------------------------------------------------
 * `/:handle/status/:id` -- one post's flattened thread (demo-polish F1).
 *
 * The thread is resolved by `:id` ALONE. `:handle` is cosmetic (it makes the URL
 * read like the platforms this mimics, and lets a caller that knows the author
 * build `/FulcoEM/status/...`); a thread opened from a post id alone uses the
 * placeholder segment (`/i/status/:id`, see `THREAD_HANDLE_PLACEHOLDER`). So a
 * wrong or stale handle can never show someone else's post.
 *
 * A reserved first segment (`/staff/status/1`) is not a thread: it is redirected
 * Home like every other reserved prefix (COR-004).
 *
 * `ThreadView` has no heading of its own, so the header supplies this route's
 * `<h1>` ("Post"), which is where focus lands on arrival. `ThreadView` emits its
 * own thread-open `view` telemetry on mount (XC-004); this route emits nothing.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useParams } from 'react-router-dom'
import { ThreadView } from '../../components/ThreadView'
import { DetailHeader } from '../DetailHeader'
import { HOME_PATH, isThreadHandle } from '../socialNavigation'
import { useSocialOpeners } from '../useSocialOpeners'
import { SocialRedirect } from './SocialRedirect'

export function ThreadRoute() {
  const { handle = '', id = '' } = useParams()
  const { openHashtag, openProfile } = useSocialOpeners()

  if (id === '' || !isThreadHandle(handle)) return <SocialRedirect to={HOME_PATH} />

  return (
    <div data-testid="social-thread-region">
      <DetailHeader title="Post" />
      <ThreadView focusedPostId={id} onHashtagOpen={openHashtag} onOpenProfile={openProfile} />
    </div>
  )
}
