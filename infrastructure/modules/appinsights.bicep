param location string
param appInsightsName string
param logAnalyticsWorkspaceId string = ''
param retentionInDays int = 90
param tags object = {}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalyticsWorkspaceId != '' ? logAnalyticsWorkspaceId : null
    RetentionInDays: retentionInDays
    IngestionMode: 'LogAnalytics'
  }
  tags: tags
}

output id string = appInsights.id
output connectionString string = appInsights.properties.ConnectionString
output instrumentationKey string = appInsights.properties.InstrumentationKey
