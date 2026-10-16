/**
 * core/auth/sessionResolver.ts
 * ---------------------------------------------------------------------------
 * Wave-1 mock resolver for the short-lived, exercise-bound session a Pulse
 * participant holds (COR-012; feature: identity-auth-roles, story 03 —
 * docs/features/identity-auth-roles/03-sessions.md).
 *
 * Split out from `session.tsx` (provider + hook) exactly as
 * `exerciseContextResolver.ts` is split from `exerciseContext.tsx`: the
 * resolver is pure, transport-shaped, and unit-testable on its own, and the
 * provider file stays component/hook-only (fast-refresh clean).
 *
 * `resolveSession()` is routed through the shared axios client
 * (`core/services/api.ts`) so its request shape matches a real `/session`
 * endpoint once the backend lands — swapping the mock adapter for a live call
 * needs no change to the provider or any consumer. It resolves EXACTLY ONE
 * session, bound to one exercise + one account (or one read-only session,
 * COR-015): there is no session list and no account picker here.
 *
 * Fail-closed: a malformed/empty body, an out-of-vocabulary role, or an
 * ALREADY-EXPIRED session throws, so the provider renders nothing rather than
 * ever handing back a default/unscoped session (the anchor the isolation
 * guarantee COR-001 relies on). The expired case throws the typed
 * `SessionExpiredError` (the server confirmed the sign-in is over: the provider sends the
 * person to sign in); a malformed body stays a plain `Error` (it proves nothing about the
 * sign-in, e.g. a captive portal's HTML page: the provider offers a retry).
 *
 * World: platform/foundation. Pure `core/` module — no UI, no COBRA. Note the
 * session's `expiresAt` is REAL wall-clock (auth lifetime is a real-time
 * concern, not scenario time) — this is a staff/foundation module, exempt from
 * the participant scenario-time rule; `expiresAt` is never shown in-fiction.
 */

import type { AxiosAdapter } from 'axios'
import { api } from '../services/api'
import { isSessionRole, type ExerciseRole, type OrgRole, type SessionScope } from './roles'
import { USE_MOCK_DATA } from '../config/mockData'
import { SessionExpiredError } from './sessionExpiredError'

/** Fields every session carries, whatever its scope. */
interface SessionBase {
  /** The person the session was minted for; `null` for a one-off participant / read-only viewer. */
  readonly personId: string | null
  /** `staff` (staff sessions) or `participant` (participant + read-only). One world per origin. */
  readonly world: SessionWorld
  /** Whether the person holds the exercise's lead-controller enrollment (read live server-side). */
  readonly isLead: boolean
  readonly accountId: string
  readonly personaId?: string
  readonly actingHumanId: string
  readonly isReadOnly: boolean
  /** ISO-8601 wall-clock expiry — short-lived; past expiry forces re-auth. */
  readonly expiresAt: string
}

/** A session bound to exactly one exercise, carrying an `ExerciseRole`. */
export interface ExerciseSession extends SessionBase {
  readonly scope: 'exercise'
  readonly exerciseId: string
  readonly role: ExerciseRole
}

/** An org-scope session: no exercise bound, `orgAdmin` only (ADMIN-IDENTITY-MODEL §1.2/§9). */
export interface OrgSession extends SessionBase {
  readonly scope: 'org'
  readonly exerciseId: null
  readonly role: OrgRole
}

/**
 * The bound session for the current user (COR-012), discriminated on `scope`: an exercise session
 * is bound to ONE exercise and carries an `ExerciseRole`; an org session has no exercise and
 * carries `orgAdmin`. `personaId` is the persona this account posts as; `actingHumanId` is the
 * human behind the account for per-human attribution (COR-018); `isReadOnly` marks a shared
 * view-only session (COR-015).
 */
export type Session = ExerciseSession | OrgSession

/** Which world a session belongs to (matches the server's `world` value). */
export type SessionWorld = 'staff' | 'participant'

/** Mock session lifetime (short-lived, COR-012). */
export const SESSION_TTL_MS = 60 * 60 * 1000

/** Wire shape of the `/session` response body (the frozen `SessionDto`). */
interface SessionResponseBody {
  readonly exerciseId: string | null
  readonly personId: string | null
  readonly world: SessionWorld
  readonly scope: SessionScope
  readonly isLead: boolean
  readonly accountId: string
  readonly role: ExerciseRole | OrgRole
  readonly personaId?: string
  readonly actingHumanId: string
  readonly isReadOnly: boolean
  readonly expiresAt: string
}

