using '../main.bicep'

// ============================================================================
// UAT / Shared SandBox Environment Parameters
// Subscription:   Shared SandBox (2a127d53-c9bf-471a-8196-3155eae6cb1b)
// Resource Group: rg-pulse-uat-centralus
// ============================================================================
//
// Cost posture: Pulse has no .NET backend yet, so today this deploys ONLY the
// Free-tier Static Web App (stapp-pulse-uat). Everything else is authored in
// main.bicep but gated off. When the backend lands, flip the toggles below to
// true, set the SQL secrets, and re-deploy — no template rewrite required.
// ============================================================================

param environment = 'uat'
param location = 'centralus'

// --- Cost / feature toggles ---------------------------------------------------
// Flip to true when the .NET backend lands (and set the SQL secrets below).
param deployMonitoring = false
param deployStorage = false
param deployDatabase = false
param deployBackend = false
param deployCommunication = false

// Flip to true to stand up the E8 Azure AI Foundry endpoint + model deployments (independent of the
// backend). Needed for the story-06 measured cost/latency pass. See infrastructure/README.md.
param deployAi = false

// --- Static Web App (the one resource deployed today) -------------------------
param repositoryUrl = 'https://github.com/dynamisinc/pulse'
// Custom domain bound to stapp-pulse-uat. Requires the GoDaddy CNAME
// pulse-uat -> lively-river-0ce317010.7.azurestaticapps.net (registrar-side).
// The clean pulse.cobrasoftware.com is reserved for a future prod environment.
param staticWebAppCustomDomain = 'pulse-uat.cobrasoftware.com'

// --- Hosting (only used once deployBackend = true) ----------------------------
param hostingModel = 'webapi'
param frontendUrl = 'https://pulse-uat.cobrasoftware.com'

// --- SQL (only used once deployDatabase = true) -------------------------------
param sqlAdminLogin = 'sqladmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')
param sqlEntraAdminLogin = 'tbull@dynamis.com'
// TODO: set sqlEntraAdminObjectId (Entra object id for tbull@dynamis.com) before enabling SQL.

// --- Secrets — sourced from environment variables (set in CI from GitHub secrets)
param jwtSecretKey = readEnvironmentVariable('JWT_SECRET_KEY', '')
param emailConnectionString = readEnvironmentVariable('EMAIL_CONNECTION_STRING', '')
