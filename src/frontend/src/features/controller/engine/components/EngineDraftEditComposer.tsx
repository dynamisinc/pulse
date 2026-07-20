/**
 * features/controller/engine/components/EngineDraftEditComposer.tsx
 * ---------------------------------------------------------------------------
 * The `<ReviewQueue>` `editSlot` composer (feature: engine-review-cockpit,
 * integration seam; D5 §"Composer", NFR-004, XC-002). STAFF world — dark COBRA
 * operator chrome (matches `ReviewQueue`'s D5 tokens), `@/theme/styledComponents`
 * (`CobraTextField`/`CobraPrimaryButton`/`CobraLinkButton`), FontAwesome icons
 * only, MUI 9 `sx`-only system props. Mounted at the composition root
 * (`ControllerConsoleRoute`), wired into `<ReviewQueue editSlot={...}>`.
 *
 * PUBLISH PATH: this component NEVER calls `createPost` itself. `onSubmit`
 * (from {@link ReviewQueueEditSlotProps}) is `ReviewQueue`'s own `submitEdit`,
 * which routes the new text through `useReviewQueue().edit()` ->
 * `reviewActions.edit()` -> `createPost` with `origin: 'engine'` — sanitized
 * there (NFR-004). There is deliberately NO `'engine-edited'` origin: an
 * edited-then-sent draft is `engine`, identical to an approved one; the
 * approve-vs-edit distinction lives in telemetry only (`reviewActions.ts`
 * header). This file must NOT import or reuse `PersonaComposer` — that
 * component's publish path is `origin: 'controller-as-persona'` and would
 * double-publish a SECOND post under the wrong origin (see the integration
 * spec's "deliberate reconciliation" note).
 *
 * IDENTITY HEADER (mirrors `PersonaComposer`'s `PersonaIdentity`, R-001/R-004):
 * the cross-surface `<Avatar>` + `<VerifiedMark>` so the persona reads
 * identically here and on every participant surface — a trust signal is never
 * re-themed per world. Falls back to a handle-derived monogram while the
 * persona roster hasn't resolved (mirrors `ReviewQueue`'s own fallback).
 */

import { useMemo, useState, type KeyboardEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPen } from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
import { Avatar, VerifiedMark, type AvatarPersona } from '@/features/social'
import { usePersonas } from '@/features/personas'
import type { ReviewQueueEditSlotProps } from './ReviewQueue'

/** D5 dark operator-chrome tokens (matches `ReviewQueue`'s `chrome`). Staff-only. */
const chrome = {
  panel: '#0f1826',
  line: '#28384b',
  ink: '#e9eff7',
  inkMuted: '#9db1c8',
  inkFaint: '#63758b',
  blue: '#4d97d1',
} as const

/** Fallback avatar identity when the persona isn't resolved yet (mirrors `ReviewQueue`). */
function fallbackAvatar(handle: string): AvatarPersona {
  const initials = handle.slice(0, 2).toUpperCase()
  return { kind: 'org', avatarColor: '#33455c', initials, displayName: handle }
}

/** The queue's edit composer — see the module header for the publish contract. */
export function EngineDraftEditComposer({
  item,
  initialText,
  onSubmit,
  onCancel,
}: ReviewQueueEditSlotProps) {
  const { personas } = usePersonas()
  const persona = useMemo(
    () => personas.find(p => p.handle.toLowerCase() === item.leadPersonaHandle.toLowerCase()),
    [personas, item.leadPersonaHandle],
  )
  const avatarPersona: AvatarPersona = persona ?? fallbackAvatar(item.leadPersonaHandle)
  const displayName = persona?.displayName ?? item.leadPersonaHandle

  const [text, setText] = useState(initialText)

  const submit = () => {
    if (text.trim().length === 0) return
    onSubmit(text)
  }

  // Keyboard-first (NFR-001): Ctrl/Cmd+Enter sends without leaving the field.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      submit()
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      onCancel()
    }
  }

  return (
    <Stack
      data-testid="engine-draft-edit-composer"
      role="dialog"
      aria-label={`Edit draft for ${displayName}`}
      sx={{
        gap: 1.25,
        p: 1.75,
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        bgcolor: chrome.panel,
        color: chrome.ink,
        fontFamily: "'Figtree', system-ui, sans-serif",
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
        <FontAwesomeIcon icon={faPen} color={chrome.blue} aria-hidden="true" />
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.1em', color: chrome.ink }}>
          EDIT DRAFT
        </Typography>
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Avatar persona={avatarPersona} size={38} />
        <Stack sx={{ minWidth: 0 }}>
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
            <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, color: chrome.ink }}>
              {displayName}
            </Typography>
            {persona?.verified && <VerifiedMark size={13} />}
          </Stack>
          <Typography component="span" sx={{ fontSize: 11.5, color: chrome.inkFaint }}>
            @{item.leadPersonaHandle} · {item.actionLabel}
          </Typography>
        </Stack>
      </Stack>

      <CobraTextField
        label={`Send in-character as ${displayName}`}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        multiline
        minRows={4}
        fullWidth
        autoFocus
        slotProps={{ htmlInput: { 'aria-label': 'Edited draft text' } }}
      />

      <Box sx={{ flex: 1 }} />

      <Stack direction="row" sx={{ justifyContent: 'flex-end', gap: 1 }}>
        <CobraLinkButton type="button" onClick={onCancel}>
          Cancel
        </CobraLinkButton>
        <CobraPrimaryButton
          type="button"
          onClick={submit}
          disabled={text.trim().length === 0}
          aria-label="Send in-character"
        >
          Send in-character
        </CobraPrimaryButton>
      </Stack>
    </Stack>
  )
}
