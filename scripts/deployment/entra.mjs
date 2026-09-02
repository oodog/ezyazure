import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const GRAPH = 'https://graph.microsoft.com/v1.0'
const GRAPH_APP_ID = '00000003-0000-0000-c000-000000000000'
const USER_READ_SCOPE_ID = 'e1fe6dd8-ba31-4d61-89e7-88639da4683d'
const configureRedirectOnly = process.argv.includes('--configure-redirect')

function run(command, args, { allowFailure = false, inherit = false } = {}) {
  const resolved = resolveCommand(command, args)
  const result = spawnSync(resolved.command, resolved.args, {
    encoding: 'utf8',
    shell: false,
    stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  })
  if (result.error) {
    throw new Error(`${command} could not be started: ${result.error.message}`)
  }
  if (result.status !== 0 && !allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim()
    throw new Error(`${command} ${args[0] ?? ''} failed${detail ? `: ${detail}` : ''}`)
  }
  return result
}

function output(command, args, options) {
  return run(command, args, options).stdout.trim()
}

function json(command, args, options) {
  const value = output(command, args, options)
  return value ? JSON.parse(value) : null
}

function azdValue(name) {
  const result = run('azd', ['env', 'get-value', name], { allowFailure: true })
  return result.status === 0 ? result.stdout.trim() : ''
}

function setAzdValue(name, value) {
  run('azd', ['env', 'set', name, value])
}

function graphRequest(method, path, body) {
  const args = ['rest', '--method', method, '--url', `${GRAPH}${path}`, '--output', 'json']
  if (body !== undefined) {
    args.push('--headers', 'Content-Type=application/json', '--body', JSON.stringify(body))
  }
  return json('az', args)
}

function role(value, displayName, description, existingRoles) {
  const existing = existingRoles.find((candidate) => candidate.value === value)
  return {
    allowedMemberTypes: ['User'],
    description,
    displayName,
    id: existing?.id ?? randomUUID(),
    isEnabled: true,
    value,
  }
}

function ensureAzureCliSession() {
  const account = run('az', ['account', 'show', '--output', 'json'], { allowFailure: true })
  if (account.status !== 0) {
    console.log('Azure CLI sign-in is required for Entra application setup.')
    run('az', ['login'], { inherit: true })
  }
  const subscriptionId = process.env.AZURE_SUBSCRIPTION_ID || azdValue('AZURE_SUBSCRIPTION_ID')
  if (subscriptionId) run('az', ['account', 'set', '--subscription', subscriptionId])
  return json('az', ['account', 'show', '--output', 'json'])
}

function getApplication() {
  const configuredClientId = process.env.EASYAZURE_CLIENT_ID || azdValue('EASYAZURE_CLIENT_ID')
  if (configuredClientId) {
    const result = run('az', ['ad', 'app', 'show', '--id', configuredClientId, '--output', 'json'], { allowFailure: true })
    if (result.status === 0) return JSON.parse(result.stdout)
  }

  const environmentName = process.env.AZURE_ENV_NAME || azdValue('AZURE_ENV_NAME') || 'dev'
  const displayName = `EasyAzure-${environmentName}`
  const matches = json('az', ['ad', 'app', 'list', '--display-name', displayName, '--output', 'json']) ?? []
  if (matches.length > 0) return matches[0]

  console.log(`Creating Microsoft Entra application ${displayName}...`)
  return json('az', [
    'ad', 'app', 'create',
    '--display-name', displayName,
    '--sign-in-audience', 'AzureADMyOrg',
    '--output', 'json',
  ])
}

