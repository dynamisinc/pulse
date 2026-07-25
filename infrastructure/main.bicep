targetScope = 'resourceGroup'

// ============================================================================
// Core Parameters
// ============================================================================

@description('Deployment environment (uat, prod)')
param environment string

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Application name used in resource naming')
param appName string = 'pulse'

// ============================================================================
// Cost / Feature Toggles
// ----------------------------------------------------------------------------
// Pulse is frontend-only today (no .NET backend exists yet), so the Shared
// SandBox deploys ONLY the Free-tier Static Web App. The heavier resources are
// fully authored below but gated off by default — flip the relevant toggle in
// the environment .bicepparam when the backend lands. The Static Web App always
// deploys.
// ============================================================================

@description('Deploy Log Analytics + Application Insights. Off until the backend needs telemetry.')
param deployMonitoring bool = false

@description('Deploy the Storage account (blob media). Off until the backend needs it.')
param deployStorage bool = false

@description('Deploy Azure SQL server + database. Off until the backend needs it.')
param deployDatabase bool = false

@description('Deploy the backend host (App Service / Function App per hostingModel). Off until backend code exists.')
param deployBackend bool = false

@description('Deploy Azure SignalR Service for real-time feed fan-out (social-api/03). Web-API-hosted hub (ServiceMode Default), independent of the Functions host. Off until the real-time story lands.')
param deploySignalR bool = false

@description('Azure SignalR SKU name. Free_F1 caps at 20 concurrent connections / 20k messages/day — fine for a smoke test; use Standard_S1 for real exercise load (burst legibility, SOC-071).')
param signalRSkuName string = 'Free_F1'

@description('Deploy ACS + Email Service resources. Off until email is needed.')
param deployCommunication bool = false

@description('Deploy the Azure AI Foundry (Cognitive Services) account + E8 model deployments. Off until the engine needs a live endpoint.')
param deployAi bool = false

@description('Also deploy the Claude-on-Foundry (serverless MaaS) model tiers alongside the Azure OpenAI ones (for the E8 provider comparison). Requires deployAi and a Claude-eligible subscription.')
param deployClaude bool = false

@description('Legal organization name for the Anthropic Marketplace attestation (modelProviderData), used only when deployClaude = true.')
param claudeOrganizationName string = 'Dynamis'

@description('ROUTE ENGINE GENERATION TRAFFIC TO THE LIVE GOVERNED MODEL. Deliberately SEPARATE from deployAi: deployAi provisions the endpoint, this decides whether application code is pointed at it. OFF by default — flipping it makes the App Service resolve Generation:Provider = AzureOpenAI instead of Fake, i.e. real LLM egress. TIER-2 (NFR-005 / ADP-025): requires the signed sign-off in docs/features/engine-runtime/PROVIDER-GOVERNANCE.md §8 before it is set true in any environment.')
param generationProviderLive bool = false

@description('TIER-2 HUMAN ASSERTION (NFR-005 §2), NOT a derived value: the signer attests that the generation endpoint is bounded to this tenant — a single-tenant Cognitive Services account, keyless (disableLocalAuth), no shared/public inference. Typed by the §8 signer in the environment parameter file, in the same reviewed commit as generationProviderLive. Deliberately NOT derived from deployAi: derived, it would make GenerationGovernance.Validate a restatement of deployAi instead of an independent gate. False by default, so a parameter file that omits it cannot accidentally assert a posture — and with a live provider a false assertion throws GenerationConfigurationException at startup (fail closed) rather than egressing.')
param generationTenantBounded bool = false

@description('TIER-2 HUMAN ASSERTION (NFR-005 §2 / ADP-025), NOT a derived value: the signer attests the contractual no-training terms covering this endpoint (Microsoft product terms for Azure OpenAI; the Anthropic Marketplace offer for Claude). Typed by the §8 signer in the environment parameter file alongside generationProviderLive; deliberately NOT derived from deployAi, for the same reason as generationTenantBounded. False by default (fail closed); a false assertion under a live provider throws at startup rather than egressing.')
param generationNoTrainingAttested bool = false

