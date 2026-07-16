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
    administrators: entraAdminObjectId != '' ? {
      administratorType: 'ActiveDirectory'
      azureADOnlyAuthentication: false
      login: entraAdminLogin
      sid: entraAdminObjectId
      tenantId: subscription().tenantId
      principalType: 'User'
    } : null
  }
  tags: tags
}

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
