/**
 * features/controller/personaEdit/PersonaEditDialog.tsx
 * ---------------------------------------------------------------------------
 * The persona profile EDIT DIALOG (demo-polish story 21 / PE-FE,
 * docs/features/demo-polish/21-persona-profile-edit.md; COR-020, COR-022 (edit,
 * not create), COR-024, NFR-001, NFR-004, SOC-052). STAFF world — a COBRA dialog:
 * `CobraTextField` / `CobraPrimaryButton` / `CobraLinkButton` / `CobraSecondaryButton`
 * from `@/theme/styledComponents`, `CobraStyles` spacing, FontAwesome icons, MUI 9
 * `sx`-only. Nothing participant-styled is imported: this must never be confusable
 * with what a participant sees.
 *
 * Fields (everything else about a persona is out of scope here — create/delete,
 * kind/archetype/audience-band and voice notes are not editable from this dialog):
 *   - HANDLE        read-only, always shown. The engine matches on handles
 *                   (plan §9), so they are immutable — the request cannot name one;
 *   - DISPLAY NAME  required, 1..100;
 *   - BIO           <= 512, with a character counter;
 *   - LOCATION      <= 100;
 *   - VERIFIED      a checkbox labelled "Verified" with the helper text "Changes
 *                   the trust mark participants see". It is the one cue a
 *                   participant has for impersonation training (SOC-052), so
 *                   flipping it in EITHER direction asks for confirmation
 *                   (`VerifiedConfirmDialog`), and the state is always said in
 *                   words + icon, never by colour (NFR-001);
 *   - AVATAR/BANNER `ImageChooser`: upload (`useMediaUpload`) or pick from the
 *                   library (C1's picker), with an image preview.
 *
 * ## Save
 * `buildPersonaPatch` diffs the draft against the persona and sends ONLY the
 * changed fields as a JSON merge-patch (`null` to clear, never the whole persona).
 * Save is DISABLED while the draft is invalid, while an upload is running, while a
 * save is in flight, and while nothing has changed (a no-op must not reach the
 * audit trail) — and the reason is always written next to the button. A failed
 * save keeps the dialog open with every edit intact and shows the failure in a
 * `role="alert"` banner: for a 400 the SERVER's own sentence, verbatim. The
 * success side effects (invalidate persona reads, refresh the active persona,
 * ONE `steering_action` event) live in `usePersonaEdit`.
 *
 * ## Keyboard and focus (the controller console is fully keyboard-operable)
 * The dialog is a real `<form>` (Enter in a single-line field saves; Ctrl/Cmd+Enter
 * saves from anywhere, incl. the bio), focus starts on Display name, MUI's trap
 * keeps Tab inside, Esc cancels (not while a save is running — the request cannot
 * be taken back), and focus returns to the "Edit persona" button on close
 * (`PersonaEditButton`). After a failed save, focus returns to Save, not to
 * `<body>`.
 *
 * ## Text is never truncated
 * Lengths are COUNTED in code points and an over-long field shows its limit and
 * blocks Save; there is no `maxLength` and no `.slice()` anywhere (cutting through
 * a surrogate pair is a server 400 — `textRules.ts`).
 *
 * ## Content security (NFR-004)
 * Free text (name/bio/location) is sent as typed and sanitized by the SERVER —
 * the trust boundary — and every value is rendered back as React text, never as
 * HTML. This dialog mounts only while open, so each opening starts from the
 * persona's current values with no stale error.
 */

import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type InputHTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  Box,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormHelperText,
  Stack,
  Typography,
} from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleCheck,
  faCircleInfo,
  faCircleXmark,
  faFloppyDisk,
  faLock,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { useMediaUpload } from '@/core/media'
