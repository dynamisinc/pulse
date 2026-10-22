/**
 * features/planner/components/StaffPanel.tsx
 * ---------------------------------------------------------------------------
 * The planner "Staff" section of Exercise Settings (identity-auth-roles story 20, #575a).
 * STAFF world: COBRA components, FontAwesome only, MUI 9 `sx`-only. Self-contained (own hooks,
 * own states), mounted from the page's `SECTIONS` registry like the other panels.
 *
 * WHAT IT DOES. Lists who holds a staff role in the planner's CURRENT exercise (the exercise id
 * comes from the exercise context; the server enforces scope). A planner can add an org person
 * from `candidates` with a role, change a role (native select), remove someone, and make a
 * controller the lead. Remove / Make lead / EVERY role change go through one confirm dialog.
 *
 * RULES THE UI CARRIES.
 *  - Lead is shown as icon + the word "Lead", never colour alone (NFR-001).
 *  - Make lead warns that it turns swamped mode off (Phase 2 server behaviour, #642). It is gated
 *    by `can('setLeadController')` (planner only), not `assignStaff`: an org admin can assign
 *    staff but not pick the lead, so it is hidden rather than offered and 403'd.
 *  - A role change signs that person out of this exercise (the server revokes their sessions so
 *    the new role takes effect), so every change is confirmed first and says so (S-002).
 *  - Removing or demoting the LEAD warns that the exercise is left with no lead and swamped mode
 *    turns off (W-003); that sentence joins whichever confirm applies.
 *  - Removing or demoting YOURSELF warns you are signed out of it (demoting also says you keep the
 *    new staff role but lose planner access). The server revokes the sessions; on success, an
 *    exercise-bound session is then ended through the shared sign-out path (`endSession()` + the
 *    login route), so the page never sits on stale planner controls backed by a revoked token. An
 *    org-scope session is not revoked by the server (it is not minted from the exercise grant), so
 *    it stays.
 *  - Successes are announced in a page-level polite `role="status"` region (W-001); failures show
 *    inline in a `role="alert"` block (icon + words) mapped by `staffErrors.ts`; 409/404 also
 *    refetch. Every success refetches; nothing is optimistic.
 * The server is the authority (403s, last-planner, conflicts); this only hides what cannot work.
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleNotch,
  faStar,
  faTriangleExclamation,
  faUserPlus,
  faUsers,
} from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { endSession, useOptionalSession, usePermissions } from '@/core/auth'
import { LOGIN_PATH } from '@/features/app-shell/constants'
import { useOptionalExerciseContext } from '@/core/exerciseContext'
import { CobraLinkButton, CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { useStaffMutations, useStaffRoster } from '../hooks/useStaffAssignment'
import { needsRefetch, staffErrorMessage } from '../services/staffErrors'
import { STAFF_ROLES, type StaffEnrollment, type StaffRole } from '../types/staff'
import { StaffConfirmDialog } from './StaffConfirmDialog'

const ROLE_LABEL: Readonly<Record<StaffRole, string>> = {
  planner: 'Planner',
  controller: 'Controller',
  evaluator: 'Evaluator',
}

/** "a Controller" / "an Evaluator", for the success announcement. */
const withArticle = (role: StaffRole) =>
  `${role === 'evaluator' ? 'an' : 'a'} ${ROLE_LABEL[role]}`

type Pending =
  | { readonly kind: 'remove'; readonly row: StaffEnrollment; readonly self: boolean }
  | { readonly kind: 'lead'; readonly row: StaffEnrollment }
  | {
    readonly kind: 'role'
    readonly row: StaffEnrollment
    readonly role: StaffRole
    readonly self: boolean
  }

const SELF_REMOVE_WARNING =
  'You are changing your own role. You will lose your staff role in this exercise and be '
  + 'signed out of it.'

const LEAD_WARNING =
  'This person is the lead controller. The exercise will have no lead, and swamped mode turns off.'

