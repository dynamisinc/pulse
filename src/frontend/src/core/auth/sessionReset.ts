/**
 * core/auth/sessionReset.ts
 * ---------------------------------------------------------------------------
 * A tiny registry of "forget my session-scoped state" callbacks, run by `endSession`
 * (Wave 3 Gate-2 A L-5). WORLD-NEUTRAL (`core/`): pure callbacks, no React, no theme, and -
 * the point of it - NO import of any feature.
 *
 * WHY. Some module singletons live as long as the TAB, not the session - the controller
 * composer's unsent drafts and its unresolved "did that post go out?" questions are
 * `Map`s at module level (they must survive the dock unmounting). Left alone they would
 * hand the previous staff user's text and pending question to the next sign-in on the same
 * tab. `endSession` is the one place sign-out runs, but `core/` must not import a staff
 * feature (the participant bundle would pull the controller in, and the layering inverts),
 * so the feature registers its reset HERE, at module load, and `endSession` runs the lot:
 *
 *     // in the feature module:
 *     registerSessionReset(() => store.reset())
 *
 * A reset registered by a module that was never loaded simply does not exist - and then
 * there is nothing to forget. Resets run synchronously, in registration order; one that
 * throws is isolated so the others (and the logout that follows) still happen.
 *
 * Existing session-scoped stores (`ownPostStore`, `removedPosts`, reply intent) are leaves
 * `endSession` calls directly; they are not migrated onto this registry.
 */

type SessionReset = () => void

const resets = new Set<SessionReset>()

/**
 * Registers a callback `endSession` runs when the session ends. Returns an unregister
 * function (idempotent). Registering the same function twice registers it once.
 */
export function registerSessionReset(reset: SessionReset): () => void {
  resets.add(reset)
  return () => {
    resets.delete(reset)
  }
}

/** Runs every registered reset. Called by `endSession`; never throws. */
export function runSessionResets(): void {
  for (const reset of [...resets]) {
    try {
      reset()
    } catch {
      // A failing reset must not stop the others or the logout.
    }
  }
}
