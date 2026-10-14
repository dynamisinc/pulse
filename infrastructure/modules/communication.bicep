// ============================================================================
// Azure Communication Services + Email (easy-login story 13) — KEYLESS.
//
// The API emails each participant their personal sign-in link through ACS Email. Nothing in this module
// produces or exposes a key: local (access-key) auth is DISABLED on the Communication Service, so the
// data plane accepts only Entra ID tokens, and there is no connection-string output. The API reaches it
// as https://{hostName} (Email__Endpoint) with the App Service's system-assigned managed identity.
//
// The identity's grant ("Communication and Email Service Owner") lives in the SIBLING module
// communication-sender-role.bicep, not here, for one reason: webapp.bicep needs THIS module's outputs
// (the endpoint and the Azure-managed sender, whose domain is a service-generated GUID and so cannot be a
// main.bicep local the way the storage URI is), while the grant needs webapp.bicep's principalId. A grant
// in this module would make webApp <-> communication a module cycle, which Bicep rejects. The role module
// keeps the storage.bicep pattern exactly (backendPrincipalId param, deterministic guid name, skipped when
// empty) and depends on both.
//
// Sender: the Azure-managed domain's DoNotReply@<guid>.azurecomm.net (UAT). A customer-managed domain is
// supported (emailCustomDomain) but out of scope for story 13; it needs DNS verification before linking.
// No sender display name ("Pulse") is set: Microsoft Learn ("How to add multiple sender addresses") states that
// sender usernames (Microsoft.Communication/emailServices/domains/senderUsernames, which carry displayName)
// "cannot be enabled for Azure Managed Domains", and that managed-domain sender usernames can't be personalized.
// On a verified custom domain with raised limits, a senderUsernames child (username 'DoNotReply',
// displayName 'Pulse') would do it.
// ============================================================================

param acsName string
param emailServiceName string
param dataLocation string = 'United States'
param emailCustomDomain string = ''
param tags object = {}

// 2025-05-01 for disableLocalAuth (the 2023-04-01 shape has no such property).
resource communicationService 'Microsoft.Communication/CommunicationServices@2025-05-01' = {
  name: acsName
  location: 'global'
  properties: {
    dataLocation: dataLocation
    // KEYLESS: access keys and connection strings are rejected by the data plane. Entra ID only.
    disableLocalAuth: true
    linkedDomains: [
      emailManagedDomain.id
      ...(emailCustomDomain != '' ? [emailCustomDomainResource.id] : [])
    ]
  }
  tags: tags
}

resource emailService 'Microsoft.Communication/EmailServices@2023-04-01' = {
  name: emailServiceName
  location: 'global'
  properties: {
    dataLocation: dataLocation
  }
  tags: tags
}

resource emailManagedDomain 'Microsoft.Communication/EmailServices/Domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: {
    domainManagement: 'AzureManaged'
    // No open/click tracking at the domain level either (the API also disables it per message).
    userEngagementTracking: 'Disabled'
  }
}

resource emailCustomDomainResource 'Microsoft.Communication/EmailServices/Domains@2023-04-01' = if (emailCustomDomain != '') {
  parent: emailService
  name: emailCustomDomain
  location: 'global'
  properties: {
    domainManagement: 'CustomerManaged'
    userEngagementTracking: 'Disabled'
  }
}

// No connection-string or key output: there is no usable key (disableLocalAuth = true).
output acsName string = communicationService.name
output acsHostName string = communicationService.properties.hostName
// Email__Endpoint: the data-plane endpoint the API's EmailClient(endpoint, tokenCredential) targets.
output emailEndpoint string = 'https://${communicationService.properties.hostName}'
output emailServiceName string = emailService.name
output managedDomainSenderAddress string = 'DoNotReply@${emailManagedDomain.properties.fromSenderDomain}'