// ============================================================================
// SQL Parameters (only consumed when deployDatabase = true)
// ============================================================================

@description('SQL Server admin login')
param sqlAdminLogin string = ''

@secure()
@description('SQL Server admin password')
param sqlAdminPassword string = ''

@description('Override database name (defaults to sqldb-{appName}-{env})')
param sqlDatabaseName string = 'sqldb-${appName}-${environment}'

@description('Entra ID admin login email for SQL Server')
param sqlEntraAdminLogin string = ''

@description('Entra ID admin object ID for SQL Server')
param sqlEntraAdminObjectId string = ''

// ============================================================================
// Hosting Parameters
// ============================================================================

@allowed(['functions', 'webapi', 'both'])
@description('Which backend hosting model to deploy (only when deployBackend = true)')
param hostingModel string = 'webapi'

@description('Frontend URL for CORS and auth redirect (e.g., https://uat-pulse.cobrasoftware.com)')
param frontendUrl string = ''

// ============================================================================
// Communication / Email Parameters
// ============================================================================

@description('Custom email domain (e.g., cobrasoftware.com). Leave empty to use Azure managed domain only.')
param emailCustomDomain string = ''

@description('Email sender address when deployCommunication=false (e.g., DoNotReply@xxx.azurecomm.net from shared ACS)')
param emailSenderAddress string = ''

// Note: Defender for Cloud's security-contact email is passed straight to the
// subscription-scoped defender.bicep at deploy time (from a CI secret), so this
// template intentionally does not carry a securityContactEmail parameter.

// ============================================================================
// Name Overrides (for resources that don't follow the standard pattern)
// ============================================================================

@description('Override Static Web App name (defaults to stapp-{appName}-{env})')
param staticWebAppName string = 'stapp-${appName}-${environment}'

@description('GitHub repository URL for Static Web App')
param repositoryUrl string = 'https://github.com/dynamisinc/pulse'

@description('Custom domain bound to the Static Web App (e.g. pulse-uat.cobrasoftware.com). Empty = none. Requires a registrar CNAME to the SWA default hostname (managed at the registrar, not here).')
param staticWebAppCustomDomain string = ''

// ============================================================================
// Secrets (set via parameter file or --parameters on CLI)
// ============================================================================

@secure()
@description('JWT signing key (32+ characters)')
param jwtSecretKey string = ''

@secure()
@description('Bootstrap secret for the one-time UAT seed endpoint (Authentication:Bootstrap:Secret, story login/06). Empty -> the endpoint is disabled (fail closed). Threaded like jwtSecretKey, sourced from the BOOTSTRAP_SECRET GitHub secret in deploy-infrastructure.yml.')
param bootstrapSecret string = ''

@secure()
@description('Phase-1 staff allowlist JSON array (Authentication:StaffIdentity:Accounts, story login/06). Empty -> no staff sign-in (fail closed). Threaded like jwtSecretKey, sourced from the STAFF_IDENTITY_ACCOUNTS_JSON GitHub secret; webapp.bicep expands it into the indexed app-setting keys the .NET options binder reads.')
param staffIdentityAccountsJson string = ''

@secure()
@description('Azure Communication Services connection string for email')
param emailConnectionString string = ''

// ============================================================================
// Resource Naming Convention (Azure CAF abbreviations, matches Cadence/C5)
// ============================================================================
//   stapp-pulse-{env}      (static web app)   <-- deployed today
//   app-pulse-api-{env}    (webapp)
//   asp-pulse-{env}        (app service plan)
//   sql-pulse-{env}        (sql server)
//   stpulse{env}           (storage - no hyphens)
//   appi-pulse-{env}       (app insights)
//   log-pulse-{env}        (log analytics)
//   sigr-pulse-{env}       (signalr)
//   func-pulse-{env}       (function app)
//   acs-pulse-{env}        (communication services)
//   email-pulse-{env}      (email service)
//   aif-pulse-{env}        (ai foundry / cognitive services)
// ============================================================================

