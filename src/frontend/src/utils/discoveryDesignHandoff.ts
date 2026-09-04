import type { Edge, Node } from 'reactflow'
import type { AzureResource } from '@/types/azure'
import type { DesignBlock } from '@/types/designer'
import { getSubnetPrefixes, getVNetDnsServers, getVNetPrefixes, getVmPrivateIps } from './azureResourceDetails'
import { canConnect, canContain, containerSize, isContainer } from '@/components/designer/relationships'
import type { DesignEdgeData } from './designEdges'

const HANDOFF_KEY = 'easyazure.design.discoveryHandoff.v1'
const MAX_HANDOFF_BYTES = 4_000_000

export interface DiscoveryDesignHandoff {
  version: 1
  capturedAt: string
  subscriptionIds: string[]
  nodes: Node<DesignBlock>[]
  edges: Edge<DesignEdgeData>[]
  skippedResources: string[]
}

export function createDiscoveryDesignHandoff(
  discoveryNodes: Node<AzureResource>[],
  discoveryEdges: Edge[],
  capturedAt = new Date().toISOString(),
): DiscoveryDesignHandoff {
  const mapped: Array<{ originalId: string; node: Node<DesignBlock> }> = discoveryNodes.flatMap((node, index) => {
    const blockType = blockTypeFor(node.data)
    if (!blockType) return []
    const id = `baseline-${index + 1}`
    const size = containerSize(blockType)
    return [{
      originalId: node.id,
      node: {
        id,
        type: isContainer(blockType) ? 'azureContainer' : 'azureResource',
        position: { ...node.position },
        draggable: false,
        deletable: false,
        ...(isContainer(blockType) ? { style: { width: size.width, height: size.height }, zIndex: -1 } : {}),
        data: {
          label: node.data.name,
          blockType,
          properties: designProperties(node.data, blockType),
          origin: {
            kind: 'discovered' as const,
            resourceId: node.data.id,
            resourceType: node.data.type,
            subscriptionId: node.data.subscriptionId,
            resourceGroup: node.data.resourceGroup,
            capturedAt,
          },
        },
      } satisfies Node<DesignBlock>,
    }]
  })
  const idMap = new Map(mapped.map((item) => [item.originalId.toLowerCase(), item.node.id]))
  const nodeById = new Map(mapped.map((item) => [item.node.id, item.node]))
  const baselineEdges: Edge<DesignEdgeData>[] = []
  const seenEdges = new Set<string>()

  for (const edge of discoveryEdges) {
    let sourceId = idMap.get(edge.source.toLowerCase())
    let targetId = idMap.get(edge.target.toLowerCase())
    if (!sourceId || !targetId || sourceId === targetId) continue
    let source = nodeById.get(sourceId)!
    let target = nodeById.get(targetId)!
    const category = String((edge.data as { category?: string } | undefined)?.category ?? '')

    const sourceCanContain = canContain(source.data.blockType, target.data.blockType)
    const targetCanContain = canContain(target.data.blockType, source.data.blockType)
    if ((category === 'contains' && sourceCanContain) || (targetCanContain && isSubnetAssociation(source, target))) {
      if (!sourceCanContain && targetCanContain) {
        ;[sourceId, targetId] = [targetId, sourceId]
        ;[source, target] = [target, source]
      }
      const parentAbsolute = source.position
      target.parentId = source.id
      target.parentNode = source.id
      target.extent = 'parent'
      target.position = {
        x: Math.max(40, target.position.x - parentAbsolute.x),
        y: Math.max(45, target.position.y - parentAbsolute.y),
      }
      continue
    }

    let connection = canConnect(source.data.blockType, target.data.blockType)
    if (!connection.allowed) {
      const reversed = canConnect(target.data.blockType, source.data.blockType)
      if (!reversed.allowed) continue
      ;[sourceId, targetId] = [targetId, sourceId]
      ;[source, target] = [target, source]
      connection = reversed
    }
    const relationship = connection.label ?? String(edge.label ?? 'connected to')
    const dedupeKey = `${sourceId}|${targetId}|${relationship}`.toLowerCase()
    if (seenEdges.has(dedupeKey)) continue
    seenEdges.add(dedupeKey)
    baselineEdges.push({
      id: `baseline-edge-${baselineEdges.length + 1}`,
      source: sourceId,
      target: targetId,
      label: relationship,
      deletable: false,
      data: {
        relationship,
        origin: 'discovered',
        baselineRelationshipId: edge.id,
        properties: {},
      },
    })
  }

  const skippedResources = discoveryNodes
    .filter((node) => !idMap.has(node.id.toLowerCase()))
    .map((node) => `${node.data.name} (${node.data.type})`)
  const subscriptionIds = Array.from(new Set(mapped.map((item) => item.node.data.origin!.subscriptionId)))
  return { version: 1, capturedAt, subscriptionIds, nodes: mapped.map((item) => item.node), edges: baselineEdges, skippedResources }
}

