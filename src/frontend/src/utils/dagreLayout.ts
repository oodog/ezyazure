import dagre from 'dagre'
import type { Edge, Node } from 'reactflow'

const NODE_W = 220
const NODE_H = 100

/**
 * Apply a left-to-right dagre layout so the topology nodes don't overlap.
 * Resource-type rows (VNets, subnets, NSG/route-tables, VMs, etc.) flow
 * naturally without manual placement.
 */
export function applyDagreLayout<T>(nodes: Node<T>[], edges: Edge[]): Node<T>[] {
  if (nodes.length === 0) return nodes

  const graph = new dagre.graphlib.Graph()
  graph.setDefaultEdgeLabel(() => ({}))
  graph.setGraph({
    rankdir: 'LR',
    nodesep: 40,
    ranksep: 90,
    marginx: 20,
    marginy: 20,
  })

  for (const n of nodes) {
    graph.setNode(n.id, { width: NODE_W, height: NODE_H })
  }
  for (const e of edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
      graph.setEdge(e.source, e.target)
    }
  }

  dagre.layout(graph)

  return nodes.map((n) => {
    const pos = graph.node(n.id)
    if (!pos) return n
    return {
      ...n,
      position: { x: pos.x - NODE_W / 2, y: pos.y - NODE_H / 2 },
    }
  })
}