var resourceSuffix = '${appName}-${environment}'
var storageName = 'st${appName}${environment}'
var logAnalyticsName = 'log-${resourceSuffix}'
var appInsightsName = 'appi-${resourceSuffix}'
var sqlServerName = 'sql-${resourceSuffix}'
var appServicePlanName = 'asp-${resourceSuffix}'
// App Service names are GLOBALLY unique (they become <name>.azurewebsites.net). The plain
// 'app-pulse-api-uat' is already registered in another Azure tenant, so a create in this RG 409s
// ("Website with given name app-pulse-api-uat already exists"). A tenant-specific suffix restores a
// free, predictable name (keeps deploy-backend.yml's WEBAPP_NAME + the frontend's VITE_API_URL static).
var webAppName = 'app-${appName}-api-${environment}-dynamis'
var signalRName = 'sigr-${resourceSuffix}'
var functionAppName = 'func-${resourceSuffix}'
var acsName = 'acs-${resourceSuffix}'
var emailServiceName = 'email-${resourceSuffix}'
var aiFoundryName = 'aif-${resourceSuffix}'

var tags = {
  Environment: environment
  Application: appName
  ManagedBy: 'Bicep'
}

// Derived hosting flags — backend sub-resources require deployBackend = true.
var deployWebApp = deployBackend && (hostingModel == 'webapi' || hostingModel == 'both')
var deployFunctions = deployBackend && (hostingModel == 'functions' || hostingModel == 'both')

// ============================================================================
// E8 engine generation (Generation:*) — engine-runtime/05, NFR-005 / ADP-025
// ----------------------------------------------------------------------------
// These are DELIBERATELY plain locals, not reads of module ai's outputs. modules/ai.bicep depends on
// modules/webapp.bicep (it needs the App Service's ARM-assigned principalId for the role assignment);
// if webapp were then to read ai's outputs for its Generation:* app settings, the two modules would form
// a cycle Bicep rejects. Every governed Generation:* value is deterministic from params both modules already
// take (the account-name pattern, location, the literal model ids), so it is computed ONCE here and
// passed as the SAME literal into both modules independently — which also keeps the config values
// verbatim-identical to what ai.bicep actually deploys (PROVIDER-GOVERNANCE.md §4 mapping table).
// ============================================================================

// = ai.bicep output 'endpoint'. The account's customSubDomainName IS the data-plane host and is pinned to
// the account name below (customSubDomain: aiFoundryName on the ai module call, passed explicitly so an
// override there can't silently desync this literal), so the host is deterministic from the name alone.
var generationEndpoint = 'https://${aiFoundryName}.cognitiveservices.azure.com/'

// The model ids ai.bicep deploys — passed into the ai module below so the deployed models and the app
// config can never drift apart. (The deployment NAMES are ai.bicep resource names: 'standard' /
// 'ambient'; only 'ambient' is referenced today because of the temporary alias immediately below.)
var generationStandardModelName = 'gpt-5.4'
var generationAmbientDeploymentName = 'ambient'
var generationAmbientModelName = 'gpt-5.4-mini'

// TEMPORARY (engine-runtime/05 AC4) — Ambient tier for the first live UAT run, reached by ALIASING the
// Standard tier config key at the Ambient deployment/model. The reaction loop's generate stage has no
// runtime tier selector (IntentComposer.TierFor hardcodes Standard for everything but AmbientFloor), so
// this config-level alias is the only way to reach Ambient today. gpt-5.4-mini is ~3x cheaper than
// gpt-5.4 and cleared the same 10/10 InjectionRedTeam + voice-diversity gates (MEASURED-RESULTS.md).
// REMOVE THIS ALIAS in autonomy-safety/05 — "Engine settings API (autonomy default + tier policy,
// runtime-settable)", #353 — which adds the real per-exercise tier seam at IntentComposer.Compose. When
// it lands, point these two back at 'standard' / generationStandardModelName (the real Standard tier).
// Tracked as an open follow-up in docs/features/engine-runtime/feature.md.
var generationStandardTierDeployment = generationAmbientDeploymentName
var generationStandardTierModel = generationAmbientModelName

