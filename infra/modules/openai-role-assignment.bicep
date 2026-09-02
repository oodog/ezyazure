param accountName string
param principalId string
param principalName string
param roleAssignmentName string = ''

resource account 'Microsoft.CognitiveServices/accounts@2025-06-01' existing = {
  name: accountName
}

resource openAIUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: empty(roleAssignmentName)
    ? guid(account.id, principalName, 'Cognitive Services OpenAI User')
    : roleAssignmentName
  scope: account
  properties: {
    roleDefinitionId: subscriptionResourceId(
      'Microsoft.Authorization/roleDefinitions',
      '5e0bd9bd-7b93-4f28-af87-19fc36ad61bd'
    )
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}