import type { StaffPersona } from '@/features/personas'
import CobraStyles from '@/theme/CobraStyles'
import { CobraLinkButton, CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { ImageChooser } from './ImageChooser'
import { VerifiedConfirmDialog } from './VerifiedConfirmDialog'
import {
  BIO_MAX,
  DISPLAY_NAME_MAX,
  LOCATION_MAX,
  buildPersonaPatch,
  countedLength,
  draftFromPersona,
  isPatchEmpty,
  validateDraft,
} from './personaEditForm'
import { MUTED_TEXT, STAFF_FIELD_SX } from './personaEditStyles'
import { usePersonaEdit } from './usePersonaEdit'
import type { ImageChoice, PersonaEditDraft } from './types'

export interface PersonaEditDialogProps {
  readonly persona: StaffPersona
  readonly open: boolean
  /** Close without (further) changes — Cancel, Esc, backdrop, or after a save. */
  readonly onClose: () => void
  /** Called once with the server's updated persona after a save succeeds, before `onClose`. */
  readonly onSaved: (updated: StaffPersona) => void
}

/** Inline icon + words problem line (NFR-001: never colour alone). All-`span`: lives in a `<p>`. */
function Problem({ message }: { message: string }) {
  return (
    <Stack
      direction="row"
      component="span"
      sx={{ alignItems: 'flex-start', gap: 0.75, color: 'notifications.errorText' }}
    >
      <Box component="span" sx={{ mt: '2px' }}>
        <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden />
      </Box>
      <Box component="span">{message}</Box>
    </Stack>
  )
}

interface FieldHelpProps {
  readonly problem: string | undefined
  readonly hint: ReactNode
  readonly length: number
  readonly max: number
  readonly counterTestId: string
}

/** Helper text under a field: the problem (or a hint) on the left, `n/max` on the right. */
function FieldHelp({ problem, hint, length, max, counterTestId }: FieldHelpProps) {
  return (
    <Stack
      direction="row"
      component="span"
      sx={{ justifyContent: 'space-between', gap: 1, alignItems: 'flex-start' }}
    >
      <Box component="span">{problem !== undefined ? <Problem message={problem} /> : hint}</Box>
      <Box
        component="span"
        data-testid={counterTestId}
        sx={{ flex: 'none', fontWeight: length > max ? 700 : 400 }}
      >
        {length}/{max}
      </Box>
    </Stack>
  )
}

/** The words for the verified state: what participants see now / will see after saving. */
function verifiedStateText(draftVerified: boolean, persisted: boolean): string {
  if (draftVerified === persisted) {
    return draftVerified
      ? 'Participants currently see the verified seal on this account.'
      : 'Participants currently see no verified seal on this account.'
  }
  return draftVerified
    ? 'After you save, participants will see the verified seal on this account.'
    : 'After you save, participants will see no verified seal on this account.'
}

interface PersonaEditFormProps {
  readonly persona: StaffPersona
  readonly onClose: () => void
  readonly onSaved: (updated: StaffPersona) => void
}

/** The open dialog. Mounted only while open, so its draft always starts from the persona. */
function PersonaEditForm({ persona, onClose, onSaved }: PersonaEditFormProps) {
  const titleId = useId()
  const hintId = useId()
  const verifiedHelpId = useId()
  const saveButtonRef = useRef<HTMLButtonElement>(null)

  const [draft, setDraft] = useState<PersonaEditDraft>(() => draftFromPersona(persona))
  const [proposedVerified, setProposedVerified] = useState<boolean | null>(null)
  const avatarUpload = useMediaUpload()
  const bannerUpload = useMediaUpload()
  const { save, saving, error } = usePersonaEdit(persona)

  const problems = validateDraft(draft)
  const valid = Object.keys(problems).length === 0
  const patch = useMemo(() => buildPersonaPatch(persona, draft), [persona, draft])
  const dirty = !isPatchEmpty(patch)
  const uploading = avatarUpload.state === 'uploading' || bannerUpload.state === 'uploading'
  const canSave = valid && dirty && !uploading && !saving

  const saveHint = saving
    ? 'Saving…'
    : uploading
      ? 'Waiting for the image upload to finish.'
      : !valid
        ? 'Fix the highlighted fields to save.'
        : !dirty
          ? 'No changes to save.'
          : ''

  // After a FAILED save the (disabled-while-saving) Save button is enabled again but
  // focus has been stranded on the dialog; put it back so the retry is one keypress.
  const wasSavingRef = useRef(false)
  useLayoutEffect(() => {
    if (wasSavingRef.current && !saving && error !== undefined) saveButtonRef.current?.focus()
    wasSavingRef.current = saving
  }, [saving, error])

  const setText = (field: 'displayName' | 'bio' | 'location', value: string) =>
    setDraft(previous => ({ ...previous, [field]: value }))
  const chooseAvatar = (avatar: ImageChoice) => setDraft(previous => ({ ...previous, avatar }))
  const chooseBanner = (banner: ImageChoice) => setDraft(previous => ({ ...previous, banner }))

  const submit = async () => {
    if (!canSave) return
    const updated = await save(patch)
    if (updated === undefined) return
    onSaved(updated)
    onClose()
  }

  const handleSubmit = (event: FormEvent<HTMLElement>) => {
    event.preventDefault()
    void submit()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Only keys pressed inside THIS dialog (React events also bubble out of portals).
    if (!event.currentTarget.contains(event.target as Node)) return
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      void submit()
    }
  }

  // Esc / backdrop. A save in flight cannot be taken back; dismissing now would hide its
  // outcome. (The banner of a failed save stays until the NEXT attempt, so the controller
  // can keep reading it while fixing the field it names.)
  const dismiss = () => {
    if (!saving) onClose()
  }

  const textReadOnly = saving ? { readOnly: true } : {}

  // The Paper IS the form, so Save (in the actions row) is a real submit button of it and
  // Enter in a single-line field submits in every browser. (MUI types the paper slot as
  // plain Paper props, which know neither `noValidate` nor a form's `onSubmit`.)
  const paperAsForm: object = {
    component: 'form',
    noValidate: true,
    'aria-busy': saving,
    onSubmit: handleSubmit,
    onKeyDown: handleKeyDown,
  }

  return (
    <>
      <Dialog
        open
        onClose={dismiss}
        maxWidth="sm"
        fullWidth
        scroll="paper"
        transitionDuration={0}
        aria-labelledby={titleId}
        slotProps={{ paper: paperAsForm }}
      >
        <DialogTitle id={titleId} sx={{ fontSize: 18, fontWeight: 700, pb: 0.5 }}>
          Edit persona
        </DialogTitle>
        <DialogContent dividers sx={{ padding: CobraStyles.Padding.DialogContent }}>
          <Box>
            <Stack sx={{ gap: CobraStyles.Spacing.FormFields }}>
              <Stack direction="row" sx={{ gap: 1, alignItems: 'flex-start' }}>
                <Box component="span" sx={{ mt: '3px' }}>
                  <FontAwesomeIcon icon={faCircleInfo} aria-hidden />
                </Box>
                <Typography variant="body2">
                  Saved changes go live for participants straight away — nothing here is a draft.
                </Typography>
              </Stack>

              <CobraTextField
                label="Handle"
                size="small"
                sx={STAFF_FIELD_SX}
                fullWidth
                value={`@${persona.handle}`}
                slotProps={{
                  input: {
                    readOnly: true,
                    startAdornment: (
                      <Box component="span" sx={{ mr: 1, display: 'inline-flex' }}>
                        <FontAwesomeIcon icon={faLock} aria-hidden />
                      </Box>
                    ),
                  },
                  htmlInput: { 'data-testid': 'persona-edit-handle' },
                }}
                helperText="Read-only — the engine matches on handles, so they can't be changed."
              />

              <CobraTextField
                label="Display name"
                size="small"
                sx={STAFF_FIELD_SX}
                fullWidth
                required
                autoFocus
                value={draft.displayName}
                onChange={event => setText('displayName', event.target.value)}
                error={problems.displayName !== undefined}
                helperText={
                  <FieldHelp
                    problem={problems.displayName}
                    hint="Shown on the account's posts and profile."
                    length={countedLength(draft.displayName)}
                    max={DISPLAY_NAME_MAX}
                    counterTestId="persona-edit-name-counter"
                  />
                }
                slotProps={{
                  input: textReadOnly,
                  htmlInput: { 'data-testid': 'persona-edit-display-name' },
                }}
              />

              <CobraTextField
                label="Bio"
                size="small"
                sx={STAFF_FIELD_SX}
                fullWidth
                multiline
                minRows={3}
                maxRows={8}
                value={draft.bio}
                onChange={event => setText('bio', event.target.value)}
                error={problems.bio !== undefined}
                helperText={
                  <FieldHelp
                    problem={problems.bio}
                    hint="Plain text. Leave empty for no bio."
                    length={countedLength(draft.bio)}
                    max={BIO_MAX}
                    counterTestId="persona-edit-bio-counter"
                  />
                }
                slotProps={{
                  input: textReadOnly,
                  htmlInput: { 'data-testid': 'persona-edit-bio' },
                }}
              />

              <CobraTextField
                label="Location"
                size="small"
                sx={STAFF_FIELD_SX}
                fullWidth
                value={draft.location}
                onChange={event => setText('location', event.target.value)}
                error={problems.location !== undefined}
                helperText={
                  <FieldHelp
                    problem={problems.location}
                    hint="Optional, e.g. a town. Leave empty for none."
                    length={countedLength(draft.location)}
                    max={LOCATION_MAX}
                    counterTestId="persona-edit-location-counter"
                  />
                }
                slotProps={{
                  input: textReadOnly,
                  htmlInput: { 'data-testid': 'persona-edit-location' },
                }}
              />

              <Box>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.verified}
                      disabled={saving}
                      onChange={event => setProposedVerified(event.target.checked)}
                      slotProps={{
                        input: {
                          'aria-describedby': verifiedHelpId,
                          'data-testid': 'persona-edit-verified',
                        } as InputHTMLAttributes<HTMLInputElement>,
                      }}
                    />
                  }
                  label="Verified"
                />
                <FormHelperText id={verifiedHelpId} sx={{ mt: 0, ml: 4, color: MUTED_TEXT }}>
                  Changes the trust mark participants see
                </FormHelperText>
                <Stack
                  direction="row"
                  data-testid="persona-edit-verified-state"
                  sx={{ gap: 0.75, alignItems: 'center', ml: 4, mt: 0.5 }}
                >
                  <FontAwesomeIcon
                    icon={draft.verified ? faCircleCheck : faCircleXmark}
                    aria-hidden
                  />
                  <Typography variant="body2">
                    {verifiedStateText(draft.verified, persona.verified)}
                  </Typography>
                </Stack>
              </Box>

              <ImageChooser
                slot="avatar"
                handle={persona.handle}
                initials={persona.initials}
                currentUrl={persona.avatarUrl}
                choice={draft.avatar}
                onChoose={chooseAvatar}
                upload={avatarUpload}
              />
              <ImageChooser
                slot="banner"
                handle={persona.handle}
                initials={persona.initials}
                currentUrl={persona.bannerUrl}
                choice={draft.banner}
                onChoose={chooseBanner}
                upload={bannerUpload}
              />

              <Box role="alert" data-testid="persona-edit-error">
                {error !== undefined ? (
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
                    <Typography variant="body2">
                      <strong>Not saved.</strong>{' '}
                      <span data-testid="persona-edit-error-text">{error}</span>
                    </Typography>
                  </Stack>
                ) : null}
              </Box>
            </Stack>
          </Box>
        </DialogContent>
        <DialogActions
          sx={{ padding: CobraStyles.Padding.DialogContent, gap: 1, alignItems: 'center' }}
        >
          <Typography
            id={hintId}
            variant="body2"
            data-testid="persona-edit-save-hint"
            sx={{ flex: 1, color: MUTED_TEXT }}
          >
            {saveHint}
          </Typography>
          <CobraLinkButton disabled={saving} onClick={onClose}>
            Cancel
          </CobraLinkButton>
          <CobraPrimaryButton
            ref={saveButtonRef}
            type="submit"
            disabled={!canSave}
            aria-describedby={hintId}
            startIcon={<FontAwesomeIcon icon={faFloppyDisk} />}
          >
            {saving ? 'Saving…' : 'Save'}
          </CobraPrimaryButton>
        </DialogActions>

      </Dialog>
      <VerifiedConfirmDialog
        proposed={proposedVerified}
        handle={persona.handle}
        onCancel={() => setProposedVerified(null)}
        onConfirm={() => {
          if (proposedVerified !== null) {
            const next = proposedVerified
            setDraft(previous => ({ ...previous, verified: next }))
          }
          setProposedVerified(null)
        }}
      />
    </>
  )
}

/** The persona edit dialog. See the module header. */
export function PersonaEditDialog({ persona, open, onClose, onSaved }: PersonaEditDialogProps) {
  // Mounted only while open: each opening starts from the persona's current values,
  // with no stale draft, banner or upload state.
  return open ? <PersonaEditForm persona={persona} onClose={onClose} onSaved={onSaved} /> : null
}
