// Generates Bicep IaC from the designer canvas state.
import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from '@/utils/designEdges'
import { analyzeDesignDelta } from '@/utils/designDelta'

type DesignNode = Node<DesignBlock>

function safeName(label: string): string {
  return label.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_+|_+$/g, '') || 'resource'
}

/** Sanitize a display name into a valid Azure resource name (no spaces, valid chars only). */
function safeResourceName(label: string): string {
  return label.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '').replace(/^[^a-zA-Z0-9]/, '').replace(/[^a-zA-Z0-9_]$/, '') || 'resource'
}

function prop(n: DesignNode, k: string): unknown {
  return n.data?.properties?.[k]
}

function strProp(n: DesignNode, k: string): string {
  const v = prop(n, k)
  return typeof v === 'string' ? v : ''
}


function genVNet(n: DesignNode, subnets: DesignNode[]): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  const space = (prop(n, 'addressSpace') as string[] | undefined) ?? []
  const cidr = space.length > 0 ? space : ['10.0.0.0/16']

  let subnetBlock = ''
  if (subnets.length > 0) {
    const subs = subnets
      .map((s) => {
        const sName = safeResourceName(strProp(s, 'resourceName') || s.data.label)
        const prefix = strProp(s, 'addressPrefix') || '10.0.0.0/24'
        const delegation = strProp(s, 'delegation')
        const delegationBlock = delegation && delegation !== 'None' && delegation !== 'none'
          ? `\n        delegations: [\n          {\n            name: '${delegation}'\n            properties: {\n              serviceName: '${delegation}'\n            }\n          }\n        ]`
          : ''
        return `      {\n        name: '${sName}'\n        properties: {\n          addressPrefix: '${prefix}'${delegationBlock}\n        }\n      }`
      })
      .join('\n')
    subnetBlock = `\n    subnets: [\n${subs}\n    ]`
  }

  return `resource ${name} 'Microsoft.Network/virtualNetworks@2024-01-01' = {
  name: '${rName}'
  location: location
  properties: {
    addressSpace: {
      addressPrefixes: [
${cidr.map((c) => `        '${c}'`).join('\n')}
      ]
    }${subnetBlock}
  }
}\n`
}

function genNsg(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name} 'Microsoft.Network/networkSecurityGroups@2024-01-01' = {
  name: '${rName}'
  location: location
  properties: {
    securityRules: []
  }
}\n`
}

function genRouteTable(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name} 'Microsoft.Network/routeTables@2024-01-01' = {
  name: '${rName}'
  location: location
  properties: {
    routes: []
  }
}\n`
}

function genStorageAccount(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label).toLowerCase()
  const kind = strProp(n, 'kind') || 'StorageV2'
  const sku = strProp(n, 'skuName') || 'Standard_LRS'
  return `resource ${name} 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: '${rName}'
  location: location
  kind: '${kind}'
  sku: {
    name: '${sku}'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
  }
}\n`
}

function genKeyVault(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  const sku = strProp(n, 'skuName') || 'standard'
  return `resource ${name} 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${rName}'
  location: location
  properties: {
    sku: {
      family: 'A'
      name: '${sku}'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
  }
}\n`
}

function genSqlDatabase(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name}_server 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: '${rName}-server'
  location: location
  properties: {
    administratorLogin: 'sqladmin'
    minimalTlsVersion: '1.2'
  }
}

resource ${name} 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: ${name}_server
  name: '${rName}'
  location: location
  sku: {
    name: 'GP_S_Gen5_1'
    tier: 'GeneralPurpose'
  }
}\n`
}

function genPostgres(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name} 'Microsoft.DBforPostgreSQL/flexibleServers@2024-08-01' = {
  name: '${rName}'
  location: location
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: 'pgadmin'
    storage: {
      storageSizeGB: 32
    }
  }
}\n`
}

