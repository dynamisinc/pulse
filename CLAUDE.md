# CLAUDE.md - AI Assistant Guide

> **Project:** Pulse - Simulated Media Environment for EM Exercises
> **Status:** Scaffold (Phase 1 build starting)
> **Family:** Dynamis (sibling to Cadence & COBRA)

## What is Pulse?

Pulse simulates the information ecosystem participants experience during an
emergency-management exercise: a fake social network, local news portals, TV /
newspaper / wire outlets, and a weather service. Controllers and evaluators drive
and observe it from Cadence-style **staff consoles**.

Read [`docs/design/D0-FOUNDATIONS.md`](docs/design/D0-FOUNDATIONS.md) before any
design or UI work — it is the shared context for every surface.

## The cardinal rule: two worlds

Pulse has two visual worlds that must never blur into each other:

| | Participant world (the fiction) | Staff world (the machine) |
|---|---|---|
| Feel | Consumer apps — warm, familiar, brandable | Cadence operator tooling — dense-on-purpose |
| Theming | Per-exercise brands, per-outlet skins | Fixed **COBRA** system look |
| Rule | **Nothing breaks fiction**; no default MUI look | **Never confusable** with a participant view |

- **Participant surfaces** (social, portal, outlets, weather) are heavily skinned.
  They must NOT read as an enterprise app. Do **not** apply the COBRA staff theme to
  them — each brand mounts its own theme within its route subtree.
- **Staff surfaces** (controller console, evaluator dashboard) use COBRA, exactly
  like Cadence.

## Tech stack (matches Cadence frontend)

| Technology | Version | Notes |
|------------|---------|-------|
| React | 19.x | UI framework |
| TypeScript | 5.x | Strict mode |
| Vite | 7.x | Build tool (dev server on **5198**) |
| Material-UI | 7.x | Component library (skinned on participant paths) |
| FontAwesome | 7.x | **Icons (MANDATORY)** — never `@mui/icons-material` |
| React Query | 5.x | Server state |
| Axios | 1.x | HTTP client (`src/core/services/api.ts`) |
| React Router | 7.x | Routing |
| Vitest + RTL | 4.x / 16.x | Testing |

A .NET backend is expected later (real-time feeds, staff APIs), mirroring Cadence's
`*.Core` / `*.WebApi` split. Not present yet.

## Project structure

```
src/frontend/src/
├── core/
│   ├── services/api.ts        # Shared axios instance (VITE_API_URL)
│   └── utils/validateEnv.ts   # Startup env validation
├── theme/                     # COBRA styling system (STAFF surfaces)
│   ├── cobraTheme.ts          # MUI theme + palette augmentations
│   ├── CobraStyles.ts         # Spacing/padding constants
│   └── styledComponents/      # CobraPrimaryButton, CobraTextField, ...
├── features/
│   └── home/                  # Scaffold landing page
├── App.tsx                    # Theme + Router + Query + Toasts
└── main.tsx
```

New surfaces should follow the Cadence feature pattern:

```
features/{surfaceName}/
├── components/
├── pages/
├── hooks/
├── services/
├── types/
└── README.md
```

## Code conventions

### COBRA styling (staff surfaces only)

```tsx
// ❌ NEVER on a staff surface
import { Button, TextField } from '@mui/material'

// ✅ ALWAYS on a staff surface
import { CobraPrimaryButton, CobraTextField } from '@/theme/styledComponents'
```

Available COBRA components: `CobraPrimaryButton`, `CobraSecondaryButton`,
`CobraDeleteButton`, `CobraLinkButton`, `CobraTextField`. Spacing/padding via
`CobraStyles`.

### Icons (everywhere)

```tsx
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlus, faTrash } from '@fortawesome/free-solid-svg-icons'

<FontAwesomeIcon icon={faPlus} />
```

Never import from `@mui/icons-material`.

### Naming

- Components / Types: `PascalCase`
- Variables / functions: `camelCase`
- Hooks: `useCamelCase`

### Formatting (enforced by ESLint)

2-space indent · single quotes · no semicolons · trailing commas (multiline) ·
100-char line warning. Run `npm run lint:fix` before committing.

## Design non-negotiables (from D0 §4)

1. **Accessibility (NFR-001):** WCAG 2.1 AA on participant + evaluator surfaces.
   Severity/alert states **never color-only**.
2. **Scenario time only (COR-053):** every timestamp participants see is scenario
   time — never wall-clock.
3. **Verification is a trainable signal (SOC-052):** lookalike unverified accounts
   must be visually possible (impersonation training).
4. **Persistent alert bar (PRT-010):** the EAS analog across all channels;
   severity-styled, not color-only.
5. **Burst legibility (SOC-071, NFR-002):** feeds stay smooth/readable at 120
   posts/min. The stress is the training; jank is not.
6. **Mobile:** participant surfaces mobile-first; staff surfaces desktop-first.
7. **Watermark readiness (NFR-008):** high-risk templates reserve an "EXERCISE"
   watermark slot.

## Common tasks

**Verify the frontend compiles** without killing a running dev server:

```bash
npm run type-check   # or: npm run build:check
```

Use `npm run build` only for deployment validation.

## FAQ

**Q: Should participant surfaces use COBRA components?**
A: **No.** COBRA is the staff-world look. Participant surfaces are per-brand skins
and must never read as an enterprise app.

**Q: Which icon library?**
A: FontAwesome only.

**Q: What time do participants see?**
A: Scenario time, always (COR-053).

**Q: Where do design requirements live?**
A: `docs/design/` (foundations + per-surface briefs D1–D6) and the epic docs.
