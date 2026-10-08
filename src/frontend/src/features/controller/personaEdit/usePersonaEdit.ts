/**
 * features/controller/personaEdit/usePersonaEdit.ts
 * ---------------------------------------------------------------------------
 * The SAVE flow of the persona profile edit (demo-polish story 21 / PE-FE;
 * COR-018 attribution, XC-004 telemetry, XC-001 scope). Staff world.
 *
 *   const { save, saving, error, clearError } = usePersonaEdit(persona)
 *   const updated = await save(patch)        // StaffPersona | undefined
 *
 * `save` PATCHes the merge-patch (`patchPersona`) and, ONLY on a 200 whose body
 * reads as the edited persona, does exactly four things, in this order:
 *
 *   1. `invalidatePersonas()` — the persona reads are `useState`/`useEffect`
 *      hooks, not React Query (F0), so this module-level signal is the cache
 *      invalidation: every mounted `useStaffPersonas()` (the console picker, the
 *      live-world column) and `usePersonas()` (the participant feed's author
 *      lookup — same browser in mock mode and the staff preview) re-resolves and
 *      picks up the new name / avatar / bio / verified mark;
 *   2. `selectPersona(updated)` — refreshes the console's ACTIVE-persona snapshot
 *      (`useActivePersona`), which the context panel and composer read. It is
 *      skipped only if the controller has meanwhile switched to a DIFFERENT
 *      persona (a stale save must not yank the console back);
 *   3. emits exactly ONE `steering_action` telemetry event
 *        payload { action: 'persona_edit', fields }, target { persona, id },
 *        actor { kind: 'system', actingHumanId, role }
 *      through the caller-safe `buildAndEmit` (it never throws into the save).
 *      `fields` are the NAMES of the changed fields — never values (a bio or a
 *      new name must not enter the event stream, implementation.md §1.8). The
 *      CONSOLE emits this in both mock and live mode: PE-BE emits nothing
 *      server-side (DP-9), so there is no double count to avoid;
 *   4. returns the updated persona so the dialog can close.
 *
 * A failure does NONE of that: the persona lists are untouched, nothing is
 * emitted, and `error` carries the text to show (the server's own sentence for a
 * 400, verbatim). One exception to "untouched": a 2xx the console could not read
 * (`mayHaveSaved`) still invalidates the persona reads, because the edit may well
 * have landed and the lists should show the truth — but it selects nothing and
 * emits nothing, since the console cannot say what changed.
 *
 * Single-flight: a second `save` while one is running is ignored.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { scenarioNow } from '@/core/clock'
import { useExerciseContext } from '@/core/exerciseContext'
import { buildAndEmit } from '@/core/telemetry'
import { wallClockNowIso } from '@/core/time/wallClock'
import type { StaffPersona } from '@/features/personas'
import { invalidatePersonas } from '@/features/personas/personaService'
import { useActivePersona } from '../hooks/useActivePersona'
import { useControllerIdentity } from '../identity/controllerIdentity'
import { patchFieldNames } from './personaEditForm'
import { patchPersona, toPersonaEditError } from './personaEditService'
import type { PersonaPatch } from './types'

/** What {@link usePersonaEdit} returns. */
export interface UsePersonaEditResult {
  /** Sends `patch`; resolves with the updated persona, or `undefined` on failure / while busy. */
  save(patch: PersonaPatch): Promise<StaffPersona | undefined>
  readonly saving: boolean
  /** The text to show for the last failed save (verbatim server sentence for a 400). */
  readonly error: string | undefined
  clearError(): void
}

/** The save flow for `persona` (the persona the dialog was opened for). */
export function usePersonaEdit(persona: Pick<StaffPersona, 'id'>): UsePersonaEditResult {
  const { exerciseId, timeZone } = useExerciseContext()
  const { actingHumanId, role } = useControllerIdentity()
  const { activePersona, selectPersona } = useActivePersona()

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const inFlightRef = useRef(false)

  // The active persona AT RESPONSE TIME, not at click time (the closure below is
  // created on an earlier render).
  const activeIdRef = useRef<string | undefined>(activePersona?.id)
  useLayoutEffect(() => {
    activeIdRef.current = activePersona?.id
  }, [activePersona])

  const personaId = persona.id

  const save = useCallback(
    async (patch: PersonaPatch): Promise<StaffPersona | undefined> => {
      if (inFlightRef.current) return undefined
      inFlightRef.current = true
      setSaving(true)
      setError(undefined)
      try {
        const updated = await patchPersona(personaId, patch)

        invalidatePersonas()
        if (activeIdRef.current === undefined || activeIdRef.current === updated.id) {
          selectPersona(updated)
        }
        buildAndEmit({
          exerciseId,
          eventType: 'steering_action',
          channel: 'system',
          actor: { kind: 'system', actingHumanId, role },
          wallClockTime: wallClockNowIso(),
          scenarioTime: scenarioNow().toISOString(),
          timeZone,
          target: { entityType: 'persona', entityId: updated.id },
          payload: { action: 'persona_edit', fields: patchFieldNames(patch) },
        })
        return updated
      } catch (failure) {
        const problem = toPersonaEditError(failure)
        if (problem.mayHaveSaved) invalidatePersonas()
        setError(problem.message)
        return undefined
      } finally {
        inFlightRef.current = false
        setSaving(false)
      }
    },
    [personaId, selectPersona, exerciseId, timeZone, actingHumanId, role],
  )

  const clearError = useCallback(() => setError(undefined), [])

  return { save, saving, error, clearError }
}
