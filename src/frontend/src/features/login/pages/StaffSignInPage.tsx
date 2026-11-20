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
 * ORG SIGN-IN (identity-auth-roles/27, #835): the form is email + password on the bare host and on
 * `/o/:slug`; on an EXERCISE address (the host resolves an exercise context) the default is the
 * exercise-bound username + secret form instead (staff there land in that exercise; org admins
 * need the email form). Each form links to the other. While the host's context is pending a
 * neutral "Loading sign-in" placeholder shows instead of a form (a hung request falls back to
 * email after 3 s), so the first form shown is the right one and never swaps under focus or
 * autofill. DEV NOTE: the mock-data seam resolves a mock exercise for EVERY host, so under mock
 * data the bare host also defaults to the exercise-bound form (this is what the guide screenshots
 * show); against the real API only an exercise host does.
 *
 * Focus is managed: the first field takes focus when a form appears, a refused sign-in focuses
 * the password, an expired choice the email, a toggle the new form's first field; inputs go
 * readOnly (not disabled) and buttons aria-disabled while submitting so focus never drops to
 * <body>. Each form guards its one request with `useSubmitGuard`: a ref (two submits in one tick
 * cannot both pass), link buttons do nothing mid-request, and a reply that arrives after the form
 * unmounted is ignored (no `completeSignIn`, no navigate).
 *
 * The email form sends `POST /auth/staff/login {email, password}` (no `exerciseId`) via
 * `staffOrgSignIn`, plus an `orgSlug` when the page was opened at an org address (`/o/:slug`;
 * the slug is trimmed and lower-cased and must match `^[a-z0-9-]{1,63}$`, else a short "address
 * isn't valid" note shows and no `orgSlug` is sent), so a bookmarked address skips the org choice.
 * An org admin's reply is an org-scope session (`scope: 'org'`, `role: 'orgAdmin'`,
 * `exerciseId: null`); it is stored like any staff session and `RoleAwareEntry` lands it on
 * Exercise Management. A person in several orgs gets a `{ choose, choiceToken }` reply: the page
 * switches to a "Choose an organization" step (focus moves to the heading, whose
 * `aria-describedby` carries the note that the choice expires in 2 minutes) and posts
 * `staffOrgChoose`. An expired or used token returns to the form with a plain message. The email
 * field also takes an ALLOWLIST (break-glass) username, which the backend accepts on this route
 * (so it is a text input, not `type="email"`). Credentials-type refusals (400, 401, 403, 429)
 * show the one message `UNIFORM_FAILURE_MESSAGE` and clear the password, and so does a 5xx (a
 * login 5xx can only follow a matching password, so a distinct message would be an oracle). A
 * network failure and a malformed reply have their own retry messages and KEEP the password.
 * Nothing says
 * whether an email or org exists. The password is cleared once a reply arrives; never logged.
 *
 * The exercise-bound username + secret form (described below) stays reachable behind "Use a
 * username and secret instead" until it is retired; its 401/403 copy is unchanged.
 *
 * ON SUCCESS the shared `completeSignIn` (`../completeSignIn.ts`) stores the pair in
 * the SESSION-scoped store (staff never opt in to `persist`), runs `resetClientSession()`
 * so a previous identity's cached data and composer state cannot show through
 * (easy-login Gate-2 W-2), and navigates to `/` with `replace`.
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

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleNotch, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import {
  CobraLinkButton,
  CobraPrimaryButton,
  CobraSecondaryButton,
  CobraTextField,
} from '@/theme/styledComponents'
import { cobraTheme } from '@/theme/cobraTheme'
import { resolveExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { completeSignIn } from '../completeSignIn'
import {
  isStaffOrgChoiceResponse,
  staffOrgChoose,
  staffOrgSignIn,
  staffSignIn,
  StaffSignInError,
  type StaffOrgChoice,
  type StaffOrgLoginResponse,
} from '../services/staffSignInService'

/** The ONE message for every refused org-shape sign-in (#835): never reveals what was wrong. */
export const UNIFORM_FAILURE_MESSAGE =
  "That email and password don't match, or your account is locked."

/** Shown when the org choice is refused (expired after 2 minutes, already used, or mismatched). */
const CHOICE_EXPIRED_MESSAGE = 'Your organization choice expired. Sign in again.'

/** A malformed reply or unexpected error: never worded as a credentials failure. */
const GENERIC_FAILURE_MESSAGE = 'Something went wrong. Try again.'

/** A choice that failed for a reason that may pass (5xx, rate limit, network): keep the step. */
const CHOICE_RETRY_MESSAGE = 'Could not complete sign-in. Try again, or use a different account.'

/** Stops phones capitalising or "correcting" an email address or username as it is typed. */
const TYPED_IDENTIFIER_ATTRIBUTES = {
  autoCapitalize: 'none',
  autoCorrect: 'off',
  spellCheck: false,
} as const

/** Network failure: no response, so nothing about the account can be revealed. */
const UNREACHABLE_MESSAGE = 'Could not reach the server. Check your connection and try again.'

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
      if (error.unreachable) return UNREACHABLE_MESSAGE
      return error.status === undefined
        ? GENERIC_FAILURE_MESSAGE
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

interface ExerciseBoundFormProps {
  /** The host-resolved exercise context, owned by `StaffSignInForm` (it picks the default). */
  readonly contextQuery: UseQueryResult<ExerciseScope>
  readonly onUseEmail: () => void
}

/**
 * The guard every form uses around its one in-flight request.
 *
 *  - `begin()` returns a generation number, or `null` when a request is already in flight. It is
 *    a REF, so two submits in the same tick (autofill plus Enter) cannot both pass.
 *  - `isCurrent(g)` is false once the form has unmounted, so a late
 *    reply is ignored: no `completeSignIn`, no navigate, no state update.
 */
function useSubmitGuard() {
  const inFlight = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    const ref = generation
    return () => {
      ref.current += 1
    }
  }, [])
  return {
    busy: () => inFlight.current,
    begin: (): number | null => {
      if (inFlight.current) return null
      inFlight.current = true
      return generation.current
    },
    isCurrent: (g: number) => g === generation.current,
    end: (g: number) => {
      if (g === generation.current) inFlight.current = false
    },
  }
}

