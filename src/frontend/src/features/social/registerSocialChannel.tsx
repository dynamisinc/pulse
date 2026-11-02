/**
 * features/social/registerSocialChannel.tsx
 * ---------------------------------------------------------------------------
 * Social's one `registerChannel()` call (channels-foundation 12, #708). Imported
 * once, for its side effect, by the participant composition root (`App.tsx`).
 *
 *  - `/` and every Social sub-route (`/home`, `/explore`, `/hashtag/:tag`,
 *    `/:handle`, `/:handle/status/:id`, ...) keep working unchanged: Social still
 *    routes them itself (`layout/SocialRoutes.tsx`).
 *  - `navPath: '/home'`: the shell's nav goes to Social's home, because `/` is the
 *    landing entry, which is the portal when the portal is enabled (PRT-001).
 *  - `themeScope: SocialBrandScope`: `--pulse-ac` from the resolved brand, inside
 *    Social's own subtree (F5, #433), below the router's enablement guard.
 *  - `claimsPath`: a path Social's route table would only bounce to Home is a
 *    participant not-found instead (WR-002), rendered by the router in the
 *    exercise brand.
 *
 * World: participant.
 */

import { registerChannel } from '@/features/channels/routing'
import { SocialChannel } from './SocialChannel'
import { HOME_PATH, matchSocialRoute } from './layout/socialNavigation'
import { SocialBrandScope } from './theme/SocialBrandScope'

registerChannel({
  id: 'social',
  pathPrefix: '/',
  navPath: HOME_PATH,
  element: <SocialChannel />,
  themeScope: SocialBrandScope,
  claimsPath: pathname => matchSocialRoute(pathname) !== 'redirect',
})
