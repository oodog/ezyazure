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