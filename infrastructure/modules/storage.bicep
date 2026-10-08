// ============================================================================
// Storage account for post media (demo-polish/01, story I1) — KEYLESS.
//
// Photos, videos and video posters live in ONE private blob container. Nothing in this module
// produces or exposes an account key: shared-key auth is disabled on the account, so the only way
// into the data plane is an Entra ID token. The API's system-assigned managed identity
// (webapp.bicep output principalId, passed in as backendPrincipalId) gets Storage Blob Data
// Contributor here and uses DefaultAzureCredential to write blobs and to request a user-delegation
// key, from which it mints short-lived, read-only, single-blob SAS URLs (<img>/<video> cannot send
// an Authorization header — docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md §4 "Why read SAS"). Same keyless
// posture as modules/ai.bicep.
//
// The API reads the account by its blob service URI (Azure:BlobStorage:ServiceUri), which main.bicep
// computes as a plain local rather than reading an output of this module: this module depends on the
// webApp module (for backendPrincipalId), so the reverse edge would be a module cycle Bicep rejects —
// the same reason the ai module is wired the way it is.
// ============================================================================

@description('Azure region for the storage account.')
param location string

@description('Storage account name, e.g. stpulseuat (3-24 lowercase letters/digits, globally unique).')
param storageAccountName string

@description('Private blob container for post media. main.bicep passes the same local to webapp.bicep (Azure:BlobStorage:ContainerName), so the container and the app setting cannot drift apart.')
param postMediaContainerName string = 'post-media'

@description('Object (principal) id of the API\'s system-assigned managed identity (webapp.bicep output principalId). Granted Storage Blob Data Contributor at account scope. Empty -> the role assignment is skipped.')
param backendPrincipalId string = ''

@description('Browser origins allowed to read blobs cross-origin (GET/HEAD/OPTIONS) — the SWA origin, for video range requests and future WebVTT tracks. Empty -> no CORS rule.')
param corsAllowedOrigins array = []

param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    // No anonymous reads anywhere on the account — every container is private regardless of its own
    // publicAccess setting. Media is only readable through a SAS the API mints for in-scope media.
    allowBlobPublicAccess: false
    // KEYLESS: the data plane rejects shared-key (account-key) auth, so no connection string or
    // account-key SAS works even if one leaked. Entra ID only (managed identity / user-delegation SAS).
    allowSharedKeyAccess: false
    allowCrossTenantReplication: false
    accessTier: 'Hot'
    largeFileSharesState: 'Enabled'
  }
  tags: tags
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    cors: {
      corsRules: empty(corsAllowedOrigins) ? [] : [
        {
          allowedOrigins: corsAllowedOrigins
          // Read-only: browsers only fetch media. Uploads go through the API, never browser-to-blob.
          allowedMethods: [
            'GET'
            'HEAD'
            'OPTIONS'
          ]
          // Range is the request header a media fetch adds (video seeking / progressive download).
          allowedHeaders: [
            'Range'
          ]
          // Lets <video> (and a future <track> fetch) read length and range metadata cross-origin.
          exposedHeaders: [
            'Content-Length'
            'Content-Range'
            'Accept-Ranges'
          ]
          maxAgeInSeconds: 3600
        }
      ]
    }
  }
}

resource postMediaContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: postMediaContainerName
  properties: {
    publicAccess: 'None'
  }
}

// Storage Blob Data Contributor — lets the API's managed identity write/read/delete blobs AND request a
// user-delegation key (Microsoft.Storage/storageAccounts/blobServices/generateUserDelegationKey/action)
// to sign read SAS URLs. Assigned at STORAGE-ACCOUNT scope on purpose: generateUserDelegationKey is an
// account-level blob-service action, so a container-scoped assignment cannot request the key.
// Built-in role definition id (well-known GUID). The deterministic name makes a re-run a no-op, never a
// duplicate. Same shape as ai.bicep's openAiUserAssignment. Skipped until a principal is supplied.
var storageBlobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

resource blobDataContributorAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (backendPrincipalId != '') {
  name: guid(storageAccount.id, backendPrincipalId, storageBlobDataContributorRoleId)
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', storageBlobDataContributorRoleId)
    principalId: backendPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// No connection-string or key output: there is no usable key (allowSharedKeyAccess = false).
output id string = storageAccount.id
output name string = storageAccount.name
