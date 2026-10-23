/**
 * features/orgDirectory/components/OrgPeopleTable.tsx
 * ---------------------------------------------------------------------------
 * The org people table (story 19, #574): a real `<table>` with a caption, column headers, and per
 * row: name + email, status (org-admin badge, disabled, locked-out: ALWAYS icon + text, never
 * colour alone), an enrollment summary (exercise name + role, lead marker) and the actions, each
 * opening `PersonActionDialog`. The caller's own row offers no Disable (and says "you"); the
 * server's `cannot-disable-self` 409 is still mapped in the dialog. "Reset link" is disabled on
 * org-admin and disabled rows with a VISIBLE text reason (the server would 409; the 409 mappings
 * stay for a stale row). A dialog's success sentence is passed up via `onActionSuccess`.
 * STAFF world, COBRA, FontAwesome.
 */

import { useId, useState, type ReactNode } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faBan,
  faKey,
  faLock,
  faShieldHalved,
  faStar,
  faUserCheck,
  faUserMinus,
  faUserPlus,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { CobraSecondaryButton } from '@/theme/styledComponents'
import type { OrgPerson } from '../types'
import { PersonActionDialog } from './PersonActionDialog'
import { resetUnavailableReason, type PersonActionKind } from './personActions'

const CELL_SX = {
  padding: '8px 12px',
  borderBottom: '1px solid',
  borderBottomColor: 'grid.main',
  textAlign: 'left',
  verticalAlign: 'top',
} as const

const ACTION_SX = { minWidth: 0, whiteSpace: 'nowrap' } as const

function Badge({ icon, text, testId }: { icon: IconDefinition; text: string; testId?: string }) {
  return (
    <Stack
      direction="row"
      data-testid={testId}
      sx={{ alignItems: 'center', gap: 0.75, fontSize: 12, fontWeight: 700 }}
    >
      <FontAwesomeIcon icon={icon} aria-hidden="true" />
      <span>{text}</span>
    </Stack>
  )
}

export interface OrgPeopleTableProps {
  readonly people: readonly OrgPerson[]
  /** The signed-in person's id, so their own Disable is not offered. */
  readonly currentPersonId: string | null
  /** Receives the short success sentence of a completed action (for the page status region). */
  readonly onActionSuccess?: (message: string) => void
  /**
   * TODO(#667 merge): the per-exercise staff link hook. Receives an enrollment's exercise and
   * returns the node to render for its name; the default is PLAIN TEXT. #667's merge passes a link
   * to that exercise's staff editor here. Nothing from #667 is imported by this feature.
   */
  readonly renderExerciseLink?: (exerciseId: string, exerciseName: string) => ReactNode
}

const plainExerciseName = (_exerciseId: string, exerciseName: string): ReactNode => exerciseName