function configureApplication(application) {
  const detail = graphRequest('GET', `/applications/${application.id}`)
  const existingRoles = detail.appRoles ?? []
  const existingScopes = detail.api?.oauth2PermissionScopes ?? []
  const accessScope = existingScopes.find((scope) => scope.value === 'access_as_user') ?? {
    id: randomUUID(),
  }
  const appRoles = [
    role('Reader', 'Reader', 'View discoveries, topology, data paths, and reviews.', existingRoles),
    role('Designer', 'Designer', 'Create and validate designs and generated infrastructure.', existingRoles),
    role('Reviewer', 'Reviewer', 'Review discovered environments and best-practice findings.', existingRoles),
    role('Operator', 'Operator', 'Preview and run approved infrastructure deployments.', existingRoles),
    role('Admin', 'Administrator', 'Administer all EasyAzure capabilities.', existingRoles),
  ]
  const localRedirects = ['http://localhost:3000', 'http://localhost:4173']
  const existingRedirects = detail.spa?.redirectUris ?? []

  graphRequest('PATCH', `/applications/${application.id}`, {
    appRoles,
    identifierUris: [`api://${application.appId}`],
    api: {
      requestedAccessTokenVersion: 2,
      oauth2PermissionScopes: [{
        adminConsentDescription: 'Allow EasyAzure to access its API as the signed-in user.',
        adminConsentDisplayName: 'Access EasyAzure API',
        id: accessScope.id,
        isEnabled: true,
        type: 'User',
        userConsentDescription: 'Allow EasyAzure to access its API on your behalf.',
        userConsentDisplayName: 'Access EasyAzure API',
        value: 'access_as_user',
      }],
    },
    requiredResourceAccess: [
      {
        resourceAppId: GRAPH_APP_ID,
        resourceAccess: [{ id: USER_READ_SCOPE_ID, type: 'Scope' }],
      },
    ],
    spa: {
      redirectUris: [...new Set([...existingRedirects, ...localRedirects])],
    },
  })

  return { appRoles, accessScope }
}

function ensureServicePrincipalAndAdmin(application, appRoles, userObjectId) {
  let servicePrincipal = run('az', ['ad', 'sp', 'show', '--id', application.appId, '--output', 'json'], { allowFailure: true })
  if (servicePrincipal.status !== 0) {
    servicePrincipal = run('az', ['ad', 'sp', 'create', '--id', application.appId, '--output', 'json'])
  }
  const servicePrincipalValue = JSON.parse(servicePrincipal.stdout)
  const assignments = graphRequest('GET', `/servicePrincipals/${servicePrincipalValue.id}/appRoleAssignedTo`)?.value ?? []
  const adminRole = appRoles.find((candidate) => candidate.value === 'Admin')
  const alreadyAssigned = assignments.some((assignment) =>
    assignment.resourceId === servicePrincipalValue.id && assignment.appRoleId === adminRole.id)
  if (!alreadyAssigned) {
    console.log('Assigning the deploying user the EasyAzure Administrator role...')
    graphRequest('POST', `/servicePrincipals/${servicePrincipalValue.id}/appRoleAssignedTo`, {
      principalId: userObjectId,
      resourceId: servicePrincipalValue.id,
      appRoleId: adminRole.id,
    })
  }
}

function configureRedirect() {
  ensureAzureCliSession()
  const application = getApplication()
  const webEndpoint = process.env.SERVICE_WEB_ENDPOINT_URL || azdValue('SERVICE_WEB_ENDPOINT_URL')
  if (!webEndpoint) {
    console.log('Static Web App endpoint is not available during preview; redirect URI configuration is deferred.')
    return
  }
  const detail = graphRequest('GET', `/applications/${application.id}`)
  const redirectUris = [...new Set([
    ...(detail.spa?.redirectUris ?? []),
    webEndpoint.replace(/\/$/, ''),
  ])]
  graphRequest('PATCH', `/applications/${application.id}`, { spa: { redirectUris } })
  console.log(`Configured Entra redirect URI: ${webEndpoint}`)
}

