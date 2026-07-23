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
param tags object = {}

// The staff allowlist is supplied as a single JSON-array secret (STAFF_IDENTITY_ACCOUNTS_JSON) and expanded
// here into the indexed environment-variable keys the .NET configuration binder reads
// (Authentication__StaffIdentity__Accounts__{i}__{Field} -> DynamisIdentityProviderOptions.Accounts[i]). A
// variable-length allowlist can't be an inline app-settings literal, so it is concat()'d onto the fixed
// settings below. Empty/unset JSON -> an empty array -> NO account settings emitted -> the provider
// authenticates no one (fail closed, matching DynamisIdentityProviderOptions' documented default).
var staffAccounts = empty(staffIdentityAccountsJson) ? [] : json(staffIdentityAccountsJson)
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

resource webApp 'Microsoft.Web/sites@2023-12-01' = {
  name: webAppName
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlanId
    reserved: true
    httpsOnly: true
    clientAffinityEnabled: false
    siteConfig: {
      linuxFxVersion: 'DOTNETCORE|10.0'
      use32BitWorkerProcess: true
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
      http20Enabled: false
      webSocketsEnabled: false
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
      ], staffAccountSettings)
    }
  }
  tags: tags
}

output name string = webApp.name
output defaultHostname string = webApp.properties.defaultHostName
