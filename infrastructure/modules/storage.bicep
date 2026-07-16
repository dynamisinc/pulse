param location string
param storageAccountName string
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowCrossTenantReplication: false
    accessTier: 'Hot'
    largeFileSharesState: 'Enabled'
  }
  tags: tags
}

output id string = storageAccount.id
output name string = storageAccount.name
output connectionString string = 'DefaultEndpointsProtocol=https;AccountName=${storageAccount.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storageAccount.listKeys().keys[0].value}'
