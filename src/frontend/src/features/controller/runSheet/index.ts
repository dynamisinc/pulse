/**
 * features/controller/runSheet — public barrel (STAFF world; inject-queue story 07, #453).
 *
 * The console's run sheet for the SERVER-SIDE inject queue (story 06): scripted persona
 * posts held on the server, assigned to controllers like MSEL rows, fired on cue (one
 * post, or a paced pile-on burst), kept in sync across consoles by ~3 s polling.
 *
 * MOUNTING. `<RunSheetPanel />` takes NO props (the frozen seam name it inherits from
 * demo-polish C3, #438). Mount it in `ControllerConsole`'s `runSheetSlot`; it needs the
 * exercise-context provider and a React Query provider above it, which the console route
 * already supplies.
 *
 *   panel + editor        RunSheetPanel.tsx (list, filters, banners, keyboard, live region)
 *                         RunSheetRow.tsx · InjectItemEditor.tsx · InjectPostEditor.tsx
 *   media adapter         media/InjectMediaField.tsx — the ONE place C1's picker is imported
 *   server state          useInjectQueue.ts (polling + mutations) · useInjectAssignees.ts
 *   service seam          injectService.ts (interface + live axios + the USE_MOCK_DATA flip)
 *                         injectMock.ts (in-memory server: state machine, versions, burst pacing)
 *   contract + rules      types.ts (FROZEN wire contract) · injectRules.ts · injectDraft.ts
 *
 * The mock's controls (`injectMock.setPauseTier`, `.as(actor)`, `.failNextPublish`) are for
 * tests and dev only and are deliberately NOT re-exported here.
 */
export { RunSheetPanel } from './RunSheetPanel'
export type {
  InjectAssigneesDto,
  InjectItemDto,
  InjectItemWrite,
  InjectKind,
  InjectPostDto,
  InjectPostWrite,
  InjectQueueDto,
  InjectStatus,
} from './types'
