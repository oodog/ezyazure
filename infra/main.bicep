targetScope = 'subscription'

metadata name = 'EasyAzure Platform Infrastructure'
metadata description = 'Deploys the EasyAzure management tool into a dedicated tooling subscription.'

@description('Short azd environment name used for resource names and tags.')
@minLength(2)
@maxLength(24)
param environmentName string = 'staging'

@description('Primary Azure region for all resources.')
param location string = 'australiaeast'

@description('Microsoft Entra tenant ID.')
param tenantId string

@description('Microsoft Entra application client ID used by the EasyAzure SPA and API.')
param apiClientId string

@description('Initial API image. azd replaces the default bootstrap image with a source-built ACR image during deploy.')
param apiContainerImage string = 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'

@description('Azure OpenAI endpoint used for optional AI validation and multimodal design import. Leave empty to deploy deterministic features only.')
param azureOpenAIEndpoint string = ''

@description('Optional full resource ID of the existing Azure OpenAI account. When set, the API identity receives Cognitive Services OpenAI User.')
param azureOpenAIResourceId string = ''

@description('Vision-capable Azure OpenAI deployment used for design analysis.')
param azureOpenAIDeploymentName string = 'gpt-4o-mini'

@description('Optional stronger vision deployment used only for design import (for example gpt-4.1 or gpt-5). Empty uses azureOpenAIDeploymentName.')
param azureOpenAIDesignImportDeploymentName string = ''

@description('Whether the design import deployment is a reasoning model (true/false). Empty infers it from the deployment name.')
@allowed(['', 'true', 'false'])
param azureOpenAIDesignImportReasoningModel string = ''

@description('Azure OpenAI inference API version.')
param azureOpenAIApiVersion string = '2024-10-21'

@description('Storage public network access. The VNet-free API reaches Blob Storage through this endpoint using managed identity.')
@allowed(['Enabled', 'Disabled'])
param storagePublicNetworkAccess string = 'Enabled'

@description('Storage firewall default action. Access remains Entra authenticated because shared keys and anonymous blob access are disabled.')
@allowed(['Allow', 'Deny'])
param storageNetworkDefaultAction string = 'Allow'

@description('Static Web App SKU. Existing staging uses Standard; new self-hosted environments default to Free.')
@allowed(['Free', 'Standard'])
param staticWebAppSkuName string = environmentName == 'staging' ? 'Standard' : 'Free'

@description('Optional GitHub repository already linked to the Static Web App.')
param staticWebAppRepositoryUrl string = environmentName == 'staging' ? 'https://github.com/oodog/ezyazure' : ''

@description('Branch associated with the linked Static Web App repository.')
param staticWebAppRepositoryBranch string = 'main'

@description('Cost-center tag applied to deployed resources.')
param costCenter string = 'platform'

@description('Optional existing subscription Reader role-assignment resource name to adopt.')
param discoveryReaderRoleAssignmentName string = ''

@description('Optional existing Storage Blob Data Contributor role-assignment resource name to adopt.')
param storageBlobRoleAssignmentName string = ''

@description('Optional existing Cognitive Services OpenAI User role-assignment resource name to adopt.')
param openAIUserRoleAssignmentName string = ''

@description('Object ID of the admin user or group for initial Key Vault access policy.')
param adminObjectId string

@description('Microsoft Entra principal type for the initial Key Vault administrator.')
@allowed(['User', 'Group', 'ServicePrincipal'])
param adminPrincipalType string = 'User'

@description('Tags applied to all resources.')
param tags object = {
  product: 'easyazure'
  environment: environmentName
  managedBy: 'bicep'
  costCenter: costCenter
}

