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
// feature needs them. Before running the Deploy Infrastructure workflow, ensure the SQL_ADMIN_PASSWORD,
// JWT_SECRET_KEY, and (for login go-live, story login/06) BOOTSTRAP_SECRET + STAFF_IDENTITY_ACCOUNTS_JSON
// GitHub secrets are set on the uat environment.
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

// --- E8 engine generation provider (engine-runtime/05, NFR-005 / ADP-025) ----
// deployAi = true stands up aif-pulse-uat (Cognitive Services / AIServices) with the `standard`
// (gpt-5.4) and `ambient` (gpt-5.4-mini) model deployments, keyless (disableLocalAuth), and grants the
// App Service's system-assigned identity "Cognitive Services OpenAI User" on it. This is PROVISIONING
// ONLY: with generationProviderLive = false below, the App Service still resolves
// Generation:Provider = Fake, so no application code can reach the endpoint and NOTHING egresses.
// Idempotent — re-running the deploy neither fails nor duplicates the deployments.
param deployAi = true

// ⚠ THE LIVE-TRAFFIC GATE (TIER-2, NFR-005 / ADP-025). Deliberately SEPARATE from deployAi: flipping
// this — and only this — points the engine's generate stage at the live governed model
// (Generation:Provider = AzureOpenAI), i.e. real LLM egress of world/persona content.
//
// DO NOT set this true until docs/features/engine-runtime/PROVIDER-GOVERNANCE.md §8 is SIGNED (all five
// boxes ticked, signer + date entered) for this environment. §8 carries the four evidence items
// (governance contract, fail-closed gate green in CI, measured p95 vs the 10s degraded-mode threshold,
// InjectionRedTeam 10/10 live). The startup gate (GenerationGovernance.Validate) is the mechanical
// backstop; this toggle is the contractual one. Both must hold.
//
// Cost, once live: ~$0.61/exercise-hour at the measured Ambient rate while a storyline is active
// (MEASURED-RESULTS.md). Cheap, not free — flip it back to false after a verification pass rather than
// leaving it on indefinitely.
param generationProviderLive = false

// The two §2 governance attestations, asserted HERE BY A HUMAN — deliberately not derived from deployAi,
// so GenerationGovernance.Validate remains an independent startup gate that can actually fire rather than
// a restatement of "did we deploy the account". These are what the PROVIDER-GOVERNANCE.md §8 signature
// covers (evidence item (i)); they belong in the same reviewed commit as generationProviderLive:
//   - TenantBounded:      aif-pulse-uat is a single-tenant Cognitive Services account with
//                         disableLocalAuth (keyless Entra only, no API key exists) and no
//                         shared/public inference.
//   - NoTrainingAttested: Azure OpenAI Service does not use customer prompts/completions to train
//                         models (Microsoft product terms).
// Both default to FALSE in main.bicep, so any other/future environment parameter file that omits them
// asserts nothing (fail closed). Setting either false while generationProviderLive is true makes the host
// throw GenerationConfigurationException at startup instead of egressing — that is the intended behaviour.
param generationTenantBounded = true
param generationNoTrainingAttested = true

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
// Login/06 go-live secrets (see docs/features/login/06-uat-goLive-config-runbook.md). Both default empty
// (fail closed): an unset BOOTSTRAP_SECRET disables the seed endpoint; an unset/empty allowlist lets no
// staff sign in. Set these as `uat` environment GitHub secrets before running Deploy Infrastructure.
param bootstrapSecret = readEnvironmentVariable('BOOTSTRAP_SECRET', '')
param staffIdentityAccountsJson = readEnvironmentVariable('STAFF_IDENTITY_ACCOUNTS_JSON', '')
param emailConnectionString = readEnvironmentVariable('EMAIL_CONNECTION_STRING', '')
