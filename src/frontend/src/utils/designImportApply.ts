import { MarkerType, type Edge, type Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import type { DesignImportProposal } from '@/services/designImportService'
import { blockCategories } from '@/components/designer/blockMetadata'
import {
  canConnect,
  canContain,
  containerSize,
  isContainer,
} from '@/components/designer/relationships'

interface EdgeData {
  relationship?: string
  properties?: Record<string, unknown>
}

export type DesignImportApplyMode = 'merge' | 'replace'

export interface AppliedDesignImport {
  nodes: Node<DesignBlock>[]
  edges: Edge<EdgeData>[]
  warnings: string[]
}

const supportedBlockTypes = new Set(
  blockCategories.flatMap((category) => category.blocks.map((block) => block.type)),
)

export function applyDesignImport(
  proposal: DesignImportProposal,
  selectedNodeIds: ReadonlySet<string>,
  existingNodes: Node<DesignBlock>[],
  existingEdges: Edge<EdgeData>[],
  mode: DesignImportApplyMode,
  importKey = Date.now().toString(36),
): AppliedDesignImport {
  const selected = proposal.nodes.filter(
    (node) => selectedNodeIds.has(node.id) && supportedBlockTypes.has(node.blockType),
  )
  const selectedById = new Map(selected.map((node) => [node.id, node]))
  const usedNodeIds = new Set(existingNodes.map((node) => node.id.toLowerCase()))
  const idMap = new Map(selected.map((node, index) => [
    node.id,
    uniqueImportedId(`import-${importKey}-${safeId(node.id, index + 1)}`, usedNodeIds),
  ]))
  const warnings: string[] = []

  const minX = selected.length > 0 ? Math.min(...selected.map((node) => node.x)) : 0
  const existingRight = existingNodes.reduce((right, node) => {
    const width = typeof node.style?.width === 'number' ? node.style.width : 220
    return Math.max(right, node.position.x + width)
  }, 0)
  const offsetX = mode === 'merge' && existingNodes.length > 0
    ? existingRight + 160 - minX
    : 0

  const importedNodes = selected
    .slice()
    .sort((a, b) => nodeDepth(a.id, selectedById) - nodeDepth(b.id, selectedById))
    .map((node) => {
      const mappedParentId = node.parentId ? idMap.get(node.parentId) : undefined
      const parent = node.parentId ? selectedById.get(node.parentId) : undefined
      const validParent = !!mappedParentId && !!parent && canContain(parent.blockType, node.blockType)
      if (node.parentId && !validParent) {
        warnings.push(`${node.label}: ignored unsupported parent relationship.`)
      }
      const isContainerNode = isContainer(node.blockType)
      const size = containerSize(node.blockType)
      const absolutePosition = { x: node.x + offsetX, y: node.y }
      const position = validParent && parent
        ? { x: node.x - parent.x, y: node.y - parent.y }
        : absolutePosition

      return {
        id: idMap.get(node.id)!,
        type: isContainerNode ? 'azureContainer' : 'azureResource',
        position,
        ...(validParent
          ? { parentId: mappedParentId, parentNode: mappedParentId, extent: 'parent' as const }
          : {}),
        ...(isContainerNode
          ? { style: { width: size.width, height: size.height }, zIndex: -1 }
          : {}),
        data: {
          label: node.label,
          blockType: node.blockType,
          properties: {
            importConfidence: node.confidence,
            importEvidence: node.evidence,
            importSource: proposal.sourceFileName,
          },
        },
      } satisfies Node<DesignBlock>
    })

  const importedEdges: Edge<EdgeData>[] = []
  const usedEdgeIds = new Set(existingEdges.map((edge) => edge.id.toLowerCase()))
  for (const edge of proposal.edges) {
    const source = selectedById.get(edge.source)
    const target = selectedById.get(edge.target)
    const sourceId = idMap.get(edge.source)
    const targetId = idMap.get(edge.target)
    if (!source || !target || !sourceId || !targetId) continue
    const connection = canConnect(source.blockType, target.blockType)
    if (!connection.allowed) {
      warnings.push(`${source.label} → ${target.label}: ${connection.reason ?? 'unsupported relationship'}`)
      continue
    }
    const label = connection.label ?? edge.relationship
    importedEdges.push({
      id: uniqueImportedId(
        `import-${importKey}-${safeId(edge.id, importedEdges.length + 1)}`,
        usedEdgeIds,
      ),
      source: sourceId,
      target: targetId,
      label,
      style: { strokeWidth: 2, stroke: '#94a3b8' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
      labelStyle: { fontSize: 10, fontWeight: 600, fill: '#475569' },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
      labelBgPadding: [4, 2],
      labelBgBorderRadius: 4,
      data: {
        relationship: label,
        properties: {
          importConfidence: edge.confidence,
          importEvidence: edge.evidence,
        },
      },
    })
  }

  return {
    nodes: mode === 'replace' ? importedNodes : [...existingNodes, ...importedNodes],
    edges: mode === 'replace' ? importedEdges : [...existingEdges, ...importedEdges],
    warnings: [...new Set(warnings)],
  }
}

function nodeDepth(
  id: string,
  nodes: ReadonlyMap<string, DesignImportProposal['nodes'][number]>,
  visited = new Set<string>(),
): number {
  if (visited.has(id)) return 0
  visited.add(id)
  const parentId = nodes.get(id)?.parentId
  return parentId && nodes.has(parentId) ? 1 + nodeDepth(parentId, nodes, visited) : 0
}

function safeId(value: string, fallback: number): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '')
  return normalized || `item-${fallback}`
}

function uniqueImportedId(baseId: string, usedIds: Set<string>): string {
  let candidate = baseId
  let suffix = 2
  while (usedIds.has(candidate.toLowerCase())) candidate = `${baseId}-${suffix++}`
  usedIds.add(candidate.toLowerCase())
  return candidate
}