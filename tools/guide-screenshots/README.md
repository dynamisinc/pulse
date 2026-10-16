# Guide screenshots

Captures the screenshots used by the user guide (`docs/guide/*.md`) into
`docs/guide/img/`, the same way every time.

The images show **mock data only**: the fictional *Coastal Surge (Mock Exercise)*
and its Fairhaven water-contamination storyline, served by the frontend's built-in
mock seams. No backend is needed, and no real exercise content, participant or
credential can appear in a shot. Mock sign-in links and QR codes on the card sheet
use placeholder tokens (`MockTkn…`).

This tool is **not part of CI**. It has its own `package.json` (one dependency,
`playwright-core`) and adds nothing to `src/frontend/package.json`.

Browser e2e specs (Playwright, `src/frontend/e2e/`) reuse this server for the role / alerts
/ overlay seams; see `src/frontend/e2e/README.md`.

## Run it

Prerequisites: Node 22+, `src/frontend/node_modules` installed (`npm ci` in
`src/frontend`), and a Chromium. In the cloud dev container Chromium is at
`/opt/pw-browsers/chromium`; elsewhere set `CHROMIUM_PATH` to any Chrome/Chromium
binary (or install one with `npx playwright-core install chromium`).

```bash
cd tools/guide-screenshots
npm install                         # once
npm run capture                     # all shots -> docs/guide/img/*.png
node capture.mjs roster day-word    # only some shots
node capture.mjs --list             # shot names
```

`capture.mjs` starts its own Vite dev server on **port 5199** (it does not touch
your `npm run dev` on 5198) and stops it when done. To reuse a server you already
started with `node serve.mjs`, set `GUIDE_SHOTS_URL=http://localhost:5199`.

Viewports: staff screens 1440x900 (console panel crops use 1440x1150 so the panel
shows more rows), participant screens 390x844 (phone).

## Why its own dev server

Plain `npm run dev` always signs you in as the participant Dana Reyes, and the
staff sign-in has no mock, so the staff consoles cannot be reached. `serve.mjs`
adds a dev-only Vite plugin that, at transform time and without editing any file,
lets the browser override three mock seams through `localStorage`:

| Key | Effect |
|-----|--------|
| `pulse.guideShots.role` | Mock session role: `participant`, `pio`, `controller`, `evaluator`, `planner`, `orgAdmin` |
| `pulse.guideShots.alerts` | JSON list of alerts for the participant alert bar (stock mock: none) |
| `pulse.guideShots.overlay` | JSON pause / EndEx overlay, e.g. `{"state":"pause","register":"out-of-fiction","message":""}` |

With no key set the app behaves exactly like `npm run dev`. You can browse the same
server by hand: `node serve.mjs`, open http://localhost:5199, then in devtools run
`localStorage.setItem('pulse.guideShots.role','controller'); location.reload()`.

If a mock seam is renamed in `src/`, the server fails loudly with
`could not find "…" in …` — update `MOCK_SEAM_REWRITES` in `serve.mjs`.

## Add a shot

1. Add an entry to `SHOTS` in `capture.mjs`:

   ```js
   {
     name: 'my-screen',          // -> docs/guide/img/my-screen.png (docs link to this name)
     role: 'controller',         // mock session role
     path: '/staff/console',     // URL to open
     viewport: MOBILE,           // optional; default DESKTOP (1440x900)
     storage: { … },             // optional extra localStorage keys
     act: async page => { … },   // optional clicks / typing (Playwright Page API)
     crop: page => locator,      // optional: capture only this element (or an array: their union)
   }
   ```

2. Run `node capture.mjs my-screen` and **open the PNG** — check for spinners, empty
   states and the wrong page before committing it.

The capture hides dev-only scaffolding a real user never sees: the cross-exercise
switcher (shown only because the mock staff user has three exercises), the
"Simulate degraded (dev)" engine button and the evaluator's "DEV — exercise state"
strip.

## Files

- `capture.mjs`: the shot list and the capture loop.
- `serve.mjs`: starts the mock dev server with the override plugin.
- `package.json` / `package-lock.json`: `playwright-core` only. `node_modules/` is
  git-ignored by the root `.gitignore`.