function dialogCopy(pending: Pending): {
  title: string
  paragraphs: string[]
  confirm: string
  destructive: boolean
} {
  const name = pending.row.displayName
  const leadLines = pending.kind !== 'lead' && pending.row.isLead ? [LEAD_WARNING] : []
  if (pending.kind === 'lead') {
    return {
      title: `Make ${name} the lead?`,
      paragraphs: [
        `${name} becomes the lead controller for this exercise.`,
        'Changing the lead turns swamped mode off.',
      ],
      confirm: 'Make lead',
      destructive: false,
    }
  }
  if (pending.kind === 'role') {
    const label = ROLE_LABEL[pending.role]
    if (pending.self) {
      // S-003: say what you keep (the new staff role), what you lose, and that it is immediate.
      const selfLine = pending.row.role === 'planner'
        ? `You keep a staff role in this exercise as ${label}, but you lose planner access and `
          + 'will be signed out now.'
        : `You will be signed out of this exercise and must sign in again as ${label}.`
      return {
        title: `Change your role to ${label}?`,
        paragraphs: [selfLine, ...leadLines],
        confirm: 'Change role',
        destructive: true,
      }
    }
    return {
      title: `Change ${name}'s role to ${label}?`,
      paragraphs: [
        `${name} will be signed out of this exercise and must sign in again as ${label}.`,
        ...leadLines,
      ],
      confirm: 'Change role',
      destructive: pending.row.isLead,
    }
  }
  return {
    title: `Remove ${name}?`,
    paragraphs: [
      `${name} will lose their staff role in this exercise.`,
      ...leadLines,
      ...(pending.self ? [SELF_REMOVE_WARNING] : []),
    ],
    confirm: 'Remove',
    destructive: true,
  }
}

/** The polite announcement for a write that succeeded (W-001). */
function successMessage(pending: Pending): string {
  const name = pending.row.displayName
  if (pending.kind === 'lead') return `${name} is now the lead controller.`
  if (pending.kind === 'role') return `${name} is now ${withArticle(pending.role)}.`
  return `Removed ${name}.`
}

