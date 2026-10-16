/**
 * features/pwa/install/useInstallPrompt.ts
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 11. The install-prompt state machine.
 *
 *   mode 'none'     standalone / dismissed / no exerciseId / nothing to offer yet
 *   mode 'android'  a `beforeinstallprompt` event is being held (Chrome/Android)
 *   mode 'ios'      iOS Safari, >= 2 visits to this exercise, not standalone, not dismissed
 *
 * Fail closed: no `exerciseId` => 'none' (no per-exercise persistence possible, and the brand
 * must belong to a resolved exercise). Escape dismisses whichever surface is showing. Taps are
 * the only thing that calls `prompt()`. NO telemetry (MT-D5).
 */
import { useCallback, useEffect, useState } from 'react'
import {
  IOS_VISIT_THRESHOLD,
  detectPlatform,
  isDismissed,
  isStandalone,
  markDismissed,
  recordVisit,
} from './installEnv'

/** The (non-standard) Chrome install event. */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallMode = 'none' | 'android' | 'ios'

export interface InstallPromptState {
  mode: InstallMode
  /** Android: trigger the native prompt (call from a user tap). */
  install(): Promise<void>
  /** Hide and remember (per exercise). */
  dismiss(): void
}

export function useInstallPrompt(exerciseId: string | undefined): InstallPromptState {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | undefined>()
  const [hidden, setHidden] = useState(false)
  const [iosEligible, setIosEligible] = useState(false)

  // Exercise-scoped reset + iOS eligibility. Re-runs on exercise switch (no cross-exercise carry).
  useEffect(() => {
    setHidden(false)
    setIosEligible(false)
    if (!exerciseId || isStandalone()) return
    if (isDismissed(exerciseId)) {
      setHidden(true)
      return
    }
    const visits = recordVisit(exerciseId)
    if (
      detectPlatform(navigator.userAgent, navigator.maxTouchPoints) === 'ios-safari' &&
      visits >= IOS_VISIT_THRESHOLD
    ) {
      setIosEligible(true)
    }
  }, [exerciseId])

  // Android/Chrome: hold the event; hide permanently once installed.
  useEffect(() => {
    if (!exerciseId) return undefined
    const onBip = (e: Event) => {
      e.preventDefault()
      setDeferred(e as BeforeInstallPromptEvent)
    }
    const onInstalled = () => {
      setDeferred(undefined)
      setHidden(true)
    }
    window.addEventListener('beforeinstallprompt', onBip)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBip)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [exerciseId])

  const dismiss = useCallback(() => {
    if (exerciseId) markDismissed(exerciseId)
    setHidden(true)
  }, [exerciseId])

  const install = useCallback(async () => {
    const evt = deferred
    if (!evt) return
    setDeferred(undefined) // a captured event can be used once
    try {
      await evt.prompt()
      const choice = await evt.userChoice
      if (choice.outcome === 'dismissed') dismiss()
      else setHidden(true)
    } catch {
      dismiss()
    }
  }, [deferred, dismiss])

  let mode: InstallMode = 'none'
  if (exerciseId && !hidden && !isStandalone()) {
    if (deferred) mode = 'android'
    else if (iosEligible) mode = 'ios'
  }

  useEffect(() => {
    if (mode === 'none') return undefined
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [mode, dismiss])

  return { mode, install, dismiss }
}
