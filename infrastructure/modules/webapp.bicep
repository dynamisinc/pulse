param location string
param webAppName string
param appServicePlanId string
param appInsightsConnectionString string
param sqlConnectionString string
param storageConnectionString string
@secure()
@description('Azure SignalR connection string for the Web-API-hosted real-time hub (social-api/03). Empty when SignalR is not deployed.')
param signalRConnectionString string = ''
param frontendUrl string = ''
param aspnetcoreEnvironment string = 'Production'
param blobStorageProvider string = 'Azure'
param blobStorageContainerName string = 'post-media'
@secure()
param emailConnectionString string = ''
param emailProvider string = 'AzureCommunicationServices'
param emailDefaultSenderAddress string = ''
param emailDefaultSenderName string = 'Pulse'
param emailSupportAddress string = 'pulse-support@cobrasoftware.com'
@secure()
param jwtSecretKey string = ''
param jwtAccessTokenMinutes int = 15
param jwtRefreshTokenHours int = 4
param jwtRememberMeDays int = 30
@secure()
@description('Bootstrap secret for the one-time UAT seed endpoint (Authentication:Bootstrap:Secret, story login/05-06). Empty by default -> the endpoint is disabled entirely (fail closed). Threaded exactly like jwtSecretKey; never committed to appsettings.')
param bootstrapSecret string = ''
@secure()
@description('Phase-1 staff allowlist as a JSON array of {Username,Secret,ExternalSubject,DisplayName} objects, bound to Authentication:StaffIdentity:Accounts (story login/06). Empty by default -> no staff can sign in (fail closed). Expanded below into the indexed env-var keys the .NET options binder reads. Threaded like jwtSecretKey; never committed.')
param staffIdentityAccountsJson string = ''

// ----------------------------------------------------------------------------
// E8 engine generation provider (Generation:*) — engine-runtime/05, NFR-005 / ADP-025.
//
// Every value below is supplied by main.bicep from the SAME deterministic locals it passes to
// modules/ai.bicep, so each Generation:* app setting matches its ai.bicep output / §2 attestation
// VERBATIM (docs/features/engine-runtime/PROVIDER-GOVERNANCE.md §4). Nothing here reads module ai's
// outputs — that would create a module cycle (ai already depends on this module's principalId).
//
// Every default is FAIL CLOSED: Provider = Fake (in-process, no egress), no endpoint, no attestation.
// Routing traffic to a live model requires an explicit, separately-reviewed parameter change, gated on
// the Tier-2 sign-off in PROVIDER-GOVERNANCE.md §8. Auth is keyless (DefaultAzureCredential via the
// system-assigned identity below) — no API key exists for these settings to carry.
// ----------------------------------------------------------------------------

@description('Generation:Provider discriminator. Fake = in-process, no egress (the fail-closed default CI/prod keep). AzureOpenAI/ClaudeFoundry = a live, EGRESSING endpoint — only ever set from main.bicep\'s generationProviderLive toggle, which is gated on the PROVIDER-GOVERNANCE.md §8 Tier-2 sign-off.')
@allowed(['Fake', 'AzureOpenAI', 'ClaudeFoundry'])
param generationProvider string = 'Fake'

@description('Generation:Endpoint — the tenant-bounded endpoint URI (= ai.bicep output "endpoint"). Empty when no governed endpoint is provisioned.')
param generationEndpoint string = ''

@description('Generation:ApiVersion — the Azure OpenAI data-plane api-version. A client-side choice, NOT a provisioned resource property (PROVIDER-GOVERNANCE.md §4).')
param generationApiVersion string = '2025-04-01-preview'

@description('Generation:Tiers:Standard:Deployment (= an ai.bicep deployment name). NOTE: main.bicep currently aliases this to the AMBIENT deployment — a TEMPORARY shim, see its generationStandardTier* locals.')
param generationStandardDeployment string = ''

