# controller/report — printable exercise report (demo-feedback story 29, #550)

Staff-world page at `/staff/console/report` (opened in a new tab by the **Exercise report**
button beside Export posts). The controller uses the browser's **Print / Save as PDF** (DF-40).

- `pages/ExerciseReportPage.tsx` — COBRA toolbar (screen only) + the sheet in a portal; injects
  the `@page` Letter rule and the `html.reportOpen` print scope only while mounted.
- `components/` — `ReportSheet` (header, At a glance, footer) composing `ActivityChart` (inline
  SVG), `InjectResponseTable`, `LookalikeSection` (omitted when empty), `PostRecord` / `ReportPostCard`.
  `report.module.css` is the sheet's own neutral print stylesheet (no COBRA, no brand skin).
- `services/reportService.ts` — `GET /staff/exports/report?includeNoise=`; `reportMock.ts` serves
  the same shape under `USE_MOCK_DATA`; `reportFormat.ts` holds the pure helpers.
- `types/report.ts` — the frozen contract. `hooks/useExerciseReport.ts` — React Query seam.

Rules: all times are the server's preformatted scenario times (never converted); post text is
plain text, never HTML; labels are words, never color-only; icons are FontAwesome; fonts are local
stacks (the mockup's Google Fonts are not loaded).