export function saveDiscoveryDesignHandoff(handoff: DiscoveryDesignHandoff): void {
  const serialized = JSON.stringify(handoff)
  if (new Blob([serialized]).size > MAX_HANDOFF_BYTES) {
    throw new Error('This topology is too large for an in-browser handoff. Filter Discovery by technology or use a smaller topology view, then try again.')
  }
  try {
    sessionStorage.setItem(HANDOFF_KEY, serialized)
  } catch {
    throw new Error('The browser could not store this topology handoff. Filter Discovery to a smaller view and try again.')
  }
}

export function consumeDiscoveryDesignHandoff(): DiscoveryDesignHandoff | null {
  const raw = sessionStorage.getItem(HANDOFF_KEY)
  if (!raw) return null
  sessionStorage.removeItem(HANDOFF_KEY)
  try {
    const parsed = JSON.parse(raw) as DiscoveryDesignHandoff
    return parsed.version === 1 && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) ? parsed : null
  } catch {
    return null
  }
}

function blockTypeFor(resource: AzureResource): string | null {
  const type = resource.type.toLowerCase()
  if (type === 'microsoft.network/virtualnetworks') return 'VNet'
  if (type === 'microsoft.network/virtualnetworks/subnets') return 'Subnet'
  if (type === 'microsoft.network/networksecuritygroups') return 'NSG'
  if (type === 'microsoft.network/routetables') return 'Route Table'
  if (type === 'microsoft.network/natgateways') return 'NAT Gateway'
  if (type === 'microsoft.network/azurefirewalls') return 'Azure Firewall'
  if (type === 'microsoft.network/virtualnetworkgateways') return 'VPN Gateway'
  if (type === 'microsoft.network/expressroutegateways') return 'ExpressRoute Gateway'
  if (type === 'microsoft.network/privatednszones') return 'Private DNS Zone'
  if (type === 'microsoft.network/privateendpoints') return 'Private Endpoint'
  if (type === 'microsoft.network/loadbalancers') return 'Load Balancer'
  if (type === 'microsoft.network/applicationgateways') return 'Application Gateway'
  if (type === 'microsoft.network/virtualwans') return 'Virtual WAN'
  if (type === 'microsoft.network/virtualhubs') return 'Virtual Hub'
  if (type === 'microsoft.network/virtualhubs/routingintent') return 'Route Intent'
  if (type === 'microsoft.network/bastionhosts') return 'Bastion'
  if (type === 'microsoft.compute/virtualmachines') return 'VM'
  if (type === 'microsoft.compute/virtualmachinescalesets') return 'VM Scale Set'
  if (type === 'microsoft.containerservice/managedclusters') return 'AKS'
  if (type === 'microsoft.app/containerapps') return 'Container App'
  if (type === 'microsoft.web/sites') return resource.properties.kind?.toString().toLowerCase().includes('functionapp') ? 'Function App' : 'App Service'
  if (type === 'microsoft.storage/storageaccounts') return 'Storage Account'
  if (type === 'microsoft.sql/servers/databases') return 'SQL Database'
  if (type === 'microsoft.dbforpostgresql/flexibleservers') return 'PostgreSQL'
  if (type === 'microsoft.documentdb/databaseaccounts') return 'Cosmos DB'
  if (type === 'microsoft.keyvault/vaults') return 'Key Vault'
  if (type === 'microsoft.managedidentity/userassignedidentities') return 'Managed Identity'
  if (type === 'microsoft.operationalinsights/workspaces') return 'Log Analytics'
  return null
}

