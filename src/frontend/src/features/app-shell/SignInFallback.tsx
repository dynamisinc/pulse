/**
 * features/app-shell/SignInFallback.tsx
 * ---------------------------------------------------------------------------
 * The TEMPORARY, world-neutral fail-closed landing mounted at `LOGIN_PATH` by
 * `routes.tsx` (feature: app-shell, story 01). It is NOT the login page — that,
 * with its theming, is owned by the login story (COR-030, out of scope here).
 * Until it lands, this gives the fail-closed redirect (both `RoleAwareEntry`'s
 * and the composed `exercise-isolation/04` guard's) something visible to land
 * on instead of a blank screen or a redirect loop. The orchestrator should DROP
 * this once the real `/login` route exists.
 *
 * World: routing glue — world-neutral. No auth form, no COBRA, no brand skin,
 * no MUI theme dependency (plain HTML + inline styles). A single `<main>` so a
 * fail-closed redirect lands on a real landmark (NFR-001).
 *
 * (Its own module so `routes.tsx` defines no component and stays a
 * fast-refresh-clean route-config factory.)
 */

export function SignInFallback() {
  return (
    <main
      aria-labelledby="app-shell-signin-heading"
      style={{
        maxWidth: 480,
        margin: '0 auto',
        padding: '48px 24px',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h1
        id="app-shell-signin-heading"
        style={{ fontSize: '1.25rem', margin: '0 0 8px' }}
      >
        Sign-in required
      </h1>
      <p style={{ margin: 0, color: '#444' }}>
        Your session could not be resolved. Please sign in to continue.
      </p>
    </main>
  )
}
