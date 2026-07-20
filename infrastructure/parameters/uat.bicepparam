using '../main.bicep'

// ============================================================================
// UAT / Shared SandBox Environment Parameters
// Subscription:   Shared SandBox (2a127d53-c9bf-471a-8196-3155eae6cb1b)
// Resource Group: rg-pulse-uat-centralus
// ============================================================================
//
// Cost posture: Phase B0's backend (Pulse.WebApi + PulseDbContext) has landed, so this now deploys the
// App Service host (app-pulse-api-uat), Azure SQL (sqldb-pulse-uat), and App Insights alongside the
// Free-tier Static Web App. Storage (blob media) and Communication (email) stay gated off until a
// feature needs them. Before running the Deploy Infrastructure workflow, ensure the SQL_ADMIN_PASSWORD
// (and JWT_SECRET_KEY) GitHub secrets are set on the uat environment.
// ============================================================================

param environment = 'uat'
param location = 'centralus'

// --- Cost / feature toggles ---------------------------------------------------
// Backend on (Phase B0 landed): App Insights + Azure SQL + App Service host now deploy.
// Storage/Communication stay off until a feature needs blob media or email.
param deployMonitoring = true
param deployStorage = false
param deployDatabase = true
param deployBackend = true
param deployCommunication = false
// Flip to true when social-api/03-signalr-feed-host (B1 real-time) lands; bump signalRSkuName to
// Standard_S1 for real exercise load (Free_F1 caps at 20 connections / 20k msgs/day).
param deploySignalR = false

// Flip to true to stand up the E8 Azure AI Foundry endpoint + model deployments (independent of the
// backend). Needed for the story-06 measured cost/latency pass. See infrastructure/README.md.
param deployAi = false

// Flip to true (with deployAi) to also deploy the Claude-on-Foundry tiers for the E8 provider
// comparison. Requires a Claude-eligible subscription; the Anthropic Marketplace offer is auto-accepted
// from the attestation below. Set the org name to the real entity using the model.
param deployClaude = false
param claudeOrganizationName = 'Dynamis'

// --- Static Web App (participant/staff SPA host) ------------------------------
param repositoryUrl = 'https://github.com/dynamisinc/pulse'
// Custom domain bound to stapp-pulse-uat. Requires the GoDaddy CNAME
// pulse-uat -> lively-river-0ce317010.7.azurestaticapps.net (registrar-side).
// The clean pulse.cobrasoftware.com is reserved for a future prod environment.
param staticWebAppCustomDomain = 'pulse-uat.cobrasoftware.com'

// --- Hosting (only used once deployBackend = true) ----------------------------
param hostingModel = 'webapi'
param frontendUrl = 'https://pulse-uat.cobrasoftware.com'

// --- SQL (deployDatabase = true) ----------------------------------------------
// The App Service connects via SQL auth (sqlAdminLogin/password → ConnectionStrings__DefaultConnection),
// so this deploys without the Entra admin. Optionally set sqlEntraAdminObjectId to also configure an
// Entra (AAD) admin on the SQL server — recommended for keyless/least-privilege access in a later
// hardening pass, but NOT required for B1 go-live.
param sqlAdminLogin = 'sqladmin'
param sqlAdminPassword = readEnvironmentVariable('SQL_ADMIN_PASSWORD', '')
param sqlEntraAdminLogin = 'tbull@dynamis.com'
// TODO (optional, hardening): set the Entra object id for tbull@dynamis.com to enable the AAD admin:
//   param sqlEntraAdminObjectId = '<az ad user show --id tbull@dynamis.com --query id -o tsv>'

// --- Secrets — sourced from environment variables (set in CI from GitHub secrets)
param jwtSecretKey = readEnvironmentVariable('JWT_SECRET_KEY', '')
param emailConnectionString = readEnvironmentVariable('EMAIL_CONNECTION_STRING', '')
