// ============================================================================
// Azure AI Foundry (Cognitive Services, kind AIServices) for the E8 engine.
//
// Hosts the in-tenant Azure OpenAI model deployments the Adaptive Content Engine
// generates against (NFR-005: tenant-bounded, no-training, documented residency).
// Local (key) auth is DISABLED — all access is Entra ID / managed identity, so no
// API keys exist to leak. This matches the Pulse security posture and lets the
// backend call the data plane with DefaultAzureCredential.
// ============================================================================

@description('Azure region for the AI Foundry account.')
param location string

@description('AI Foundry (Cognitive Services AIServices) account name, e.g. aif-pulse-uat.')
param aiFoundryName string

@description('Custom subdomain — REQUIRED for Entra ID token auth. Defaults to the account name.')
param customSubDomain string = aiFoundryName

@description('Public network access. Enabled for the sandbox; tighten to a private endpoint when the backend vnet lands.')
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Enabled'

@description('Model-deployment SKU. DataZoneStandard keeps data within the US data zone (residency, NFR-005); GlobalStandard has the widest availability but may route globally.')
param modelSkuName string = 'DataZoneStandard'

@description('Standard tier — storyline-critical reactions (top voice quality).')
param standardModel string = 'gpt-4.1'
param standardModelVersion string = '2025-04-14'
@description('Standard-tier capacity (thousands of tokens/min).')
param standardCapacity int = 50

@description('Ambient tier — bulk background chatter (cheaper/faster, the volume driver).')
param ambientModel string = 'gpt-4.1-mini'
param ambientModelVersion string = '2025-04-14'
@description('Ambient-tier capacity (thousands of tokens/min).')
param ambientCapacity int = 100

@description('Object (principal) id of the backend managed identity to grant "Cognitive Services OpenAI User". Empty = skip the role assignment (grant your az-login identity manually for the local measured spike, story 06).')
param backendPrincipalId string = ''

param tags object = {}

resource account 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: aiFoundryName
  location: location
  kind: 'AIServices'
  sku: {
    name: 'S0'
  }
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    customSubDomainName: customSubDomain
    publicNetworkAccess: publicNetworkAccess
    // No keys: force Entra ID / managed-identity auth on the data plane (NFR-005 posture).
    disableLocalAuth: true
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
  tags: tags
}

// Standard tier — storyline-critical reactions.
resource standardDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'standard'
  sku: {
    name: modelSkuName
    capacity: standardCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: standardModel
      version: standardModelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

// Ambient tier — bulk background chatter. Serialized after the Standard deployment: the Cognitive
// Services control plane rejects concurrent deployment writes to a single account.
resource ambientDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: account
  name: 'ambient'
  dependsOn: [
    standardDeployment
  ]
  sku: {
    name: modelSkuName
    capacity: ambientCapacity
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: ambientModel
      version: ambientModelVersion
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
  }
}

// Cognitive Services OpenAI User — lets the backend's managed identity call the data plane with a
// token (no keys). Built-in role definition id (well-known GUID). Skipped until a principal is supplied.
var openAiUserRoleId = '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'

resource openAiUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (backendPrincipalId != '') {
  name: guid(account.id, backendPrincipalId, openAiUserRoleId)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', openAiUserRoleId)
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output name string = account.name
output endpoint string = account.properties.endpoint
output principalId string = account.identity.principalId
output standardDeploymentName string = standardDeployment.name
output ambientDeploymentName string = ambientDeployment.name
