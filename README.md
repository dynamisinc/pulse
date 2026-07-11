# Pulse

**A simulated media environment for emergency-management exercises.** Part of the
Dynamis product family, alongside [Cadence](https://github.com/dynamisinc/cadence)
(HSEEP MSEL management) and COBRA.

Pulse gives exercise participants a believable information ecosystem to react to —
a fake social network, local news portals, TV/newspaper/wire outlets, and a weather
service — while controllers and evaluators drive and observe it from Cadence-style
staff consoles.

## The two worlds

Pulse is built around a hard separation (see [`docs/design/D0-FOUNDATIONS.md`](docs/design/D0-FOUNDATIONS.md)):

| | Participant world (the fiction) | Staff world (the machine) |
|---|---|---|
| Feel | Consumer apps: warm, familiar, brandable | Cadence-family operator tooling |
| Anchors | X/Twitter, local news sites, weather.gov | Cadence conduct views, TweetDeck columns |
| Theming | Per-exercise brands, per-outlet skins | Fixed COBRA system look |
| Cardinal rule | Nothing breaks fiction | Never confusable with a participant view |

**Participant surfaces must never read as an enterprise app** — no default MUI look on
any participant path. **Staff surfaces reuse the COBRA styling system** so a
Cadence-trained controller is productive immediately.

### Screened brand set

Social **Pulse** · Portal **"[City] Today"** · TV **Newsline 7** · Paper
**The Courier-Ledger** · Wire **The National Wire** · Tabloid **The Scoop** ·
Press **The Wire Room** · Weather **The Weather Desk**.

## Tech stack

Matches Cadence's frontend: **React 19 · TypeScript 5 · Vite 7 · MUI 7 · FontAwesome 7
· React Query · Axios · React Router 7 · Vitest**. Styling uses the in-house **COBRA**
design system (ported under `src/frontend/src/theme/`).

## Repository layout

```
pulse/
├── docs/
│   └── design/
│       └── D0-FOUNDATIONS.md     # Shared design context for every surface
└── src/
    └── frontend/                 # React SPA (this scaffold)
        └── src/
            ├── core/             # App-wide infra (api client, env validation)
            ├── theme/            # COBRA styling system (staff surfaces)
            │   └── styledComponents/
            ├── features/         # Feature modules (home/ landing today)
            └── App.tsx
```

A `.NET` backend (real-time feed ingestion, staff APIs) is expected to land under
`src/` later, mirroring Cadence's `src/*.Core` / `src/*.WebApi` split. The root
`.gitignore` already covers it.

## Getting started

```bash
cd src/frontend
cp .env.example .env      # optional; blank VITE_API_URL runs against mock data
npm install
npm run dev               # http://localhost:5198
```

### Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start the Vite dev server (port 5198) |
| `npm run build` | Type-check + production build |
| `npm run build:check` | Type-check only (`tsc -b`) |
| `npm run lint` / `lint:fix` | ESLint (COBRA/Cadence rules) |
| `npm run test` / `test:run` | Vitest |
| `npm run type-check` | `tsc --noEmit` |

## Conventions

See [`CLAUDE.md`](CLAUDE.md) for the full guide. Highlights:

- **Staff surfaces:** use COBRA styled components from `@/theme/styledComponents` —
  never raw MUI buttons/inputs.
- **Icons:** FontAwesome only (`@fortawesome/react-fontawesome`) — never
  `@mui/icons-material`.
- **Participant surfaces:** per-brand skins; the COBRA staff theme must not leak in.
- **Scenario time only** on participant surfaces (COR-053).
- **Accessibility:** WCAG 2.1 AA; severity states never color-only (NFR-001).
