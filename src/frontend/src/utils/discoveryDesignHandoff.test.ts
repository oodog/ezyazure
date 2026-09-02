// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { AzureResource } from '@/types/azure'
import { consumeDiscoveryDesignHandoff, createDiscoveryDesignHandoff, saveDiscoveryDesignHandoff } from './discoveryDesignHandoff'

describe('Discovery design handoff', () => {
  it('maps containment, associations, targeting, properties and baseline origin', () => {
    const nodes = [
      azureNode('vnet', 'hub-vnet', 'Microsoft.Network/virtualNetworks', { addressSpace: { addressPrefixes: ['10.20.0.0/16'] } }),
      azureNode('subnet', 'private-endpoints', 'Microsoft.Network/virtualNetworks/subnets', { addressPrefix: '10.20.1.0/24' }),
      azureNode('nsg', 'workload-nsg', 'Microsoft.Network/networkSecurityGroups'),
      azureNode('pe', 'storage-pe', 'Microsoft.Network/privateEndpoints', { privateIPAddresses: ['10.20.1.4'] }),
      azureNode('storage', 'data', 'Microsoft.Storage/storageAccounts'),
      azureNode('unsupported', 'dashboard', 'Microsoft.Portal/dashboards'),
    ]
    const edges: Edge[] = [
      edge('contains', 'vnet', 'subnet', 'contains', 'contains'),
      edge('nsg', 'nsg', 'subnet', 'protects', 'associatedWith'),
      edge('pe-subnet', 'pe', 'subnet', 'in subnet', 'associatedWith'),
      edge('pe-target', 'pe', 'storage', 'connected to', 'connectedTo'),
    ]

    const handoff = createDiscoveryDesignHandoff(nodes, edges, '2026-08-30T00:00:00Z')

    expect(handoff.nodes).toHaveLength(5)
    const vnet = handoff.nodes.find((node) => node.data.blockType === 'VNet')!
    const subnet = handoff.nodes.find((node) => node.data.blockType === 'Subnet')!
    const pe = handoff.nodes.find((node) => node.data.blockType === 'Private Endpoint')!
    expect(vnet.data.origin).toMatchObject({ kind: 'discovered', resourceId: '/subscriptions/sub/resourceGroups/rg/providers/vnet' })
    expect(vnet.data.properties.addressSpace).toEqual(['10.20.0.0/16'])
    expect(subnet.parentId).toBe(vnet.id)
    expect(subnet.data.properties.addressPrefix).toBe('10.20.1.0/24')
    expect(pe.parentId).toBe(subnet.id)
    expect(pe.data.properties.privateIpAddress).toBe('10.20.1.4')
    expect(handoff.edges).toContainEqual(expect.objectContaining({
      label: 'protects',
      data: expect.objectContaining({ origin: 'discovered' }),
    }))
    expect(handoff.edges).toContainEqual(expect.objectContaining({ label: 'targets' }))
    expect(handoff.skippedResources).toEqual(['dashboard (Microsoft.Portal/dashboards)'])
  })

  it('round-trips once through session storage', () => {
    const handoff = createDiscoveryDesignHandoff([
      azureNode('vnet', 'vnet', 'Microsoft.Network/virtualNetworks'),
    ], [])

    saveDiscoveryDesignHandoff(handoff)

    expect(consumeDiscoveryDesignHandoff()?.nodes).toHaveLength(1)
    expect(consumeDiscoveryDesignHandoff()).toBeNull()
  })

  it('rejects a handoff that exceeds the browser transfer budget', () => {
    const handoff = createDiscoveryDesignHandoff([
      azureNode('vnet', 'x'.repeat(4_100_000), 'Microsoft.Network/virtualNetworks'),
    ], [])

    expect(() => saveDiscoveryDesignHandoff(handoff)).toThrow(/too large/)
  })
})

function azureNode(id: string, name: string, type: string, properties: Record<string, unknown> = {}): Node<AzureResource> {
  return {
    id,
    position: { x: id.length * 100, y: id.length * 30 },
    data: {
      id: `/subscriptions/sub/resourceGroups/rg/providers/${id}`,
      type,
      name,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      location: 'australiaeast',
      properties,
    },
  }
}

function edge(id: string, source: string, target: string, label: string, category: string): Edge {
  return { id, source, target, label, data: { category } }
}