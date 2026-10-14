/**
 * features/controller/liveWorld — public surface (demo-polish C2/C5).
 *
 * STAFF world only. The console route (orchestrator-owned) imports
 * `LiveWorldColumn` and mounts it through `ControllerConsole`'s `liveWorldSlot`;
 * C5's `TakedownAction` takes a `LiveWorldPost` and is mounted through the
 * column's `renderRowActions` prop. See `LiveWorldColumn.tsx`.
 */
export { LiveWorldColumn } from './LiveWorldColumn'
export type { LiveWorldColumnProps } from './LiveWorldColumn'
export type { LiveWorldPost } from './liveWorldModel'
