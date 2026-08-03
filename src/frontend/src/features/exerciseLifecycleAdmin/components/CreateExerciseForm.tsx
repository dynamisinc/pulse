/**
 * features/exerciseLifecycleAdmin/components/CreateExerciseForm.tsx
 * ---------------------------------------------------------------------------
 * The EXERCISE CREATION form (feature: exercise-lifecycle-admin, story 01 —
 * COR-074). Until this shipped there was no way for anyone to create an
 * exercise from the UI at all: the only thing that made an `Exercise` row was
 * `POST /api/ops/bootstrap-exercise`, a deployment-secret-gated seam whose own
 * doc comment says it must not be reachable in a customer-facing deployment.
 *
 * ## What the form does NOT decide
 * Three things a naive form would put in the body are absent here, and their
 * absence is the contract (see `services/orgExercisesService.ts`):
 *  - the OWNING ORGANIZATION — always the caller's own, resolved server-side;
 *  - the LIFECYCLE STATUS — always `build` (COR-032). The form neither sends it
 *    nor assumes it: the success notice below reports the status the SERVER
 *    returned, so a server that ever created something else would be visible
 *    rather than papered over by a hard-coded "Created in Build";
 *  - the EXERCISE ID and creation instant — server-generated.
 *
 * ## The 409 is a FORM ERROR, not a toast (the whole point of this component)
 * Hostname uniqueness is GLOBAL, across every customer, and it is enforced by
 * the database rather than a pre-flight read (any "is this taken?" query would
 * race the insert). So "that host is taken" is a normal, recoverable outcome of
 * a well-formed submission, and it arrives as a `409` AFTER the user has typed
 * everything. Handling it as a toast would be actively hostile: the toast
 * evaporates, and the natural implementations of "show a toast" clear the form
 * on settle. Instead:
 *  - both fields KEEP what the user typed;
 *  - the error is attached to the HOSTNAME field (`error` + `helperText`, which
 *    MUI wires to `aria-describedby` and `aria-invalid`), because that is the
 *    field they have to change;
 *  - focus moves to that field, so a keyboard or screen-reader user is put on
 *    the thing to fix rather than left at the bottom of the form;
 *  - the form is immediately re-submittable.
 * A blank hostname cannot 409 — the server allocates one — so the recovery is
 * always available: clear the field and submit again.
 *
 * ## NFR-004 — free text
 * `name` is free text. It is sanitized SERVER-side on ingest (markup stripped,
 * not encoded) and this component renders the server's echoed value back as
 * TEXT through React. Nothing here renders user input as HTML, and nothing here
 * may start to.
 *
 * ## Accessibility (NFR-001)
 * Native `<form>` with a real submit button, so Enter submits. Every control is
 * labelled. Validation messages are text + a FontAwesome icon — never colour
 * alone — and are announced: field-level failures land in a `role="alert"`
 * region, the success confirmation in a `role="status"` one. Only the SUBMIT
 * BUTTON is disabled while the request is in flight, and `aria-busy` reports
 * that state on the form.
 *
 * The text inputs are deliberately NOT disabled while pending. Disabling them
 * would (a) strand focus on `<body>` for anyone who was in a field, and (b)
 * silently break the 409 recovery: the error handler focuses the offending
 * input, and the browser refuses focus on a control the last committed render
 * left disabled — so the whole "put the user on the thing to fix" behaviour
 * would be a no-op that no prop-passing test could see.
 *
 * World: STAFF (COBRA). `CobraTextField` / `CobraPrimaryButton` from
 * `@/theme/styledComponents` — never bare `@mui/material` `Button`/`TextField`.
 */

