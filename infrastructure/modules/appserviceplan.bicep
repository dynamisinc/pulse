param location string
param planName string
param skuName string = 'B1'
param skuTier string = 'Basic'
param tags object = {}

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: planName
  location: location
  kind: 'linux'
  sku: {
    name: skuName
    tier: skuTier
  }
  properties: {
    reserved: true // Required for Linux
  }
  tags: tags
}

output id string = appServicePlan.id
output name string = appServicePlan.name