export function StaffPanel() {
  // Optional on purpose: with no resolved exercise there is nothing to list (fails closed).
  const exerciseId = useOptionalExerciseContext()?.exerciseId ?? ''
  const { can } = usePermissions()
  const session = useOptionalSession()
  const myPersonId = session?.personId ?? null
  const navigate = useNavigate()
  const roster = useStaffRoster(exerciseId)
  const m = useStaffMutations(exerciseId)

  const [error, setError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const [candidateId, setCandidateId] = useState('')
  const [newRole, setNewRole] = useState<StaffRole>('controller')

  if (!can('assignStaff') || exerciseId === '') return null

  const busy = m.grant.isPending || m.changeRole.isPending || m.remove.isPending
    || m.makeLead.isPending

  /**
   * Runs one write; success clears the error (the hook refetched) and announces `success`
   * politely, failure explains itself in the alert region.
   */
  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    setError(null)
    setAnnouncement('')
    try {
      await action()
      setAnnouncement(success)
      return true
    } catch (e) {
      setError(staffErrorMessage(e))
      if (needsRefetch(e)) void m.refresh()
      return false
    }
  }

  // W-002: planner only — an org admin assigns staff but does not pick the lead.
  const canMakeLead = can('setLeadController')
  const isSelf = (row: StaffEnrollment) => myPersonId !== null && row.personId === myPersonId

  /** Every role change signs someone out, so it always goes through the confirm (S-002). */
  function onRoleSelect(row: StaffEnrollment, role: StaffRole) {
    if (role === row.role) return
    setPending({ kind: 'role', row, role, self: isSelf(row) })
  }

  async function confirm() {
    if (pending === null) return
    const p = pending
    const ok = await run(() => {
      if (p.kind === 'lead') return m.makeLead.mutateAsync({ id: p.row.id })
      if (p.kind === 'role') return m.changeRole.mutateAsync({ id: p.row.id, role: p.role })
      return m.remove.mutateAsync({ id: p.row.id })
    }, successMessage(p))
    setPending(null)
    // A self role change / self-remove revoked this exercise-bound session server-side (the
    // grant-revoke rule): end it here and go to sign-in, exactly as the header's sign-out does,
    // rather than leave planner controls on screen that the next call would 401.
    const selfChange = p.kind !== 'lead' && p.self
    if (ok && selfChange && session?.scope === 'exercise') {
      void endSession()
      navigate(LOGIN_PATH)
    }
  }

  async function onGrant() {
    if (candidateId === '') return
    const who = roster.data?.candidates.find(c => c.personId === candidateId)?.displayName
      ?? 'The person'
    const ok = await run(
      () => m.grant.mutateAsync({ personId: candidateId, role: newRole }),
      `${who} added as ${ROLE_LABEL[newRole]}.`,
    )
    if (ok) setCandidateId('')
  }

  const data = roster.data
  const copy = pending === null ? null : dialogCopy(pending)

  return (
    <Box
      data-testid="staff-panel"
      sx={{ padding: CobraStyles.Padding.MainWindow, maxWidth: 960 }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <FontAwesomeIcon icon={faUsers} aria-hidden />
        <Typography variant="h6" component="h2" sx={{ fontWeight: 700 }}>
          Staff
        </Typography>
      </Stack>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
        Who can plan, run and evaluate this exercise. Changes take effect immediately.
      </Typography>

      <Box
        role="status"
        aria-live="polite"
        data-testid="staff-status"
        sx={{ mt: 1.5 }}
      >
        {announcement !== '' ? <Typography variant="body2">{announcement}</Typography> : null}
      </Box>

      <Box role="alert" data-testid="staff-error-region" sx={{ mt: 1.5 }}>
        {error !== null ? (
          <Stack
            direction="row"
            data-testid="staff-error"
            sx={{ gap: 1, alignItems: 'flex-start', color: 'notifications.errorText' }}
          >
            <Box component="span" sx={{ mt: '2px' }}>
              <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
            </Box>
            <Typography variant="body2">{error}</Typography>
          </Stack>
        ) : null}
      </Box>

      {roster.isPending ? (
        <Stack role="status" direction="row" sx={{ gap: 1, mt: 2, alignItems: 'center' }}>
          <FontAwesomeIcon icon={faCircleNotch} spin aria-hidden />
          <Typography variant="body2">Loading staff&hellip;</Typography>
        </Stack>
      ) : roster.isError || data === undefined ? (
        <Stack role="alert" direction="row" sx={{ gap: 1, mt: 2, color: 'notifications.errorText' }}>
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
          <Typography variant="body2">The staff list could not be loaded.</Typography>
          <CobraLinkButton type="button" onClick={() => void roster.refetch()}>
            Try again
          </CobraLinkButton>
        </Stack>
      ) : (
        <>
          {data.enrollments.length === 0 ? (
            <Typography variant="body2" sx={{ mt: 2 }} data-testid="staff-empty">
              No one has a staff role in this exercise yet.
            </Typography>
          ) : (
            <Box sx={{ overflowX: 'auto', mt: 2 }}>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                <caption style={{ position: 'absolute', left: -9999 }}>
                  Staff in this exercise
                </caption>
                <thead>
                  <tr>
                    {['Name', 'Email', 'Role', 'Actions'].map(h => (
                      <Box
                        component="th"
                        scope="col"
                        key={h}
                        sx={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid',
                          borderColor: 'divider' }}
                      >
                        {h}
                      </Box>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.enrollments.map(row => (
                    <Box
                      component="tr"
                      key={row.id}
                      data-testid={`staff-row-${row.id}`}
                      sx={{ '& td, & th': { padding: '6px 8px', borderBottom: '1px solid',
                        borderColor: 'divider' } }}
                    >
                      <th scope="row" style={{ textAlign: 'left', fontWeight: 600 }}>
                        {row.displayName}
                        {isSelf(row) ? ' (you)' : ''}
                        {row.isLead ? (
                          <Box
                            component="span"
                            data-testid="staff-lead-marker"
                            sx={{ ml: 1, display: 'inline-flex', gap: 0.5, alignItems: 'center',
                              fontWeight: 700 }}
                          >
                            <FontAwesomeIcon icon={faStar} aria-hidden />
                            Lead
                          </Box>
                        ) : null}
                      </th>
                      <td>{row.email ?? '—'}</td>
                      <td>
                        <CobraTextField
                          select
                          size="small"
                          value={row.role}
                          disabled={busy}
                          onChange={e => onRoleSelect(row, e.target.value as StaffRole)}
                          slotProps={{
                            select: { native: true },
                            htmlInput: { 'aria-label': `Role for ${row.displayName}` },
                          }}
                        >
                          {STAFF_ROLES.map(r => (
                            <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                          ))}
                        </CobraTextField>
                      </td>
                      <td>
                        <Stack direction="row" sx={{ gap: 1 }}>
                          {row.role === 'controller' && !row.isLead && canMakeLead ? (
                            <CobraLinkButton
                              type="button"
                              disabled={busy}
                              aria-label={`Make ${row.displayName} lead`}
                              onClick={() => setPending({ kind: 'lead', row })}
                            >
                              Make lead
                            </CobraLinkButton>
                          ) : null}
                          <CobraLinkButton
                            type="button"
                            disabled={busy}
                            aria-label={`Remove ${row.displayName}`}
                            onClick={() => setPending({ kind: 'remove', row, self: isSelf(row) })}
                          >
                            Remove
                          </CobraLinkButton>
                        </Stack>
                      </td>
                    </Box>
                  ))}
                </tbody>
              </Box>
            </Box>
          )}

          <Typography variant="subtitle2" component="h3" sx={{ mt: 3, fontWeight: 700 }}>
            Add staff
          </Typography>
          {data.candidates.length === 0 ? (
            <Typography variant="body2" data-testid="staff-no-candidates" sx={{ mt: 0.5 }}>
              Everyone in your organisation already has a role in this exercise.
            </Typography>
          ) : (
            <Stack direction="row" sx={{ gap: 1, mt: 1, alignItems: 'center', flexWrap: 'wrap' }}>
              <CobraTextField
                select
                size="small"
                label="Person"
                value={candidateId}
                onChange={e => setCandidateId(e.target.value)}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
                sx={{ minWidth: 240 }}
              >
                <option value="">Choose a person</option>
                {data.candidates.map(c => (
                  <option key={c.personId} value={c.personId}>
                    {c.displayName}{c.email !== null ? ` (${c.email})` : ''}
                  </option>
                ))}
              </CobraTextField>
              <CobraTextField
                select
                size="small"
                label="Role"
                value={newRole}
                onChange={e => setNewRole(e.target.value as StaffRole)}
                slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
              >
                {STAFF_ROLES.map(r => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </CobraTextField>
              <CobraPrimaryButton
                type="button"
                disabled={candidateId === '' || busy}
                startIcon={<FontAwesomeIcon icon={faUserPlus} />}
                onClick={() => void onGrant()}
              >
                Add staff
              </CobraPrimaryButton>
            </Stack>
          )}
        </>
      )}

      {copy !== null && pending !== null ? (
        <StaffConfirmDialog
          open
          title={copy.title}
          paragraphs={copy.paragraphs}
          confirmLabel={copy.confirm}
          destructive={copy.destructive}
          pending={busy}
          onConfirm={() => void confirm()}
          onCancel={() => setPending(null)}
        />
      ) : null}
    </Box>
  )
}
