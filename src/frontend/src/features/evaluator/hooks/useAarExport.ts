/**
 * features/evaluator/hooks/useAarExport.ts
 * ---------------------------------------------------------------------------
 * Manifest + progress for the AAR export flyout (D6-012, EVL-030/031).
 * Export progress/transport state lives in `EvaluatorStateContext` (it's a
 * mutation, not a query); this hook only derives the read-only manifest
 * lines, including the live annotations count. TODO: point the actual
 * "Export AAR package" action at a real export job API once one exists —
 * today `startExport()` just animates progress.
 */

import { useMemo } from 'react'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { MANIFEST_BASE } from '../services/mockData'
import type { ManifestItem } from '../types'

const STATIC_DETAILS: Record<string, string> = {
  'timeline-log': '214 events · full origin + per-human attribution',
  'replay-bundle': '68 min · 5 channels · order-exact, counts snapshot-approx',
  'metrics': 'Latency, coverage, sentiment (with controller-input layer)',
  'scenario-design-record': 'Dial events + time jumps — the defensibility layer (EVL-014)',
}

export function useAarManifest(): ManifestItem[] {
  const { annotations } = useEvaluatorState()

  return useMemo(() => {
    const unpushed = annotations.filter(a => !a.pushed).length
    return MANIFEST_BASE.map(item => ({
      ...item,
      detail: item.id === 'annotations'
        ? `${annotations.length} notes · ${unpushed} not yet in Cadence`
        : STATIC_DETAILS[item.id] ?? '',
    }))
  }, [annotations])
}
