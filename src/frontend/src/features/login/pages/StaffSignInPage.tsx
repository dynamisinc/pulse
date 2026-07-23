/**
 * features/login/pages/StaffSignInPage.tsx
 * ---------------------------------------------------------------------------
 * The staff sign-in page (feature: login, story 03 — "Staff sign-in";
 * GitHub #306). A pre-auth, STAFF-world surface (D0 §2) — mounted at
 * `/staff/login` by a separate story (app-shell/04); this file owns ONLY the
 * page + its form, never the route table.
 *
 * TWO WORLDS (D0 §2): STAFF surface -> COBRA. This page is reached BEFORE any
 * session exists, so — unlike a post-auth staff surface, which inherits COBRA
 * from `RoleAwareEntry`'s `StaffWorldHandoff` (`features/app-shell/RoleAwareEntry.tsx`)
 * — there is no COBRA ancestor here. This page therefore mounts its OWN
 * `<ThemeProvider theme={cobraTheme}>`, exactly as `StaffWorldHandoff` does,
 * and uses ONLY `@/theme/styledComponents` (`CobraTextField`,
 * `CobraPrimaryButton`) for every input/button — never bare `@mui/material`
 * `TextField`/`Button` (the two-worlds gate). Layout primitives (`Box`,
 * `Stack`, `Typography`) come straight from `@mui/material`, matching
 * `ExerciseSwitcher.tsx`'s precedent.
 *
 * FORM SHAPE (AC1): username + secret ONLY. There is deliberately NO
 * exercise-id field — `exerciseId` is derived from the host, invisibly to the
 * staff member (see below), never typed or picked.
 *
 * DERIVING `exerciseId` (AC2 — a deliberate, reconciled deviation): there is
 * no pre-auth endpoint that lists a staff member's exercises, so this page
 * resolves the HOST's exercise context (`GET /exercise-context`, pre-auth-
 * safe, via `resolveExerciseContext` from `@/core/exerciseContext`) and uses
 * its `exerciseId` as the login body's `exerciseId`. It deliberately does
 * NOT wrap the form in `<ExerciseContextProvider>`: that provider is
 * fail-closed and renders `null` while loading AND on error (see
 * `core/exerciseContext/exerciseContext.tsx`), which would HIDE this page's
 * form on an unresolved host — making it impossible to satisfy AC1 (the form
 * must always render) and AC2 (the error must be shown ON the form, not
 * instead of it). Instead, resolution runs NON-BLOCKINGLY through React Query
 * (`useQuery`, `retry: false` — a stale/never-loading spinner is not useful
 * pre-auth and a transient failure should not auto-retry against a login
 * endpoint) so the form ALWAYS renders regardless of that query's state. On
 * submit: if the query has not resolved a scope (still loading, errored, or
 * `data` absent), the AC2 error is shown and `POST /auth/staff/login` is
 * NEVER attempted — this page never sends an empty/guessed `exerciseId`.
 *
 * ERROR MAPPING (AC4/AC5 — LAW, do not collapse): `staffSignInService`
 * surfaces the HTTP status on a typed `StaffSignInError`. A 401 (rejected
 * credentials) and a 403 (authenticated but NOT assigned to this exercise,
 * `StaffLoginOutcome.NotAssigned`) render TWO DISTINCT messages — a 403 is an
 * actionable, different failure ("contact your planner"), never folded into
 * the generic 401 copy. Only a 401 clears the secret field (AC4); a 403
 * leaves the form as-is (the credentials themselves were correct).
 *
 * ACCESSIBILITY (NFR-001): a real, labelled `<form>` (native inputs via
 * `CobraTextField`, each with its own `label`); the secret input is a real
 * `type="password"` (never shoulder-surfable, NFR-004/NFR-009); Enter submits
 * (native form submission — no keydown plumbing needed); error state is
 * `role="alert"` pairing a FontAwesome icon with text (never color alone,
 * mirroring `ExerciseSwitcher.tsx`'s `SwitcherAlert`); the in-flight state is
 * `role="status"`/`aria-live="polite"` (mirrors `ExerciseSwitcher.tsx`'s
 * `switching` block) so a screen reader announces "Signing in…" without
 * losing the form.
 *
 * CONTENT SECURITY (NFR-004/NFR-009): the secret is never logged and never
 * rendered back anywhere on this page (see `staffSignInService.ts`'s own
 * header for the service-layer half of that contract).
 *
 * SCENARIO TIME (COR-053): not applicable — staff world, pre-auth, no
 * participant-visible timestamps.
 */