/** Page-local disabled look for buttons that use `aria-disabled` (so focus is never lost). */
const ARIA_DISABLED_SX = {
  '&[aria-disabled="true"]': { opacity: 0.55, cursor: 'not-allowed' },
} as const

/**
 * The exercise-bound sign-in form (username + secret). Inputs go `readOnly` (not `disabled`)
 * while a request is in flight and buttons use `aria-disabled`, so focus never falls to
 * `<body>` mid-submit. The first field takes focus when the form appears.
 */
function ExerciseBoundForm({ contextQuery, onUseEmail }: ExerciseBoundFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const guard = useSubmitGuard()

  const [username, setUsername] = useState('')
  const [secret, setSecret] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)
  const secretRef = useRef<HTMLInputElement>(null)
  const lastField = useRef<'username' | 'secret'>('username')

  useEffect(() => {
    usernameRef.current?.focus()
  }, [])

  // The AC2 "not configured" error is stale the moment the context arrives.
  useEffect(() => {
    if (contextQuery.data) {
      setErrorMessage(previous => (previous === UNRESOLVED_CONTEXT_MESSAGE ? null : previous))
    }
  }, [contextQuery.data])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (guard.busy()) return

    // AC2: block submission (and never POST) when the host's exercise
    // context is not a RESOLVED scope — loading, errored, and "no data yet"
    // all count as unresolved.
    if (contextQuery.isPending || contextQuery.isError || !contextQuery.data) {
      setErrorMessage(UNRESOLVED_CONTEXT_MESSAGE)
      return
    }

    const generation = guard.begin()
    if (generation === null) return
    const exerciseId = contextQuery.data.exerciseId
    setSubmitting(true)
    setErrorMessage(null)

    staffSignIn({ username, secret, exerciseId })
      .then(envelope => {
        if (!guard.isCurrent(generation)) return
        // Store the pair (session-scoped: staff never opt in to `persist`), forget the
        // previous identity's client state, and hand off - one shared step so staff and
        // participant sign-in cannot drift (Gate-2 W-2).
        completeSignIn(
          { token: envelope.token, refreshToken: envelope.refreshToken },
          { persist: false, navigate, queryClient },
        )
      })
      .catch((error: unknown) => {
        if (!guard.isCurrent(generation)) return
        const signInError =
          error instanceof StaffSignInError
            ? error
            : new StaffSignInError('Sign-in failed unexpectedly.')
        setErrorMessage(friendlySignInErrorMessage(signInError))
        // AC4: ONLY a 401 clears the secret field. A 403 means the
        // credentials themselves were correct — clearing them would be
        // actively unhelpful (the fix is an assignment change, not a retry).
        if (signInError.status === 401) {
          setSecret('')
          secretRef.current?.focus()
        } else if (signInError.unreachable || (signInError.status ?? 0) >= 500) {
          // Keep what was typed and put focus back where the person was.
          ;(lastField.current === 'username' ? usernameRef : secretRef).current?.focus()
        }
      })
      .finally(() => {
        if (!guard.isCurrent(generation)) return
        guard.end(generation)
        setSubmitting(false)
      })
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
        inputRef={usernameRef}
        slotProps={{
          htmlInput: {
            readOnly: submitting,
            onFocus: () => { lastField.current = 'username' },
            ...TYPED_IDENTIFIER_ATTRIBUTES,
          },
        }}
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
        inputRef={secretRef}
        slotProps={{
          htmlInput: { readOnly: submitting, onFocus: () => { lastField.current = 'secret' } },
        }}
        required
        fullWidth
      />

      <CobraPrimaryButton
        type="submit"
        aria-disabled={submitting}
        fullWidth
        sx={ARIA_DISABLED_SX}
      >
        Sign in
      </CobraPrimaryButton>

      {submitting ? <SubmittingStatus /> : null}

      {errorMessage ? <SignInAlert message={errorMessage} /> : null}

      <CobraLinkButton
        type="button"
        onClick={() => {
          if (!guard.busy()) onUseEmail()
        }}
        aria-disabled={submitting}
        sx={ARIA_DISABLED_SX}
      >
        Sign in with email instead
      </CobraLinkButton>
    </Box>
  )
}

