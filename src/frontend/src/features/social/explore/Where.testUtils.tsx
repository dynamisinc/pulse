/**
 * features/social/explore/Where.testUtils.tsx
 * ---------------------------------------------------------------------------
 * TEST-ONLY: shows the channel location the navigation adapter currently holds, so an
 * Explore test can assert "that click navigated in-app to /hashtag/waterissues".
 * A component lives alone in its file (`react-refresh/only-export-components`);
 * `renderExplore` in `exploreTestUtils.tsx` mounts it beside the component under test.
 *
 * A plain span, not an <output>: an <output> carries a "status" role that tests query.
 */

import { useSocialNavigation } from '../layout/socialNavigation'

export function Where() {
  const { location } = useSocialNavigation()
  return <span data-testid="where">{`${location.pathname}${location.search}`}</span>
}
