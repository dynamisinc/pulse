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
    description: 'Base URL of the Pulse backend API. Blank runs against mock data only.',
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