@description('Generation:Tiers:Standard:Model (= an ai.bicep model name). NOTE: TEMPORARILY aliased to the Ambient model by main.bicep — see its generationStandardTier* locals.')
param generationStandardModel string = ''

@description('Generation:Tiers:Ambient:Deployment (= ai.bicep output "ambientDeploymentName").')
param generationAmbientDeployment string = ''

@description('Generation:Tiers:Ambient:Model (= ai.bicep output "ambientModelName").')
param generationAmbientModel string = ''

@description('Generation:Governance:Residency — documented data residency (= ai.bicep output "residency", the deployment region). NFR-005.')
param generationResidency string = ''

@description('Generation:Governance:TenantBounded — attests the endpoint is bounded to this tenant (single-tenant Cognitive Services account, disableLocalAuth, no shared/public inference). False by default: an unattested posture makes AddEngineGeneration throw at startup for a real provider (fail closed).')
param generationTenantBounded bool = false

@description('Generation:Governance:NoTrainingAttested — attests customer prompts/completions are not used to train the model (Microsoft product terms for Azure OpenAI; the Anthropic Marketplace offer for Claude). False by default (fail closed).')
param generationNoTrainingAttested bool = false

@description('Generation:Governance:Retention — the attestable retention posture. Retained is today\'s posture (standard retention under the no-training contract); switch to ZeroDataRetention only once the per-subscription abuse-monitoring/ZDR approval lands (PROVIDER-GOVERNANCE.md §2). Never left Unspecified.')
@allowed(['Retained', 'ZeroDataRetention'])
param generationRetention string = 'Retained'

param tags object = {}

// The staff allowlist is supplied as a single JSON-array secret (STAFF_IDENTITY_ACCOUNTS_JSON) and expanded
// here into the indexed environment-variable keys the .NET configuration binder reads
// (Authentication__StaffIdentity__Accounts__{i}__{Field} -> DynamisIdentityProviderOptions.Accounts[i]). A
// variable-length allowlist can't be an inline app-settings literal, so it is concat()'d onto the fixed
// settings below. Empty/unset JSON -> an empty array -> NO account settings emitted -> the provider
// authenticates no one (fail closed, matching DynamisIdentityProviderOptions' documented default).
// trim() first so a secret set to whitespace/newlines (common when pasting JSON into a GitHub secret) still
// reads as empty and fails closed, rather than making empty() false and json() throw on the padded string.
var trimmedStaffAccountsJson = trim(staffIdentityAccountsJson)
var staffAccounts = empty(trimmedStaffAccountsJson) ? [] : json(trimmedStaffAccountsJson)
var staffAccountSettings = flatten(map(staffAccounts, (account, i) => [
  {
    name: 'Authentication__StaffIdentity__Accounts__${i}__Username'
    value: account.Username
  }
  {
    name: 'Authentication__StaffIdentity__Accounts__${i}__Secret'
    value: account.Secret
  }
  {
    name: 'Authentication__StaffIdentity__Accounts__${i}__ExternalSubject'
    value: account.ExternalSubject
  }
  {
    name: 'Authentication__StaffIdentity__Accounts__${i}__DisplayName'
    value: account.DisplayName
  }
]))