function genCosmosDb(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name} 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: '${rName}'
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    locations: [
      {
        locationName: location
        failoverPriority: 0
      }
    ]
    consistencyPolicy: {
      defaultConsistencyLevel: 'Session'
    }
  }
}\n`
}

function genVm(n: DesignNode, parentSubnetName?: string, parentVNetName?: string, parentSubnetIdExpression?: string): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  const vmSize = strProp(n, 'vmSize') || 'Standard_B2s'
  const osImage = strProp(n, 'osImage') || 'Canonical:ubuntu-24_04-lts:server:latest'
  const [publisher, offer, sku, version] = osImage.split(':')

  // Build subnet reference for the NIC
  let subnetProp = ''
  if (parentSubnetIdExpression) {
    subnetProp = `\n          subnet: {\n            id: ${parentSubnetIdExpression}\n          }`
  } else if (parentSubnetName && parentVNetName) {
    subnetProp = `\n          subnet: {\n            id: resourceId('Microsoft.Network/virtualNetworks/subnets', '${safeResourceName(parentVNetName)}', '${safeResourceName(parentSubnetName)}')\n          }`
  }

  return `resource ${name}_nic 'Microsoft.Network/networkInterfaces@2024-01-01' = {
  name: '${rName}-nic'
  location: location
  properties: {
    ipConfigurations: [
      {
        name: 'ipconfig1'
        properties: {
          privateIPAllocationMethod: 'Dynamic'${subnetProp}
        }
      }
    ]
  }
}

resource ${name} 'Microsoft.Compute/virtualMachines@2024-07-01' = {
  name: '${rName}'
  location: location
  properties: {
    hardwareProfile: {
      vmSize: '${vmSize}'
    }
    storageProfile: {
      imageReference: {
        publisher: '${publisher || 'Canonical'}'
        offer: '${offer || 'ubuntu-24_04-lts'}'
        sku: '${sku || 'server'}'
        version: '${version || 'latest'}'
      }
      osDisk: {
        createOption: 'FromImage'
        managedDisk: {
          storageAccountType: 'Standard_LRS'
        }
      }
    }
    osProfile: {
      computerName: '${rName}'
      adminUsername: adminUsername
    }
    networkProfile: {
      networkInterfaces: [
        {
          id: ${name}_nic.id
        }
      ]
    }
  }
}\n`
}

function genAppService(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name}_plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${rName}-plan'
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
  }
}

resource ${name} 'Microsoft.Web/sites@2023-12-01' = {
  name: '${rName}'
  location: location
  properties: {
    serverFarmId: ${name}_plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
    }
  }
}\n`
}

function genContainerApp(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `// Container App requires a Container Apps Environment — add one if not present
resource ${name} 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${rName}'
  location: location
  properties: {
    configuration: {
      ingress: {
        external: true
        targetPort: 80
      }
    }
    template: {
      containers: [
        {
          name: '${rName}'
          image: 'mcr.microsoft.com/k8se/quickstart:latest'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
    }
  }
}\n`
}

function genFirewall(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name}_pip 'Microsoft.Network/publicIPAddresses@2024-01-01' = {
  name: '${rName}-pip'
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    publicIPAllocationMethod: 'Static'
  }
}

resource ${name} 'Microsoft.Network/azureFirewalls@2024-01-01' = {
  name: '${rName}'
  location: location
  properties: {
    sku: {
      name: 'AZFW_VNet'
      tier: 'Standard'
    }
    ipConfigurations: [
      {
        name: 'fw-ipconfig'
        properties: {
          publicIPAddress: {
            id: ${name}_pip.id
          }
          // subnet: requires AzureFirewallSubnet reference
        }
      }
    ]
  }
}\n`
}

function genLoadBalancer(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name} 'Microsoft.Network/loadBalancers@2024-01-01' = {
  name: '${rName}'
  location: location
  sku: {
    name: 'Standard'
  }
  properties: {
    frontendIPConfigurations: []
    backendAddressPools: []
  }
}\n`
}

