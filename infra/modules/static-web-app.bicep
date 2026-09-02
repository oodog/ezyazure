param name string
param location string
@allowed(['Free', 'Standard'])
param skuName string = 'Free'
param repositoryUrl string = ''
param repositoryBranch string = 'main'
param tags object = {}

var repositoryProperties = empty(repositoryUrl) ? {} : {
  branch: repositoryBranch
  deploymentAuthPolicy: 'DeploymentToken'
  provider: 'GitHub'
  repositoryUrl: repositoryUrl
}

resource staticWebApp 'Microsoft.Web/staticSites@2024-11-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: skuName
    tier: skuName
  }
  properties: union({
    allowConfigFileUpdates: true
    enterpriseGradeCdnStatus: 'Disabled'
  }, repositoryProperties)
}

output id string = staticWebApp.id
output name string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
