param location string
param serverName string
param databaseName string
param adminLogin string
@secure()
param adminPassword string
param entraAdminLogin string = ''
param entraAdminObjectId string = ''
param autoPauseDelay int = 60
param maxSizeBytes int = 34359738368 // 32 GB
param tags object = {}

resource sqlServer 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: serverName
  location: location
  properties: {
    administratorLogin: adminLogin
    administratorLoginPassword: adminPassword
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
  tags: tags
}

// The Entra (AAD) admin, as a CHILD resource rather than `properties.administrators`.
//
// WHY THIS IS NOT INLINE (do not "simplify" it back):
// `Microsoft.Sql/servers.properties.administrators` is effectively CREATE-ONLY. It deploys fine against a
// server that does not exist yet, but re-deploying the same template against a LIVE server is rejected with
//   InvalidParameterValue: Invalid value given for parameter AzureADOnlyAuthentication
// even when the declared admin exactly matches the one already configured. That made the whole
// infrastructure template non-idempotent: `databaseDeploy` failed, and because `webappDeploy`/`aiDeploy`
// depend on it, EVERY infra deploy to an existing environment was blocked — not just a database change.
// (Observed 2026-07-30 on `sql-pulse-uat`, whose admin already matched `uat.bicepparam` byte-for-byte.)
//
// The child-resource form is the update-capable path, so this now re-applies cleanly to a live server.
// Conditional on the same guard as before: with no `entraAdminObjectId` the server deploys with SQL auth
// only, which is all the App Service needs (it connects via `administratorLogin`/password — see the
// `connectionString` output below).
resource sqlEntraAdmin 'Microsoft.Sql/servers/administrators@2023-08-01-preview' = if (entraAdminObjectId != '') {
  parent: sqlServer
  name: 'ActiveDirectory'
  properties: {
    administratorType: 'ActiveDirectory'
    login: entraAdminLogin
    sid: entraAdminObjectId
    tenantId: subscription().tenantId
  }
}

// DELIBERATELY NOT DECLARED: `Microsoft.Sql/servers/azureADOnlyAuthentications`.
// Azure-AD-only authentication must stay OFF — the App Service authenticates with SQL auth, so switching it
// on would sever the application's own connection. `false` is the Azure default and nothing here sets it
// true, so declaring a resource purely to assert a default would add an update path (and another
// non-idempotency risk of exactly the kind this comment exists to explain) for no benefit. If AAD-only auth
// is ever wanted, that is a deliberate change with its own review — and it requires the admin above to
// exist first.

resource sqlDatabase 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sqlServer
  name: databaseName
  location: location
  sku: {
    name: 'GP_S_Gen5'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    collation: 'SQL_Latin1_General_CP1_CI_AS'
    maxSizeBytes: maxSizeBytes
    autoPauseDelay: autoPauseDelay
    minCapacity: json('0.5')
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'BillOverUsage'
    requestedBackupStorageRedundancy: 'Local'
    zoneRedundant: false
  }
  tags: tags
}

// Allow Azure services (App Service, Functions) to access the server
resource allowAzureServices 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sqlServer
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

output serverName string = sqlServer.name
output serverFqdn string = sqlServer.properties.fullyQualifiedDomainName
output databaseName string = sqlDatabase.name
output connectionString string = 'Server=tcp:${sqlServer.properties.fullyQualifiedDomainName},1433;Initial Catalog=${databaseName};Persist Security Info=False;User ID=${adminLogin};Password=${adminPassword};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;'
