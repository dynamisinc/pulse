# Browser e2e (Playwright)

First Playwright harness for Pulse (mobile-tablet stories 01, 05, 06). Chromium only,
no backend: specs run against the frontend's mock seams.

## Run

```bash
cd src/frontend
npm run test:e2e                         # all projects (360, 390, 768)
npx playwright test --project=phone-390  # one viewport
npx playwright test e2e/alert-bar.phone.spec.ts
```

- **Server:** `playwright.config.ts` starts `tools/guide-screenshots/serve.mjs` (Vite on mock
  data, port **5199**) or reuses one already running. We depend on it because it provides the
  `localStorage` seams for role, alerts and overlay (`pulse.guideShots.*`); it is not forked.
- **Chromium:** `CHROMIUM_PATH`, else `/opt/pw-browsers/chromium` if present, else Playwright's
  download (`npx playwright install chromium`). Playwright is pinned to 1.56.1 (Chromium 1194).
- **Projects:** `phone-360` (360x800), `phone-390` (390x844), `tablet-768` (768x1024); all touch.
- Vitest does not pick these up (`e2e/**` is excluded); `npm run type-check` covers them via
  `tsconfig.e2e.json`.

## Kit (`e2e/kit`)

| Helper | Use |
|--------|-----|
| `signInAs(page, role)`, `seedAlerts`, `seedOverlay`, `seedStorage` | Seed mock state; call **before** `page.goto` |
| `expectNoHorizontalScroll(page)` | No sideways page scroll |
| `expectTouchTarget(locator, 44)` | Hit-test based (accounts for invisible `::after` hit-slop) |
| `expectNoWallClock(page)` | No visible text with today's real date (COR-053) |
| `boxOf`, `boxesOverlap` | Bounding-box overlap checks |

## Specs

`smoke.spec.ts` (boot + role-seam isolation), `participant-critical-path.spec.ts` (join, feed,
post, thread, reply, telemetry on the wire, unknown-thread fail-closed), `alert-bar.phone.spec.ts`.
`controller-tablet.spec.ts` (controller console at 1024x768, 768x1024, 1180x820, 820x1180; run by its own `controller-tablet` project only: `npx playwright test e2e/controller-tablet.spec.ts --project=controller-tablet`).
Known gap tracked in-spec with `test.fail`: composer submit buttons under 44px (story 18).

## Perf (`@perf`)

`burst-legibility.phone.spec.ts` (mobile-tablet story 07) runs 120 posts/min for 60 s at 4x CPU
throttle (CDP) on phone-390 only, and asserts MT-D6 (no long task over 200 ms, p95 frame <= 50 ms),
scroll anchoring, the aggregate `NewPostsPill`, and a throttled live region. It takes about 1.4 min.

```bash
npx playwright test --grep @perf            # only the perf spec
npx playwright test --grep-invert @perf     # the fast run
BURST_SECONDS=600 npx playwright test --grep @perf   # 10-minute soak (manual)
```

Seam: the spec `import()`s the dev server's `postStore` module and calls `appendPost` (the mock's
stand-in for a SignalR frame). Dev-server only; no production code or serve.mjs rewrite needed.
`npm run test:e2e` (and so the nightly) includes it. It measures a Vite DEV build (React dev mode),
which is slower than production, so a pass here is conservative.
