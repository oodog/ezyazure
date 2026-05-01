param name string
param location string
param logAnalyticsWorkspaceId string
param tags object = {}

resource containerAppsEnv 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: reference(logAnalyticsWorkspaceId, '2025-02-01').customerId
        sharedKey: listKeys(logAnalyticsWorkspaceId, '2025-02-01').primarySharedKey
      }
    }
    workloadProfiles: [
      {
        name: 'Consumption'
        workloadProfileType: 'Consumption'
      }
    ]
  }
}

output id string = containerAppsEnv.id
output name string = containerAppsEnv.name
output defaultDomain string = containerAppsEnv.properties.defaultDomain
