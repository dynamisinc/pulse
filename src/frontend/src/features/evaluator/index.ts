/**
 * features/evaluator/index.ts
 * ---------------------------------------------------------------------------
 * Public surface of the Evaluator Dashboard feature. The staff route registry
 * (`@/features/staff/staffRouteRegistry`) mounts `EvaluatorDashboardRoute` at
 * `/staff/evaluate`; `EvaluatorDashboardPage` is the bare work-area surface for
 * callers that supply their own shell. See `README.md` for the full summary.
 */

export { EvaluatorDashboardPage } from './pages/EvaluatorDashboardPage'
export { EvaluatorDashboardRoute } from './EvaluatorDashboardRoute'
