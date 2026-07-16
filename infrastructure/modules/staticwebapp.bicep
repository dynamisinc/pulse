param location string
param staticWebAppName string
param repositoryUrl string = ''
param branch string = 'main'
param tags object = {}

resource staticWebApp 'Microsoft.Web/staticSites@2023-12-01' = {
  name: staticWebAppName
  location: location
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    allowConfigFileUpdates: true
    stagingEnvironmentPolicy: 'Enabled'
    enterpriseGradeCdnStatus: 'Disabled'
    repositoryUrl: repositoryUrl != '' ? repositoryUrl : null
    branch: repositoryUrl != '' ? branch : null
    provider: repositoryUrl != '' ? 'GitHub' : null
  }
  tags: tags
}

output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output deploymentToken string = staticWebApp.listSecrets().properties.apiKey
