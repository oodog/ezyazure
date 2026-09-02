import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import { validateDesign } from './validation'

describe('Private Endpoint route symmetry validation', () => {
  it('flags secured vWAN when PE route-table policy is disabled', () => {
    const { nodes, edges } = vwanDesign('Disabled')

    const findings = validateDesign(nodes, edges)

    const finding = findings.find((item) => item.ruleId === 'PE.VWAN.RoutePolicy')
    expect(finding?.message).toContain('RouteTableEnabled')
    expect(finding?.message).toContain('Do not add the PE /32')
  })

  it('accepts secured vWAN when PE route-table policy is enabled', () => {
    const { nodes, edges } = vwanDesign('RouteTableEnabled')

    const findings = validateDesign(nodes, edges)

    expect(findings).not.toContainEqual(expect.objectContaining({ ruleId: 'PE.VWAN.RoutePolicy' }))
  })

  it('flags a broad NVA route without a PE-specific override', () => {
    const { nodes, edges } = classicNvaDesign(false)

    const findings = validateDesign(nodes, edges)

    const finding = findings.find((item) => item.ruleId === 'PE.UDR.Asymmetry')
    expect(finding?.message).toContain('10.20.1.4/32')
    expect(finding?.message).toContain('UDR, not an NSG route')
  })

  it('accepts a matching PE /32 route through the same NVA', () => {
    const { nodes, edges } = classicNvaDesign(true)

    const findings = validateDesign(nodes, edges)

    expect(findings).not.toContainEqual(expect.objectContaining({ ruleId: 'PE.UDR.Asymmetry' }))
  })
})

describe('design relationship validation', () => {
  it('accepts materialized containment and rejects unsupported customer links', () => {
    const nodes = [
      node('vnet', 'VNet', { addressSpace: ['10.0.0.0/16'] }),
      node('subnet', 'Subnet', { addressPrefix: '10.0.1.0/24' }, 'vnet'),
      node('vm', 'VM'),
    ]
    const edges: Edge[] = [
      { id: 'contains', source: 'vnet', target: 'subnet', label: 'contains', data: { relationship: 'contains' } },
      { id: 'invalid', source: 'vm', target: 'subnet', label: 'routes for', data: { relationship: 'routes for' } },
    ]

    const findings = validateDesign(nodes, edges)

    expect(findings).not.toContainEqual(expect.objectContaining({ ruleId: 'Relationship.Containment.Invalid' }))
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: 'Relationship.Unsupported', nodeId: 'vm' }))
  })

  it('flags duplicate and dangling links', () => {
    const nodes = [node('nsg', 'NSG'), node('subnet', 'Subnet')]
    const edges: Edge[] = [
      { id: 'one', source: 'nsg', target: 'subnet', label: 'protects', data: { relationship: 'protects' } },
      { id: 'two', source: 'nsg', target: 'subnet', label: 'protects', data: { relationship: 'protects' } },
      { id: 'missing', source: 'nsg', target: 'gone', label: 'protects' },
    ]

    const findings = validateDesign(nodes, edges)

    expect(findings).toContainEqual(expect.objectContaining({ ruleId: 'Relationship.Duplicate' }))
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: 'Relationship.Dangling' }))
  })
})

describe('design IP range validation', () => {
  it('reports a design-level gap when every network range is absent', () => {
    const findings = validateDesign([
      node('vnet', 'VNet'),
      node('subnet', 'Subnet', {}, 'vnet'),
      node('vwan', 'Virtual WAN'),
      node('hub', 'Virtual Hub', {}, 'vwan'),
    ], [])

    expect(findings).toContainEqual(expect.objectContaining({ ruleId: 'Design.IPRanges.Missing' }))
    expect(findings).toContainEqual(expect.objectContaining({ ruleId: 'VHub.Prefix.Required', nodeId: 'hub' }))
  })
})