/**
 * The one fixed mock session (dev/test only — see `USE_MOCK_SESSION`). The
 * current participant is Dana Reyes, a citizen bound to the mock exercise
 * `ex-mock-0001`; `personaId`/`actingHumanId` line up with the persona cast
 * and telemetry attribution the sibling seed stories reference. `expiresAt` is
 * stamped fresh on each resolve so the mock is never already-expired.
 */
const MOCK_SESSION_BASE: Omit<SessionResponseBody, 'expiresAt'> = {
  exerciseId: 'ex-mock-0001',
  personId: null,
  world: 'participant',
  scope: 'exercise',
  isLead: false,
  accountId: 'acct-dreyes',
  role: 'participant',
  personaId: 'persona-dreyes_fh',
  actingHumanId: 'human-dreyes',
  isReadOnly: false,
}

/**
 * Short-circuits the network with a canned session, while still exercising the
 * shared axios client's request pipeline exactly as a live call would. Stamps
 * a fresh `expiresAt` (now + TTL) per call.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: { ...MOCK_SESSION_BASE, expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() },
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (mirrors `exerciseContextResolver.ts`): mock
 * in dev/test, real `/session` endpoint in a production build (fails closed
 * until the backend lands). One env-guarded place, never per-call, so a
 * forgotten `adapter:` can't fail *open* to a mock session in production.
 */
const USE_MOCK_SESSION = USE_MOCK_DATA

function isValidBody(body: SessionResponseBody | null | undefined): body is SessionResponseBody {
  if (!body) return false
  // Scope and exercise binding must agree: exercise scope binds an exercise, org scope binds none.
  const exerciseBindingOk = body.scope === 'org'
    ? body.exerciseId === null
    : typeof body.exerciseId === 'string' && body.exerciseId.length > 0
  return (
    exerciseBindingOk &&
    (body.personId === null || (typeof body.personId === 'string' && body.personId.length > 0)) &&
    (body.world === 'staff' || body.world === 'participant') &&
    typeof body.isLead === 'boolean' &&
    typeof body.accountId === 'string' && body.accountId.length > 0 &&
    isSessionRole(body.scope, body.role) &&
    (body.personaId === undefined || typeof body.personaId === 'string') &&
    typeof body.actingHumanId === 'string' && body.actingHumanId.length > 0 &&
    typeof body.isReadOnly === 'boolean' &&
    typeof body.expiresAt === 'string' && !Number.isNaN(Date.parse(body.expiresAt))
  )
}

/**
 * True when `session` is at/past its expiry relative to `now`. `now` is
 * injected (not read internally) so callers/tests control the reference — a
 * bad/absent expiry counts as expired (fail-closed).
 */
export function isSessionExpired(session: Session, now: Date): boolean {
  const expiry = Date.parse(session.expiresAt)
  return Number.isNaN(expiry) || expiry <= now.getTime()
}

/**
 * Resolves the current participant's single bound session.
 *
 * Always routed through the shared axios client. Throws on request failure, a
 * malformed/empty body, or an already-expired session, so the provider can
 * fail closed rather than serve a default/expired session (COR-012, COR-001).
 */
export async function resolveSession(): Promise<Session> {
  const response = await api.get<SessionResponseBody>(
    '/session',
    USE_MOCK_SESSION ? { adapter: mockAdapter } : undefined,
  )

  if (!isValidBody(response.data)) {
    throw new Error('resolveSession: resolution returned an empty or malformed session')
  }

  const body = response.data
  const common = {
    personId: body.personId,
    world: body.world,
    isLead: body.isLead,
    accountId: body.accountId,
    personaId: body.personaId,
    actingHumanId: body.actingHumanId,
    isReadOnly: body.isReadOnly,
    expiresAt: body.expiresAt,
  }
  // `isValidBody` already proved scope/role/exerciseId agree; this re-narrows for the union.
  const session: Session = body.scope === 'org'
    ? { ...common, scope: 'org', exerciseId: null, role: 'orgAdmin' }
    : { ...common, scope: 'exercise', exerciseId: body.exerciseId as string, role: body.role as ExerciseRole }

  if (isSessionExpired(session, new Date())) {
    // The server answered with a well-formed session that is over: a typed failure, so the
    // provider sends the person to sign in instead of offering a pointless retry (W2-2).
    throw new SessionExpiredError()
  }

  return session
}