function genPrivateEndpoint(
  n: DesignNode,
  nodeById: ReadonlyMap<string, DesignNode>,
  edges: Edge<DesignEdgeData>[],
): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  const parentId = n.parentId ?? n.parentNode
  const parentSubnet = parentId ? nodeById.get(parentId) : undefined
  const subnetId = parentSubnet ? resourceIdExpression(parentSubnet, nodeById) : null
  const targetEdge = edges.find((edge) => edge.source === n.id &&
    String(edge.data?.relationship ?? edge.label ?? '').toLowerCase() === 'targets')
  const targetNode = targetEdge ? nodeById.get(targetEdge.target) : undefined
  const configuredTarget = strProp(n, 'targetResourceId')
  const targetId = configuredTarget
    ? `'${escapeBicep(configuredTarget)}'`
    : targetNode ? resourceIdExpression(targetNode, nodeById) : null
  const edgeGroupId = targetEdge?.data?.properties?.groupId
  const groupId = strProp(n, 'groupId') || (typeof edgeGroupId === 'string' ? edgeGroupId : '')
  const privateDnsZoneId = strProp(n, 'privateDnsZoneId')
  const connection = subnetId && targetId && groupId
    ? `
    subnet: {
      id: ${subnetId}
    }
    privateLinkServiceConnections: [
      {
        name: '${rName}-connection'
        properties: {
          privateLinkServiceId: ${targetId}
          groupIds: [
            '${escapeBicep(groupId)}'
          ]
        }
      }
    ]`
    : `
    // ERROR: configure parent subnet, target resource and Group ID before deployment.`
  const dnsZoneGroup = privateDnsZoneId
    ? `

resource ${name}_dns 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2024-01-01' = {
  parent: ${name}
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'default'
        properties: {
          privateDnsZoneId: '${escapeBicep(privateDnsZoneId)}'
        }
      }
    ]
  }
}
`
    : ''
  return `resource ${name} 'Microsoft.Network/privateEndpoints@2024-01-01' = {
  name: '${rName}'
  location: location
  properties: {${connection}
  }
}
${dnsZoneGroup}
`
}


function genSubnetInExistingVnet(n: DesignNode, parentVnet: DesignNode, existingVnetSymbol: string): string {
  const parsed = parseArmResourceId(parentVnet.data.origin?.resourceId ?? strProp(parentVnet, 'existingResourceId'))
  if (!parsed || parsed.type.toLowerCase() !== 'microsoft.network/virtualnetworks')
    return `// ERROR: Cannot add subnet "${n.data.label}" because the discovered parent VNet ARM ID is invalid.\n`
  const name = safeName(n.data.label)
  const subnetName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  const prefix = strProp(n, 'addressPrefix')
  return `resource ${name} 'Microsoft.Network/virtualNetworks/subnets@2024-01-01' = {
  parent: ${existingVnetSymbol}
  name: '${subnetName}'
  properties: {
    addressPrefix: '${escapeBicep(prefix)}'
  }
}
`
}

function resourceIdExpression(node: DesignNode, nodeById: ReadonlyMap<string, DesignNode>): string | null {
  const existingId = node.data.origin?.resourceId ?? strProp(node, 'existingResourceId')
  if (existingId) return `'${escapeBicep(existingId)}'`
  if (node.data.blockType === 'Subnet') {
    const vnetId = node.parentId ?? node.parentNode
    const vnet = vnetId ? nodeById.get(vnetId) : undefined
    if (!vnet) return null
    const vnetName = safeResourceName(strProp(vnet, 'resourceName') || vnet.data.label)
    const subnetName = safeResourceName(strProp(node, 'resourceName') || node.data.label)
    const existingVnet = parseArmResourceId(vnet.data.origin?.resourceId ?? strProp(vnet, 'existingResourceId'))
    if (existingVnet) {
      return `${safeName(node.data.label)}.id`
    }
    return `resourceId('Microsoft.Network/virtualNetworks/subnets', '${escapeBicep(vnetName)}', '${escapeBicep(subnetName)}')`
  }
  return `${safeName(node.data.label)}.id`
}

