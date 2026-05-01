targetScope = 'subscription'

metadata name = 'EasyAzure Platform Infrastructure'
metadata description = 'Deploys the EasyAzure management tool into a dedicated tooling subscription.'

@description('Short name for the environment (staging, production).')
@allowed(['staging', 'production'])
param environmentName string = 'staging'

@description('Primary Azure region for all resources.')
param location string = 'australiaeast'

@description('Microsoft Entra tenant ID.')
param tenantId string

@description('Object ID of the admin user or group for initial Key Vault access policy.')
param adminObjectId string

@description('Tags applied to all resources.')
param tags object = {
  product: 'easyazure'
  environment: environmentName
  managedBy: 'bicep'
}

var prefix = 'easyazure-${environmentName}'
var rgName = 'rg-${prefix}'

resource rg 'Microsoft.Resources/resourceGroups@2025-04-01' = {
  name: rgName
  location: location
  tags: tags
}

module logAnalytics 'modules/log-analytics.bicep' = {
  name: 'log-analytics'
  scope: rg
  params: {
    name: 'log-${prefix}'
    location: location
    tags: tags
  }
}

module appInsights 'modules/app-insights.bicep' = {
  name: 'app-insights'
  scope: rg
  params: {
    name: 'appi-${prefix}'
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
    tags: tags
  }
}

module keyVault 'modules/key-vault.bicep' = {
  name: 'key-vault'
  scope: rg
  params: {
    name: 'kv-${prefix}'
    location: location
    tenantId: tenantId
    adminObjectId: adminObjectId
    tags: tags
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  scope: rg
  params: {
    name: 'st${replace(prefix, '-', '')}001'
    location: location
    tags: tags
  }
}

module containerRegistry 'modules/container-registry.bicep' = {
  name: 'container-registry'
  scope: rg
  params: {
    name: 'cr${replace(prefix, '-', '')}001'
    location: location
    tags: tags
  }
}

module containerAppsEnv 'modules/container-apps-environment.bicep' = {
  name: 'container-apps-env'
  scope: rg
  params: {
    name: 'cae-${prefix}'
    location: location
    logAnalyticsWorkspaceId: logAnalytics.outputs.id
    tags: tags
  }
}

// Create managed identity first so we can assign AcrPull before the container app starts
module apiIdentity 'modules/managed-identity.bicep' = {
  name: 'api-managed-identity'
  scope: rg
  params: {
    name: 'id-ca-${prefix}-api'
    location: location
    tags: tags
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

module apiApp 'modules/container-apps.bicep' = {
  name: 'api-container-app'
  scope: rg
  dependsOn: [acrPull]
  params: {
    name: 'ca-${prefix}-api'
    location: location
    containerAppsEnvironmentId: containerAppsEnv.outputs.id
    containerImage: 'mcr.microsoft.com/dotnet/aspnet:8.0'
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
      { name: 'KeyVaultUri', value: keyVault.outputs.uri }
    ]
    tags: tags
  }
}

module staticWebApp 'modules/static-web-app.bicep' = {
  name: 'static-web-app'
  scope: rg
  params: {
    name: 'swa-${prefix}'
    location: 'eastasia'
    tags: tags
  }
}

output resourceGroupName string = rg.name
output apiUrl string = apiApp.outputs.fqdn
output staticWebAppUrl string = staticWebApp.outputs.defaultHostname
output keyVaultUri string = keyVault.outputs.uri
output containerRegistryLoginServer string = containerRegistry.outputs.loginServer
