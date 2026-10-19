using '../main.bicep'

// ============================================================================
// UAT / Shared SandBox Environment Parameters
// Subscription:   Shared SandBox (2a127d53-c9bf-471a-8196-3155eae6cb1b)
// Resource Group: rg-pulse-uat-centralus
// ============================================================================
//
// Cost posture: Phase B0's backend (Pulse.WebApi + PulseDbContext) has landed, so this now deploys the
// App Service host (app-pulse-api-uat), Azure SQL (sqldb-pulse-uat), and App Insights alongside the
// Free-tier Static Web App. Storage (keyless blob media, demo-polish/01) is on for the demo;
// Communication (keyless email of personal links, easy-login/13) is OFF until after the 10/20 demo. Before running the Deploy
// Infrastructure workflow, ensure the SQL_ADMIN_PASSWORD, JWT_SECRET_KEY, and (for login go-live,
// story login/06) BOOTSTRAP_SECRET + STAFF_IDENTITY_ACCOUNTS_JSON GitHub secrets are set on the uat
// environment.
// ============================================================================

param environment = 'uat'
param location = 'centralus'

// --- Cost / feature toggles ---------------------------------------------------
// Backend on (Phase B0 landed): App Insights + Azure SQL + App Service host now deploy.
// Storage on (demo-polish/01): stpulseuat with the PRIVATE post-media container, KEYLESS
// (allowSharedKeyAccess: false — no connection string or account key exists), and the App Service's
// managed identity granted Storage Blob Data Contributor at account scope. The grant needs the deploy
// SP's role-assignment write (already required by deployAi) and takes minutes to propagate — do not
// smoke-test media uploads in the first ~10 minutes after the deploy.
// Communication (easy-login/13) is OFF until after the 10/20 demo (Tom, 2026-10-14: the code merges dark;
// the email setup and its Tier-2 answers come after the demo). Flip deployCommunication to true then. When on: acs-pulse-uat + email-pulse-uat with the Azure-managed sender
// domain (DoNotReply@<guid>.azurecomm.net, no DNS work), KEYLESS (disableLocalAuth: no connection string
// or access key exists), and the App Service's managed identity granted "Communication and Email Service
// Owner" on the Communication Service. Same deploy-SP role-assignment prerequisite and the same ~10 minute
// propagation wait as storage. The app settings Email__Endpoint + Email__SenderAddress switch the roster's
// "Email links" on. Azure-managed domains are capped at 5 emails/minute and 10/hour per subscription (not
// raisable): fine for UAT testers, not for a real StartEx (that needs a verified custom domain + quota).
param deployMonitoring = true
param deployStorage = true
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
//
// SIGNED 2026-10-16 (Tom Bull) — PROVIDER-GOVERNANCE.md §8, uat / Ambient; Suggest default,
// Delayed-auto + swamped mode authorized: lead-only to turn on, any controller to turn off
// (§8 "Authorized autonomy" amendment).
param generationProviderLive = true

// The two §2 governance attestations, asserted HERE BY A HUMAN — deliberately not derived from deployAi,
// so GenerationGovernance.Validate remains an independent startup gate that can actually fire rather than
// a restatement of "did we deploy the account".
//
// LEFT FALSE until PROVIDER-GOVERNANCE.md §8 is signed: the signer sets these to true in the SAME
// reviewed commit as generationProviderLive. Nothing is attested yet. Until then, a stray flip of
// generationProviderLive alone fails startup by design (GenerationConfigurationException) instead of
// egressing unattested content — pre-typing them here would disarm exactly that backstop.
//
// The justification for setting them TRUE at signing time (not a claim that they are true now) is
// §8 evidence item (i):
//   - TenantBounded:      aif-pulse-uat is a single-tenant Cognitive Services account with
//                         disableLocalAuth (keyless Entra only, no API key exists) and no
//                         shared/public inference.
//   - NoTrainingAttested: Azure OpenAI Service does not use customer prompts/completions to train
//                         models (Microsoft product terms).
// Both also default to FALSE in main.bicep, so any other/future environment parameter file that omits
// them asserts nothing (fail closed). Harmless today: with generationProviderLive = false the App Service
// resolves Generation:Provider = Fake, whose in-process posture is compliant by construction and never
// runs the governance gate.
// Attested by the §8 signer (Tom Bull, 2026-10-16) after verifying evidence (i) against Azure.
param generationTenantBounded = true
param generationNoTrainingAttested = true