function parseArmResourceId(resourceId: string): { subscriptionId: string; resourceGroup: string; type: string; name: string } | null {
  const match = resourceId.match(/^\/subscriptions\/([^/]+)\/resourceGroups\/([^/]+)\/providers\/([^/]+\/[^/]+)\/([^/]+)$/i)
  if (!match) return null
  return { subscriptionId: match[1], resourceGroup: match[2], type: match[3], name: match[4] }
}

function escapeBicep(value: string): string {
  return value.replace(/'/g, "''")
}
function genAks(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name} 'Microsoft.ContainerService/managedClusters@2024-06-02-preview' = {
  name: '${rName}'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    dnsPrefix: '${rName}'
    agentPoolProfiles: [
      {
        name: 'system'
        count: 1
        vmSize: 'Standard_DS2_v2'
        mode: 'System'
      }
    ]
  }
}\n`
}

function genPrivateDnsZone(n: DesignNode): string {
  const name = safeName(n.data.label)
  const rName = safeResourceName(strProp(n, 'resourceName') || n.data.label)
  return `resource ${name} 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: '${rName}'
  location: 'global'
}\n`
}

function genFallback(n: DesignNode): string {
  return `// TODO: ${n.data.blockType} "${n.data.label}" — manual configuration required\n`
}

// ── Main generator ──