var resourceToken = uniqueString(subscription().id, environmentName)
var safeEnvironmentName = take(toLower(environmentName), 16)
var prefix = 'easyazure-${safeEnvironmentName}'
var rgName = 'rg-${prefix}'
var apiIdentityName = 'id-ca-${prefix}-api'
var isExistingStaging = environmentName == 'staging'
var keyVaultName = isExistingStaging ? 'kv-easyazure-staging' : 'kv-ezy-${resourceToken}'
var storageAccountName = isExistingStaging ? 'steasyazurestaging001' : 'stezy${resourceToken}'
var containerRegistryName = isExistingStaging ? 'creasyazurestaging001' : 'crezy${resourceToken}'
var azureOpenAIResourceIdParts = split(azureOpenAIResourceId, '/')
var azureOpenAISubscriptionId = empty(azureOpenAIResourceId) ? subscription().subscriptionId : azureOpenAIResourceIdParts[2]
var azureOpenAIResourceGroupName = empty(azureOpenAIResourceId) ? rgName : azureOpenAIResourceIdParts[4]
var azureOpenAIAccountName = empty(azureOpenAIResourceId) ? '' : azureOpenAIResourceIdParts[8]
var baseTags = union(tags, {
  'azd-env-name': environmentName
})

resource rg 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: rgName
  location: location
  tags: baseTags
}

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'log-analytics'
  scope: rg
  params: {
    name: 'log-${prefix}'
    location: location
    tags: baseTags
  }
}

module appInsights 'modules/app-insights.bicep' = {
  name: 'app-insights'
  scope: rg
  params: {
    name: 'appi-${prefix}'
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
    tags: baseTags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'key-vault'
  scope: rg
  params: {
    name: keyVaultName
    location: location
    tenantId: tenantId
    adminObjectId: adminObjectId
    adminPrincipalType: adminPrincipalType
    tags: baseTags
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    name: storageAccountName
    location: location
    publicNetworkAccess: storagePublicNetworkAccess
    networkDefaultAction: storageNetworkDefaultAction
    tags: baseTags
  }
}

module containerRegistry 'modules/container-registry.bicep' = {
  name: 'container-registry'
  scope: rg
  params: {
    name: containerRegistryName
    location: location
    tags: baseTags
  }
}

module containerAppsEnv 'modules/container-apps-environment.bicep' = {
  name: 'container-apps-env'
  scope: rg
  params: {
    name: 'cae-${prefix}'
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
    tags: baseTags
  }
}

// Create managed identity first so we can assign AcrPull before the container app starts
module apiIdentity 'modules/managed-identity.bicep' = {
  name: 'api-managed-identity'
  scope: rg
  params: {
    name: apiIdentityName
    location: location
    tags: baseTags
  }
}

// Grant AcrPull to the managed identity so the container app can pull images
module acrPull 'modules/acr-pull-assignment.bicep' = {
  name: 'acr-pull-assignment'
  scope: rg
  params: {
    registryName: containerRegistry.outputs.name
    principalId: apiIdentity.outputs.principalId
  }
}

// Discovery uses Azure Resource Graph and ARM reads across the selected subscription.
// Reader is sufficient; mutation is performed separately with the signed-in user's token.
resource discoveryReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: empty(discoveryReaderRoleAssignmentName)
    ? guid(subscription().id, apiIdentityName, 'EasyAzure discovery Reader')
    : discoveryReaderRoleAssignmentName
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      'acdd72a7-3385-48ef-bd42-f606fba81ae7' // Reader
    )
    principalId: apiIdentity.outputs.principalId
    principalType: 'ServicePrincipal'
  }
}

module snapshotStorageAccess 'modules/storage-blob-role-assignment.bicep' = {
  name: 'snapshot-storage-access'
  scope: rg
  params: {
    storageAccountName: storage.outputs.name
    principalId: apiIdentity.outputs.principalId
    principalName: apiIdentityName
    roleAssignmentName: storageBlobRoleAssignmentName
  }
}

module azureOpenAIAccess 'modules/openai-role-assignment.bicep' = if (!empty(azureOpenAIResourceId)) {
  name: 'azure-openai-access'
  scope: resourceGroup(azureOpenAISubscriptionId, azureOpenAIResourceGroupName)
  params: {
    accountName: azureOpenAIAccountName
    principalId: apiIdentity.outputs.principalId
    principalName: apiIdentityName
    roleAssignmentName: openAIUserRoleAssignmentName
  }
}

