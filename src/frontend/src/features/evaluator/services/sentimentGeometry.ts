/**
 * features/evaluator/services/sentimentGeometry.ts
 * ---------------------------------------------------------------------------
 * SVG geometry for the sentiment-trajectory chart (D6-008), transcribed from
 * the reference mockup's coordinate mapping so the chart matches it exactly:
 * viewBox "0 0 680 190"; X maps elapsed minutes 0-68 onto 30-670; Y maps the
 * engine's aggregate sentiment scale onto the 14-176 plot band.
 */

import type { AxisTick, DialMark, SentimentPoint } from '../types'

export function sentimentX(t: number): number {
  return 30 + (t / 68) * 640
}

export function sentimentY(v: number): number {
  return 95 - v * 1.45
}

export function buildSentimentPath(points: SentimentPoint[]): string {
  return points
    .map((p, i) => `${i ? 'L' : 'M'}${sentimentX(p.t).toFixed(1)} ${sentimentY(p.v).toFixed(1)}`)
    .join(' ')
}

export interface DialMarkerGeometry {
  label: string;
  x: string;
  y: string;
  /** Top-left of the 9x9 rotated-diamond marker rect (x/y minus half its side). */
  rectX: string;
  rectY: string;
  /** Label x position, clear of the marker. */
  labelX: string;
}

export function buildDialMarkers(dialMarks: DialMark[]): DialMarkerGeometry[] {
  return dialMarks.map(d => {
    const x = sentimentX(d.t)
    const y = sentimentY(d.v)
    return {
      label: d.label,
      x: x.toFixed(1),
      y: y.toFixed(1),
      rectX: (x - 4.5).toFixed(1),
      rectY: (y - 4.5).toFixed(1),
      labelX: (x + 8).toFixed(1),
    }
  })
}

export interface AxisTickGeometry {
  x: string;
  label: string;
}

export function buildAxisTickGeometry(ticks: AxisTick[]): AxisTickGeometry[] {
  return ticks.map(a => ({ x: sentimentX(a.t).toFixed(1), label: a.label }))
}

export function seamXPosition(seamT: number): string {
  return sentimentX(seamT).toFixed(1)
}
