# Design Handoff — Pulse Evaluator Dashboard & Replay (D6)

Session 7 output, the final Pulse surface. This package is the design source of truth for
the evaluator dashboard frontend build.

## Contents
| File | What |
|---|---|
| `Evaluator Dashboard.dc.html` | The approved clickable mockup (open directly in a browser; `support.js` + `cobra.jsx` must sit beside it). All markup is inline-styled; the template between `<x-dc>` tags is the reference DOM. |
| `DECISIONS.md` | Full project decisions log — **D6-001…D6-012** are this surface's entries, each citing requirement IDs. Read D6 + D7 (shell) + D5 (shared staff patterns) before building. |
| `SHELL-CONTRACT.md` | The staff shell contract this surface renders inside (COR-063): header, toolstrip dock, work area. The mockup inlines the shell for standalone viewing; the build must consume the real shared shell. |
| `cobra.jsx` | Provider-wrapped COBRA (CadenceDS) component shims used by the mockup. In the real build, import `cadence-design-system` directly and wrap the app in `CobraThemeProvider`. |
| `support.js` | Mockup runtime only — not a build artifact. |

## Surface summary
Read-only evaluator surface (COR-013 — steering affordances absent, never disabled). Four
views: **Live** (storyline board tiles + live stream + read-only world view), **Timeline**
(filterable event explorer, per-human attribution COR-018, deep-link to replay),
**Replay** (video-scrubber over the exercise; evaluator vs participant-visible hotwash
modes, EVL-003/014), **Metrics** (latency incl. CTL-026 off-platform markers, coverage with
confirm-before-AAR EVL-011, sentiment with controller-dial overlay EVL-014, evidence-level
chips EVL-012). Annotation capture ≤10s via B key / ⚑ (EVL-020) with push-to-Cadence
(EVL-021). AAR export with manifest (EVL-030/031).

Demo states are component props (`exState`: live-quiet / live-storm / hotwash / pre-e8;
`projector`): implement as real runtime states, not props.

## Requirement IDs in scope
EVL-001…004, 010…015, 020…022, 030…033 · COR-013, COR-018, COR-053/054 · CTL-026 · NFR-001
(WCAG 2.1 AA; all state encodings are word + shape + color, never color-only).