// ⚠ Autonomous ambient chatter (ambient-chatter story 01, AC0) — App Service setting
// Generation__Governance__AmbientAutonomyAuthorized. When false, the engine settings POST rejects ambient mode
// `autonomous` with a 400 (review mode still works). Stated explicitly rather than left to the main.bicep default.
// NOT authorized until PROVIDER-GOVERNANCE §8 amendment 2 is signed; the signer flips this in that same commit.
param generationAmbientAutonomyAuthorized = false

// ⚠ Timeout auto-send (swamped mode) — App Service setting Generation__Governance__TimeoutAutoSendAuthorized. When
// false, turning swamped mode ON is refused with a 400 and an expired Delayed-auto countdown always holds for a human.
// Phase 2 (PROVIDER-GOVERNANCE §8 amendment 1): AUTHORIZED. A1c's lead-controller gate is on main (#615, smoke passed
// 2026-10-19) and the console toggle now drives the server. Only the lead may turn swamped mode on; any controller may
// turn it off; the kill switch, degraded mode and cut-to-Fake all hold expired countdowns. Revert to false to withdraw.
param generationTimeoutAutoSendAuthorized = true

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
// Entra admin — note the tenant UPN is @dynamiscobra.com (tenantDefaultDomain), not @dynamis.com.
param sqlEntraAdminLogin = 'tbull@dynamiscobra.com'
param sqlEntraAdminObjectId = '2b210ee5-c558-4eef-92ce-79186cae6595'

// --- Secrets — sourced from environment variables (set in CI from GitHub secrets)
param jwtSecretKey = readEnvironmentVariable('JWT_SECRET_KEY', '')
// Login/06 go-live secrets (see docs/features/login/06-uat-goLive-config-runbook.md). Both default empty
// (fail closed): an unset BOOTSTRAP_SECRET disables the seed endpoint; an unset/empty allowlist lets no
// staff sign in. Set these as `uat` environment GitHub secrets before running Deploy Infrastructure.
param bootstrapSecret = readEnvironmentVariable('BOOTSTRAP_SECRET', '')
param staffIdentityAccountsJson = readEnvironmentVariable('STAFF_IDENTITY_ACCOUNTS_JSON', '')
// No email secret: email is keyless (easy-login/13). The former emailConnectionString param is gone.

// --- Provider alert rules (engine-telemetry-tuning/04, NFR-009) ---------------
// Push alerts on the live generation provider (errors/breaker, latency 5 s warn / 10 s trip, call-volume
// spend proxy), emailed to the provider owner. Read-only over appi-pulse-uat's `dependencies` rows for
// aif-pulse-uat; requires deployMonitoring + deployAi (both on above). TIER-2 infra: Tom signs off.
// The owner's address is NEVER typed here: it comes from the PULSE_ALERT_OWNER_EMAIL secret on the uat
// GitHub environment (threaded by deploy-infrastructure.yml). An unset secret with alerts on FAILS the
// deploy with a clear message.
//
// ON since the 10/17 go-live (#571): Tom created the PULSE_ALERT_OWNER_EMAIL secret on the uat environment. If that
// secret is ever removed, every UAT infra deploy fails with a clear message until it is restored or this is set false. Thresholds can be overridden here for a forced test
// fire (e.g. param providerAlertCallsPerHourThreshold = 1), then reverted; see infrastructure/README.md.
param deployProviderAlerts = true // ON for the Saturday go-live: PULSE_ALERT_OWNER_EMAIL added to the uat environment (Tom, 2026-10-17)
param alertOwnerEmail = readEnvironmentVariable('PULSE_ALERT_OWNER_EMAIL', '')