function designProperties(resource: AzureResource, blockType: string): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    resourceName: resource.name,
    location: resource.location,
    existingResourceId: resource.id,
  }
  if (blockType === 'VNet') {
    properties.addressSpace = getVNetPrefixes(resource)
    properties.dnsServers = getVNetDnsServers(resource)
  }
  if (blockType === 'Subnet') {
    properties.addressPrefix = getSubnetPrefixes(resource)[0] ?? ''
    properties.privateEndpointPolicies = resource.properties.privateEndpointNetworkPolicies ?? 'Disabled'
  }
  if (blockType === 'Virtual Hub') {
    properties.addressPrefix = resource.properties.addressPrefix ?? ''
    properties.virtualWanId = referenceId(resource.properties.virtualWan) ?? ''
    properties.sku = resource.properties.sku ?? 'Standard'
  }
  if (blockType === 'Route Intent') {
    Object.assign(properties, routeIntentProperties(resource))
  }
  if (blockType === 'Private Endpoint')
    properties.privateIpAddress = getVmPrivateIps(resource)[0] ?? ''
  if (blockType === 'Storage Account') {
    properties.minTlsVersion = resource.properties.minimumTlsVersion ?? 'TLS1_2'
    properties.httpsOnly = resource.properties.supportsHttpsTrafficOnly ?? true
  }
  for (const key of ['publicNetworkAccess', 'allowBlobPublicAccess', 'allowSharedKeyAccess', 'minimumTlsVersion', 'httpsOnly', 'enablePurgeProtection', 'enableRbacAuthorization']) {
    if (resource.properties[key] !== undefined) properties[key] = resource.properties[key]
  }
  return properties
}

function isSubnetAssociation(source: Node<DesignBlock>, target: Node<DesignBlock>): boolean {
  return source.data.blockType === 'Subnet' || target.data.blockType === 'Subnet'
}

function routeIntentProperties(resource: AzureResource): Record<string, unknown> {
  const policies = Array.isArray(resource.properties.routingPolicies)
    ? resource.properties.routingPolicies.filter(isRecord)
    : []
  const result: Record<string, unknown> = {
    virtualHubId: parentResourceId(resource.id, '/routingIntent/') ?? '',
    internetTraffic: 'None',
    privateTraffic: 'None',
  }

  for (const policy of policies) {
    const destinations = Array.isArray(policy.destinations)
      ? policy.destinations.map(String)
      : []
    const nextHop = typeof policy.nextHop === 'string' ? policy.nextHop : ''
    const nextHopType = nextHop.toLowerCase().includes('/networkvirtualappliances/')
      ? 'NVA'
      : 'AzureFirewall'
    if (destinations.some((destination) => destination.toLowerCase() === 'internet'))
      result.internetTraffic = nextHopType
    if (destinations.some((destination) => destination.toLowerCase() === 'privatetraffic'))
      result.privateTraffic = nextHopType
    if (nextHop) result.nextHopResourceId = nextHop
  }

  return result
}

function referenceId(value: unknown): string | undefined {
  return isRecord(value) && typeof value.id === 'string' ? value.id : undefined
}

function parentResourceId(resourceId: string, childSegment: string): string | undefined {
  const index = resourceId.toLowerCase().indexOf(childSegment.toLowerCase())
  return index > 0 ? resourceId.slice(0, index) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}