module apiApp 'modules/container-apps.bicep' = {
  name: 'api-container-app'
  scope: rg
  dependsOn: [acrPull]
  params: {
    name: 'ca-${prefix}-api'
    location: location
    containerAppsEnvironmentId: containerAppsEnv.outputs.id
    containerImage: apiContainerImage
    containerRegistryServer: containerRegistry.outputs.loginServer
    managedIdentityId: apiIdentity.outputs.id
    managedIdentityPrincipalId: apiIdentity.outputs.principalId
    targetPort: 8080
    minReplicas: 1
    maxReplicas: 10
    secrets: [
      { name: 'appinsights-connection-string', value: appInsights.outputs.connectionString }
    ]
    environmentVariables: [
      { name: 'ASPNETCORE_ENVIRONMENT', value: environmentName == 'production' ? 'Production' : 'Staging' }
      { name: 'ApplicationInsights__ConnectionString', secretRef: 'appinsights-connection-string' }
      { name: 'AZURE_CLIENT_ID', value: apiIdentity.outputs.clientId }
      { name: 'KeyVaultUri', value: keyVault.outputs.uri }
      { name: 'Storage__BlobEndpoint', value: storage.outputs.blobEndpoint }
      { name: 'AzureAd__TenantId', value: tenantId }
      { name: 'AzureAd__ClientId', value: apiClientId }
      { name: 'AzureAd__Audience', value: apiClientId }
      { name: 'AllowedOrigins__0', value: 'https://${staticWebApp.outputs.defaultHostname}' }
      { name: 'AzureOpenAI__Endpoint', value: azureOpenAIEndpoint }
      { name: 'AzureOpenAI__DeploymentName', value: azureOpenAIDeploymentName }
      { name: 'AzureOpenAI__ApiVersion', value: azureOpenAIApiVersion }
      { name: 'AzureOpenAI__DesignImportDeploymentName', value: azureOpenAIDesignImportDeploymentName }
      { name: 'AzureOpenAI__DesignImportReasoningModel', value: azureOpenAIDesignImportReasoningModel }
    ]
    tags: union(baseTags, {
      'azd-service-name': 'api'
    })
  }
}

module staticWebApp 'modules/static-web-app.bicep' = {
  name: 'static-web-app'
  scope: rg
  params: {
    name: 'swa-${prefix}'
    location: 'eastasia'
    skuName: staticWebAppSkuName
    repositoryUrl: staticWebAppRepositoryUrl
    repositoryBranch: staticWebAppRepositoryBranch
    tags: union(baseTags, {
      'azd-service-name': 'web'
    })
  }
}

// azd captures Bicep outputs as environment values used by packaging and deployment.
output AZURE_RESOURCE_GROUP string = rg.name
output AZURE_CONTAINER_REGISTRY_NAME string = containerRegistry.outputs.name
output AZURE_CONTAINER_REGISTRY_ENDPOINT string = containerRegistry.outputs.loginServer
output SERVICE_API_NAME string = apiApp.outputs.name
output SERVICE_API_ENDPOINT_URL string = 'https://${apiApp.outputs.fqdn}'
output SERVICE_WEB_NAME string = staticWebApp.outputs.name
output SERVICE_WEB_ENDPOINT_URL string = 'https://${staticWebApp.outputs.defaultHostname}'
output VITE_API_BASE_URL string = 'https://${apiApp.outputs.fqdn}/api'
output VITE_AZURE_CLIENT_ID string = apiClientId
output VITE_AZURE_TENANT_ID string = tenantId
output EASYAZURE_API_IDENTITY_PRINCIPAL_ID string = apiIdentity.outputs.principalId
output EASYAZURE_KEY_VAULT_URI string = keyVault.outputs.uri
