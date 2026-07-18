/**
 * features/evaluator/components/shell/EvaluatorFlyoutLayer.tsx
 * ---------------------------------------------------------------------------
 * Everything absolutely-positioned against the work-area frame: whichever
 * toolstrip flyout is open — driven by the shell's shared active-tool state
 * (`useToolstrip().activeToolId`, `@/features/staffShell/toolRegistry`), not
 * local evaluator state, since "one flyout open at a time" is a shell-owned
 * invariant (D7-011) — plus the annotation-capture popover, which can appear
 * over any view.
 */

import { useToolstrip } from '@/features/staffShell/toolRegistry'
import { EVALUATOR_TOOLS } from '../../evaluatorTools'
import { AnnotationCapture } from '../AnnotationCapture'

export function EvaluatorFlyoutLayer() {
  const { activeToolId } = useToolstrip()
  const ActiveFlyout = EVALUATOR_TOOLS.find(tool => tool.id === activeToolId)?.Flyout

  return (
    <>
      {ActiveFlyout && <ActiveFlyout />}
      <AnnotationCapture />
    </>
  )
}