function setup() {
  const account = ensureAzureCliSession()
  const tenantId = account.tenantId
  const signedInUser = json('az', ['ad', 'signed-in-user', 'show', '--output', 'json'])
  if (!signedInUser?.id) {
    throw new Error('One-command setup requires an interactive Entra user. Service-principal deployments must provide a preconfigured EASYAZURE_CLIENT_ID.')
  }
  const application = getApplication()
  run('az', ['ad', 'app', 'owner', 'add', '--id', application.appId, '--owner-object-id', signedInUser.id], { allowFailure: true })
  const { appRoles } = configureApplication(application)
  ensureServicePrincipalAndAdmin(application, appRoles, signedInUser.id)

  setAzdValue('AZURE_TENANT_ID', tenantId)
  setAzdValue('EASYAZURE_CLIENT_ID', application.appId)
  setAzdValue('EASYAZURE_ADMIN_OBJECT_ID', signedInUser.id)
  setAzdValue('EASYAZURE_ADMIN_PRINCIPAL_TYPE', 'User')
  if (!azdValue('AZURE_OPENAI_ENDPOINT')) setAzdValue('AZURE_OPENAI_ENDPOINT', '')
  if (!azdValue('AZURE_OPENAI_RESOURCE_ID')) {
    const endpoint = azdValue('AZURE_OPENAI_ENDPOINT')
    let resourceId = ''
    if (endpoint) {
      try {
        const accountName = new URL(endpoint).hostname.split('.')[0]
        resourceId = output('az', [
          'cognitiveservices', 'account', 'list',
          '--query', `[?name=='${accountName}'].id | [0]`,
          '--output', 'tsv',
        ], { allowFailure: true })
      } catch {
        console.log('Azure OpenAI endpoint could not be mapped to a resource ID; configure AZURE_OPENAI_RESOURCE_ID to automate RBAC.')
      }
    }
    setAzdValue('AZURE_OPENAI_RESOURCE_ID', resourceId)
  }
  if (!azdValue('AZURE_OPENAI_DEPLOYMENT_NAME')) setAzdValue('AZURE_OPENAI_DEPLOYMENT_NAME', 'gpt-4o-mini')
  if (!azdValue('EASYAZURE_DISCOVERY_READER_ROLE_ASSIGNMENT_NAME')) setAzdValue('EASYAZURE_DISCOVERY_READER_ROLE_ASSIGNMENT_NAME', '')
  if (!azdValue('EASYAZURE_STORAGE_BLOB_ROLE_ASSIGNMENT_NAME')) setAzdValue('EASYAZURE_STORAGE_BLOB_ROLE_ASSIGNMENT_NAME', '')
  if (!azdValue('EASYAZURE_OPENAI_USER_ROLE_ASSIGNMENT_NAME')) setAzdValue('EASYAZURE_OPENAI_USER_ROLE_ASSIGNMENT_NAME', '')
  console.log(`Microsoft Entra application ready: ${application.displayName} (${application.appId})`)
}

try {
  if (configureRedirectOnly) configureRedirect()
  else setup()
} catch (error) {
  console.error(`EasyAzure Entra setup failed: ${error instanceof Error ? error.message : String(error)}`)
  console.error('The deploying user needs permission to create app registrations, service principals, app roles, and role assignments in Microsoft Entra ID.')
  process.exit(1)
}

function resolveCommand(command, args) {
  if (process.platform !== 'win32') return { command, args }
  if (command === 'azd') {
    const candidates = [
      process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Azure Dev CLI', 'azd.exe'),
      process.env.ProgramFiles && join(process.env.ProgramFiles, 'Azure Dev CLI', 'azd.exe'),
    ].filter(Boolean)
    return { command: candidates.find(existsSync) ?? 'azd', args }
  }
  if (command !== 'az') return { command, args }
  const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)
  const python = roots
    .map((root) => join(root, 'Microsoft SDKs', 'Azure', 'CLI2', 'python.exe'))
    .find(existsSync)
  return python
    ? { command: python, args: ['-IBm', 'azure.cli', ...args] }
    : { command: 'az', args }
}