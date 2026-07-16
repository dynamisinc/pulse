param location string
param signalRName string
param allowedOrigins array = []
param tags object = {}

resource signalR 'Microsoft.SignalRService/signalR@2023-02-01' = {
  name: signalRName
  location: location
  sku: {
    name: 'Free_F1'
    tier: 'Free'
    capacity: 1
  }
  properties: {
    features: [
      {
        flag: 'ServiceMode'
        value: 'Serverless'
      }
    ]
    cors: {
      allowedOrigins: empty(allowedOrigins) ? ['*'] : allowedOrigins
    }
  }
  tags: tags
}

output connectionString string = signalR.listKeys().primaryConnectionString
