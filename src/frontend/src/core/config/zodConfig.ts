/**
 * core/config/zodConfig.ts
 * ---------------------------------------------------------------------------
 * Side-effect module: runs zod without its JIT. zod 4 probes for `new Function` to
 * compile object parsers. The host CSP (channels-foundation story 23) allows no
 * `'unsafe-eval'`, so the probe logs a violation. zod catches the error and falls back,
 * so this is noise, not breakage.
 *
 * Imported FIRST in `main.tsx`, and by every module that builds a zod schema, so the
 * setting is in place before any schema exists.
 */
import { z } from 'zod'

z.config({ jitless: true })