export function OrgPeopleTable({
  people,
  currentPersonId,
  onActionSuccess,
  renderExerciseLink = plainExerciseName,
}: OrgPeopleTableProps) {
  const [open, setOpen] = useState<{ person: OrgPerson; kind: PersonActionKind } | null>(null)
  const reasonIdPrefix = useId()

  return (
    <>
      <Box
        component="table"
        data-testid="org-people-table"
        sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}
      >
        <caption style={{ textAlign: 'left', position: 'absolute', left: -10000 }}>
          People in your organization
        </caption>
        <thead>
          <tr>
            {['Person', 'Status', 'Exercises', 'Actions'].map(h => (
              <Box component="th" scope="col" key={h} sx={CELL_SX}>{h}</Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {people.map(p => {
            const isSelf = currentPersonId !== null && p.id === currentPersonId
            const isAdmin = p.orgRole === 'orgAdmin'
            const resetReason = resetUnavailableReason(p)
            const resetReasonId = `${reasonIdPrefix}-reset-${p.id}`
            return (
              <tr key={p.id} data-testid={`org-person-${p.id}`}>
                <Box component="td" sx={CELL_SX}>
                  <Typography sx={{ fontSize: 13, fontWeight: 700 }}>
                    {p.displayName}{isSelf ? ' (you)' : ''}
                  </Typography>
                  <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                    {p.email ?? 'No email'}
                  </Typography>
                </Box>
                <Box component="td" sx={CELL_SX}>
                  <Stack sx={{ gap: 0.5 }}>
                    {isAdmin && <Badge icon={faShieldHalved} text="Org admin" testId="badge-org-admin" />}
                    {p.disabled && <Badge icon={faBan} text="Disabled" testId="badge-disabled" />}
                    {p.lockedOutUntil !== null && (
                      <Badge icon={faLock} text="Locked out" testId="badge-locked-out" />
                    )}
                    {!isAdmin && !p.disabled && p.lockedOutUntil === null && (
                      <span style={{ fontSize: 12 }}>Active</span>
                    )}
                  </Stack>
                </Box>
                <Box component="td" sx={CELL_SX}>
                  {p.enrollments.length === 0
                    ? <span style={{ fontSize: 12 }}>No exercises</span>
                    : (
                      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                        {p.enrollments.map(e => (
                          <li key={`${e.exerciseId}-${e.role}`} style={{ fontSize: 12 }}>
                            {renderExerciseLink(e.exerciseId, e.exerciseName)}: {e.role}
                            {e.isLead && (
                              <>
                                {' '}
                                <FontAwesomeIcon icon={faStar} aria-hidden="true" />
                                {' '}(lead)
                              </>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                </Box>
                <Box component="td" sx={CELL_SX}>
                  <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
                    <CobraSecondaryButton
                      type="button"
                      size="small"
                      sx={ACTION_SX}
                      startIcon={<FontAwesomeIcon icon={isAdmin ? faUserMinus : faUserPlus} aria-hidden="true" />}
                      aria-label={`${isAdmin ? 'Remove org admin from' : 'Make org admin'} ${p.displayName}`}
                      onClick={() => setOpen({ person: p, kind: isAdmin ? 'revokeAdmin' : 'grantAdmin' })}
                    >
                      {isAdmin ? 'Remove admin' : 'Make admin'}
                    </CobraSecondaryButton>
                    {!isSelf && (
                      <CobraSecondaryButton
                        type="button"
                        size="small"
                        sx={ACTION_SX}
                        startIcon={<FontAwesomeIcon icon={p.disabled ? faUserCheck : faBan} aria-hidden="true" />}
                        aria-label={`${p.disabled ? 'Enable' : 'Disable'} ${p.displayName}`}
                        onClick={() => setOpen({ person: p, kind: p.disabled ? 'enable' : 'disable' })}
                      >
                        {p.disabled ? 'Enable' : 'Disable'}
                      </CobraSecondaryButton>
                    )}
                    <CobraSecondaryButton
                      type="button"
                      size="small"
                      sx={ACTION_SX}
                      startIcon={<FontAwesomeIcon icon={faKey} aria-hidden="true" />}
                      aria-label={`Copy password-reset link for ${p.displayName}`}
                      aria-describedby={resetReason === null ? undefined : resetReasonId}
                      disabled={resetReason !== null}
                      onClick={() => setOpen({ person: p, kind: 'resetPassword' })}
                    >
                      Reset link
                    </CobraSecondaryButton>
                  </Stack>
                  {resetReason !== null && (
                    <Typography
                      id={resetReasonId}
                      data-testid="reset-unavailable-reason"
                      sx={{ fontSize: 12, mt: 0.5 }}
                    >
                      {resetReason}
                    </Typography>
                  )}
                </Box>
              </tr>
            )
          })}
        </tbody>
      </Box>
      {open !== null && (
        <PersonActionDialog
          person={open.person}
          kind={open.kind}
          isSelf={currentPersonId !== null && open.person.id === currentPersonId}
          onClose={() => setOpen(null)}
          onSuccess={onActionSuccess}
        />
      )}
    </>
  )
}
