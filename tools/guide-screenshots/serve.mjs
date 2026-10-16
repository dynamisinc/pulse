/**
 * serve.mjs — start a Pulse frontend dev server for screenshots
 * ---------------------------------------------------------------------------
 * Starts Vite (the copy installed in src/frontend/node_modules) against the
 * real frontend config, in mock-data mode, on a SEPARATE port (default 5199) so
 * it never collides with a developer's `npm run dev` on 5198.
 *
 * The one difference from `npm run dev`: a tiny in-memory Vite plugin lets the
 * browser override three MOCK seams through localStorage (see
 * MOCK_SEAM_REWRITES below):
 *   - pulse.guideShots.role    the mock session's role. In plain mock mode the
 *                              session is always the participant Dana Reyes and
 *                              staff sign-in has no mock, so staff consoles are
 *                              otherwise unreachable.
 *   - pulse.guideShots.alerts  JSON alert list for the participant alert bar
 *                              (the stock mock has none).
 *   - pulse.guideShots.overlay JSON pause/EndEx overlay state (stock: none).
 * The rewrite happens at transform time only — no file on disk changes, nothing
 * in src/ is edited, and with no key set the app renders exactly as `npm run dev`.
 *
 * Usage:
 *   node serve.mjs            # serve on http://localhost:5199 until Ctrl+C
 *   GUIDE_SHOTS_PORT=5300 node serve.mjs
 * Then, in the browser devtools console:
 *   localStorage.setItem('pulse.guideShots.role', 'controller'); location.reload()
 *   (roles: participant, pio, controller, evaluator, planner, orgAdmin)
 *
 * capture.mjs imports `startServer` from here.
 */
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const FRONTEND_DIR = path.resolve(HERE, '../../src/frontend')
export const ROLE_STORAGE_KEY = 'pulse.guideShots.role'

/**
 * Transform-time rewrites of mock seams. Each one swaps a canned mock literal
 * for "the value in localStorage[key] if set, else the original literal", so a
 * page with no override set renders exactly what `npm run dev` renders.
 *   file   – path under src/frontend that holds the mock literal
 *   find   – exact source text to replace (the build fails loudly if missing)
 *   replace – builds the replacement text from the key
 *   key    – localStorage key the browser sets (capture.mjs does it per shot)
 */
const MOCK_SEAM_REWRITES = [
  {
    // Mock session role (participant | controller | evaluator | planner | orgAdmin | pio)
    file: 'src/core/auth/sessionResolver.ts',
    find: "role: 'participant',",
    replace: k => `role: (${readOverride(k, false)} ?? 'participant') as ExerciseRole,`,
    key: ROLE_STORAGE_KEY,
  },
  {
    // Alert-bar content: a JSON array of { id, severity, message, scenarioTime }
    file: 'src/features/participant-shell/components/AlertBar/useAlerts.ts',
    find: 'const MOCK_ALERTS: readonly Alert[] = []',
    replace: k => `const MOCK_ALERTS: readonly Alert[] = ${readOverride(k, true)} ?? []`,
    key: 'pulse.guideShots.alerts',
  },
  {
    // Participant overlay: JSON { state: 'pause'|'endex'|'broadcast', register, message }
    file: 'src/features/participant-shell/components/OverlayLayer/overlayState.ts',
    find: 'const MOCK_OVERLAY_STATE: OverlayStateResponseBody = {',
    replace: k => `const MOCK_OVERLAY_STATE: OverlayStateResponseBody = ${readOverride(k, true)} ?? {`,
    key: 'pulse.guideShots.overlay',
  },
]

/** A JS expression reading localStorage[key] (parsed as JSON when `json`), or null. */
function readOverride(key, json) {
  const read = `globalThis.localStorage?.getItem('${key}')`
  return json
    ? `((() => { try { const v = ${read}; return v ? JSON.parse(v) : null } catch { return null } })())`
    : `((() => { try { return ${read} } catch { return null } })())`
}

/** Vite plugin applying MOCK_SEAM_REWRITES (dev server only; nothing on disk changes). */
function mockSeamOverridePlugin() {
  return {
    name: 'pulse-guide-shots-mock-seams',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replaceAll('\\', '/')
      const rewrite = MOCK_SEAM_REWRITES.find(r => file.endsWith(r.file))
      if (!rewrite) return null
      if (!code.includes(rewrite.find)) {
        throw new Error(
          `[guide-shots] could not find "${rewrite.find}" in ${rewrite.file}; ` +
          'the mock seam changed — update MOCK_SEAM_REWRITES in serve.mjs.',
        )
      }
      return code.replace(rewrite.find, rewrite.replace(rewrite.key))
    },
  }
}

/** Start the dev server; resolves to { url, close }. */
export async function startServer({ port = Number(process.env.GUIDE_SHOTS_PORT ?? 5199) } = {}) {
  const viteEntry = pathToFileURL(path.join(FRONTEND_DIR, 'node_modules/vite/dist/node/index.js'))
  const { createServer } = await import(viteEntry.href)
  const server = await createServer({
    root: FRONTEND_DIR,
    configFile: path.join(FRONTEND_DIR, 'vite.config.ts'),
    mode: 'development',
    logLevel: 'error',
    plugins: [mockSeamOverridePlugin()],
    server: { port, strictPort: true, open: false },
  })
  await server.listen()
  return { url: `http://localhost:${port}`, close: () => server.close() }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { url } = await startServer()
  console.log(`[guide-shots] Pulse mock dev server (role override enabled) at ${url}`)
}
