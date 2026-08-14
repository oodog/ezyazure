import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import { applyDagreLayout } from './dagreLayout'

describe('applyDagreLayout', () => {
  it('returns an empty graph unchanged', () => {
    expect(applyDagreLayout([], [])).toEqual([])
  })

  it('places connected nodes at distinct finite positions', () => {
    const nodes: Node<{ label: string }>[] = [
      { id: 'source', position: { x: 0, y: 0 }, data: { label: 'Source' } },
      { id: 'target', position: { x: 0, y: 0 }, data: { label: 'Target' } },
    ]
    const edges: Edge[] = [{ id: 'edge', source: 'source', target: 'target' }]

    const result = applyDagreLayout(nodes, edges)

    expect(result).toHaveLength(2)
    expect(result.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true)
    expect(result[0].position).not.toEqual(result[1].position)
  })
})