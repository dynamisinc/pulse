/**
 * features/social/edit/EditHistoryDialog.tsx
 * ---------------------------------------------------------------------------
 * The "Edit history" dialog (demo-feedback story 20; DF-31, X-style): every version of a post,
 * NEWEST FIRST, each with its SCENARIO time (COR-053; never a wall-clock time) and the labels
 * "Current" (the top version) and "Original" (edit 0). PARTICIPANT world, brand skin, opened from
 * the "Edited" button in `PostHeader`; the staff Live world has its own COBRA-skinned dialog
 * (`controller/liveWorld/LiveWorldEditHistory.tsx`) over the same `usePostEditHistory` read.
 *
 * Text, not colour, marks the labels. Version text renders as plain React text (NFR-004). A load
 * failure shows a retry; the dialog is labelled, Esc / Close dismiss it and focus returns to the
 * "Edited" button (`EditDialogShell`).
 */

import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { EditDialogShell } from './EditDialogShell'
import { usePostEditHistory, versionLabel } from './usePostEditHistory'
import styles from './EditDialogs.module.css'

export interface EditHistoryDialogProps {
  readonly postId: string
  readonly onClose: () => void
  /** The "Edited" button, for focus return. */
  readonly returnFocusTo: HTMLElement | null
}

export function EditHistoryDialog({ postId, onClose, returnFocusTo }: EditHistoryDialogProps) {
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)
  const { history, isLoading, isError, refetch } = usePostEditHistory(postId)

  const versions = history === undefined
    ? []
    : [...history.versions].sort((a, b) => b.editNumber - a.editNumber)
  const newest = versions[0]?.editNumber ?? 0

  return (
    <EditDialogShell
      title="Edit history"
      testId="edit-history-dialog"
      onClose={onClose}
      returnFocusTo={returnFocusTo}
    >
      <div className={styles.body}>
        {isLoading && (
          <p className={styles.status} role="status">Loading edit history…</p>
        )}
        {isError && (
          <p className={styles.error} role="alert">
            <span>Couldn't load the edit history.</span>
            <button type="button" className={styles.cancel} onClick={refetch}>Try again</button>
          </p>
        )}
        {versions.length > 0 && (
          <ol className={styles.versions} data-testid="edit-history-list">
            {versions.map(version => {
              const label = versionLabel(version.editNumber, newest)
              return (
                <li
                  key={version.editNumber}
                  className={styles.version}
                  data-testid="edit-history-version"
                >
                  <div className={styles.versionMeta}>
                    {label !== null && <span className={styles.versionLabel}>{label}</span>}
                    <time dateTime={version.scenarioTime}>
                      {format(version.scenarioTime, { format: 'absolute' })}
                    </time>
                  </div>
                  <p className={styles.versionText}>{version.text}</p>
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </EditDialogShell>
  )
}