export function generateBicep(nodes: DesignNode[], edges: Edge<DesignEdgeData>[]): string {
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const delta = analyzeDesignDelta(nodes, edges)
  const nodesToCreate = delta.hasBaseline ? delta.newNodes : nodes
  const existingVnetReferences = new Map<string, { node: DesignNode; symbol: string; parsed: NonNullable<ReturnType<typeof parseArmResourceId>> }>()
  for (const subnet of nodesToCreate.filter((node) => node.data.blockType === 'Subnet')) {
    const parentId = subnet.parentId ?? subnet.parentNode
    const parent = parentId ? nodeById.get(parentId) : undefined
    if (!parent || parent.data.blockType !== 'VNet' || parent.data.origin?.kind !== 'discovered') continue
    const parsed = parseArmResourceId(parent.data.origin.resourceId)
    if (!parsed) continue
    if (!existingVnetReferences.has(parent.id)) {
      existingVnetReferences.set(parent.id, {
        node: parent,
        symbol: `existing_${safeName(parent.data.label)}_${existingVnetReferences.size + 1}`,
        parsed,
      })
    }
  }

  // Find VNets and their child subnets
  const subnets = nodesToCreate.filter((n) => n.data.blockType === 'Subnet')
  const subnetsByVnet = new Map<string, DesignNode[]>()
  for (const s of subnets) {
    const pid = s.parentId ?? s.parentNode
    if (pid) {
      const list = subnetsByVnet.get(pid) ?? []
      list.push(s)
      subnetsByVnet.set(pid, list)
    }
  }

  // Track which nodes are handled inline (subnets inside VNets)
  const handledInline = new Set(subnets.filter((subnet) => {
    const parentId = subnet.parentId ?? subnet.parentNode
    return parentId && nodeById.get(parentId)?.data.origin?.kind !== 'discovered'
  }).map((subnet) => subnet.id))

  // Helper: resolve parent subnet/VNet names for a node placed inside a Subnet
  const getSubnetContext = (n: DesignNode): { subnetName?: string; vnetName?: string; subnetIdExpression?: string } => {
    const pid = n.parentId ?? n.parentNode
    if (!pid) return {}
    const parent = nodeById.get(pid)
    if (!parent) return {}
    if (parent.data.blockType === 'Subnet') {
      const subnetIdExpression = resourceIdExpression(parent, nodeById)
      if (subnetIdExpression) return { subnetIdExpression }
      const subnetName = strProp(parent, 'resourceName') || parent.data.label
      // Find the VNet that contains this subnet
      const vnetId = parent.parentId ?? parent.parentNode
      const vnet = vnetId ? nodeById.get(vnetId) : undefined
      const vnetName = vnet ? (strProp(vnet, 'resourceName') || vnet.data.label) : undefined
      return { subnetName, vnetName }
    }
    return {}
  }

  const hasVms = nodesToCreate.some((n) => n.data.blockType === 'VM')

  const lines: string[] = []
  lines.push(`// Generated by EasyAzure Design / Validate`)
  lines.push(`// ${new Date().toISOString()}\n`)
  if (delta.hasBaseline) {
    lines.push(`// Additions-only plan: ${delta.newNodes.length} new resource(s); ${delta.existingNodes.length} discovered resource(s) are references and will not be redeployed.`)
    lines.push(`// Run Azure what-if and review every change before deployment.\n`)
    if (delta.requiredDeploymentScopes.length === 1) {
      const scope = delta.requiredDeploymentScopes[0]
      lines.push(`// Required deployment target: subscription ${scope.subscriptionId}, resource group ${scope.resourceGroup}.\n`)
    }
  }
  lines.push(`targetScope = 'resourceGroup'\n`)
  lines.push(`@description('Azure region for all resources')`)
  lines.push(`param location string = resourceGroup().location\n`)
  if (hasVms) {
    lines.push(`@description('Admin username for virtual machines')`)
    lines.push(`param adminUsername string\n`)
  }

  for (const reference of existingVnetReferences.values()) {
    lines.push(`resource ${reference.symbol} 'Microsoft.Network/virtualNetworks@2024-01-01' existing = {
  name: '${escapeBicep(reference.parsed.name)}'
}\n`)
  }

  // Generate resources
  for (const n of nodesToCreate) {
    if (handledInline.has(n.id)) continue

    const bt = n.data.blockType
    switch (bt) {
      case 'VNet':
        lines.push(genVNet(n, subnetsByVnet.get(n.id) ?? []))
        break
      case 'NSG':
        lines.push(genNsg(n))
        break
      case 'Route Table':
        lines.push(genRouteTable(n))
        break
      case 'Storage Account':
        lines.push(genStorageAccount(n))
        break
      case 'Key Vault':
        lines.push(genKeyVault(n))
        break
      case 'SQL Database':
        lines.push(genSqlDatabase(n))
        break
      case 'PostgreSQL':
        lines.push(genPostgres(n))
        break
      case 'Cosmos DB':
        lines.push(genCosmosDb(n))
        break
      case 'VM': {
        const ctx = getSubnetContext(n)
        lines.push(genVm(n, ctx.subnetName, ctx.vnetName, ctx.subnetIdExpression))
        break
      }
      case 'App Service':
      case 'Function App':
        lines.push(genAppService(n))
        break
      case 'Container App':
        lines.push(genContainerApp(n))
        break
      case 'Azure Firewall':
        lines.push(genFirewall(n))
        break
      case 'Load Balancer':
        lines.push(genLoadBalancer(n))
        break
      case 'Private Endpoint':
        lines.push(genPrivateEndpoint(n, nodeById, edges))
        break
      case 'AKS':
        lines.push(genAks(n))
        break
      case 'Private DNS Zone':
        lines.push(genPrivateDnsZone(n))
        break
      case 'Subnet':
        {
          const parentId = n.parentId ?? n.parentNode
          const parentVnet = parentId ? nodeById.get(parentId) : undefined
          const reference = parentVnet ? existingVnetReferences.get(parentVnet.id) : undefined
          if (parentVnet?.data.blockType === 'VNet' && reference)
            lines.push(genSubnetInExistingVnet(n, parentVnet, reference.symbol))
          else
            lines.push(`// WARNING: Subnet "${n.data.label}" is not inside a deployable VNet\n`)
        }
        break
      default:
        lines.push(genFallback(n))
        break
    }
  }

  return lines.join('\n')
}