/** The in-flight announcement shared by both forms. */
function SubmittingStatus() {
  return (
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
  )
}

interface OrgSignInFormProps {
  /** From the `/o/:slug` address, when it is a well-formed slug: sent as `orgSlug`. */
  readonly orgSlug?: string
  /** True when the address carried a `/o/` value that is not a well-formed slug. */
  readonly invalidSlug: boolean
  readonly onUseSecret: () => void
}

interface PendingChoice {
  readonly choose: readonly StaffOrgChoice[]
  readonly choiceToken: string
}

type FocusField = 'email' | 'password'

/** Org-shape sign-in: email + password, then (for several orgs) the org choice. */
function OrgSignInForm({ orgSlug, invalidSlug, onUseSecret }: OrgSignInFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const guard = useSubmitGuard()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [choice, setChoice] = useState<PendingChoice | null>(null)
  const [focusRequest, setFocusRequest] = useState<{ field: FocusField; n: number } | null>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const choiceHeading = useRef<HTMLHeadingElement>(null)
  const lastField = useRef<FocusField>('email')

  const requestFocus = (field: FocusField) =>
    setFocusRequest(previous => ({ field, n: (previous?.n ?? 0) + 1 }))

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  // Runs after the render that (re)mounts the form, so it also works when the choice step closes.
  useEffect(() => {
    if (!focusRequest) return
    ;(focusRequest.field === 'email' ? emailRef : passwordRef).current?.focus()
  }, [focusRequest])

  // Move focus to the choice heading when the step appears (keyboard + screen-reader users).
  useEffect(() => {
    if (choice) choiceHeading.current?.focus()
  }, [choice])

  /** Stores a session, or opens the choice step. Throws a 401-shaped error for an empty list. */
  const finish = (result: StaffOrgLoginResponse) => {
    setPassword('') // the response is in; the password is never needed again
    if (isStaffOrgChoiceResponse(result)) {
      if (result.choose.length === 0) {
        throw new StaffSignInError('Empty organization choice.', { status: 401 })
      }
      setChoice({ choose: result.choose, choiceToken: result.choiceToken })
      return
    }
    completeSignIn(
      { token: result.token, refreshToken: result.refreshToken },
      { persist: false, navigate, queryClient },
    )
  }

  /**
   * Copy for a failed sign-in. Credentials-type refusals (400, 401, 403, 429 and anything else
   * the server answered) stay uniform and clear the password; 429 cannot be split out without
   * hinting at a lock. A 5xx is uniform too: the only 5xx a login can raise come after the password
   * matched (session issue / save), so a distinct 5xx message would be an oracle. A missing
   * response and a malformed reply say so, and KEEP what was
   * typed so the person can simply retry, with focus back where they were.
   */
  const handleSignInFailure = (error: unknown) => {
    let keepMessage: string | null = null
    if (!(error instanceof StaffSignInError)) keepMessage = GENERIC_FAILURE_MESSAGE
    else if (error.unreachable) keepMessage = UNREACHABLE_MESSAGE
    else if (error.status === undefined) keepMessage = GENERIC_FAILURE_MESSAGE

    if (keepMessage !== null) {
      setErrorMessage(keepMessage)
      ;(lastField.current === 'email' ? emailRef : passwordRef).current?.focus()
      return
    }
    setErrorMessage(UNIFORM_FAILURE_MESSAGE)
    setPassword('')
    passwordRef.current?.focus()
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const generation = guard.begin()
    if (generation === null) return
    setSubmitting(true)
    setErrorMessage(null)
    staffOrgSignIn({ ...(orgSlug ? { orgSlug } : {}), email: email.trim(), password })
      .then(result => {
        if (guard.isCurrent(generation)) finish(result)
      })
      .catch((error: unknown) => {
        if (guard.isCurrent(generation)) handleSignInFailure(error)
      })
      .finally(() => {
        if (!guard.isCurrent(generation)) return
        guard.end(generation)
        setSubmitting(false)
      })
  }

  const backToForm = (message: string | null) => {
    setChoice(null)
    setErrorMessage(message)
    requestFocus('email')
  }

  const handleChoose = (picked: StaffOrgChoice) => {
    if (!choice) return
    const generation = guard.begin()
    if (generation === null) return
    setSubmitting(true)
    setErrorMessage(null)
    staffOrgChoose({ choiceToken: choice.choiceToken, orgSlug: picked.slug })
      .then(result => {
        if (guard.isCurrent(generation)) finish(result)
      })
      .catch((error: unknown) => {
        if (!guard.isCurrent(generation)) return
        if (error instanceof StaffSignInError && (error.status === 401 || error.status === 400)) {
          // An expired or used token is final: back to the form with a plain message.
          backToForm(CHOICE_EXPIRED_MESSAGE)
        } else if (error instanceof StaffSignInError && error.status === undefined &&
          !error.unreachable) {
          setErrorMessage(GENERIC_FAILURE_MESSAGE)
        } else {
          // 5xx, 429, network: the choice may still be valid, so keep the step and let them retry.
          setErrorMessage(CHOICE_RETRY_MESSAGE)
        }
      })
      .finally(() => {
        if (!guard.isCurrent(generation)) return
        guard.end(generation)
        setSubmitting(false)
      })
  }

  if (choice) {
    // No live region around the step: the heading takes focus and `aria-describedby` makes the
    // expiry note part of what a screen reader announces with it.
    return (
      <Stack data-testid="staff-org-choice" sx={{ gap: 2, width: '100%', maxWidth: 360 }}>
        <Box>
          <Typography
            variant="h6"
            component="h2"
            tabIndex={-1}
            ref={choiceHeading}
            aria-describedby="staff-org-choice-expiry"
            sx={{ fontWeight: 700, outline: 'none' }}
          >
            Choose an organization
          </Typography>
          <Typography
            id="staff-org-choice-expiry"
            variant="body2"
            sx={{ color: 'text.secondary' }}
          >
            Your sign-in matches {choice.choose.length} organizations. This choice expires in 2
            minutes.
          </Typography>
        </Box>
        <Stack
          component="ul"
          aria-label="Organizations"
          sx={{ gap: 1, m: 0, p: 0, listStyle: 'none' }}
        >
          {choice.choose.map(org => (
            <li key={org.slug}>
              <CobraSecondaryButton
                type="button"
                fullWidth
                aria-disabled={submitting}
                onClick={() => handleChoose(org)}
                sx={ARIA_DISABLED_SX}
              >
                {org.orgName}
              </CobraSecondaryButton>
            </li>
          ))}
        </Stack>
        {submitting ? <SubmittingStatus /> : null}
        {errorMessage ? <SignInAlert message={errorMessage} /> : null}
        <CobraLinkButton
          type="button"
          onClick={() => {
            if (!guard.busy()) backToForm(null)
          }}
          aria-disabled={submitting}
          sx={ARIA_DISABLED_SX}
        >
          Use a different account
        </CobraLinkButton>
      </Stack>
    )
  }

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      aria-label="Staff sign-in"
      data-testid="staff-sign-in-form"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%', maxWidth: 360 }}
    >
      {orgSlug ? (
        <Typography
          id="staff-org-slug-note"
          variant="body2"
          data-testid="staff-org-slug"
          sx={{ color: 'text.secondary' }}
        >
          Signing in to <strong>{orgSlug}</strong>
        </Typography>
      ) : null}
      {invalidSlug ? (
        <Typography
          id="staff-org-slug-note"
          variant="body2"
          data-testid="staff-org-slug-invalid"
          sx={{ color: 'text.secondary' }}
        >
          This sign-in address isn&apos;t valid. Sign in with your email.
        </Typography>
      ) : null}
      <CobraTextField
        label="Email"
        name="email"
        autoComplete="username"
        value={email}
        onChange={event => setEmail(event.target.value)}
        inputRef={emailRef}
        slotProps={{
          htmlInput: {
            readOnly: submitting,
            'aria-describedby': orgSlug || invalidSlug ? 'staff-org-slug-note' : undefined,
            onFocus: () => { lastField.current = 'email' },
            ...TYPED_IDENTIFIER_ATTRIBUTES,
          },
        }}
        required
        fullWidth
      />
      <CobraTextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={event => setPassword(event.target.value)}
        inputRef={passwordRef}
        slotProps={{
          htmlInput: { readOnly: submitting, onFocus: () => { lastField.current = 'password' } },
        }}
        required
        fullWidth
      />

      <CobraPrimaryButton
        type="submit"
        aria-disabled={submitting}
        fullWidth
        sx={ARIA_DISABLED_SX}
      >
        Sign in
      </CobraPrimaryButton>

      {submitting ? <SubmittingStatus /> : null}

      {errorMessage ? <SignInAlert message={errorMessage} /> : null}

      <CobraLinkButton
        type="button"
        onClick={() => {
          if (!guard.busy()) onUseSecret()
        }}
        aria-disabled={submitting}
        sx={ARIA_DISABLED_SX}
      >
        Use a username and secret instead
      </CobraLinkButton>
    </Box>
  )
}

