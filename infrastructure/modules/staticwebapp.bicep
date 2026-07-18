param location string
param staticWebAppName string
param repositoryUrl string = ''
param branch string = 'main'
param tags object = {}

@description('Custom domain to bind (e.g. pulse-uat.cobrasoftware.com). Empty = none. A subdomain validated via a CNAME to defaultHostname; Azure auto-issues the managed TLS cert. Leave empty to skip.')
param customDomainName string = ''

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

// Bind a custom domain when one is configured. Subdomain validation is by CNAME
// (the DNS record points at `defaultHostname`); Azure then auto-provisions the
// free managed TLS cert. Idempotent: if the domain was already added out-of-band
// (e.g. via `az staticwebapp hostname set`), a deploy reconciles to this same
// resource. The GoDaddy CNAME (registrar-side) is NOT managed here.
resource customDomain 'Microsoft.Web/staticSites/customDomains@2023-12-01' = if (customDomainName != '') {
  parent: staticWebApp
  name: customDomainName
  properties: {
    validationMethod: 'cname-delegation'
  }
}

output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output customDomain string = customDomainName
output deploymentToken string = staticWebApp.listSecrets().properties.apiKey
