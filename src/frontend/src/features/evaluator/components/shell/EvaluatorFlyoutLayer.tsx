/**
 * features/evaluator/components/shell/EvaluatorFlyoutLayer.tsx
 * ---------------------------------------------------------------------------
 * Everything absolutely-positioned against the work-area/toolstrip frame:
 * whichever toolstrip flyout is open (Annotations XOR AAR export — toggling
 * one closes the other, see the reducer) plus the annotation-capture
 * popover, which can appear over any view.
 */

import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'
import { AnnotationsFlyout } from '../AnnotationsFlyout'
import { AarExportPanel } from '../AarExportPanel'
import { AnnotationCapture } from '../AnnotationCapture'

export function EvaluatorFlyoutLayer() {
  const { annotationsFlyoutOpen, exportFlyoutOpen } = useEvaluatorState()

  return (
    <>
      {annotationsFlyoutOpen && <AnnotationsFlyout />}
      {exportFlyoutOpen && <AarExportPanel />}
      <AnnotationCapture />
    </>
  )
}
