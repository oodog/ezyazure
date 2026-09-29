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

type ImportNode = DesignImportProposal['nodes'][number]

const RESOURCE_SIZE = { width: 176, height: 64 }
const MIN_CONTAINER = { width: 240, height: 140 }
const CONTAINER_HEADER = 28
const CONTAINER_PADDING = 16

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

  // Scale the source layout so Azure-sized icons (often ~50px in draw.io or
  // screenshots) do not overlap once rendered as full designer cards.
  const scale = layoutScale(selected)
  const minX = selected.length > 0 ? Math.min(...selected.map((node) => node.x)) : 0
  const minY = selected.length > 0 ? Math.min(...selected.map((node) => node.y)) : 0
  const existingRight = existingNodes.reduce((right, node) => {
    const width = typeof node.style?.width === 'number' ? node.style.width : 220
    return Math.max(right, node.position.x + width)
  }, 0)
  const originX = mode === 'merge' && existingNodes.length > 0 ? existingRight + 160 : minX
  const absoluteOf = (node: ImportNode) => ({
    x: (node.x - minX) * scale + originX,
    y: (node.y - minY) * scale + minY,
  })

  const validParentOf = new Map<string, ImportNode>()
  for (const node of selected) {
    const parent = node.parentId ? selectedById.get(node.parentId) : undefined
    if (parent && canContain(parent.blockType, node.blockType)) {
      validParentOf.set(node.id, parent)
    } else if (node.parentId) {
      warnings.push(`${node.label}: ignored unsupported parent relationship.`)
    }
  }

  const ordered = selected
    .slice()
    .sort((a, b) => nodeDepth(a.id, selectedById) - nodeDepth(b.id, selectedById))
  const positions = new Map<string, { x: number; y: number }>()
  for (const node of ordered) {
    const parent = validParentOf.get(node.id)
    const absolute = absoluteOf(node)
    if (!parent) {
      positions.set(node.id, absolute)
      continue
    }
    const parentAbsolute = absoluteOf(parent)
    // Keep children clear of the container header and border.
    positions.set(node.id, {
      x: Math.max(CONTAINER_PADDING, absolute.x - parentAbsolute.x),
      y: Math.max(CONTAINER_HEADER + CONTAINER_PADDING, absolute.y - parentAbsolute.y),
    })
  }

  // Size containers bottom-up so every child fits, instead of relying on the
  // fixed defaults that clipped imported children.
  const sizes = new Map<string, { width: number; height: number }>()
  for (const node of ordered.slice().reverse()) {
    if (!isContainer(node.blockType)) continue
    const fallback = containerSize(node.blockType)
    const hasSourceSize = (node.width ?? 0) > 0 && (node.height ?? 0) > 0
    let width = hasSourceSize ? Math.max(MIN_CONTAINER.width, node.width! * scale) : fallback.width
    let height = hasSourceSize ? Math.max(MIN_CONTAINER.height, node.height! * scale) : fallback.height
    for (const child of selected) {
      if (validParentOf.get(child.id)?.id !== node.id) continue
      const position = positions.get(child.id)!
      const size = sizes.get(child.id) ?? RESOURCE_SIZE
      width = Math.max(width, position.x + size.width + CONTAINER_PADDING)
      height = Math.max(height, position.y + size.height + CONTAINER_PADDING)
    }
    sizes.set(node.id, { width: Math.round(width), height: Math.round(height) })
  }

  const importedNodes = ordered.map((node) => {
    const mappedParentId = validParentOf.has(node.id) ? idMap.get(node.parentId!) : undefined
    const isContainerNode = isContainer(node.blockType)
    const size = sizes.get(node.id)
    const position = positions.get(node.id)!

    return {
      id: idMap.get(node.id)!,
      type: isContainerNode ? 'azureContainer' : 'azureResource',
      position: { x: Math.round(position.x), y: Math.round(position.y) },
      ...(mappedParentId
        ? { parentId: mappedParentId, parentNode: mappedParentId, extent: 'parent' as const }
        : {}),
      ...(isContainerNode && size
        ? { style: { width: size.width, height: size.height }, zIndex: -1 }
        : {}),
      data: {
        label: node.label,
        blockType: node.blockType,
        properties: {
          ...(node.properties ?? {}),
          importConfidence: node.confidence,
          importEvidence: node.evidence,
          importSource: proposal.sourceFileName,
        },
      },
    } satisfies Node<DesignBlock>
  })

  const importedEdges: Edge<EdgeData>[] = []
  const usedEdgeIds = new Set(existingEdges.map((edge) => edge.id.toLowerCase()))
  const edgeKeys = new Set<string>()
  for (const edge of proposal.edges) {
    let source = selectedById.get(edge.source)
    let target = selectedById.get(edge.target)
    let sourceId = idMap.get(edge.source)
    let targetId = idMap.get(edge.target)
    if (!source || !target || !sourceId || !targetId) continue
    // Containment drawn as a connector is already represented by nesting.
    if (validParentOf.get(target.id)?.id === source.id || validParentOf.get(source.id)?.id === target.id) continue
    let connection = canConnect(source.blockType, target.blockType)
    if (!connection.allowed) {
      // Diagram arrows are often drawn in the opposite direction to the
      // Azure association (for example Subnet → NSG), so try the reverse.
      const reversed = canConnect(target.blockType, source.blockType)
      if (reversed.allowed) {
        ;[source, target, sourceId, targetId] = [target, source, targetId, sourceId]
        connection = reversed
      }
    }
    if (!connection.allowed) {
      warnings.push(`${source.label} → ${target.label}: ${connection.reason ?? 'unsupported relationship'}`)
      continue
    }
    const edgeKey = `${sourceId}|${targetId}`
    if (edgeKeys.has(edgeKey)) continue
    edgeKeys.add(edgeKey)
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

function layoutScale(nodes: ImportNode[]): number {
  const leafWidths = nodes
    .filter((node) => !isContainer(node.blockType) && (node.width ?? 0) > 0)
    .map((node) => node.width!)
    .sort((a, b) => a - b)
  if (leafWidths.length === 0) return 1
  const median = leafWidths[Math.floor(leafWidths.length / 2)]
  return Math.min(2.5, Math.max(1, RESOURCE_SIZE.width / 1.6 / median))
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