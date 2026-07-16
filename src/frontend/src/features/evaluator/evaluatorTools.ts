/**
 * features/evaluator/evaluatorTools.ts
 * ---------------------------------------------------------------------------
 * Toolstrip tool registry for the Evaluator Dashboard: Annotations (badged
 * with the unpushed-to-Cadence count) and AAR export. Mounted into
 * `StaffShellStub`'s toolstrip slot for now.
 *
 * TODO(D7-011): once the real shared staff shell exists, its toolstrip owns
 * a single `registerTool()` registry shared by every staff surface (see
 * `docs/features/console-shell/implementation.md`, story 01). Move these
 * two entries there instead of rendering them locally via
 * `EvaluatorToolstripButtons`.
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
