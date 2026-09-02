param name string
param location string
@allowed(['Enabled', 'Disabled'])
param publicNetworkAccess string = 'Enabled'
@allowed(['Allow', 'Deny'])
param networkDefaultAction string = 'Allow'
param tags object = {}

resource storageAccount 'Microsoft.Storage/storageAccounts@2025-01-01' = {
  name: name
  location: location
  kind: 'StorageV2'
  tags: tags
  sku: {
    name: 'Standard_ZRS'
  }
  properties: {
    accessTier: 'Hot'
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    // The default azd deployment is intentionally VNet-free. Access remains authenticated
    // with Entra ID because shared keys and anonymous blob access are disabled.
    publicNetworkAccess: publicNetworkAccess
    networkAcls: {
      bypass: 'AzureServices'
      defaultAction: networkDefaultAction
    }
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2025-01-01' = {
  parent: storageAccount
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 30
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 30
    }
  }
}

resource iacContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'generated-iac'
  properties: {
    publicAccess: 'None'
  }
}

resource exportsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2025-01-01' = {
  parent: blobService
  name: 'exports'
  properties: {
    publicAccess: 'None'
  }
}

output id string = storageAccount.id
output name string = storageAccount.name
output blobEndpoint string = storageAccount.properties.primaryEndpoints.blob
