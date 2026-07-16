// Microsoft Defender for Cloud - Free Tier (Foundational CSPM)
// Provides: Security recommendations, Secure Score, Azure Security Benchmark assessment
// Cost: $0/month (free tier)
//
// DEPLOYMENT NOTE: This module targets subscription scope. Deploy separately from
// the resource-group-scoped main.bicep using:
//   az deployment sub create --location <location> --template-file modules/defender.bicep

targetScope = 'subscription'

param logAnalyticsWorkspaceId string
param securityContactEmail string = ''

// Enable Defender for Cloud free tier (Cloud Security Posture Management)
resource defenderCspm 'Microsoft.Security/pricings@2024-01-01' = {
  name: 'CloudPosture'
  properties: {
    pricingTier: 'Free'
  }
}

// Security contact for alert notifications
resource securityContact 'Microsoft.Security/securityContacts@2020-01-01-preview' = {
  name: 'default'
  properties: {
    emails: securityContactEmail
    notificationsByRole: {
      state: 'On'
      roles: ['Owner', 'Contributor']
    }
    alertNotifications: {
      state: securityContactEmail != '' ? 'On' : 'Off'
      minimalSeverity: 'High'
    }
  }
}

// Configure Defender to send findings to Log Analytics workspace
resource workspaceSetting 'Microsoft.Security/workspaceSettings@2017-08-01-preview' = {
  name: 'default'
  properties: {
    workspaceId: logAnalyticsWorkspaceId
    scope: subscription().id
  }
}
