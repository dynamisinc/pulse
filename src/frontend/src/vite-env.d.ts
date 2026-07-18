/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Pulse backend API. Blank → same-origin `/api`. */
  readonly VITE_API_URL?: string
  /**
   * Opt-in flag to serve mock data from a *production* build (e.g. the
   * backend-less UAT environment). `'true'` enables it; anything else (incl.
   * unset) leaves the app fail-closed. See `core/config/mockData.ts`. NEVER set
   * in a participant-facing deploy (COR-001).
   */
  readonly VITE_USE_MOCK_DATA?: string
}
