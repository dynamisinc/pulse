/**
 * features/social/layout/routes/ProfileRoute.tsx
 * ---------------------------------------------------------------------------
 * `/:handle` -- one persona's profile (demo-polish F1; SOC-050).
 *
 * HANDLE -> PERSONA. The handle is resolved CASE-INSENSITIVELY through the shared
 * persona directory (`/fulcoem` and `/FulcoEM` are the same account), and the
 * profile is opened by that persona's id -- ids stay opaque, nothing is parsed.
 *
 * STATES.
 *  - directory still loading: a "Loading profile..." status (never a premature
 *    "doesn't exist").
 *  - handle matches no persona: `<Profile>` is mounted with an id that cannot
 *    match anything, which renders its own existing "This account doesn't exist."
 *    state -- the same copy and semantics the profile page has always had.
 *  - a RESERVED first segment (`/staff`, `/login`, `/hashtag`, ...) is not a
 *    handle at all: it is redirected Home (COR-004 -- a participant typing
 *    `/staff` must not read as a missing account, nor reach a staff route).
 *
 * `<Profile>` renders its own `<h1>` (the display name) once resolved; in the two
 * non-happy states there is no such heading, so the header supplies a "Profile"
 * `<h1>` and focus still has somewhere to land.
 *
 * World: participant. No COBRA, no MUI.
 */

import { useParams } from 'react-router-dom'
import { Profile } from '../../pages/Profile'
import { DetailHeader } from '../DetailHeader'
import { useSocialDirectory } from '../socialDirectory'
import { HOME_PATH, isReservedSegment } from '../socialNavigation'
import { SocialRedirect } from './SocialRedirect'
import styles from './routes.module.css'

/** A persona id no cast can contain: drives `<Profile>`'s own "doesn't exist" state. */
const UNRESOLVED_PERSONA_ID = 'unresolved-handle'

export function ProfileRoute() {
  const { handle = '' } = useParams()
  const directory = useSocialDirectory()

  if (handle === '' || isReservedSegment(handle)) return <SocialRedirect to={HOME_PATH} />

  const persona = directory.findByHandle(handle)

  return (
    <div data-testid="social-profile-region">
      {directory.loading
        ? (
          <>
            <DetailHeader title="Profile" />
            <p className={styles.status} role="status">Loading profile…</p>
          </>
        )
        : (
          <>
            <DetailHeader {...(persona === undefined ? { title: 'Profile' } : {})} />
            <Profile personaId={persona?.id ?? UNRESOLVED_PERSONA_ID} />
          </>
        )}
    </div>
  )
}
