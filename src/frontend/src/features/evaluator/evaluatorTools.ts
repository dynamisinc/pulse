/**
 * features/evaluator/evaluatorTools.ts
 * ---------------------------------------------------------------------------
 * Toolstrip tool registry for the Evaluator Dashboard: Annotations (badged
 * with the unpushed-to-Cadence count) and AAR export. Registered into the
 * real shared staff shell's ONE toolstrip dock via `useRegisterSurfaceTool()`
 * (`@/features/staffShell/toolRegistry`, D7-011) by
 * `components/shell/EvaluatorToolstripRegistration.tsx` — this feature draws
 * no toolstrip of its own.
 */

import type { ComponentType } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faFlag, faFileExport } from '@fortawesome/free-solid-svg-icons'
import { AnnotationsFlyout } from './components/AnnotationsFlyout'
import { AarExportPanel } from './components/AarExportPanel'

export type EvaluatorToolId = 'annotations' | 'aar-export'

export interface EvaluatorToolDefinition {
  id: EvaluatorToolId;
  label: string;
  icon: IconDefinition;
  tooltip: string;
  Flyout: ComponentType;
}

export const EVALUATOR_TOOLS: EvaluatorToolDefinition[] = [
  {
    id: 'annotations',
    label: 'ANNOT',
    icon: faFlag,
    tooltip: 'Annotations — your bookmarked moments (EVL-020)',
    Flyout: AnnotationsFlyout,
  },
  {
    id: 'aar-export',
    label: 'EXPORT',
    icon: faFileExport,
    tooltip: 'AAR export — one-click evidence package (EVL-030)',
    Flyout: AarExportPanel,
  },
]
