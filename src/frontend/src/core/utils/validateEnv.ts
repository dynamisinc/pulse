/**
 * Environment variable validation.
 *
 * Runs once at startup (from main.tsx). Warns loudly in the console when
 * optional-but-recommended variables are missing so misconfiguration is
 * obvious during development rather than surfacing as opaque runtime errors.
 */

interface EnvVar {
  key: string;
  required: boolean;
  description: string;
}

const ENV_VARS: EnvVar[] = [
  {
    key: 'VITE_API_URL',
    required: false,
    description:
      'Base URL of the Pulse backend API. Blank targets same-origin /api. Mock ' +
      'data requires the dev server (`npm run dev`) or an explicit ' +
      'VITE_USE_MOCK_DATA=true; a plain production build fails closed and renders ' +
      'blank without a backend.',
  },
]

export function checkEnvironment(): void {
  const missingRequired: string[] = []

  for (const { key, required, description } of ENV_VARS) {
    const value = import.meta.env[key]
    if (!value) {
      if (required) {
        missingRequired.push(`${key} - ${description}`)
      } else {
        console.info(`[env] ${key} not set - ${description}`)
      }
    }
  }

  if (missingRequired.length > 0) {
    console.error(
      `[env] Missing required environment variables:\n  ${missingRequired.join('\n  ')}`,
    )
  }
}
