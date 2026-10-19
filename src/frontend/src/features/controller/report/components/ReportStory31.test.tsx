/**
 * features/controller/report/components/ReportStory31.test.tsx
 * ---------------------------------------------------------------------------
 * Story 31 at the component level: the numbered chart badges + real-text key at dense marker
 * counts (no overlap), dates on a multi-day inject table, and the print CSS rules (media max
 * height, poster-less tile, sheet padding; `@page` itself is injected by the page, never in CSS).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ActivityChart } from './ActivityChart'
import { InjectResponseTable } from './InjectResponseTable'
import { PostRecord } from './PostRecord'
import { ReportSheet } from './ReportSheet'
import { MOCK_REPORT } from '../services/reportMock'
import type { ExerciseReport } from '../types/report'

function activityWith(markers: ExerciseReport['activity']['injectMarkers']): ExerciseReport['activity'] {
  return {
    binMinutes: 5,
    bins: Array.from({ length: 40 }, (_, index) => ({
      start: `2026-10-15 ${String(9 + Math.floor((index * 5) / 60)).padStart(2, '0')}:${String((index * 5) % 60).padStart(2, '0')}`,
      participant: 1,
      scripted: 0,
      engine: 0,
      noise: 0,
    })),
    injectMarkers: markers,
  }
}

describe('ActivityChart inject badges and key (story 31)', () => {
  const dense = Array.from({ length: 10 }, (_, index) => ({
    ref: index % 2 === 0 ? `${index + 1}` : null,
    title: `Inject ${index + 1}`,
    at: `2026-10-15 09:${String(index * 5).padStart(2, '0')}`,
    binIndex: 10 + index,
  }))

  it('lists every inject in a real-text key, numbered, ref before the title only when present', () => {
    render(<ActivityChart activity={activityWith(dense)} />)
    const key = screen.getByTestId('marker-key')
    const items = within(key).getAllByRole('listitem')
    expect(items).toHaveLength(10)
    expect(items[0]).toHaveTextContent('1 · 09:00 · #1 Inject 1')
    expect(items[1]).toHaveTextContent('2 · 09:05 · Inject 2')
    expect(items[9]).toHaveTextContent('10 · 09:45 · Inject 10')
  })

  it('does not print inject words on the chart itself (numbers only)', () => {
    render(<ActivityChart activity={activityWith(dense)} />)
    const chart = screen.getByTestId('activity-chart')
    expect(chart.textContent).not.toContain('Inject 1')
  })

  it('never overlaps badges when ten injects sit in adjacent bins', () => {
    render(<ActivityChart activity={activityWith(dense)} />)
    const badges = screen.getAllByTestId('marker-badge').map(group => {
      const rect = group.querySelector('rect')
      return {
        x: Number(rect?.getAttribute('x')),
        y: Number(rect?.getAttribute('y')),
        width: Number(rect?.getAttribute('width')),
        height: Number(rect?.getAttribute('height')),
      }
    })
    expect(badges.length).toBeGreaterThan(0)
    for (let i = 0; i < badges.length; i += 1) {
      for (let j = i + 1; j < badges.length; j += 1) {
        const a = badges[i]
        const b = badges[j]
        if (a === undefined || b === undefined) continue
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x ||
          a.y + a.height <= b.y || b.y + b.height <= a.y
        expect(apart, `badge ${i} vs ${j}`).toBe(true)
      }
    }
  })

  it('carries the date in the key on a multi-day report only', () => {
    const one = [{ ref: '2', title: 'Advisory', at: '2026-10-15 09:04', binIndex: 1 }]
    const { rerender } = render(<ActivityChart activity={activityWith(one)} spansMultipleDays />)
    expect(screen.getByText('1 · 15 Oct 09:04 · #2 Advisory')).toBeInTheDocument()
    rerender(<ActivityChart activity={activityWith(one)} />)
    expect(screen.getByText('1 · 09:04 · #2 Advisory')).toBeInTheDocument()
  })

  it('never lets an axis time label run into the next one, at any bin count', () => {
    // 10px monospace: at most 6.2 viewBox units per character.
    const extent = (text: Element) => {
      const x = Number(text.getAttribute('x'))
      const width = (text.textContent ?? '').length * 6.2
      return text.getAttribute('text-anchor') === 'end' ? [x - width, x] : [x, x + width]
    }
    for (let count = 1; count <= 300; count += 1) {
      const activity: ExerciseReport['activity'] = {
        binMinutes: 60,
        bins: Array.from({ length: count }, (_, index) => ({
          start: `2026-10-${String(14 + Math.floor(index / 24)).padStart(2, '0')} `
            + `${String(index % 24).padStart(2, '0')}:00`,
          participant: 1,
          scripted: 0,
          engine: 0,
          noise: 0,
        })),
        injectMarkers: [],
      }
      const { unmount } = render(<ActivityChart activity={activity} />)
      const labels = [...screen.getByTestId('activity-chart').querySelectorAll('text[y="168"]')]
        .map(extent)
        .sort((a, b) => (a[0] ?? 0) - (b[0] ?? 0))
      for (let index = 1; index < labels.length; index += 1) {
        expect(labels[index]?.[0] ?? 0, `${count} bins`).toBeGreaterThan(labels[index - 1]?.[1] ?? 0)
      }
      unmount()
    }
  })
})

describe('InjectResponseTable dates (story 31)', () => {
  const rows = [{
    ref: null,
    title: 'Impersonator: brown water',
    deliveredAt: '2026-10-14 06:39',
    firstResponseAt: '2026-10-15 07:02',
    responseMinutes: 23,
    respondedAsHandle: '@KestrelCoEM',
  }]

  it('prints delivered and response times with their date on a multi-day report', () => {
    render(<InjectResponseTable rows={rows} spansMultipleDays />)
    expect(screen.getByText('14 Oct 06:39')).toBeInTheDocument()
    expect(screen.getByText('23 min · 15 Oct 07:02')).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'Impersonator: brown water' })).toBeInTheDocument()
  })

  it('prints plain times on a single-day report', () => {
    render(<InjectResponseTable rows={rows} />)
    expect(screen.getByText('06:39')).toBeInTheDocument()
    expect(screen.getByText('23 min · 07:02')).toBeInTheDocument()
  })
})

describe('report.module.css print rules (story 31, DF-46)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/features/controller/report/components/report.module.css'), 'utf-8')
  const printBlock = css.slice(css.indexOf('@media print'))

  // Story 34 (DF-50): the compact print card; the screen card (before @media print) is unchanged.
  it('prints a compact card: small avatar, tight rows, counts and tags on one line', () => {
    const screenCss = css.slice(0, css.indexOf('@media print'))
    expect(printBlock).toMatch(/\.post\s*\{[^}]*grid-template-columns:\s*52px 24px 1fr/)
    expect(printBlock).toMatch(/\.post\s*\{[^}]*padding:\s*5px 0/)
    expect(printBlock).toMatch(/\.av,\s*\.avImg\s*\{[^}]*width:\s*24px/)
    expect(printBlock).toMatch(/\.meta\s*\{[^}]*display:\s*flex/)
    expect(screenCss).toMatch(/\.post\s*\{[^}]*grid-template-columns:\s*72px 40px 1fr/)
    expect(screenCss).toMatch(/\.meta\s*\{[^}]*display:\s*grid/)
  })

  it('caps media at 2.5in and the poster-less tile at 1.25in, inside @media print', () => {
    expect(printBlock).toMatch(/\.frame\s*\{[^}]*max-height:\s*2\.5in/)
    expect(printBlock)
      .toMatch(/\.frame img\s*\{[^}]*max-height:\s*2\.5in[^}]*object-fit:\s*contain/)
    expect(printBlock).toMatch(/\.plain\s*\{[^}]*height:\s*1\.25in/)
  })

  it('gives the sheet 0.5in print padding and keeps headings with their first item', () => {
    expect(printBlock).toMatch(/\.sheet\s*\{[^}]*padding:\s*0\.5in/)
    expect(printBlock).toMatch(/\.heading,\s*\.hour\s*\{[^}]*break-after:\s*avoid/)
    // The record's filter statement and notes keep with its first group too.
    expect(printBlock).toMatch(/\.method,\s*\.omit\s*\{[^}]*break-after:\s*avoid/)
    // The post record may start on its heading's page: no forced break before it.
    expect(css).not.toMatch(/break-before:\s*page/)
  })

  it('never declares @page in the module (it is injected only while the page is mounted)', () => {
    expect(css).not.toMatch(/^\s*@page\s*\{/m)
  })
})

describe('Copilot review folds (story 31)', () => {
  it('keeps edge badges inside the chart without overlapping a row neighbour', () => {
    const indexes = [0, 20, 40, 60, 80, 100, 120, 140, 160, 289, 299]
    const activity: ExerciseReport['activity'] = {
      binMinutes: 5,
      bins: Array.from({ length: 300 }, () => ({ start: '2026-10-15 09:00', participant: 1, scripted: 0, engine: 0, noise: 0 })),
      injectMarkers: indexes.map((binIndex, index) => ({
        ref: null, title: `Inject ${index + 1}`, at: '2026-10-15 09:00', binIndex,
      })),
    }
    render(<ActivityChart activity={activity} />)
    const rects = screen.getAllByTestId('marker-badge').map(group => {
      const rect = group.querySelector('rect')
      const x = Number(rect?.getAttribute('x'))
      return { x, right: x + Number(rect?.getAttribute('width')), y: Number(rect?.getAttribute('y')) }
    })
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0)
      expect(rect.right).toBeLessThanOrEqual(680)
    }
    for (const a of rects) {
      for (const b of rects) {
        if (a !== b && a.y === b.y) expect(a.right <= b.x || b.right <= a.x).toBe(true)
      }
    }
  })

  it('dates a reply after midnight that prints under its root from the day before', () => {
    const base = MOCK_REPORT.posts[0]
    if (base === undefined) throw new Error('mock has no posts')
    const root = { ...base, id: 'r', threadRootId: 'r', depth: 0, parentPostId: null, scenarioAt: '2026-10-14 23:50', scenarioTime: '23:50' }
    const reply = { ...base, id: 'c', threadRootId: 'r', depth: 1, parentPostId: 'r', scenarioAt: '2026-10-15 00:05', scenarioTime: '00:05' }
    render(
      <PostRecord
        posts={[root, reply]}
        omittedNoiseCount={0}
        postRecord={MOCK_REPORT.postRecord}
        spansMultipleDays
      />,
    )
    const cards = screen.getAllByTestId('report-post')
    expect(cards[0]).not.toHaveTextContent('14 Oct 23:50')
    expect(cards[1]).toHaveTextContent('15 Oct 00:05')
  })

  it('dates the busiest window on a multi-day report', () => {
    render(<ReportSheet
      report={{
        ...MOCK_REPORT,
        exercise: { ...MOCK_REPORT.exercise, spansMultipleDays: true },
        summary: { ...MOCK_REPORT.summary, busiestWindow: { start: '2026-10-15 10:05', posts: 3 } },
      }}
    />)
    expect(screen.getByText('Busiest 5 minutes (15 Oct 10:05)')).toBeInTheDocument()
  })
})
