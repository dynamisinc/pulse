param location string
param functionAppName string
param storageAccountName string
param appInsightsConnectionString string
param signalRConnectionString string = ''
param sqlConnectionString string
param tags object = {}

// Functions use their own Consumption plan (scale to zero)
resource hostingPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${functionAppName}-plan'
  location: location
  kind: 'linux'
  sku: {
    name: 'Y1'
    tier: 'Dynamic'
  }
  properties: {
    reserved: true
  }
  tags: tags
}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: hostingPlan.id
    reserved: true
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'DOTNET-ISOLATED|10.0'
      use32BitWorkerProcess: false
      minTlsVersion: '1.2'
      ftpsState: 'FtpsOnly'
      appSettings: [
        {
          name: 'AzureWebJobsStorage'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTAZUREFILECONNECTIONSTRING'
          value: 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
        }
        {
          name: 'WEBSITE_CONTENTSHARE'
          value: toLower(functionAppName)
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'dotnet-isolated'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'AzureSignalRConnectionString'
          value: signalRConnectionString
        }
        {
          name: 'SqlConnectionString'
          value: sqlConnectionString
        }
      ]
      cors: {
        allowedOrigins: [
          'https://portal.azure.com'
        ]
      }
    }
  }
  tags: tags
}

output name string = functionApp.name
output defaultHostName string = functionApp.properties.defaultHostName
