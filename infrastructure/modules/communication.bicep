param acsName string
param emailServiceName string
param dataLocation string = 'United States'
param emailCustomDomain string = ''
param tags object = {}

resource communicationService 'Microsoft.Communication/CommunicationServices@2023-04-01' = {
  name: acsName
  location: 'global'
  properties: {
    dataLocation: dataLocation
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
  }
}

resource emailCustomDomainResource 'Microsoft.Communication/EmailServices/Domains@2023-04-01' = if (emailCustomDomain != '') {
  parent: emailService
  name: emailCustomDomain
  location: 'global'
  properties: {
    domainManagement: 'CustomerManaged'
  }
}

output acsName string = communicationService.name
output acsHostName string = communicationService.properties.hostName
output emailServiceName string = emailService.name
output managedDomainSenderAddress string = 'DoNotReply@${emailManagedDomain.properties.fromSenderDomain}'
