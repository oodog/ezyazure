param name string
param location string
param tags object = {}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: name
  location: location
  tags: tags
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 90
    features: { enableLogAccessUsingOnlyResourcePermissions: true }
  }
}

output id string = logAnalytics.id
output name string = logAnalytics.name