import { useState, type FormEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { cobraTheme } from '@/theme/cobraTheme'
import { setTokens } from '@/core/auth'
import { resolveExerciseContext } from '@/core/exerciseContext'
import { staffSignIn, StaffSignInError } from '../services/staffSignInService'

/** AC2 — shown when the host's exercise context cannot be resolved at submit time. */
const UNRESOLVED_CONTEXT_MESSAGE =
  "This address isn't configured for staff sign-in — check the URL your planner gave you."

/** AC4 — the ONE generic message for rejected credentials (401). Never reveals which field. */
const INVALID_CREDENTIALS_MESSAGE = "Those credentials weren't recognized."

/** AC5 — DISTINCT from the 401 copy: authenticated, but not assigned to this exercise (403). */
const NOT_ASSIGNED_MESSAGE = "You're not assigned to this exercise. Contact your planner."

/** Maps a thrown `StaffSignInError` to clear, status-aware staff-facing copy (AC4/AC5). */
function friendlySignInErrorMessage(error: StaffSignInError): string {
  switch (error.status) {
    case 401:
      return INVALID_CREDENTIALS_MESSAGE
    case 403:
      return NOT_ASSIGNED_MESSAGE
    case 400:
      return error.serverMessage
        ? `Sign-in could not be completed: ${error.serverMessage}`
        : 'Sign-in could not be completed.'
    default:
      return error.status === undefined
        ? 'Could not reach the server. Check your connection and try again.'
        : (error.serverMessage ?? 'Sign-in failed. Try again.')
  }
}

/** A `role="alert"` pairing an icon with a message (never color alone); mirrors `SwitcherAlert`. */
function SignInAlert({ message }: { message: string }) {
  return (
    <Stack
      role="alert"
      direction="row"
      data-testid="staff-sign-in-error"
      sx={{ alignItems: 'flex-start', gap: 1, color: 'error.main' }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Typography variant="body2">{message}</Typography>
    </Stack>
  )
}

/**
 * The sign-in form. Split from `StaffSignInPage` so the page owns only the
 * COBRA theme hand-off + page chrome, and this owns the field state.
 */
function StaffSignInForm() {
  const navigate = useNavigate()

  // Non-blocking, host-resolved exercise scope (see module header). Never
  // gates rendering — only gates SUBMISSION (AC2).
  const contextQuery = useQuery({
    queryKey: ['staff-login', 'exercise-context'],
    queryFn: resolveExerciseContext,
    retry: false,
  })

  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting) return

    // AC2: block submission (and never POST) when the host's exercise
    // context is not a RESOLVED scope — loading, errored, and "no data yet"
    // all count as unresolved.
    if (contextQuery.isPending || contextQuery.isError || !contextQuery.data) {
      setErrorMessage(UNRESOLVED_CONTEXT_MESSAGE)
      return
    }

    const exerciseId = contextQuery.data.exerciseId
    setSubmitting(true)
    setErrorMessage(null)

    staffSignIn({ username, secret, exerciseId })
      .then(envelope => {
        setTokens({ token: envelope.token, refreshToken: envelope.refreshToken })
        navigate('/')
      })
      .catch((error: unknown) => {
        const signInError =
          error instanceof StaffSignInError
            ? error
            : new StaffSignInError('Sign-in failed unexpectedly.', { cause: error })
        setErrorMessage(friendlySignInErrorMessage(signInError))
        // AC4: ONLY a 401 clears the secret field. A 403 means the
        // credentials themselves were correct — clearing them would be
        // actively unhelpful (the fix is an assignment change, not a retry).
        if (signInError.status === 401) {
          setSecret('')
        }
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      aria-label="Staff sign-in"
      data-testid="staff-sign-in-form"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', maxWidth: 360 }}
    >
      <CobraTextField
        label="Username"
        name="username"
        autoComplete="username"
        value={username}
        onChange={event => setUsername(event.target.value)}
        disabled={submitting}
        required
        fullWidth
      />
      <CobraTextField
        label="Secret"
        name="secret"
        type="password"
        autoComplete="current-password"
        value={secret}
        onChange={event => setSecret(event.target.value)}
        disabled={submitting}
        required
        fullWidth
      />

      <CobraPrimaryButton type="submit" disabled={submitting} fullWidth>
        Sign in
      </CobraPrimaryButton>

      {submitting ? (
        <Stack
          direction="row"
          role="status"
          aria-live="polite"
          data-testid="staff-sign-in-submitting"
          sx={{ alignItems: 'center', gap: 1, color: 'text.secondary' }}
        >
          <FontAwesomeIcon icon={faCircleNotch} spin aria-hidden />
          <Typography variant="body2">Signing in…</Typography>
        </Stack>
      ) : null}

      {errorMessage ? <SignInAlert message={errorMessage} /> : null}
    </Box>
  )
}

/**
 * The staff sign-in page. See module header for the full contract. Renders
 * standalone — no ancestor providers required beyond the app-wide React
 * Query `QueryClientProvider` (`App.tsx` already supplies this at the root).
 */
export function StaffSignInPage() {
  return (
    <ThemeProvider theme={cobraTheme}>
      <Box
        sx={{
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
          p: 2,
        }}
      >
        <Stack sx={{ gap: 3, alignItems: 'center', width: '100%', maxWidth: 360 }}>
          <Typography variant="h5" sx={{ fontWeight: 700 }}>
            Staff sign-in
          </Typography>
          <StaffSignInForm />
        </Stack>
      </Box>
    </ThemeProvider>
  )
}

export default StaffSignInPage
