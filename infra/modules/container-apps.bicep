param name string
param location string
param containerAppsEnvironmentId string
param containerImage string
param containerRegistryServer string = ''
param managedIdentityId string
param managedIdentityPrincipalId string
param targetPort int = 8080
param minReplicas int = 1
param maxReplicas int = 5
param environmentVariables array = []
param secrets array = []
param tags object = {}

resource containerApp 'Microsoft.App/containerApps@2025-01-01' = {
  name: name
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${managedIdentityId}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironmentId
    workloadProfileName: 'Consumption'
    configuration: {
      ingress: {
        external: true
        targetPort: targetPort
        allowInsecure: false
        transport: 'http'
      }
      registries: empty(containerRegistryServer) ? [] : [
        {
          server: containerRegistryServer
          identity: managedIdentityId
        }
      ]
      secrets: secrets
    }
    template: {
      containers: [
        {
          name: name
          image: containerImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: environmentVariables
        }
      ]
      scale: {
        minReplicas: minReplicas
        maxReplicas: maxReplicas
        rules: [
          {
            name: 'http-scaling'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
    }
  }
}

output id string = containerApp.id
output fqdn string = containerApp.properties.configuration.ingress.fqdn
output managedIdentityPrincipalId string = managedIdentityPrincipalId
