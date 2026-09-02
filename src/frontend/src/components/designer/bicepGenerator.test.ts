import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from '@/utils/designEdges'
import { generateBicep } from './bicepGenerator'

describe('additions-only Bicep generation', () => {
  it('does not redeploy the baseline and creates a PE referencing existing resources', () => {
    const subnet = discoveredNode(
      'subnet',
      'Subnet',
      '/subscriptions/sub-a/resourceGroups/network-rg/providers/Microsoft.Network/virtualNetworks/hub-vnet/subnets/endpoints',
      'Microsoft.Network/virtualNetworks/subnets',
    )
    const storage = discoveredNode(
      'storage',
      'Storage Account',
      '/subscriptions/sub-a/resourceGroups/data-rg/providers/Microsoft.Storage/storageAccounts/proddata',
      'Microsoft.Storage/storageAccounts',
    )
    const endpoint = node('pe', 'Private Endpoint', { resourceName: 'proddata-pe' }, 'subnet')
    const edges: Edge<DesignEdgeData>[] = [
      { id: 'target', source: 'pe', target: 'storage', label: 'targets', data: { relationship: 'targets', properties: { groupId: 'blob' } } },
    ]

    const bicep = generateBicep([subnet, storage, endpoint], edges)

    expect(bicep).toContain('Additions-only plan: 1 new resource(s); 2 discovered resource(s)')
    expect(bicep).toContain("resource pe 'Microsoft.Network/privateEndpoints@2024-01-01'")
    expect(bicep).toContain("id: '/subscriptions/sub-a/resourceGroups/network-rg/providers/Microsoft.Network/virtualNetworks/hub-vnet/subnets/endpoints'")
    expect(bicep).toContain("privateLinkServiceId: '/subscriptions/sub-a/resourceGroups/data-rg/providers/Microsoft.Storage/storageAccounts/proddata'")
    expect(bicep).toContain("'blob'")
    expect(bicep).toContain('location: location')
    expect(bicep).not.toContain("resource storage 'Microsoft.Storage/storageAccounts")
  })

  it('adds a new subnet at the scope of an existing VNet without recreating it', () => {
    const vnet = discoveredNode(
      'vnet',
      'VNet',
      '/subscriptions/sub-a/resourceGroups/network-rg/providers/Microsoft.Network/virtualNetworks/hub-vnet',
      'Microsoft.Network/virtualNetworks',
    )
    const subnet = node('subnet', 'Subnet', { resourceName: 'new-endpoints', addressPrefix: '10.20.8.0/24' }, 'vnet')

    const bicep = generateBicep([vnet, subnet], [])

    expect(bicep).toContain('Required deployment target: subscription sub-a, resource group network-rg.')
    expect(bicep).toContain("resource existing_vnet_1 'Microsoft.Network/virtualNetworks@2024-01-01' existing")
    expect(bicep).toContain('parent: existing_vnet_1')
    expect(bicep).toContain("name: 'new-endpoints'")
    expect(bicep).not.toContain("resource vnet 'Microsoft.Network/virtualNetworks@")
  })

  it('references a new subnet under an existing VNet from a child VM', () => {
    const vnet = discoveredNode(
      'vnet',
      'VNet',
      '/subscriptions/sub-a/resourceGroups/network-rg/providers/Microsoft.Network/virtualNetworks/hub-vnet',
      'Microsoft.Network/virtualNetworks',
    )
    const subnet = node('subnet', 'Subnet', { resourceName: 'new-workload', addressPrefix: '10.20.9.0/24' }, 'vnet')
    const vm = node('vm', 'VM', { resourceName: 'new-vm' }, 'subnet')

    const bicep = generateBicep([vnet, subnet, vm], [])

    expect(bicep).toContain('id: subnet.id')
  })
})

function discoveredNode(id: string, blockType: string, resourceId: string, resourceType: string): Node<DesignBlock> {
  const resourceGroup = resourceId.match(/\/resourceGroups\/([^/]+)/i)?.[1] ?? 'rg'
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      blockType,
      properties: { resourceName: id, existingResourceId: resourceId, location: 'australiaeast' },
      origin: { kind: 'discovered', resourceId, resourceType, subscriptionId: 'sub-a', resourceGroup, capturedAt: '2026-08-30T00:00:00Z' },
    },
  }
}

function node(id: string, blockType: string, properties: Record<string, unknown>, parentId?: string): Node<DesignBlock> {
  return {
    id,
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId, parentNode: parentId } : {}),
    data: { label: id, blockType, properties },
  }
}