// The live-traffic decision. Requires BOTH toggles: generationProviderLive is the reviewed, Tier-2-gated
// intent, and deployAi is the precondition that the governed endpoint actually exists (routing at a
// non-existent endpoint would only produce a startup failure). deployAi alone NEVER routes traffic —
// that separation is the whole point of the two toggles.
var generationLive = deployAi && generationProviderLive
var generationProvider = generationLive ? 'AzureOpenAI' : 'Fake'

// The §2 governance attestations are PARAMETERS, not locals derived from deployAi (see their
// @description()s above): the §8 signer types them, so GenerationGovernance.Validate stays an
// independent gate that can actually fire. They are zeroed out at the webApp call site when
// deployAi = false — not to re-derive the assertion, but because with no endpoint provisioned there is
// nothing for it to describe, and every other Generation:* value is emptied the same way.

// = ai.bicep output 'residency' (the model deployments' region, DataZoneStandard SKU / US data zone).
var generationResidency = location

// ============================================================================
// Module Deployments
// ============================================================================

module storage 'modules/storage.bicep' = if (deployStorage) {
  name: 'storageDeploy'
  params: {
    location: location
    storageAccountName: storageName
    tags: tags
  }
}

module logAnalytics 'modules/loganalytics.bicep' = if (deployMonitoring) {
  name: 'logAnalyticsDeploy'
  params: {
    location: location
    workspaceName: logAnalyticsName
    tags: tags
  }
}

module appInsights 'modules/appinsights.bicep' = if (deployMonitoring) {
  name: 'appInsightsDeploy'
  params: {
    location: location
    appInsightsName: appInsightsName
    // Both this module and logAnalytics share the deployMonitoring guard, so the
    // reference is only reached when logAnalytics is actually deployed.
    #disable-next-line BCP318
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
    tags: tags
  }
}

module database 'modules/database.bicep' = if (deployDatabase) {
  name: 'databaseDeploy'
  params: {
    location: location
    serverName: sqlServerName
    databaseName: sqlDatabaseName
    adminLogin: sqlAdminLogin
    adminPassword: sqlAdminPassword
    entraAdminLogin: sqlEntraAdminLogin
    entraAdminObjectId: sqlEntraAdminObjectId
    tags: tags
  }
}

module appServicePlan 'modules/appserviceplan.bicep' = if (deployWebApp) {
  name: 'appServicePlanDeploy'
  params: {
    location: location
    planName: appServicePlanName
    tags: tags
  }
}

module signalR 'modules/signalr.bicep' = if (deploySignalR) {
  name: 'signalRDeploy'
  params: {
    location: location
    signalRName: signalRName
    skuName: signalRSkuName
    // Web-API-hosted hub (webapi) needs Default; the Azure Functions SignalR bindings (functions/both)
    // need Serverless. Derive from the hosting model so enabling Functions + SignalR stays coherent.
    serviceMode: deployFunctions ? 'Serverless' : 'Default'
    allowedOrigins: frontendUrl != '' ? [frontendUrl] : []
    tags: tags
  }
}

