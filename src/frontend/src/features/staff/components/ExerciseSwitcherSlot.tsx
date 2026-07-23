/**
 * features/staff/components/ExerciseSwitcherSlot.tsx
 * ---------------------------------------------------------------------------
 * Composition-level VISIBILITY GATE for the cross-exercise switcher (feature:
 * exercise-isolation, story 05; COR-005). `RoleAwareEntry` mounts the staff
 * hand-off as `{staffSwitcher}{surface}` — i.e. whatever is passed as the
 * switcher renders as a strip ABOVE the live staff console. `ExerciseSwitcher`
 * itself deliberately does not gate its own visibility ("whether/where to
 * mount THIS switcher is the composing route's decision" — see its header), so
 * this slot IS that decision:
 *
 *   - The switcher exists to move BETWEEN exercises. A staff member assigned to
 *     ONE exercise (the common case) has nothing to switch to, and the console's
 *     own header identity badge already shows which exercise they're in — so a
 *     full switcher panel above the console is redundant noise. This slot renders
 *     NOTHING in that case, leaving a clean console.
 *   - Only when the caller holds TWO OR MORE assignments does the switcher have a
 *     job to do; then (and only then) this slot mounts it.
 *
 * It renders nothing while the assignment list is loading or on error, too — a
 * gate has no UI of its own, and a switcher that can't determine there is
 * anywhere to switch to simply doesn't appear (a soft degrade: the staff member
 * still operates their current, session-scoped exercise). This keeps the
 * switcher's OWN loading/empty/error affordances (exercise-isolation/05 ACs,
 * NFR-001) intact for the standalone/pre-conduct contexts that mount
 * `<ExerciseSwitcher>` directly — this slot changes only WHEN the app-shell
 * staff hand-off shows it, never the switcher's internals.
 *
 * Shares the exact React Query key (`useStaffAssignments`, `['staff',
 * 'assignments']`) the switcher uses, so mounting the switcher after this gate
 * resolves hits the warm cache — one network read, no double fetch, no
 * loading flash.
 *
 * World: STAFF. Pure gate — no COBRA, no UI; the mounted `<ExerciseSwitcher>`
 * owns all of that. Requires the same ancestors the switcher does (a React
 * Query `QueryClientProvider` + an `ExerciseContextProvider`), which the
 * role-aware staff hand-off already provides.
 */

import { useStaffAssignments } from '../hooks/useStaffAssignments'
import { ExerciseSwitcher } from './ExerciseSwitcher'

/** The minimum number of assignments for the switcher to have anything to switch between. */
const MIN_ASSIGNMENTS_TO_SWITCH = 2

/**
 * Renders the cross-exercise switcher ONLY when the staff member has more than
 * one exercise to switch between; otherwise renders nothing. See module header.
 */
export function ExerciseSwitcherSlot() {
  const { data } = useStaffAssignments()

  if (!data || data.length < MIN_ASSIGNMENTS_TO_SWITCH) {
    return null
  }

  return <ExerciseSwitcher />
}
