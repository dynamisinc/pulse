/**
 * features/pwa/install/InstallPrompt.tsx
 * ---------------------------------------------------------------------------
 * Mobile-tablet story 11. Participant-world "add to home screen" surface:
 *   - Android/Chrome: an unobtrusive banner "Add [brand] to your home screen"; tapping the main
 *     action calls the held `beforeinstallprompt` event's `prompt()`.
 *   - iOS Safari: a dismissible non-modal sheet with "Share -> Add to Home Screen" steps
 *     (FontAwesome icons + text; never color-only). A home-screen app has its own storage, so it
 *     opens signed out: the last step tells the participant to copy their sign-in link first,
 *     because the app's sign-in page asks them to paste it (#606).
 * Skinned with `--pulse-brand-*` tokens; no COBRA, no MUI; actions are >= 44px; it never takes
 * focus (feed focus is preserved) and Escape dismisses while focus is inside it. Copy uses the
 * exercise brand name only,
 * never Pulse/Dynamis. Mounted by PwaRoot inside PwaDock, so it inherits PwaRoot's gates
 * (resolved brand, not `/staff/*`, signed-in subtree) and the dock's safe-zone placement above
 * the compliance footer / tab bar. Needs the exercise id (from the exercise context) for
 * per-exercise dismissal; with none it renders nothing. NO telemetry (MT-D5).
 */
import { useRef } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faArrowUpFromBracket,
  faLink,
  faSquarePlus,
  faXmark,
  faDownload,
} from '@fortawesome/free-solid-svg-icons'
import { useOptionalExerciseContext } from '@/core/exerciseContext'
import { useInstallPrompt } from './useInstallPrompt'
import styles from './InstallPrompt.module.css'

export interface InstallPromptProps {
  /** The RESOLVED exercise brand name (PwaRoot only mounts this once the brand resolved). */
  brandName: string
}

export function InstallPrompt({ brandName }: InstallPromptProps) {
  const surfaceRef = useRef<HTMLElement>(null)
  const exerciseId = useOptionalExerciseContext()?.exerciseId
  const { mode, install, dismiss } = useInstallPrompt(exerciseId, surfaceRef)

  if (mode === 'android') {
    return (
      <section
        ref={surfaceRef}
        className={styles.card}
        role="region"
        aria-label={`Add ${brandName} to your home screen`}
      >
        <button type="button" className={styles.primary} onClick={() => void install()}>
          <FontAwesomeIcon icon={faDownload} aria-hidden="true" />
          <span>{`Add ${brandName} to your home screen`}</span>
        </button>
        <button type="button" className={styles.close} onClick={dismiss} aria-label="Not now">
          <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
        </button>
      </section>
    )
  }

  if (mode === 'ios') {
    return (
      <section
        ref={surfaceRef}
        className={styles.sheet}
        role="region"
        aria-label={`Add ${brandName} to your home screen`}
      >
        <div className={styles.sheetHead}>
          <h2 className={styles.title}>{`Add ${brandName} to your home screen`}</h2>
          <button type="button" className={styles.close} onClick={dismiss} aria-label="Close">
            <FontAwesomeIcon icon={faXmark} aria-hidden="true" />
          </button>
        </div>
        <ol className={styles.steps}>
          <li>
            <FontAwesomeIcon icon={faArrowUpFromBracket} aria-hidden="true" />
            <span>Tap the Share button in Safari&apos;s toolbar.</span>
          </li>
          <li>
            <FontAwesomeIcon icon={faSquarePlus} aria-hidden="true" />
            <span>Choose &ldquo;Add to Home Screen&rdquo;, then tap Add.</span>
          </li>
          <li>
            <FontAwesomeIcon icon={faLink} aria-hidden="true" />
            <span>
              {`Open ${brandName} from your home screen and paste your sign-in link from your `
                + 'invitation, or use today\'s word.'}
            </span>
          </li>
        </ol>
      </section>
    )
  }

  return null
}
