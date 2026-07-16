// Log Analytics Workspace for monitoring
// Used by: Defender for Cloud, Application Insights, diagnostic settings

param location string
param workspaceName string
param retentionInDays int = 30
param tags object = {}

resource logAnalyticsWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: workspaceName
  location: location
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: retentionInDays
  }
  tags: tags
}

output id string = logAnalyticsWorkspace.id
output name string = logAnalyticsWorkspace.name
