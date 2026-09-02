import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import { containmentEdgeId, materializeDesignEdges, type DesignEdgeData } from './designEdges'

describe('materializeDesignEdges', () => {
  it('draws every containment link and styles imported relationships', () => {
    const nodes = [
      node('vnet', 'VNet'),
      node('subnet', 'Subnet', 'vnet'),
      node('pe', 'Private Endpoint', 'subnet'),
      node('storage', 'Storage Account'),
    ]
    const explicit: Edge<DesignEdgeData>[] = [{
      id: 'pe-target',
      source: 'pe',
      target: 'storage',
      label: 'targets',
      data: { relationship: 'targets' },
    }]

    const edges = materializeDesignEdges(nodes, explicit)

    expect(edges).toHaveLength(3)
    expect(edges).toContainEqual(expect.objectContaining({
      id: containmentEdgeId('vnet', 'subnet'),
      source: 'vnet',
      target: 'subnet',
      label: 'contains',
      deletable: false,
    }))
    expect(edges).toContainEqual(expect.objectContaining({
      id: containmentEdgeId('subnet', 'pe'),
      source: 'subnet',
      target: 'pe',
    }))
    expect(edges.find((edge) => edge.id === 'pe-target')?.style).toMatchObject({
      stroke: '#059669',
      strokeWidth: 2.25,
    })
  })

  it('removes stale generated containment edges before rebuilding', () => {
    const nodes = [node('vnet', 'VNet'), node('subnet', 'Subnet', 'vnet')]
    const stale: Edge<DesignEdgeData>[] = [{
      id: 'contains:old:subnet',
      source: 'old',
      target: 'subnet',
      data: { relationship: 'contains', generatedContainment: true },
    }]

    const edges = materializeDesignEdges(nodes, stale)

    expect(edges.map((edge) => edge.id)).toEqual([containmentEdgeId('vnet', 'subnet')])
  })
})

function node(id: string, blockType: string, parentId?: string): Node<DesignBlock> {
  return {
    id,
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId, parentNode: parentId } : {}),
    data: { label: id, blockType, properties: {} },
  }
}