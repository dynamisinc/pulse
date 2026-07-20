param location string
param signalRName string
param allowedOrigins array = []

@description('SKU name. Tier is derived from the prefix; constrained so the derivation can never drift.')
@allowed(['Free_F1', 'Standard_S1', 'Premium_P1'])
param skuName string = 'Free_F1'

@description('Unit capacity for the SKU (Free is always 1; Standard/Premium scale out). Clamped to 1 on the Free tier so a misconfigured value cannot fail the deployment.')
param capacity int = 1

@description('SignalR service mode. Default = the app server (Pulse.WebApi) hosts the hub and holds connections to the service. Serverless is only for the Azure Functions SignalR bindings.')
@allowed(['Default', 'Serverless', 'Classic'])
param serviceMode string = 'Default'

param tags object = {}

// Tier is fixed by the SKU-name prefix (Free_F1 → Free, Standard_S1 → Standard, Premium_P1 → Premium).
// skuName is @allowed-constrained above, so this derivation cannot mismatch.
var skuTier = startsWith(skuName, 'Premium') ? 'Premium' : (startsWith(skuName, 'Standard') ? 'Standard' : 'Free')

// Free_F1 only supports a single unit — clamp so a stray capacity value can't fail the deployment.
var effectiveCapacity = skuTier == 'Free' ? 1 : capacity

resource signalR 'Microsoft.SignalRService/signalR@2023-02-01' = {
  name: signalRName
  location: location
  sku: {
    name: skuName
    tier: skuTier
    capacity: effectiveCapacity
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
