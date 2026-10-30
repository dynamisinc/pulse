# `features/channels/skin` — the outlet skin system

Channels-foundation story 13 (#709), FC-3b / FC-8a, D3-P1 / D3-P2. One rendering system; each outlet is a
**token file**. A fifth outlet is a token file plus one registration line, never new layout code.

## Registering a skin (from your channel's own folder)

Never edit this folder to add a skin. Register at module top level in your channel, so it runs when the
channel is imported:

```ts
// features/news/skins/newsline7/index.ts
import { registerSkinTokens, type OutletSkinTokens, type SkinFontFace } from '@/features/channels'
import oswaldUrl from './fonts/oswald-latin-wght.woff2?url'

export const tokens: OutletSkinTokens = { schemaVersion: 1, type: { … }, palette: { … }, … }
const fonts: SkinFontFace[] = [{ family: 'Oswald', src: oswaldUrl, weight: '200 700' }]

registerSkinTokens('newsline7', tokens, { fonts })
```

| Call | Rules |
|---|---|
| `registerSkinTokens(key, tokens, { fonts? })` | Validated against the schema at import (a bad file throws in dev). `neutral` cannot be registered. `wire-room` and `weather-desk` ship as **stubs**: the press and weather channels replace them once. A second, different registration of any key is a dev-time error; an identical one is a no-op. `clutter` / `homeLead: 'clutter'` only under `the-scoop`. |
| `registerSkinFonts(key, faces)` | Self-hosted **`.woff2` from this origin** only: no `data:`/`blob:` URI, no CDN (CSP `font-src 'self'`, story 23). Import the file with `?url`. Faces load lazily, with `font-display: swap`, when a scope for the key mounts. |
| `registerSkinExtension(ns, { keys })` | `ns` is `news`, `press`, `weather` or `portal`. Keys are `string`, `number`, `boolean`, `string[]`, `enum` or `color`. Undeclared keys and unregistered namespaces are dropped (reported in dev). `color` keys are AA-checked (`against: 'bg' \| 'surface'`, `large` for 3:1). Mirror the keys in F03's `ISkinOverridesValidator`. |

Two dev-time notes:
- **HMR.** Editing a registered token file re-runs it with new values, which is a "second, different
  registration" and throws; reload the page after a token edit.
- **Small fonts.** Vite would inline assets under 4 KiB as `data:` URIs, which the registry (and CSP)
  reject; story 23's `assetsInlineLimit` keeps every font a file, so `?url` is all you need.

Token files name font **stacks** only, and every stack must end in a generic family (`serif`,
`sans-serif`, `monospace`, `system-ui`, …) so a missing or blocked face falls back cleanly. Keeping
the swap's layout shift within tolerance (choosing metric-compatible fallbacks, or `size-adjust`) is
the skin author's job and a manual check in each skin story; the system does not measure it.

## Mounting a skin

```tsx
<OutletSkinScope outlet={outlet}>…</OutletSkinScope>          // an outlet: registry tokens ⊕ outlet.skinOverrides
<SkinScope scopeId="portal" tokens={portalTokens} skinKey="portal">…</SkinScope>  // not an outlet
const { tokens, outlet, isLoading } = useOutletSkin(slug)     // data hook: GET /api/outlets/{slug}
const { tokens } = useSkin()                                  // inside a scope; throws outside one
```

Mount a scope in the channel's own route subtree, never around the shell. A scope publishes on its own
`display: contents` wrapper and a nested MUI `ThemeProvider` built from the tokens (never COBRA), so
scopes on one page do not bleed. Layouts read CSS custom properties (`SKIN_CSS_VARS`), for example
`var(--pulse-skin-accent)`, `var(--pulse-skin-font-hed)` or `var(--pulse-skin-on-breaking)`, and `ext`
colours as `skinExtColorVar(ns, key)`.

### What every mounted skin gets, whatever the tokens say (the CANNOT list)

- **AA contrast.** Each pair in `CONTRAST_PAIRS` (text and link on bg and surface at 4.5:1, accent and
  breaking on bg and surface at 3:1) is clamped to the neutral palette if it fails, with a report in dev. Text on an
  accent, breaking or player fill uses the derived `--pulse-skin-on-*` (black or white, always ≥ 4.5:1).
  The accent is a fill or large mark; for body-size accent text the MUI theme's `primary` uses the
  accent only when it reaches 4.5:1, and the link colour otherwise.
- **Body size** `max(1rem, 16px)`: fixed, not a token.
- **Clutter** is honoured only for `the-scoop`.
- **No platform copy.** The system renders no text. `breaking.vocabulary` is the outlet's own label, and
  the neutral skin's is empty.

Slot order, the scenario-time source, the Pulse embed and link card, the watermark slot, share
behaviour, comments and telemetry have **no token key at all**, so no skin can reach them.

## Embedding a Social post: `SkinResetBoundary`

```tsx
<SkinResetBoundary><PostCard post={post} /></SkinResetBoundary>
```

Inside any scope, this boundary unsets every `--pulse-skin-*` variable, resets inherited type and colour
to the participant base, restores the MUI theme from outside all scopes, and re-publishes the exercise
brand (`--pulse-brand-*`). It must sit below `BrandThemeProvider`. Inside a boundary, the F14 primitives see no `--pulse-skin-*` and
use their own neutral `var()` fallbacks, not the brand colours, so keep them out of a reset placed on a
dark brand surface. An embed that needs the Social accent
(`--pulse-ac`) still mounts Social's own scope inside the boundary.
