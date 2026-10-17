/**
 * features/controller/access — the console's read-only gate (demo-feedback story 11, #507;
 * DF-14). `useCanControl()` decides whether a write control exists; `ViewOnlyChip` tells a
 * non-controller why they are not there. See `useCanControl.ts` for the rule.
 */

export {
  useCanControl,
  useCanEditContent,
  useCanStaffPost,
  useCanStaffPin,
} from './useCanControl'
export { ViewOnlyChip } from './ViewOnlyChip'
