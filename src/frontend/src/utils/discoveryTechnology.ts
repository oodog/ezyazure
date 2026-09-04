import type { Edge, Node } from 'reactflow'
import type { AzureResource } from '@/types/azure'

export const discoveryTechnologies = [
  { key: 'networking', label: 'Networking' },
  { key: 'compute', label: 'Compute & VMs' },
  { key: 'avs', label: 'Azure VMware Solution' },
  { key: 'storage', label: 'Storage' },
  { key: 'databases', label: 'Databases' },
  { key: 'web-apps', label: 'Web & app services' },
  { key: 'containers', label: 'Containers' },
  { key: 'ai-search', label: 'AI & search' },
  { key: 'security-identity', label: 'Security & identity' },
  { key: 'monitoring', label: 'Monitoring' },
  { key: 'other', label: 'Other' },
] as const

export type DiscoveryTechnology = (typeof discoveryTechnologies)[number]['key']
export type DiscoveryTopologyView = 'network' | 'network-compute' | 'full'

const networkPathResourceTypes = new Set([
  'easyazure.network/internet',
  'microsoft.avs/privateclouds',
  'microsoft.network/applicationgateways',
  'microsoft.network/azurefirewalls',
  'microsoft.network/bastionhosts',
  'microsoft.network/connections',
  'microsoft.network/expressroutecircuits',
  'microsoft.network/expressroutegateways',
  'microsoft.network/expressrouteports',
  'microsoft.network/loadbalancers',
  'microsoft.network/localnetworkgateways',
  'microsoft.network/natgateways',
  'microsoft.network/networkinterfaces',
  'microsoft.network/networksecuritygroups',
  'microsoft.network/networkvirtualappliances',
  'microsoft.network/p2svpngateways',
  'microsoft.network/privatednszones',
  'microsoft.network/privateendpoints',
  'microsoft.network/privatelinkservices',
  'microsoft.network/publicipaddresses',
  'microsoft.network/routetables',
  'microsoft.network/virtualhubs',
  'microsoft.network/virtualnetworkgateways',
  'microsoft.network/virtualnetworks',
  'microsoft.network/virtualnetworks/subnets',
  'microsoft.network/virtualwans',
  'microsoft.network/vpngateways',
  'microsoft.network/vpnsites',
])

const networkAttachmentAnchorTypes = new Set([
  'microsoft.network/privateendpoints',
  'microsoft.network/virtualnetworks',
  'microsoft.network/virtualnetworks/subnets',
])

export function getDiscoveryTechnology(resourceType: string): DiscoveryTechnology {
  const type = resourceType.toLowerCase()

  if (type.startsWith('microsoft.network/') || type === 'easyazure.network/internet')
    return 'networking'
  if (type.startsWith('microsoft.compute/')) return 'compute'
  if (type.startsWith('microsoft.avs/')) return 'avs'
  if (type.startsWith('microsoft.storage/')) return 'storage'
  if (
    type.startsWith('microsoft.sql/') ||
    type.startsWith('microsoft.documentdb/') ||
    type.startsWith('microsoft.dbfor') ||
    type.startsWith('microsoft.cache/')
  )
    return 'databases'
  if (type.startsWith('microsoft.web/') || type.startsWith('microsoft.apimanagement/'))
    return 'web-apps'
  if (
    type.startsWith('microsoft.app/') ||
    type.startsWith('microsoft.containerservice/') ||
    type.startsWith('microsoft.containerinstance/') ||
    type.startsWith('microsoft.containerregistry/')
  )
    return 'containers'
  if (
    type.startsWith('microsoft.cognitiveservices/') ||
    type.startsWith('microsoft.machinelearningservices/') ||
    type.startsWith('microsoft.search/')
  )
    return 'ai-search'
  if (
    type.startsWith('microsoft.keyvault/') ||
    type.startsWith('microsoft.managedidentity/') ||
    type.startsWith('microsoft.authorization/') ||
    type.startsWith('microsoft.security/')
  )
    return 'security-identity'
  if (
    type.startsWith('microsoft.insights/') ||
    type.startsWith('microsoft.operationalinsights/') ||
    type.startsWith('microsoft.alertsmanagement/')
  )
    return 'monitoring'

  return 'other'
}

