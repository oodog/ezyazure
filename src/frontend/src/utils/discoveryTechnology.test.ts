import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { AzureResource } from '@/types/azure'
import {
  filterDiscoveryGraph,
  filterDiscoveryGraphByView,
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

  it('shows network resources and Private Link targets in network view', () => {
    const nodes: Node<AzureResource>[] = [
      node('vnet', 'Microsoft.Network/virtualNetworks'),
      node('pe', 'Microsoft.Network/privateEndpoints'),
      node('storage', 'Microsoft.Storage/storageAccounts'),
      node('identity', 'Microsoft.ManagedIdentity/userAssignedIdentities'),
      node('vm', 'Microsoft.Compute/virtualMachines'),
    ]
    const edges: Edge[] = [
      { id: 'vnet-pe', source: 'vnet', target: 'pe' },
      {
        id: 'pe-storage',
        source: 'pe',
        target: 'storage',
        data: { metadata: { relationship: 'privateLinkService' } },
      },
      { id: 'identity-storage', source: 'identity', target: 'storage' },
    ]

    const result = filterDiscoveryGraphByView(nodes, edges, 'network', new Set())

    expect(result.nodes.map((item) => item.id)).toEqual(['vnet', 'pe', 'storage'])
    expect(result.edges.map((item) => item.id)).toEqual(['vnet-pe', 'pe-storage'])
  })

  it('adds VM endpoints only in network and compute view', () => {
    const nodes = [
      node('subnet', 'Microsoft.Network/virtualNetworks/subnets'),
      node('vm', 'Microsoft.Compute/virtualMachines'),
      node('disk', 'Microsoft.Compute/disks'),
    ]
    const edges: Edge[] = [
      { id: 'subnet-vm', source: 'subnet', target: 'vm' },
      { id: 'vm-disk', source: 'vm', target: 'disk' },
    ]

    const result = filterDiscoveryGraphByView(nodes, edges, 'network-compute', new Set())

    expect(result.nodes.map((item) => item.id)).toEqual(['subnet', 'vm'])
    expect(result.edges.map((item) => item.id)).toEqual(['subnet-vm'])
  })

  it('keeps the VM to network interface to NSG association visible', () => {
    const nodes = [
      node('vm', 'Microsoft.Compute/virtualMachines'),
      node('nic', 'Microsoft.Network/networkInterfaces'),
      node('nsg', 'Microsoft.Network/networkSecurityGroups'),
    ]
    const edges: Edge[] = [
      { id: 'vm-nic', source: 'vm', target: 'nic', data: { category: 'connectedTo' } },
      { id: 'nic-nsg', source: 'nic', target: 'nsg', data: { category: 'connectedTo' } },
    ]

    const result = filterDiscoveryGraphByView(nodes, edges, 'network-compute', new Set())

    expect(result.nodes.map((item) => item.id)).toEqual(['vm', 'nic', 'nsg'])
    expect(result.edges.map((item) => item.id)).toEqual(['vm-nic', 'nic-nsg'])
  })

  it('adds only PaaS workloads with a proven network attachment', () => {
    const nodes = [
      node('subnet', 'Microsoft.Network/virtualNetworks/subnets'),
      node('integrated-app', 'Microsoft.Web/sites'),
      node('public-app', 'Microsoft.Web/sites'),
      node('identity', 'Microsoft.ManagedIdentity/userAssignedIdentities'),
    ]
    const edges: Edge[] = [
      {
        id: 'subnet-app',
        source: 'integrated-app',
        target: 'subnet',
        data: { category: 'connectedTo' },
      },
      { id: 'app-identity', source: 'public-app', target: 'identity' },
    ]

    const result = filterDiscoveryGraphByView(nodes, edges, 'network-compute', new Set())

    expect(result.nodes.map((item) => item.id)).toEqual(['subnet', 'integrated-app'])
    expect(result.edges.map((item) => item.id)).toEqual(['subnet-app'])
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