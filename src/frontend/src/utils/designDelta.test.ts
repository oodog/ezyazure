import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from './designEdges'
import { analyzeDesignDelta } from './designDelta'

describe('analyzeDesignDelta', () => {
  it('keeps discovered resources in the baseline and allows a new PE target link', () => {
    const nodes = [
      node('subnet', 'Subnet', true),
      node('storage', 'Storage Account', true),
      node('pe', 'Private Endpoint', false),
    ]
    const edges: Edge<DesignEdgeData>[] = [
      { id: 'baseline', source: 'subnet', target: 'storage', data: { origin: 'discovered', relationship: 'uses' } },
      { id: 'target', source: 'pe', target: 'storage', label: 'targets', data: { relationship: 'targets' } },
    ]

    const delta = analyzeDesignDelta(nodes, edges)

    expect(delta.existingNodes.map((item) => item.id)).toEqual(['subnet', 'storage'])
    expect(delta.newNodes.map((item) => item.id)).toEqual(['pe'])
    expect(delta.unsupportedRelationships).toHaveLength(0)
  })

  it('blocks a link that would mutate an existing subnet', () => {
    const nodes = [node('subnet', 'Subnet', true), node('nsg', 'NSG', false)]
    const edges: Edge<DesignEdgeData>[] = [
      { id: 'protects', source: 'nsg', target: 'subnet', label: 'protects', data: { relationship: 'protects' } },
    ]

    const delta = analyzeDesignDelta(nodes, edges)

    expect(delta.unsupportedRelationships).toContainEqual(expect.objectContaining({
      edge: expect.objectContaining({ id: 'protects' }),
      reason: expect.stringContaining('changing an existing Azure resource'),
    }))
  })

  it('detects additions that require separate baseline deployment scopes', () => {
    const first = node('first', 'VNet', true)
    const second = node('second', 'VNet', true)
    second.data.origin = { ...second.data.origin!, subscriptionId: 'sub-2', resourceGroup: 'rg-2' }
    const firstSubnet = node('first-subnet', 'Subnet', false)
    firstSubnet.parentId = 'first'
    const secondSubnet = node('second-subnet', 'Subnet', false)
    secondSubnet.parentId = 'second'

    const delta = analyzeDesignDelta([first, second, firstSubnet, secondSubnet], [])

    expect(delta.requiredDeploymentScopes).toEqual([
      { subscriptionId: 'sub', resourceGroup: 'rg' },
      { subscriptionId: 'sub-2', resourceGroup: 'rg-2' },
    ])
  })
})

function node(id: string, blockType: string, discovered: boolean): Node<DesignBlock> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      label: id,
      blockType,
      properties: {},
      ...(discovered ? {
        origin: {
          kind: 'discovered' as const,
          resourceId: `/subscriptions/sub/resourceGroups/rg/providers/${id}`,
          resourceType: blockType,
          subscriptionId: 'sub',
          resourceGroup: 'rg',
          capturedAt: '2026-08-30T00:00:00Z',
        },
      } : {}),
    },
  }
}