export function isNetworkPathResource(resourceType: string): boolean {
  return networkPathResourceTypes.has(resourceType.toLowerCase())
}

export function isComputeEndpoint(resourceType: string): boolean {
  const type = resourceType.toLowerCase()
  return (
    type === 'microsoft.compute/virtualmachines' ||
    type === 'microsoft.compute/virtualmachinescalesets'
  )
}

export function isNetworkAttachableWorkload(resourceType: string): boolean {
  const type = resourceType.toLowerCase()
  return (
    isComputeEndpoint(type) ||
    type.startsWith('microsoft.apimanagement/') ||
    type.startsWith('microsoft.app/') ||
    type.startsWith('microsoft.cognitiveservices/') ||
    type.startsWith('microsoft.containerinstance/') ||
    type.startsWith('microsoft.containerservice/') ||
    type.startsWith('microsoft.dbfor') ||
    type.startsWith('microsoft.documentdb/') ||
    type.startsWith('microsoft.search/') ||
    type.startsWith('microsoft.sql/') ||
    type.startsWith('microsoft.storage/') ||
    type.startsWith('microsoft.web/')
  )
}

export function filterDiscoveryGraphByView(
  nodes: Node<AzureResource>[],
  edges: Edge[],
  view: DiscoveryTopologyView,
  selectedTechnologies: ReadonlySet<DiscoveryTechnology>,
): { nodes: Node<AzureResource>[]; edges: Edge[] } {
  if (view === 'full') return filterDiscoveryGraph(nodes, edges, selectedTechnologies)

  const visibleNodeIds = new Set(
    nodes
      .filter((node) =>
        isNetworkPathResource(node.data.type) ||
        (view === 'network-compute' && isComputeEndpoint(node.data.type)),
      )
      .map((node) => node.id),
  )
  const nodeById = new Map(nodes.map((node) => [node.id, node]))

  // A Private Endpoint without its destination service is operationally incomplete.
  // Typed Private Link edges identify the linked PaaS resource without pulling every
  // unrelated storage account, database, or web app into the network canvas.
  for (const edge of edges) {
    const metadata = (edge.data as { metadata?: Record<string, string> } | undefined)?.metadata
    if (metadata?.relationship !== 'privateLinkService') continue
    visibleNodeIds.add(edge.source)
    visibleNodeIds.add(edge.target)
  }

  if (view === 'network-compute') {
    for (const edge of edges) {
      const source = nodeById.get(edge.source)
      const target = nodeById.get(edge.target)
      if (!source || !target) continue

      const category = (edge.data as { category?: string } | undefined)?.category
      if (category !== 'associatedWith' && category !== 'connectedTo') continue

      const targetIsAnchor = networkAttachmentAnchorTypes.has(target.data.type.toLowerCase())
      if (targetIsAnchor && isNetworkAttachableWorkload(source.data.type))
        visibleNodeIds.add(source.id)
    }
  }

  const visibleNodes = nodes.filter((node) => visibleNodeIds.has(node.id))
  const visibleEdges = edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  )

  return { nodes: visibleNodes, edges: visibleEdges }
}

export function filterDiscoveryGraph(
  nodes: Node<AzureResource>[],
  edges: Edge[],
  selectedTechnologies: ReadonlySet<DiscoveryTechnology>,
): { nodes: Node<AzureResource>[]; edges: Edge[] } {
  if (selectedTechnologies.size === 0) return { nodes, edges }

  const visibleNodes = nodes.filter((node) =>
    selectedTechnologies.has(getDiscoveryTechnology(node.data.type)),
  )
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const visibleEdges = edges.filter(
    (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
  )

  return { nodes: visibleNodes, edges: visibleEdges }
}