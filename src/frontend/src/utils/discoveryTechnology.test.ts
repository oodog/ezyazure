import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { AzureResource } from '@/types/azure'
import {
  filterDiscoveryGraph,
  getDiscoveryTechnology,
  type DiscoveryTechnology,
} from './discoveryTechnology'

describe('discovery technology filters', () => {
  it('classifies common Azure resource types', () => {
    expect(getDiscoveryTechnology('Microsoft.Network/virtualNetworks')).toBe('networking')
    expect(getDiscoveryTechnology('Microsoft.Compute/virtualMachines')).toBe('compute')
    expect(getDiscoveryTechnology('Microsoft.Compute/disks')).toBe('compute')
    expect(getDiscoveryTechnology('Microsoft.AVS/privateClouds')).toBe('avs')
    expect(getDiscoveryTechnology('Microsoft.CognitiveServices/accounts')).toBe('ai-search')
  })

  it('keeps only selected nodes and edges whose endpoints remain visible', () => {
    const nodes: Node<AzureResource>[] = [
      node('vnet', 'Microsoft.Network/virtualNetworks'),
      node('subnet', 'Microsoft.Network/virtualNetworks/subnets'),
      node('vm', 'Microsoft.Compute/virtualMachines'),
    ]
    const edges: Edge[] = [
      { id: 'vnet-subnet', source: 'vnet', target: 'subnet' },
      { id: 'subnet-vm', source: 'subnet', target: 'vm' },
    ]
    const selected = new Set<DiscoveryTechnology>(['networking'])

    const result = filterDiscoveryGraph(nodes, edges, selected)

    expect(result.nodes.map((item) => item.id)).toEqual(['vnet', 'subnet'])
    expect(result.edges.map((item) => item.id)).toEqual(['vnet-subnet'])
  })

  it('returns the complete graph when no technology is selected', () => {
    const nodes = [node('vm', 'Microsoft.Compute/virtualMachines')]
    const edges: Edge[] = []

    const result = filterDiscoveryGraph(nodes, edges, new Set())

    expect(result.nodes).toBe(nodes)
    expect(result.edges).toBe(edges)
  })
})

function node(id: string, type: string): Node<AzureResource> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      id,
      type,
      name: id,
      subscriptionId: 'subscription',
      resourceGroup: 'resource-group',
      location: 'australiaeast',
      properties: {},
    },
  }
}