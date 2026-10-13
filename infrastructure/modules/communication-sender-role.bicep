// ============================================================================
// The API's right to SEND email through Azure Communication Services (easy-login story 13) — KEYLESS.
//
// Grants the App Service's system-assigned managed identity (webapp.bicep output principalId, passed in as
// backendPrincipalId) the built-in "Communication and Email Service Owner" role on the Communication
// Service, so the API's EmailClient(endpoint, ManagedIdentityCredential) can send with no connection
// string and no access key (communication.bicep sets disableLocalAuth, so a key would not work anyway).
//
// Role choice (confirmed against Microsoft Learn, "Create credentials for SMTP authentication" →
// "Assign the built-in Communication and Email Service Owner role", the Entra-authenticated ACS Email
// path; id per the Azure Verified Modules role map): it is the narrowest BUILT-IN role that can send.
// The alternatives are broader (Contributor, Owner). A custom role holding only
// Microsoft.Communication/CommunicationServices/Read + /Write and Microsoft.Communication/EmailServices/write
// is narrower still (Learn documents it) but needs role-DEFINITION write rights; noted as a follow-up.
//
// Same pattern as storage.bicep's blobDataContributorAssignment: scoped to the one resource, a
// deterministic name (a re-run is a no-op, never a duplicate), skipped until a principal is supplied.
// It is its own module rather than part of communication.bicep only to avoid a webApp <-> communication
// module cycle (see communication.bicep's header).
// ============================================================================

@description('Name of the Communication Service (communication.bicep output acsName).')
param acsName string

@description('Object (principal) id of the API\'s system-assigned managed identity (webapp.bicep output principalId). Granted Communication and Email Service Owner on the Communication Service. Empty -> the role assignment is skipped.')
param backendPrincipalId string = ''

resource communicationService 'Microsoft.Communication/CommunicationServices@2025-05-01' existing = {
  name: acsName
}

// Communication and Email Service Owner (built-in, well-known GUID).
var communicationAndEmailServiceOwnerRoleId = '09976791-48a7-449e-bb21-39d1a415f350'

resource emailSenderAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (backendPrincipalId != '') {
  name: guid(communicationService.id, backendPrincipalId, communicationAndEmailServiceOwnerRoleId)
  scope: communicationService
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', communicationAndEmailServiceOwnerRoleId)
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output roleDefinitionId string = communicationAndEmailServiceOwnerRoleId
