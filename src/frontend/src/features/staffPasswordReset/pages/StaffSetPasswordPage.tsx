/**
 * features/staffPasswordReset/pages/StaffSetPasswordPage.tsx
 * ---------------------------------------------------------------------------
 * Landing page for a copied password reset / invite link (identity-auth-roles story 21,
 * #576): `/staff/reset#token=...`. STAFF world (COBRA), PRE-auth - routed in
 * `app-shell/routes.tsx` next to `/staff/login`, not in the post-auth staff registry.
 *
 * Flow: the token is read from the fragment on first render and the fragment is stripped
 * from the address bar in an effect (idempotent, so StrictMode double-runs are harmless).
 * No token -> the invalid-link state. Submit POSTs `{ token, newPassword }` once; an
 * `invalid-token` 400 is terminal (the same token is never retried).
 *
 * Policy (staff): 12-128 characters, no composition rules. The client only enforces
 * confirm-match and non-empty; length is hinted live and judged by the server.
 *
 * A11y (WCAG 2.1 AA): labelled fields, show/hide toggle with aria-pressed, errors in
 * role="alert" with icon + text, in-flight in role="status", focus moves to the result
 * heading (success / invalid link) or the error alert (policy / rate limit).
 */

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Box, IconButton, InputAdornment, Stack, Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faCircleNotch,
  faEye,
  faEyeSlash,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { cobraTheme } from '@/theme/cobraTheme'
import { STAFF_LOGIN_PATH } from '@/features/app-shell/constants'
import { readResetToken, stripResetFragment } from '../resetFragment'
import {
  INVALID_TOKEN_CODE,
  PasswordResetError,
  resetPassword,
} from '../services/passwordResetService'

const INVALID_LINK_MESSAGE =
  'This link is invalid or has expired. Ask your organization admin for a new one.'
const RATE_LIMIT_MESSAGE = 'Too many attempts. Wait a minute and try again.'
const GENERIC_POLICY_MESSAGE = 'Choose a different password.'
const MISMATCH_MESSAGE = 'The two passwords do not match.'

/** Known server policy codes -> plain messages. Unknown codes fall back to the generic one. */
const POLICY_MESSAGES: Readonly<Record<string, string>> = {
  'password-too-short': 'Use at least 12 characters.',
  'password-too-long': 'Use no more than 128 characters.',
  'password-too-common': 'That password is too common. Choose a less guessable one.',
  'password-contains-personal-info': 'Do not include your name, email, or username in the password.',
}

type Phase = 'form' | 'success' | 'invalid'

function StatusLine({ icon, children }: { icon: typeof faCircleCheck; children: string }) {
  return (
    <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={icon} aria-hidden />
      </Box>
      <Typography variant="body1">{children}</Typography>
    </Stack>
  )
}

function SetPasswordBody() {
  const navigate = useNavigate()
  // Read once (pure); the strip happens in the effect below.
  const [token] = useState<string | null>(() => readResetToken())
  const [phase, setPhase] = useState<Phase>(token === null ? 'invalid' : 'form')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    stripResetFragment()
  }, [])

  useEffect(() => {
    if (phase !== 'form') headingRef.current?.focus()
  }, [phase])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (submitting || token === null) return
    if (password !== confirm) {
      setError(MISMATCH_MESSAGE)
      return
    }
    setSubmitting(true)
    setError(null)
    resetPassword({ token, newPassword: password })
      .then(() => {
        setPassword('')
        setConfirm('')
        setPhase('success')
      })
      .catch((caught: unknown) => {
        const failure = caught instanceof PasswordResetError ? caught : undefined
        if (failure?.status === 400 && failure.code === INVALID_TOKEN_CODE) {
          setPhase('invalid')
        } else if (failure?.status === 400) {
          setError(POLICY_MESSAGES[failure.code ?? ''] ?? GENERIC_POLICY_MESSAGE)
        } else if (failure?.status === 429) {
          setError(RATE_LIMIT_MESSAGE)
        } else {
          setError('Could not reach the server. Check your connection and try again.')
        }
      })
      .finally(() => setSubmitting(false))
  }

  if (phase === 'success') {
    return (
      <Stack sx={{ gap: 2 }} data-testid="set-password-success">
        <Typography variant="h5" component="h1" tabIndex={-1} ref={headingRef}>
          Your password is set.
        </Typography>
        <StatusLine icon={faCircleCheck}>You can now sign in with your new password.</StatusLine>
        <CobraPrimaryButton onClick={() => navigate(STAFF_LOGIN_PATH)}>
          Go to staff sign-in
        </CobraPrimaryButton>
      </Stack>
    )
  }

  if (phase === 'invalid') {
    return (
      <Stack sx={{ gap: 2 }} data-testid="set-password-invalid">
        <Typography variant="h5" component="h1" tabIndex={-1} ref={headingRef}>
          Link not valid
        </Typography>
        <Box role="alert">
          <StatusLine icon={faTriangleExclamation}>{INVALID_LINK_MESSAGE}</StatusLine>
        </Box>
      </Stack>
    )
  }

  const toggle = (
    <InputAdornment position="end">
      <IconButton
        aria-label={reveal ? 'Hide passwords' : 'Show passwords'}
        aria-pressed={reveal}
        onClick={() => setReveal(value => !value)}
        edge="end"
      >
        <FontAwesomeIcon icon={reveal ? faEyeSlash : faEye} aria-hidden />
      </IconButton>
    </InputAdornment>
  )

  return (
    <Box
      component="form"
      onSubmit={handleSubmit}
      aria-label="Set your password"
      sx={{ display: 'flex', flexDirection: 'column', gap: 2, width: '100%' }}
    >
      <Typography variant="h5" component="h1">
        Set your password
      </Typography>
      <CobraTextField
        label="New password"
        name="newPassword"
        type={reveal ? 'text' : 'password'}
        autoComplete="new-password"
        value={password}
        onChange={event => setPassword(event.target.value)}
        disabled={submitting}
        required
        fullWidth
        helperText="At least 12 characters"
        slotProps={{ input: { endAdornment: toggle } }}
      />
      <CobraTextField
        label="Confirm new password"
        name="confirmPassword"
        type={reveal ? 'text' : 'password'}
        autoComplete="new-password"
        value={confirm}
        onChange={event => setConfirm(event.target.value)}
        disabled={submitting}
        required
        fullWidth
      />
      <CobraPrimaryButton type="submit" disabled={submitting} fullWidth>
        Set password
      </CobraPrimaryButton>
      {submitting ? (
        <Stack
          direction="row"
          role="status"
          aria-live="polite"
          sx={{ alignItems: 'center', gap: 1, color: 'text.secondary' }}
        >
          <FontAwesomeIcon icon={faCircleNotch} spin aria-hidden />
          <Typography variant="body2">Setting password…</Typography>
        </Stack>
      ) : null}
      {error ? (
        <Box role="alert" tabIndex={-1} ref={errorRef} sx={{ color: 'error.main' }}>
          <StatusLine icon={faTriangleExclamation}>{error}</StatusLine>
        </Box>
      ) : null}
    </Box>
  )
}

export function StaffSetPasswordPage() {
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
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          <SetPasswordBody />
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default StaffSetPasswordPage
