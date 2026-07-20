/**
 * features/controller — public barrel (E7 Simcell Operator console, staff world).
 *
 * Created at the Wave-1 serial integration step (NOT during the parallel
 * fan-out, which forbade cross-story imports). Consumers import the console
 * route + the public console/persona-operation surface from `@/features/controller`.
 *
 * World: staff (COBRA/Cadence). The published OUTPUT (a persona post) lands in
 * the participant world via the shipped `createPost` pipeline and is never drawn
 * here (XC-002).
 */

// The route composition App.tsx mounts at /console (the wired Wave-1 loop).
export { ControllerConsoleRoute } from './ControllerConsoleRoute'

// console-shell/01 — the frame content + extension point.
export { ControllerConsole } from './components/ControllerConsole'
export type { ControllerConsoleProps } from './components/ControllerConsole'
export { useControllerIdentity } from './identity/controllerIdentity'
export type { ControllerIdentity } from './identity/controllerIdentity'

// persona-operation/02 — active-persona state + picker.
export { ActivePersonaProvider, useActivePersona } from './hooks/useActivePersona'
export type { ActivePersonaContextValue } from './hooks/useActivePersona'
export { PersonaPicker } from './components/PersonaPicker'

// persona-operation/01 — post-as-persona composer + service.
export { PersonaComposer } from './components/PersonaComposer'
export { composeAsPersona } from './services/composeService'

// persona-operation/03 — in-composer persona context.
export { PersonaContextPanel } from './components/PersonaContextPanel'

// world-steering/03 — tiered pause (the keystone primitive) + its control pill.
// The /console route reads usePauseState() to drive the staff-header state-pill
// label override; PausePill (the tier control) is docked in the console work area.
export { usePauseState, PAUSE_TIER_LABELS } from './hooks/usePauseState'
export type { PauseTier, PauseLabel, PauseState, OverlayRegister } from './hooks/usePauseState'
export { PausePill } from './components/steering/PausePill'

// world-steering/02 — storyline escalation dial (actual + target) + its hook.
export { EscalationDial } from './components/steering/EscalationDial'
export { useStorylineTarget } from './hooks/useStorylineTarget'
