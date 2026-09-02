import { MarkerType, type Edge, type Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'

export interface DesignEdgeData {
  relationship?: string
  properties?: Record<string, unknown>
  generatedContainment?: boolean
  origin?: 'discovered'
  baselineRelationshipId?: string
}

interface EdgeVisual {
  stroke: string
  strokeWidth: number
  dash?: string
  opacity: number
}

export function materializeDesignEdges(
  nodes: Node<DesignBlock>[],
  explicitEdges: Edge<DesignEdgeData>[],
): Edge<DesignEdgeData>[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const storedEdges = explicitEdges.filter((edge) => !edge.data?.generatedContainment)
  const containmentEdges = nodes.flatMap((node): Edge<DesignEdgeData>[] => {
    const parentId = node.parentId ?? node.parentNode
    if (!parentId || !nodeById.has(parentId)) return []
    return [{
      id: containmentEdgeId(parentId, node.id),
      source: parentId,
      target: node.id,
      label: 'contains',
      deletable: false,
      focusable: false,
      data: { relationship: 'contains', generatedContainment: true, properties: {} },
    }]
  })

  return [...storedEdges, ...containmentEdges].map((edge) => {
    const sourceType = nodeById.get(edge.source)?.data.blockType ?? ''
    const targetType = nodeById.get(edge.target)?.data.blockType ?? ''
    const visual = relationshipVisual(
      sourceType,
      targetType,
      edge.data?.relationship ?? String(edge.label ?? ''),
      edge.data?.generatedContainment === true,
    )
    return {
      ...edge,
      animated: false,
      style: {
        ...(edge.style ?? {}),
        stroke: visual.stroke,
        strokeWidth: visual.strokeWidth,
        strokeDasharray: visual.dash,
        opacity: visual.opacity,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color: visual.stroke },
      labelStyle: { fontSize: 10, fontWeight: 600, fill: visual.stroke },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.92 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    }
  })
}

export function containmentEdgeId(parentId: string, childId: string): string {
  return `contains:${parentId}:${childId}`
}

function relationshipVisual(
  sourceType: string,
  targetType: string,
  relationship: string,
  containment: boolean,
): EdgeVisual {
  const relation = relationship.toLowerCase()
  if (containment || relation === 'contains')
    return { stroke: '#64748b', strokeWidth: 1.5, dash: '4 4', opacity: 0.72 }
  if (sourceType === 'NSG' || sourceType === 'Azure Firewall' || relation.includes('protect'))
    return { stroke: '#dc2626', strokeWidth: 2.25, opacity: 0.85 }
  if (sourceType === 'Route Table' || sourceType === 'Route Intent' || relation.includes('route') || relation.includes('next-hop'))
    return { stroke: '#d97706', strokeWidth: 2.25, opacity: 0.85 }
  if ((sourceType === 'VNet' && targetType === 'VNet') || relation.includes('peer') || relation.includes('vnet connection'))
    return { stroke: '#2563eb', strokeWidth: 2.25, dash: '7 4', opacity: 0.85 }
  if (sourceType === 'Private Endpoint' || sourceType === 'Private DNS Zone' || relation.includes('linked'))
    return { stroke: '#059669', strokeWidth: 2.25, opacity: 0.85 }
  if (sourceType === 'Load Balancer' || sourceType === 'Application Gateway' || relation.includes('front') || relation.includes('load balance'))
    return { stroke: '#0891b2', strokeWidth: 2.25, opacity: 0.85 }
  if (sourceType === 'Managed Identity' || sourceType === 'RBAC Assignment' || relation.includes('role') || relation === 'uses')
    return { stroke: '#7c3aed', strokeWidth: 2, opacity: 0.82 }
  return { stroke: '#475569', strokeWidth: 2, opacity: 0.78 }
}