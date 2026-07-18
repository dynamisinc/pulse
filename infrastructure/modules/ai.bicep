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
param standardModel string = 'gpt-5.4'
param standardModelVersion string = '2026-03-05'
@description('Standard-tier capacity (thousands of tokens/min).')
param standardCapacity int = 50

@description('Ambient tier — bulk background chatter (cheaper/faster, the volume driver).')
param ambientModel string = 'gpt-5.4-mini'
param ambientModelVersion string = '2026-03-17'
@description('Ambient-tier capacity (thousands of tokens/min).')
param ambientCapacity int = 100

// ----------------------------------------------------------------------------
// Claude on Azure AI Foundry (serverless MaaS) — the quality-preferred provider
// (E8 architecture §3.1), deployed onto the SAME AIServices account as the Azure
// OpenAI models above but served on the native Anthropic Messages API passthrough
// (https://<account>.services.ai.azure.com/anthropic/v1/messages, keyless Entra,
// token scope https://ai.azure.com/.default). Gated separately from the OpenAI
// deployments: Claude requires an accepted Azure Marketplace offer for Anthropic,
// which the RP auto-accepts from the modelProviderData attestation below, and it is
// approved per customer (NFR-005). Off by default; flip deployClaude to add the
// Claude tiers alongside the OpenAI ones for the provider comparison.
// ----------------------------------------------------------------------------

@description('Also deploy the Claude-on-Foundry model tiers (serverless MaaS) alongside the Azure OpenAI ones. Requires a Claude-eligible subscription; the Marketplace offer is auto-accepted via modelProviderData below.')
param deployClaude bool = false

@description('Claude Standard tier — storyline-critical reactions (top voice quality). Sonnet-tier. Confirm the id against the live catalog (Get-ClaudeCatalog.ps1).')
param claudeStandardModel string = 'claude-sonnet-5'
@description('Claude Standard-tier SKU. DataZoneStandard keeps data in the US data zone (residency, NFR-005) and is supported by claude-sonnet-5 / claude-opus-4-8.')
@allowed(['GlobalStandard', 'DataZoneStandard'])
param claudeStandardSku string = 'DataZoneStandard'
@description('Claude Standard-tier capacity (thousands of tokens/min).')
param claudeStandardCapacity int = 25

@description('Claude Ambient tier — bulk background chatter. Haiku-tier.')
param claudeAmbientModel string = 'claude-haiku-4-5'
@description('Claude Ambient-tier SKU. GlobalStandard is the widely available default; switch to DataZoneStandard if the ambient model supports it in the target region.')
@allowed(['GlobalStandard', 'DataZoneStandard'])
param claudeAmbientSku string = 'GlobalStandard'
@description('Claude Ambient-tier capacity (thousands of tokens/min).')
param claudeAmbientCapacity int = 50

@description('Model version for the Claude deployments. Foundry uses a generic "1" for Anthropic families (versionUpgradeOption tracks the default).')
param claudeModelVersion string = '1'

// modelProviderData — the attestation the Cognitive Services RP uses to auto-accept the Anthropic
// Marketplace offer (no manual click-through). Set these to the real org using the model.
@description('Legal organization name recorded on the Anthropic Marketplace acceptance (modelProviderData).')
param claudeOrganizationName string = 'Dynamis'
@description('Two-letter ISO country code for the Marketplace acceptance (modelProviderData).')
param claudeCountryCode string = 'US'
@description('Industry for the Marketplace acceptance (modelProviderData), e.g. government, technology. Lowercased automatically (Foundry requires lowercase).')
param claudeIndustry string = 'government'

@description('Object (principal) id of the backend managed identity to grant the data-plane role(s): "Cognitive Services OpenAI User" (OpenAI surface) and, when deployClaude is set, "Cognitive Services User" (Claude/Anthropic surface). Empty = skip the role assignment (grant your az-login identity manually for the local measured spike).')
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

// Claude Standard tier (Anthropic passthrough). Same account, native Anthropic Messages API. The
// modelProviderData attestation auto-accepts the Marketplace offer. Serialized after the OpenAI
// deployments — the control plane rejects concurrent deployment writes to one account.
resource claudeStandardDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-10-01-preview' = if (deployClaude) {
  parent: account
  name: claudeStandardModel
  dependsOn: [
    ambientDeployment
  ]
  sku: {
    name: claudeStandardSku
    capacity: claudeStandardCapacity
  }
  properties: {
    model: {
      format: 'Anthropic'
      name: claudeStandardModel
      version: claudeModelVersion
    }
    // modelProviderData is a required Anthropic-deployment property the current Bicep type index doesn't
    // yet model (BCP037); the RP accepts it and auto-accepts the Marketplace offer from it. See
    // Azure-Samples/claude + azure-rest-api-specs#43610.
    #disable-next-line BCP037
    modelProviderData: {
      organizationName: claudeOrganizationName
      countryCode: claudeCountryCode
      // Foundry requires a lowercase industry; enforce it here so a capitalised param value (e.g.
      // 'Government') can't fail the deployment.
      industry: toLower(claudeIndustry)
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
    raiPolicyName: 'Microsoft.DefaultV2'
  }
}

// Claude Ambient tier (Anthropic passthrough). Serialized after the Claude Standard deployment.
resource claudeAmbientDeployment 'Microsoft.CognitiveServices/accounts/deployments@2025-10-01-preview' = if (deployClaude) {
  parent: account
  name: claudeAmbientModel
  dependsOn: [
    claudeStandardDeployment
  ]
  sku: {
    name: claudeAmbientSku
    capacity: claudeAmbientCapacity
  }
  properties: {
    model: {
      format: 'Anthropic'
      name: claudeAmbientModel
      version: claudeModelVersion
    }
    // modelProviderData is a required Anthropic-deployment property the current Bicep type index doesn't
    // yet model (BCP037); the RP accepts it and auto-accepts the Marketplace offer from it. See
    // Azure-Samples/claude + azure-rest-api-specs#43610.
    #disable-next-line BCP037
    modelProviderData: {
      organizationName: claudeOrganizationName
      countryCode: claudeCountryCode
      // Foundry requires a lowercase industry; enforce it here so a capitalised param value (e.g.
      // 'Government') can't fail the deployment.
      industry: toLower(claudeIndustry)
    }
    versionUpgradeOption: 'OnceNewDefaultVersionAvailable'
    raiPolicyName: 'Microsoft.DefaultV2'
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

// Cognitive Services User — the least-privilege data-plane role for keyless invocation of the Claude
// (Anthropic) surface. Distinct from the OpenAI-specific role above; granted only when Claude is deployed.
var cognitiveServicesUserRoleId = 'a97b65f3-24c7-4388-baec-2e87135dc908'

resource claudeUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (deployClaude && backendPrincipalId != '') {
  name: guid(account.id, backendPrincipalId, cognitiveServicesUserRoleId)
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', cognitiveServicesUserRoleId)
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output name string = account.name
output endpoint string = account.properties.endpoint
output principalId string = account.identity.principalId
output standardDeploymentName string = standardDeployment.name
output ambientDeploymentName string = ambientDeployment.name

// Base host for the Claude/Anthropic passthrough. The backend's Generation:Endpoint is set to this; the
// ClaudeFoundryGenerationProvider appends "anthropic/v1/messages". Empty when Claude is not deployed.
output claudeEndpoint string = deployClaude ? 'https://${account.name}.services.ai.azure.com/' : ''
output claudeStandardDeploymentName string = deployClaude ? claudeStandardModel : ''
output claudeAmbientDeploymentName string = deployClaude ? claudeAmbientModel : ''
