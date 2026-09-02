import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from './designEdges'

export interface UnsupportedDeltaRelationship {
  edge: Edge<DesignEdgeData>
  reason: string
}

export interface DesignDelta {
  hasBaseline: boolean
  existingNodes: Node<DesignBlock>[]
  newNodes: Node<DesignBlock>[]
  existingEdges: Edge<DesignEdgeData>[]
  newEdges: Edge<DesignEdgeData>[]
  unsupportedRelationships: UnsupportedDeltaRelationship[]
  requiredDeploymentScopes: Array<{ subscriptionId: string; resourceGroup: string }>
}

export function analyzeDesignDelta(
  nodes: Node<DesignBlock>[],
  edges: Edge<DesignEdgeData>[],
): DesignDelta {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const existingNodes = nodes.filter((node) => node.data.origin?.kind === 'discovered')
  const newNodes = nodes.filter((node) => node.data.origin?.kind !== 'discovered')
  const existingEdges = edges.filter((edge) => edge.data?.origin === 'discovered')
  const newEdges = edges.filter((edge) => !edge.data?.generatedContainment && edge.data?.origin !== 'discovered')
  const hasBaseline = existingNodes.length > 0
  const unsupportedRelationships = hasBaseline
    ? newEdges.flatMap((edge): UnsupportedDeltaRelationship[] => {
        const source = nodeById.get(edge.source)
        const target = nodeById.get(edge.target)
        if (!source || !target) return [{ edge, reason: 'The relationship references a missing design resource.' }]
        const sourceIsNew = source.data.origin?.kind !== 'discovered'
        const targetIsExisting = target.data.origin?.kind === 'discovered'
        const relationship = String(edge.data?.relationship ?? edge.label ?? '').toLowerCase()
        if (sourceIsNew && source.data.blockType === 'Private Endpoint' && relationship === 'targets') return []
        if (!targetIsExisting && sourceIsNew) {
          return [{ edge, reason: 'This relationship between new resources is not yet emitted by additions-only Bicep.' }]
        }
        return [{ edge, reason: 'This link requires changing an existing Azure resource and is blocked from additions-only deployment.' }]
      })
    : []
  const requiredDeploymentScopes = newNodes.flatMap((node) => {
    let current = node
    const visited = new Set<string>()
    while (!visited.has(current.id)) {
      visited.add(current.id)
      const parentId = current.parentId ?? current.parentNode
      if (!parentId) return []
      const parent = nodeById.get(parentId)
      if (!parent) return []
      if (parent.data.origin?.kind === 'discovered') {
        return [{
          subscriptionId: parent.data.origin.subscriptionId,
          resourceGroup: parent.data.origin.resourceGroup,
        }]
      }
      current = parent
    }
    return []
  }).filter((scope, index, all) => all.findIndex((candidate) =>
    candidate.subscriptionId.toLowerCase() === scope.subscriptionId.toLowerCase() &&
    candidate.resourceGroup.toLowerCase() === scope.resourceGroup.toLowerCase()) === index)

  return { hasBaseline, existingNodes, newNodes, existingEdges, newEdges, unsupportedRelationships, requiredDeploymentScopes }
}