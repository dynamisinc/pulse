# Portal layout (`features/portal/layout/`)

Exercise-portal story 07 (#772). The registry, the `anchor` grid and the section frame
every portal module plugs into. Participant world: CSS Modules over the skin variables
(`--pulse-skin-*`, F13), each with a neutral fallback. No COBRA, no MUI component.

The types below are the **stable seam** for module stories 09-15. Change them additively
only (a new optional field), never by renaming or narrowing.

## Writing a module

1. Build the component under `features/portal/modules/<id>/`. It receives `PortalModuleProps`:

   | Prop | Meaning |
   |---|---|
   | `moduleId` | Its PC-1 id. |
   | `region` | `'lead'` or `'rail'`, where it is mounted (render denser in the rail if you like). |
   | `trackClick(target?)` | Reports one activation (PC-6 `portal_module_click`), bound to `moduleId`. `ModuleLink` calls it for you; call it yourself only for a non-link control. |

2. Render everything through `ModuleFrame`:

   ```tsx
   <ModuleFrame moduleId={moduleId} title="Top Stories" status={status} announce={{ arrivals }}>
     <ModuleLink moduleId={moduleId} to={item.permalink} clickTarget={{ contentId: item.id }}>
       {item.headline}
     </ModuleLink>
   </ModuleFrame>
   ```

   | `ModuleFrame` prop | Meaning |
   |---|---|
   | `moduleId`, `title` | The `h2` heading, also the `section`'s accessible name. |
   | `status` | `'loading'`: heading over a static skeleton, `aria-busy`. `'ready'`: children. `'empty'` / `'error'`: **nothing at all**, heading and link included (fail closed, D2-005). Map "no items" to `'empty'`, never to a placeholder box. |
   | `seeAll?` (default `true`), `seeAllLabel?` (default `"See all"`) | The in-content link to the source channel's home (PRT-020, conflict C-1). It renders only while that channel is enabled. Its accessible name is `"{label} {title}"`. |
   | `announce?: { arrivals, noun? }` | The polite live-region slot (F14 `LiveRegionAnnouncer`). Pass a running arrival count. Never assertive: the alert bar owns that. |

3. Register it once, from `modules/<id>/register.ts`:

   ```ts
   registerPortalModule({ id: 'topStories', channelId: 'news', region: 'lead', order: 10, Component: TopStories })
   ```

   `channelId` must be the module's PC-1 source channel. A second registration of the same id
   throws. `order` is the default position; on a page the stored order (`PortalDto.modules`)
   wins. `DisplaySlide` is optional (kiosk slides are Deferred, Q-35). Importing the
   `register.ts` files is orchestrator-owned (`features/portal/modules/index.ts`, story 17).

Modules never call the telemetry emitter. Every in-module link is a `ModuleLink`: it takes
every router `Link` prop (`aria-label`, `ref`, `state`, `data-*`, ...), and a bare `Link`
inside a module is a telemetry gap. `ModuleLink` carries a base class with a 44 px target
under `(pointer: coarse)` and a visible `:focus-visible` ring; your `className` merges on top.
Give any non-link control the same. Never render a heading above `h2` (the masthead owns
the `h1`). Pass `moduleId` from your props to `ModuleFrame` / `ModuleLink` unchanged.

## `PortalLayout`

```tsx
<PortalLayout layoutKey={portal.layoutKey} modules={portal.modules} before={alertsEntry} after={resourcesLink} />
```

| Prop | Meaning |
|---|---|
| `layoutKey` | `PortalDto.layoutKey`. Only `anchor` in December. |
| `modules` | `PortalDto.modules`, in stored order. |
| `before?`, `after?` | Content inside `main`, above and below the grid. |
| `registry?` | Defaults to the app registry. Tests pass an isolated one. |

It renders the page's `main`. The masthead's banner sits outside it (stories 06/17).
`anchor` is `grid-template-areas`. From 1024 px it shows `lead` beside a 336 px `rail`.
Below 1024 px the rail folds under the lead in stored order, so 320 px is one column.

Clean hiding: an unregistered id is skipped. Once the enabled set is known, a module whose
channel is off is dropped. An `empty` or `error` module hides itself. A region with nothing
visible collapses and the other region takes the full width. With nothing visible, no grid
is rendered.

`PortalLayout` mounts `LivePortalFrameEnvironment` (F08 `useEnabledChannels` + PC-6
telemetry), so it needs the exercise context, the session and a QueryClient above it. It
skips that mount when a `PortalFrameEnvironmentProvider` is already above it. A
`ModuleFrame` with no environment fails closed: no "See all", no telemetry.

## Testing a module: the subset harness

```ts
import { PORTAL_LAYOUT_SUBSETS, renderPortalSubset } from '@/features/portal/layout/testing'

const { clicks } = renderPortalSubset(['topStories', 'weather'], {
  registrations: [topStoriesRegistration],     // real modules; the rest are stubs
  statuses: { weather: 'empty' },              // stub statuses
  enabledChannels: ['news'],                   // default: the subset's channels
})
```

The stored order follows each registration's `order` (yours for a real module).
The harness uses an isolated registry and a fake environment that records every
`trackClick` in `clicks` (it emits no telemetry). `PORTAL_LAYOUT_SUBSETS` holds all 32
subsets: 2^4 content modules, each with Trending absent and present. It is test-only, so
never import `layout/testing` from app code.