/** A `/o/:slug` value is trimmed and lower-cased, then shown and sent only if it looks like one. */
const ORG_SLUG_PATTERN = /^[a-z0-9-]{1,63}$/

/** How long the page waits for the host's exercise context before falling back to email. */
const CONTEXT_WAIT_MS = 3000

type FormMode = 'email' | 'secret'

/**
 * Picks the form. Default: email on the bare host and on `/o/:slug`; the exercise-bound
 * username + secret form when the host resolves an exercise (an exercise address). While the
 * host's context is pending (and there is no `/o/` slug) a neutral placeholder shows instead of
 * a form, so the first form shown is the right one and nothing swaps under focus or autofill. A
 * hung request falls back to email after `CONTEXT_WAIT_MS`.
 */
function StaffSignInForm() {
  const { slug } = useParams<{ slug?: string }>()
  // Keyed on the normalised slug, so client-side navigation between `/staff/login` and
  // `/o/:slug` re-derives the default and resets the form.
  return <StaffSignInFormBody key={slug?.trim().toLowerCase() ?? ''} slug={slug} />
}

function StaffSignInFormBody({ slug }: { readonly slug?: string }) {
  const normalizedSlug = slug?.trim().toLowerCase()
  const orgSlug =
    normalizedSlug !== undefined && ORG_SLUG_PATTERN.test(normalizedSlug)
      ? normalizedSlug
      : undefined
  const invalidSlug = slug !== undefined && orgSlug === undefined

  // Non-blocking, host-resolved exercise scope (see module header).
  const contextQuery = useQuery({
    queryKey: ['staff-login', 'exercise-context'],
    queryFn: resolveExerciseContext,
    retry: false,
  })

  const [chosenMode, setChosenMode] = useState<FormMode | null>(null)
  const [lockedDefault, setLockedDefault] = useState<FormMode | null>(null)
  const [timedOut, setTimedOut] = useState(false)

  const waiting = slug === undefined && contextQuery.isPending
  useEffect(() => {
    if (!waiting) return
    const timer = setTimeout(() => setTimedOut(true), CONTEXT_WAIT_MS)
    return () => clearTimeout(timer)
  }, [waiting])

  const settled = !waiting || timedOut
  const defaultMode: FormMode =
    slug === undefined && contextQuery.data !== undefined ? 'secret' : 'email'
  // Lock the default the moment the context settles, so a later reply cannot swap the form.
  useEffect(() => {
    if (settled && lockedDefault === null) setLockedDefault(defaultMode)
  }, [settled, lockedDefault, defaultMode])

  // Computed at render time so a settled host never paints a placeholder frame; the lock above
  // then keeps it from changing.
  const mode = chosenMode ?? lockedDefault ?? (settled ? defaultMode : null)
  if (mode === null) {
    return (
      <Stack
        direction="row"
        role="status"
        aria-live="polite"
        data-testid="staff-sign-in-loading"
        sx={{ alignItems: 'center', gap: 1, color: 'text.secondary' }}
      >
        <FontAwesomeIcon icon={faCircleNotch} spin aria-hidden />
        <Typography variant="body2">Loading sign-in…</Typography>
      </Stack>
    )
  }

  return mode === 'email' ? (
    <OrgSignInForm
      key={normalizedSlug ?? ''}
      orgSlug={orgSlug}
      invalidSlug={invalidSlug}
      onUseSecret={() => setChosenMode('secret')}
    />
  ) : (
    <ExerciseBoundForm contextQuery={contextQuery} onUseEmail={() => setChosenMode('email')} />
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
          <Typography variant="h5" component="h1" sx={{ fontWeight: 700 }}>
            Staff sign-in
          </Typography>
          <StaffSignInForm />
        </Stack>
      </Box>
    </ThemeProvider>
  )
}

export default StaffSignInPage