// The E8 Generation:* block (engine-runtime/05). Emitted UNCONDITIONALLY and with a fixed shape, so a
// go-live is a SMALL, fully auditable ARM diff rather than a restructuring: flipping
// generationProviderLive alone moves exactly one value (Generation__Provider), and the real signing
// commit moves THREE — Provider plus the two Generation__Governance__* attestations, which the §8 signer
// sets in that same commit (they are human assertions, deliberately not derived from deployAi, so the
// startup gate stays an independent check). Provider alone would be rejected at startup by design.
// When no governed endpoint is provisioned
// (deployAi = false) the endpoint/tier values are empty and the attestations are false, which is the
// honest representation of "nothing to attest": Provider stays Fake (compliant by construction, no
// egress), and a real provider configured against this posture would be rejected at startup by
// GenerationGovernance.Validate rather than silently reaching an unattested endpoint (NFR-005).
var generationSettings = [
  {
    name: 'Generation__Provider'
    value: generationProvider
  }
  {
    name: 'Generation__Endpoint'
    value: generationEndpoint
  }
  {
    name: 'Generation__ApiVersion'
    value: generationApiVersion
  }
  // TEMPORARY (engine-runtime/05 AC4) — the Standard tier keys are aliased to the AMBIENT
  // deployment/model by main.bicep's generationStandardTier* locals, because the reaction loop's
  // generate stage has no runtime tier selector yet. Removed by autonomy-safety/05
  // (engine settings API — runtime autonomy + tier policy, #353), which adds the real tier seam at
  // IntentComposer; after that, point these back at ai.bicep's standardDeploymentName/standardModelName.
  {
    name: 'Generation__Tiers__Standard__Deployment'
    value: generationStandardDeployment
  }
  {
    name: 'Generation__Tiers__Standard__Model'
    value: generationStandardModel
  }
  {
    name: 'Generation__Tiers__Ambient__Deployment'
    value: generationAmbientDeployment
  }
  {
    name: 'Generation__Tiers__Ambient__Model'
    value: generationAmbientModel
  }
  // Explicit lowercase literals rather than string(bool): ARM's string() renders a bool as .NET's
  // "True"/"False", and while the .NET config binder parses that case-insensitively, 'true'/'false' is
  // what the equivalent appsettings JSON key holds — keep the two representations identical.
  {
    name: 'Generation__Governance__TenantBounded'
    value: generationTenantBounded ? 'true' : 'false'
  }
  {
    name: 'Generation__Governance__NoTrainingAttested'
    value: generationNoTrainingAttested ? 'true' : 'false'
  }
  {
    name: 'Generation__Governance__Residency'
    value: generationResidency
  }
  {
    name: 'Generation__Governance__Retention'
    value: generationRetention
  }
]

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  // System-assigned managed identity (engine-runtime/05). The App Service's own principal is what
  // DefaultAzureCredential presents to the AI Foundry data plane (aif-pulse-*, disableLocalAuth: true —
  // there is no key), so the runtime path needs NO API key and NO developer az-login credential. Its
  // principalId is exported below and consumed by main.bicep to grant the Cognitive Services OpenAI
  // User role in modules/ai.bicep. One-directional: this module never reads module ai's outputs.
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlanId
    reserved: true
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      // Keep the worker warm: without this, the Basic-tier app idle-unloads and cold-starts (~1 min of
      // 5xx, incl. a transient BadImageFormatException JIT window on the .NET 10 runtime) on the next
      // request — a poor pilot experience and the reason the deploy smoke test intermittently reds (#330).
      alwaysOn: true
      // Honest value: this is a LINUX App Service (linuxFxVersion above), where the worker is ALWAYS
      // 64-bit and use32BitWorkerProcess is ignored by the platform. Set false to reflect reality and
      // avoid the misleading Windows-ism (flipping it is a no-op here; the real cold-start fix is alwaysOn).
      use32BitWorkerProcess: false
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
      http20Enabled: false
      // Required for the in-process SignalR hub (/hubs/exercise) — Azure App Service blocks the WebSocket
      // upgrade unless this is on, so with it false the controller review queue and the participant feed
      // both silently fall back to "refresh to see" (no live pushes). The negotiate + CORS already work
      // (platform CORS below sets supportCredentials); the WS transport was the missing piece. Only relevant
      // while the hub is self-hosted (signalRConnectionString empty); Azure SignalR Service would offload it.
      webSocketsEnabled: true
      cors: frontendUrl != '' ? {
        allowedOrigins: [frontendUrl]
        supportCredentials: true
      } : null
      appSettings: concat([
        // Application Insights
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        // ASP.NET Core
        {
          name: 'ASPNETCORE_ENVIRONMENT'
          value: aspnetcoreEnvironment
        }
        // Database (via connection string format for EF Core)
        {
          name: 'ConnectionStrings__DefaultConnection'
          value: sqlConnectionString
        }
        // Blob Storage
        {
          name: 'Azure__BlobStorage__ConnectionString'
          value: storageConnectionString
        }
        {
          name: 'Azure__BlobStorage__PhotoContainerName'
          value: blobStorageContainerName
        }
        {
          name: 'Azure__BlobStorage__Provider'
          value: blobStorageProvider
        }
        // Azure SignalR (real-time feed fan-out; social-api/03). Read by AddSignalR().AddAzureSignalR()
        // via config key Azure:SignalR:ConnectionString. Empty until deploySignalR = true.
        {
          name: 'Azure__SignalR__ConnectionString'
          value: signalRConnectionString
        }
        // Email
        {
          name: 'Email__Provider'
          value: emailProvider
        }
        {
          name: 'Email__ConnectionString'
          value: emailConnectionString
        }
        {
          name: 'Email__DefaultSenderAddress'
          value: emailDefaultSenderAddress
        }
        {
          name: 'Email__DefaultSenderName'
          value: emailDefaultSenderName
        }
        {
          name: 'Email__SupportAddress'
          value: emailSupportAddress
        }
        // Authentication
        {
          name: 'Authentication__FrontendBaseUrl'
          value: frontendUrl
        }
        {
          name: 'Authentication__Jwt__AccessTokenMinutes'
          value: string(jwtAccessTokenMinutes)
        }
        {
          name: 'Authentication__Jwt__RefreshTokenHours'
          value: string(jwtRefreshTokenHours)
        }
        {
          name: 'Authentication__Jwt__RememberMeDays'
          value: string(jwtRememberMeDays)
        }
        // NOTE: the backend does NOT use Serilog — logging is the ASP.NET Core ILogger
        // pipeline with the Application Insights logger provider (AddApplicationInsightsTelemetry
        // in Program.cs), whose captured level is set to Information via appsettings.json
        // (Logging:ApplicationInsights:LogLevel). The former Serilog__WriteTo__* settings here
        // were dead config (no Serilog package / UseSerilog) and have been removed.
        // JWT Secret Key (set via --parameters, not stored in repo)
        {
          name: 'Authentication__Jwt__SecretKey'
          value: jwtSecretKey
        }
        // Bootstrap secret for the one-time UAT seed endpoint (Authentication:Bootstrap:Secret, story
        // login/05-06). Empty by default -> the endpoint is disabled entirely (fail closed). Set via
        // --parameters from the BOOTSTRAP_SECRET GitHub secret, never stored in repo — mirrors jwtSecretKey.
        {
          name: 'Authentication__Bootstrap__Secret'
          value: bootstrapSecret
        }
        // Cookie config for cross-origin SPA
        {
          name: 'Authentication__Cookie__SameSite'
          value: 'None'
        }
        // NOTE: the Phase-1 staff allowlist (Authentication:StaffIdentity:Accounts) is appended after this
        // fixed array via concat(..., staffAccountSettings) — see the staffAccountSettings var above. It's a
        // variable-length array expanded from STAFF_IDENTITY_ACCOUNTS_JSON, so it can't be an inline literal.
        // The E8 Generation:* block (generationSettings) is appended the same way.
      ], staffAccountSettings, generationSettings)
    }
  }
  tags: tags
}

output name string = webApp.name
output defaultHostname string = webApp.properties.defaultHostName

// Object (principal) id of the App Service's system-assigned identity. main.bicep passes this to
// modules/ai.bicep as backendPrincipalId so the role assignment (Cognitive Services OpenAI User) targets
// the app itself — closing the keyless-auth gap that previously forced the measured spike to run as a
// developer az login (engine-runtime/05; infrastructure/README.md follow-up).
output principalId string = webApp.identity.principalId
