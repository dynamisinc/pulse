/**
 * features/evaluator/components/shell/EvaluatorToolstripRegistration.tsx
 * ---------------------------------------------------------------------------
 * Registers the Evaluator Dashboard's own tools (`EVALUATOR_TOOLS`,
 * `../../evaluatorTools`) into the staff shell's SURFACE toolstrip zone via
 * `useRegisterSurfaceTool()` (the `registerSurfaceTool()` seam,
 * `@/features/staffShell/toolRegistry`) — this surface draws no toolstrip of
 * its own (D7-011). Data-driven over `EVALUATOR_TOOLS`; the `annotations`
 * tool's badge is the live unpushed-to-Cadence annotation count
 * (`useEvaluatorState().annotations`).
 *
 * Renders nothing (`null`) — this is a registration-only component, mounted
 * once from `EvaluatorDashboardPage`. Each tool is registered by its own
 * `ToolRegistrar` child so `useRegisterSurfaceTool()` is called once per hook
 * instance, never from inside a `.map()` callback directly (hooks can't be
 * called conditionally/in a loop body).
 */

import { useRegisterSurfaceTool, type SurfaceTool } from '@/features/staffShell/toolRegistry'
import { EVALUATOR_TOOLS } from '../../evaluatorTools'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'

interface ToolRegistrarProps {
  tool: SurfaceTool
}

function ToolRegistrar({ tool }: ToolRegistrarProps) {
  useRegisterSurfaceTool(tool)
  return null
}

export function EvaluatorToolstripRegistration() {
  const { annotations } = useEvaluatorState()
  const unpushed = annotations.filter(a => !a.pushed).length

  return (
    <>
      {EVALUATOR_TOOLS.map(tool => (
        <ToolRegistrar
          key={tool.id}
          tool={{
            id: tool.id,
            label: tool.label,
            icon: tool.icon,
            tooltip: tool.tooltip,
            badge: tool.id === 'annotations' && unpushed > 0 ? { count: unpushed } : undefined,
          }}
        />
      ))}
    </>
  )
}