describe('discovered baseline delta validation', () => {
  it('blocks links that would mutate existing resources but allows a new PE target', () => {
    const subnet = node('subnet', 'Subnet', { addressPrefix: '10.0.1.0/24' })
    subnet.data.origin = {
      kind: 'discovered', resourceId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/vnet/subnets/subnet',
      resourceType: 'Microsoft.Network/virtualNetworks/subnets', subscriptionId: 'sub', resourceGroup: 'rg', capturedAt: '2026-08-30T00:00:00Z',
    }
    const storage = node('storage', 'Storage Account')
    storage.data.origin = {
      kind: 'discovered', resourceId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/data',
      resourceType: 'Microsoft.Storage/storageAccounts', subscriptionId: 'sub', resourceGroup: 'rg', capturedAt: '2026-08-30T00:00:00Z',
    }
    const findings = validateDesign([
      subnet,
      storage,
      node('nsg', 'NSG'),
      node('pe', 'Private Endpoint', {}, 'subnet'),
    ], [
      { id: 'nsg-link', source: 'nsg', target: 'subnet', label: 'protects', data: { relationship: 'protects' } },
      { id: 'pe-link', source: 'pe', target: 'storage', label: 'targets', data: { relationship: 'targets', properties: { groupId: 'blob' } } },
    ])

    expect(findings).toContainEqual(expect.objectContaining({ ruleId: 'Delta.Relationship.RequiresExistingUpdate', nodeId: 'nsg' }))
    expect(findings).not.toContainEqual(expect.objectContaining({ ruleId: 'PE.Target.Required', nodeId: 'pe' }))
  })

  it('blocks a new resource name that matches the discovered baseline', () => {
    const baseline = node('existing', 'Private Endpoint', { resourceName: 'data-pe' })
    baseline.data.origin = {
      kind: 'discovered', resourceId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/privateEndpoints/data-pe',
      resourceType: 'Microsoft.Network/privateEndpoints', subscriptionId: 'sub', resourceGroup: 'rg', capturedAt: '2026-08-30T00:00:00Z',
    }

    const findings = validateDesign([
      baseline,
      node('new', 'Private Endpoint', { resourceName: 'data-pe', targetResourceId: '/target', groupId: 'blob' }),
    ], [])

    expect(findings).toContainEqual(expect.objectContaining({ ruleId: 'Delta.NameCollision', nodeId: 'new' }))
  })
})

function vwanDesign(policy: string): { nodes: Node<DesignBlock>[]; edges: Edge[] } {
  const nodes = basePrivateEndpointNodes(policy)
  nodes.push(
    node('vwan', 'Virtual WAN'),
    node('hub', 'Virtual Hub', {}, 'vwan'),
    node('intent', 'Route Intent', { privateTraffic: 'NVA', nextHopResourceId: '/nva' }, 'hub'),
  )
  return {
    nodes,
    edges: [{ id: 'vnet-hub', source: 'vnet', target: 'hub' }],
  }
}

function classicNvaDesign(includeOverride: boolean): { nodes: Node<DesignBlock>[]; edges: Edge[] } {
  const routes = [
    'private|10.0.0.0/8|VirtualAppliance|10.30.10.4',
    ...(includeOverride ? ['pe|10.20.1.4/32|VirtualAppliance|10.30.10.4'] : []),
  ].join('\n')
  return {
    nodes: [
      ...basePrivateEndpointNodes('Enabled'),
      node('source-vnet', 'VNet', { addressSpace: ['10.30.0.0/16'] }),
      node('source-subnet', 'Subnet', { addressPrefix: '10.30.1.0/24' }, 'source-vnet'),
      node('routes', 'Route Table', { routes }),
    ],
    edges: [{ id: 'routes-source', source: 'routes', target: 'source-subnet' }],
  }
}

function basePrivateEndpointNodes(policy: string): Node<DesignBlock>[] {
  return [
    node('vnet', 'VNet', { addressSpace: ['10.20.0.0/16'] }),
    node('pe-subnet', 'Subnet', {
      addressPrefix: '10.20.1.0/24',
      privateEndpointPolicies: policy,
    }, 'vnet'),
    node('pe', 'Private Endpoint', { privateIpAddress: '10.20.1.4' }, 'pe-subnet'),
  ]
}

function node(
  id: string,
  blockType: string,
  properties: Record<string, unknown> = {},
  parentId?: string,
): Node<DesignBlock> {
  return {
    id,
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId } : {}),
    data: { label: id, blockType, properties },
  }
}