// Cross-module output accesses below are guarded by the same toggles that create
// the referenced modules (deployWebApp implies appServicePlan; the ternaries gate
// the optional ones), so the null-access BCP318 warnings are not reachable.
module webApp 'modules/webapp.bicep' = if (deployWebApp) {
  name: 'webAppDeploy'
  params: {
    location: location
    webAppName: webAppName
    #disable-next-line BCP318
    appServicePlanId: appServicePlan.outputs.id!
    #disable-next-line BCP318
    appInsightsConnectionString: deployMonitoring ? appInsights.outputs.connectionString! : ''
    #disable-next-line BCP318
    sqlConnectionString: deployDatabase ? database.outputs.connectionString! : ''
    #disable-next-line BCP318
    storageConnectionString: deployStorage ? storage.outputs.connectionString! : ''
    // The SignalR hub is hosted IN this Web API (ServiceMode Default), so the host — not the Function
    // App — reads this connection string. Empty when SignalR isn't deployed.
    #disable-next-line BCP318
    signalRConnectionString: deploySignalR ? signalR.outputs.connectionString! : ''
    frontendUrl: frontendUrl
    emailConnectionString: emailConnectionString
    #disable-next-line BCP318
    emailDefaultSenderAddress: deployCommunication ? communication.outputs.managedDomainSenderAddress! : emailSenderAddress
    jwtSecretKey: jwtSecretKey
    bootstrapSecret: bootstrapSecret
    staffIdentityAccountsJson: staffIdentityAccountsJson
    // E8 generation provider (engine-runtime/05). Plain locals — NOT module ai's outputs; see the
    // no-cycle note above the locals. Provider is Fake unless BOTH deployAi and the Tier-2-gated
    // generationProviderLive are set, so standing the endpoint up never routes traffic by itself.
    generationProvider: generationProvider
    generationEndpoint: deployAi ? generationEndpoint : ''
    generationStandardDeployment: deployAi ? generationStandardTierDeployment : ''
    generationStandardModel: deployAi ? generationStandardTierModel : ''
    generationAmbientDeployment: deployAi ? generationAmbientDeploymentName : ''
    generationAmbientModel: deployAi ? generationAmbientModelName : ''
    generationResidency: deployAi ? generationResidency : ''
    // The signer's §2 assertions, emptied along with the rest of the block when no endpoint exists.
    generationTenantBounded: deployAi && generationTenantBounded
    generationNoTrainingAttested: deployAi && generationNoTrainingAttested
    tags: tags
  }
}

module functionApp 'modules/functionapp.bicep' = if (deployFunctions) {
  name: 'functionAppDeploy'
  params: {
    location: location
    functionAppName: functionAppName
    #disable-next-line BCP318
    storageAccountName: deployStorage ? storage.outputs.name! : storageName
    #disable-next-line BCP318
    appInsightsConnectionString: deployMonitoring ? appInsights.outputs.connectionString! : ''
    #disable-next-line BCP318
    signalRConnectionString: deploySignalR ? signalR.outputs.connectionString! : ''
    #disable-next-line BCP318
    sqlConnectionString: deployDatabase ? database.outputs.connectionString! : ''
    tags: tags
  }
}

module staticWebApp 'modules/staticwebapp.bicep' = {
  name: 'staticWebAppDeploy'
  params: {
    location: location
    staticWebAppName: staticWebAppName
    repositoryUrl: repositoryUrl
    customDomainName: staticWebAppCustomDomain
    tags: tags
  }
}

module communication 'modules/communication.bicep' = if (deployCommunication) {
  name: 'communicationDeploy'
  params: {
    acsName: acsName
    emailServiceName: emailServiceName
    emailCustomDomain: emailCustomDomain
    tags: tags
  }
}

// Azure AI Foundry for the E8 Adaptive Content Engine. Independent of deployBackend — the engine's
// generation endpoint can stand up before the app host exists (e.g. for the 2026-07-18 measured spike).
// Standing this account up does NOT route generation traffic to it: that is generationProviderLive's
// job (see the locals above), so provisioning and going live stay two separately-flippable decisions
// (NFR-005 Tier-2, engine-runtime/05).
//
// backendPrincipalId closes the keyless-auth gap (engine-runtime/05): the App Service's own
// system-assigned identity gets "Cognitive Services OpenAI User" on this account, so the runtime path
// uses DefaultAzureCredential with no API key (the account sets disableLocalAuth) and no developer
// az-login credential. The dependency is one-directional — ai reads webApp's principalId; webApp reads
// only main.bicep locals, never ai's outputs (a cycle Bicep would reject). When deployWebApp is false the
// role assignment is skipped as before; grant your az-login identity the role manually for a local pass.
module ai 'modules/ai.bicep' = if (deployAi) {
  name: 'aiDeploy'
  params: {
    location: location
    aiFoundryName: aiFoundryName
    // Passed EXPLICITLY (rather than relying on ai.bicep's default of the account name) because the
    // custom subdomain IS the data-plane host, and generationEndpoint above reconstructs that host as a
    // literal. Tying them together here means an override can't silently desync the app's
    // Generation:Endpoint from the endpoint the account actually serves.
    customSubDomain: aiFoundryName
    #disable-next-line BCP318
    backendPrincipalId: deployWebApp ? webApp.outputs.principalId! : ''
    // The same literals fed to webApp's Generation:* settings, so the deployed models and the app config
    // are provably identical (PROVIDER-GOVERNANCE.md §4 "verbatim").
    standardModel: generationStandardModelName
    ambientModel: generationAmbientModelName
    deployClaude: deployClaude
    claudeOrganizationName: claudeOrganizationName
    tags: tags
  }
}