import { useId, useRef, useState, type FormEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faCircleCheck, faPlus, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import CobraStyles from '@/theme/CobraStyles'
import { CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { useCreateExercise } from '../hooks/useCreateExercise'
import { isHostnameTakenError, OrgExerciseError } from '../services/orgExercisesService'
import { ExerciseStatusBadge } from './ExerciseStatusBadge'

/** Where a failure belongs on screen: on a field the user can fix, or on the form. */
interface FormErrors {
  readonly name?: string
  readonly hostname?: string
  readonly form?: string
}

/** What the caller is told after a successful create. */
interface CreatedNotice {
  readonly name: string
  readonly status: string
  readonly hostname?: string
  readonly assignedRole: string
}

/**
 * Maps a failed create onto the field that owns it. The `409` is the load-bearing
 * case (see the module header); a `400` is a validation failure the server found
 * in the name, and everything else is a form-level problem the user cannot fix
 * by editing a field.
 */
function toFormErrors(error: OrgExerciseError): FormErrors {
  if (isHostnameTakenError(error)) {
    return {
      hostname:
        'Another exercise already uses this hostname. Hostnames are unique across the whole '
        + 'platform. Try a different one, or clear this field and one will be allocated for you.',
    }
  }
  if (error.status === 400) {
    return {
      name: error.serverMessage
        ?? 'The exercise could not be created with these details. Check the name and try again.',
    }
  }
  if (error.status === 401 || error.status === 403) {
    return {
      form:
        'Your session is not allowed to create exercises. Only a planner or an organization '
        + 'administrator can. Sign in again if you believe this is wrong.',
    }
  }
  return {
    form: error.serverMessage ?? 'The exercise could not be created. Try again.',
  }
}

/**
 * An inline, icon + words validation message (NFR-001 — colour is decoration on
 * top of both, never the signal).
 *
 * All-`span` on purpose: MUI renders `helperText` inside a `<p>`, and a `<div>`
 * there is invalid nesting the DOM silently reparents.
 */
function FieldProblem({ message }: { message: string }) {
  return (
    <Stack
      direction="row"
      component="span"
      // `notifications.errorText` (#b22222, 6.7:1 on white), not the stock
      // `error.main` MUI would apply — the same AA-headroom choice
      // `ExerciseSettingsPage` documents for COBRA error copy.
      sx={{ alignItems: 'flex-start', gap: 0.75, color: 'notifications.errorText' }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Box component="span">{message}</Box>
    </Stack>
  )
}

/**
 * The creation form. Self-contained: its own mutation, its own state, no props —
 * the same contract the planner surface's panels follow, so the page that mounts
 * it never has to thread anything through.
 */
export function CreateExerciseForm() {
  const headingId = useId()
  const [name, setName] = useState('')
  const [hostname, setHostname] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [created, setCreated] = useState<CreatedNotice | null>(null)
  const hostnameRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const createExercise = useCreateExercise()
  const pending = createExercise.isPending

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return

    const trimmedName = name.trim()
    if (trimmedName.length === 0) {
      // Caught client-side so an obviously-incomplete form does not cost a
      // round trip — but the server still validates it (the mock 400s too), so
      // this is a courtesy, not the guard.
      setCreated(null)
      setErrors({ name: 'Give the exercise a name so your team can tell it apart from the others.' })
      nameRef.current?.focus()
      return
    }

    setErrors({})
    createExercise.mutate(
      { name: trimmedName, hostname: hostname.trim() },
      {
        onSuccess: result => {
          setCreated({
            // The SERVER's echoed values, not what was typed: the name has been
            // sanitized, the hostname may have been allocated or normalized, and
            // the status is whatever the server actually recorded.
            name: result.exercise.name,
            status: result.exercise.status,
            ...(result.exercise.hostname !== undefined
              ? { hostname: result.exercise.hostname }
              : {}),
            assignedRole: result.assignedRole,
          })
          setName('')
          setHostname('')
        },
        onError: error => {
          setCreated(null)
          const mapped = toFormErrors(error)
          setErrors(mapped)
          // Put the user on the field they have to change. Nothing they typed
          // is cleared — see the module header.
          if (mapped.hostname !== undefined) hostnameRef.current?.focus()
          else if (mapped.name !== undefined) nameRef.current?.focus()
        },
      },
    )
  }

  return (
    <Box
      component="section"
      aria-labelledby={headingId}
      data-testid="create-exercise-form"
      sx={{
        border: '1px solid',
        borderColor: 'grid.main',
        borderRadius: 1,
        padding: CobraStyles.Padding.MainWindow,
        backgroundColor: 'background.paper',
      }}
    >
      <Typography id={headingId} variant="h6" component="h2" sx={{ fontWeight: 700 }}>
        Create an exercise
      </Typography>
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 780 }}>
        A new exercise starts in Build, owned by your organization, with you assigned to it. You
        configure it, stage it and take it live from there.
      </Typography>

      <Box
        component="form"
        onSubmit={handleSubmit}
        noValidate
        aria-busy={pending}
        sx={{ mt: 2 }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          sx={{ gap: 2, alignItems: 'flex-start', flexWrap: 'wrap' }}
        >
          <CobraTextField
            inputRef={nameRef}
            label="Exercise name"
            value={name}
            onChange={event => setName(event.target.value)}
            required
            error={errors.name !== undefined}
            helperText={
              errors.name !== undefined
                ? <FieldProblem message={errors.name} />
                : 'What your team calls this run. Participants never see it.'
            }
            slotProps={{ htmlInput: { maxLength: 200, 'data-testid': 'create-exercise-name' } }}
            sx={{ flex: '1 1 320px', minWidth: 240 }}
          />

          <CobraTextField
            inputRef={hostnameRef}
            label="Hostname (optional)"
            value={hostname}
            onChange={event => setHostname(event.target.value)}
            error={errors.hostname !== undefined}
            helperText={
              errors.hostname !== undefined
                ? <FieldProblem message={errors.hostname} />
                : 'Leave blank and one is allocated for you. Must be unique across the platform.'
            }
            slotProps={{ htmlInput: { maxLength: 120, 'data-testid': 'create-exercise-hostname' } }}
            sx={{ flex: '1 1 320px', minWidth: 240 }}
          />

          <CobraPrimaryButton
            type="submit"
            disabled={pending}
            data-testid="create-exercise-submit"
            startIcon={<FontAwesomeIcon icon={faPlus} />}
            sx={{ mt: { xs: 0, md: 1 }, flex: '0 0 auto' }}
          >
            {pending ? 'Creating…' : 'Create exercise'}
          </CobraPrimaryButton>
        </Stack>

        {/*
          The always-present live regions. Rendered unconditionally (empty when
          there is nothing to say) so assistive tech has a region to announce
          INTO — a region that only appears with its message is frequently
          missed by screen readers, which is the same "silent live surface"
          failure NFR-001 calls out.

          This alert carries FORM-LEVEL problems only. A field-level problem
          (the 409, a rejected name) is already announced twice over: focus is
          moved onto the offending control, and MUI wires its `helperText` to
          that control's `aria-describedby`. Repeating it here would announce
          the same sentence twice and add nothing on screen.
        */}
        <Box role="alert" data-testid="create-exercise-error" sx={{ mt: 1.5 }}>
          {errors.form !== undefined
            ? (
              <Stack
                direction="row"
                sx={{
                  alignItems: 'flex-start',
                  gap: 1,
                  padding: '10px 12px',
                  border: '1px solid',
                  borderColor: 'notifications.errorText',
                  borderRadius: 1,
                  color: 'notifications.errorText',
                }}
              >
                <Box component="span" sx={{ mt: '2px' }}>
                  <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
                </Box>
                <Typography variant="body2">{errors.form}</Typography>
              </Stack>
            )
            : null}
        </Box>

        <Box role="status" data-testid="create-exercise-success" sx={{ mt: 1.5 }}>
          {created !== null
            ? (
              <Stack
                direction="row"
                sx={{
                  alignItems: 'flex-start',
                  gap: 1,
                  padding: '10px 12px',
                  border: '1px solid',
                  borderColor: 'grid.main',
                  borderRadius: 1,
                }}
              >
                <Box component="span" sx={{ mt: '2px', color: 'success.main' }}>
                  <FontAwesomeIcon icon={faCircleCheck} aria-hidden />
                </Box>
                <Stack sx={{ gap: 0.5 }}>
                  <Typography variant="body2">
                    <strong>{created.name}</strong> was created
                    {created.hostname !== undefined ? ` at ${created.hostname}` : ''}
                    {' '}and you are assigned to it as {created.assignedRole}.
                  </Typography>
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      It starts in
                    </Typography>
                    <ExerciseStatusBadge status={created.status} />
                  </Stack>
                </Stack>
              </Stack>
            )
            : null}
        </Box>
      </Box>
    </Box>
  )
}
