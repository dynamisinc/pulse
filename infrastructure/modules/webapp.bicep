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
param tags object = {}

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
      appSettings: [
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
        // Serilog Application Insights sink
        {
          name: 'Serilog__WriteTo__1__Name'
          value: 'ApplicationInsights'
        }
        {
          name: 'Serilog__WriteTo__1__Args__connectionString'
          value: appInsightsConnectionString
        }
        {
          name: 'Serilog__WriteTo__1__Args__telemetryConverter'
          value: 'Serilog.Sinks.ApplicationInsights.TelemetryConverters.TraceTelemetryConverter, Serilog.Sinks.ApplicationInsights'
        }
        // JWT Secret Key (set via --parameters, not stored in repo)
        {
          name: 'Authentication__Jwt__SecretKey'
          value: jwtSecretKey
        }
        // Cookie config for cross-origin SPA
        {
          name: 'Authentication__Cookie__SameSite'
          value: 'None'
        }
      ]
    }
  }
  tags: tags
}

output name string = webApp.name
output defaultHostname string = webApp.properties.defaultHostName
