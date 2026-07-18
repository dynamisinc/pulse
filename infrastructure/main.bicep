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

@description('Deploy ACS + Email Service resources. Off until email is needed.')
param deployCommunication bool = false

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
// ============================================================================

var resourceSuffix = '${appName}-${environment}'
var storageName = 'st${appName}${environment}'
var logAnalyticsName = 'log-${resourceSuffix}'
var appInsightsName = 'appi-${resourceSuffix}'
var sqlServerName = 'sql-${resourceSuffix}'
var appServicePlanName = 'asp-${resourceSuffix}'
var webAppName = 'app-${appName}-api-${environment}'
var signalRName = 'sigr-${resourceSuffix}'
var functionAppName = 'func-${resourceSuffix}'
var acsName = 'acs-${resourceSuffix}'
var emailServiceName = 'email-${resourceSuffix}'

var tags = {
  Environment: environment
  Application: appName
  ManagedBy: 'Bicep'
}

// Derived hosting flags — backend sub-resources require deployBackend = true.
var deployWebApp = deployBackend && (hostingModel == 'webapi' || hostingModel == 'both')
var deployFunctions = deployBackend && (hostingModel == 'functions' || hostingModel == 'both')

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

module signalR 'modules/signalr.bicep' = if (deployFunctions) {
  name: 'signalRDeploy'
  params: {
    location: location
    signalRName: signalRName
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
    frontendUrl: frontendUrl
    emailConnectionString: emailConnectionString
    #disable-next-line BCP318
    emailDefaultSenderAddress: deployCommunication ? communication.outputs.managedDomainSenderAddress! : emailSenderAddress
    jwtSecretKey: jwtSecretKey
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
    signalRConnectionString: deployFunctions ? signalR.outputs.connectionString! : ''
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
