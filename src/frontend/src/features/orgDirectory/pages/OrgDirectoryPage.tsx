/**
 * features/orgDirectory/pages/OrgDirectoryPage.tsx
 * ---------------------------------------------------------------------------
 * The PEOPLE DIRECTORY work area (identity-auth-roles story 19, #574) at `/staff/people`. The shell
 * owns the header; this renders the single `h1`, the search box, a live-region status line (result
 * count / loading), an alert on read failure, the table and prev/next paging.
 *
 * ROLE GATING. Org admin only. Any other role sees a short notice and NO request is made (the
 * inner component, which owns the query, is never mounted). The server 403s regardless; this is
 * only so a control is absent instead of failing. STAFF world: COBRA, FontAwesome, sx-only.
 */

import { useState, type FormEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faAddressBook,
  faChevronLeft,
  faChevronRight,
  faMagnifyingGlass,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { useOptionalSession, usePermissions } from '@/core/auth'
import { CobraSecondaryButton, CobraTextField } from '@/theme/styledComponents'
import { OrgPeopleTable } from '../components/OrgPeopleTable'
import { useOrgPeople } from '../hooks/useOrgPeople'

/** Page size; the server default and an easy dense read. */
export const DIRECTORY_PAGE_SIZE = 25
const MAX_SEARCH = 200

function Directory() {
  const session = useOptionalSession()
  const [draft, setDraft] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const people = useOrgPeople({ search, page, pageSize: DIRECTORY_PAGE_SIZE })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setSearch(draft.trim())
  }

  const data = people.data
  const lastPage = data === undefined ? 1 : Math.max(1, Math.ceil(data.total / data.pageSize))
  const status = people.isPending
    ? 'Loading people…'
    : data === undefined
      ? ''
      : `${data.total} ${data.total === 1 ? 'person' : 'people'}${search ? ` matching "${search}"` : ''}. Page ${data.page} of ${lastPage}.`

  return (
    <>
      <Box component="form" role="search" onSubmit={submit} sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <CobraTextField
          label="Search by name or email"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          slotProps={{ htmlInput: { maxLength: MAX_SEARCH } }}
          size="small"
          sx={{ minWidth: 320 }}
        />
        <CobraSecondaryButton
          type="submit"
          startIcon={<FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />}
        >
          Search
        </CobraSecondaryButton>
      </Box>

      <div role="status" aria-live="polite" data-testid="org-people-status">{status}</div>

      {people.isError && (
        <Stack
          role="alert"
          direction="row"
          data-testid="org-people-error"
          sx={{ gap: 1, alignItems: 'flex-start' }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" style={{ marginTop: 3 }} />
          <span>The people list could not be loaded. Try again in a moment.</span>
          <CobraSecondaryButton type="button" onClick={() => { void people.refetch() }}>
            Try again
          </CobraSecondaryButton>
        </Stack>
      )}

      {data !== undefined && (
        data.items.length === 0
          ? <Typography data-testid="org-people-empty">No people found.</Typography>
          : <OrgPeopleTable people={data.items} currentPersonId={session?.personId ?? null} />
      )}

      {data !== undefined && lastPage > 1 && (
        <Stack direction="row" component="nav" aria-label="Pagination" sx={{ gap: 1, alignItems: 'center' }}>
          <CobraSecondaryButton
            type="button"
            disabled={page <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            startIcon={<FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />}
          >
            Previous
          </CobraSecondaryButton>
          <CobraSecondaryButton
            type="button"
            disabled={page >= lastPage}
            onClick={() => setPage(p => p + 1)}
            endIcon={<FontAwesomeIcon icon={faChevronRight} aria-hidden="true" />}
          >
            Next
          </CobraSecondaryButton>
        </Stack>
      )}
    </>
  )
}

export function OrgDirectoryPage() {
  const isOrgAdmin = usePermissions().role === 'orgAdmin'
  return (
    <Box
      data-testid="org-directory-page"
      sx={{ padding: CobraStyles.Padding.MainWindow, display: 'flex', flexDirection: 'column', gap: 2 }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <FontAwesomeIcon icon={faAddressBook} aria-hidden="true" />
        <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
          People directory
        </Typography>
      </Stack>
      {isOrgAdmin
        ? <Directory />
        : <Typography data-testid="org-directory-denied">Only organization admins can open the people directory.</Typography>}
    </Box>
  )
}
