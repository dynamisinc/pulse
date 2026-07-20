param location string
param signalRName string
param allowedOrigins array = []

@description('SKU name, e.g. Free_F1 or Standard_S1. Tier is derived from the prefix.')
param skuName string = 'Free_F1'

@description('Unit capacity for the SKU (1 for Free_F1; scale up on Standard/Premium).')
param capacity int = 1

@description('SignalR service mode. Default = the app server (Pulse.WebApi) hosts the hub and holds connections to the service. Serverless is only for the Azure Functions SignalR bindings.')
@allowed(['Default', 'Serverless', 'Classic'])
param serviceMode string = 'Default'

param tags object = {}

// Tier is fixed by the SKU-name prefix (Free_F1 → Free, Standard_S1 → Standard, Premium_P1 → Premium).
var skuTier = startsWith(skuName, 'Premium') ? 'Premium' : (startsWith(skuName, 'Standard') ? 'Standard' : 'Free')

resource signalR 'Microsoft.SignalRService/signalR@2023-02-01' = {
  name: signalRName
  location: location
  sku: {
    name: skuName
    tier: skuTier
    capacity: capacity
  }
  properties: {
    features: [
      {
        flag: 'ServiceMode'
        value: serviceMode
      }
    ]
    cors: {
      allowedOrigins: empty(allowedOrigins) ? ['*'] : allowedOrigins
    }
  }
  tags: tags
}

output connectionString string = signalR.listKeys().primaryConnectionString