// ============================================================================
// Defender for Cloud (subscription-scoped) — deploy separately:
//   az deployment sub create --location <location> \
//     --template-file modules/defender.bicep \
//     --parameters logAnalyticsWorkspaceId='<logAnalytics.outputs.id>' \
//                  securityContactEmail='security@dynamis.com'
// ============================================================================

// ============================================================================
// Outputs
// ============================================================================

// Conditional outputs — each ternary is guarded by the toggle that creates the
// referenced module, so the BCP318 null-access warnings are not reachable.
#disable-next-line BCP318
output webAppName string = deployWebApp ? webApp.outputs.name! : ''
#disable-next-line BCP318
output webAppHostname string = deployWebApp ? webApp.outputs.defaultHostname! : ''
#disable-next-line BCP318
output functionAppName string = deployFunctions ? functionApp.outputs.name! : ''
output staticWebAppName string = staticWebApp.outputs.name
output staticWebAppHostname string = staticWebApp.outputs.defaultHostname
output staticWebAppCustomDomain string = staticWebApp.outputs.customDomain
output staticWebAppDeploymentToken string = staticWebApp.outputs.deploymentToken
#disable-next-line BCP318
output sqlServerFqdn string = deployDatabase ? database.outputs.serverFqdn! : ''
#disable-next-line BCP318
output logAnalyticsWorkspaceId string = deployMonitoring ? logAnalytics.outputs.id! : ''
#disable-next-line BCP318
output acsHostName string = deployCommunication ? communication.outputs.acsHostName! : ''
#disable-next-line BCP318
output emailSenderAddress string = deployCommunication ? communication.outputs.managedDomainSenderAddress! : emailSenderAddress
#disable-next-line BCP318
output aiFoundryEndpoint string = deployAi ? ai.outputs.endpoint! : ''
#disable-next-line BCP318
output aiFoundryAccountName string = deployAi ? ai.outputs.name! : ''
// Base host for the Claude/Anthropic passthrough (Generation:Endpoint for the ClaudeFoundry provider).
#disable-next-line BCP318
output aiClaudeEndpoint string = (deployAi && deployClaude) ? ai.outputs.claudeEndpoint! : ''
// Which generation provider the deployed App Service resolves. 'Fake' = in-process, NO LLM egress;
// 'AzureOpenAI' = live, egressing traffic (only when the Tier-2-gated generationProviderLive is set).
// Surfaced as an output so every Deploy Infrastructure run states it in the job summary (NFR-005 audit).
output generationProvider string = generationProvider
// The EFFECTIVE attested governance posture (§2 / NFR-005) — exactly the values emitted as the
// Generation__Governance__* app settings. Surfaced so a post-deploy audit can read what the deployed app
// actually asserts from the Deploy Infrastructure job summary, without diffing the parameter file. All
// false/empty until the §8 signer sets the attestation params (they are human assertions, not derived
// from deployAi).
output generationAttestedPosture object = {
  tenantBounded: deployAi && generationTenantBounded
  noTraining: deployAi && generationNoTrainingAttested
  residency: deployAi ? generationResidency : ''
}
// Object id of the App Service identity that holds the Foundry data-plane role (engine-runtime/05).
#disable-next-line BCP318
output webAppPrincipalId string = deployWebApp ? webApp.outputs.principalId! : ''
