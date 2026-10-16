import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import type { Plugin } from 'vite'

/**
 * Mobile-tablet story 10: stamps dist/sw.js after the build so every deploy changes the
 * worker's bytes (browsers only install a new worker when sw.js differs). Replaces
 * __PULSE_BUILD_ID__ (hash of the emitted index.html) and __PULSE_PRECACHE__ (JSON list:
 * /index.html + the /assets/* files index.html references). Dev/test keep the placeholders
 * (the worker is only registered in production builds).
 */
function pulseSwStamp(): Plugin {
  let outDir = 'dist'
  return {
    name: 'pulse-sw-stamp',
    apply: 'build',
    configResolved(c) {
      outDir = path.resolve(c.root, c.build.outDir)
    },
    closeBundle() {
      const swPath = path.join(outDir, 'sw.js')
      const htmlPath = path.join(outDir, 'index.html')
      if (!fs.existsSync(swPath) || !fs.existsSync(htmlPath)) return
      const html = fs.readFileSync(htmlPath, 'utf8')
      const assets = Array.from(html.matchAll(/["'](\/assets\/[^"']+)["']/g), m => m[1])
      const list = Array.from(new Set(['/index.html', ...assets]))
      const id = crypto.createHash('sha256').update(html).digest('hex').slice(0, 12)
      const sw = fs
        .readFileSync(swPath, 'utf8')
        .replace("'__PULSE_BUILD_ID__'", () => `'${id}'`)
        .replace("'__PULSE_PRECACHE__'", () => `'${JSON.stringify(list)}'`)
      fs.writeFileSync(swPath, sw)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pulseSwStamp()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5198,
  },
  preview: {
    port: 5198,
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Playwright specs (e2e/**) run via `npm run test:e2e`, never under Vitest.
    exclude: ['node_modules/**', 'dist/**', 'e2e/**'],
    // The suite is populated per-story by testing-agent (see docs/ORCHESTRATION_MECHANICS.md);
    // an empty/early tree must not fail CI. Real per-story test coverage is enforced at the
    // code-review gate, not here.
    passWithNoTests: true,
    testTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.*',
        'dist/',
      ],
    },
  },
})
