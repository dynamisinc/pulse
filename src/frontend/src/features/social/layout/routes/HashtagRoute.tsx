/**
 * features/social/layout/routes/HashtagRoute.tsx
 * ---------------------------------------------------------------------------
 * `/hashtag/:tag` -- the feed of posts carrying one hashtag (demo-polish F1;
 * SOC-040). `HashtagFeed` expects the NORMALIZED tag (lower-cased, no leading
 * `#`) -- the same key the linkified anchors produce -- so a typed or shared URL
 * (`/hashtag/%23WaterIssues`, `/hashtag/WaterIssues`) is normalized here and both
 * read the same feed. An empty tag is not a feed; it is redirected Home.
 *
 * `HashtagFeed` renders its own `<h1>` (`#tag`), so the header carries only Back.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useParams } from 'react-router-dom'
import { HashtagFeed } from '../../pages/HashtagFeed'
import { DetailHeader } from '../DetailHeader'
import { HOME_PATH, normalizeHashtagParam } from '../socialNavigation'
import { useSocialOpeners } from '../useSocialOpeners'
import { SocialRedirect } from './SocialRedirect'

export function HashtagRoute() {
  const { tag = '' } = useParams()
  const { openThread, openProfile } = useSocialOpeners()

  const normalized = normalizeHashtagParam(tag)
  if (normalized === undefined) return <SocialRedirect to={HOME_PATH} />

  return (
    <div data-testid="social-hashtag-region">
      <DetailHeader />
      <HashtagFeed tag={normalized} onOpenThread={openThread} onOpenProfile={openProfile} />
    </div>
  )
}
