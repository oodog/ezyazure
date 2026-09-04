import type { Edge, Node } from 'reactflow'
import type { DesignerAssistantAction } from '@/services/designerAssistantService'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from '@/utils/designEdges'
import { getBlockSchema } from './blockSchemas'
import { canConnect, canContain, containerSize, isContainer } from './relationships'

export interface DesignerAssistantApplyResult {
  nodes: Node<DesignBlock>[]
  edges: Edge<DesignEdgeData>[]
  warnings: string[]
  appliedActions: number
}

const requiredParentTypes: Record<string, string[]> = {
  Subnet: ['VNet'],
  'Virtual Hub': ['Virtual WAN'],
  'Route Intent': ['Virtual Hub'],
  'Private Endpoint': ['Subnet'],
}

export function applyDesignerAssistantActions(
  currentNodes: Node<DesignBlock>[],
  currentEdges: Edge<DesignEdgeData>[],
  actions: DesignerAssistantAction[],
  createId: (prefix: string, index: number) => string = (prefix, index) =>
    `${slug(prefix)}-${Date.now()}-${index + 1}`,
): DesignerAssistantApplyResult {
  let nodes = [...currentNodes]
  let edges = [...currentEdges]
  const warnings: string[] = []
  const refs = new Map<string, string>(currentNodes.map((node) => [node.id.toLowerCase(), node.id]))
  let appliedActions = 0

  actions.forEach((action, index) => {
    if (action.kind === 'addNode') {
      const blockType = action.blockType?.trim()
      const nodeRef = action.nodeRef?.trim()
      if (!blockType || !nodeRef || !getBlockSchema(blockType)) {
        warnings.push('Skipped a resource with an unsupported type or missing reference.')
        return
      }
      if (refs.has(nodeRef.toLowerCase())) {
        warnings.push(`Skipped duplicate resource reference "${nodeRef}".`)
        return
      }

      const parentId = resolveRef(action.parentRef, refs)
      const parent = parentId ? nodes.find((node) => node.id === parentId) : undefined
      const requiredParents = requiredParentTypes[blockType]
      if (requiredParents && (!parent || !requiredParents.includes(parent.data.blockType))) {
        warnings.push(`${blockType} requires a ${requiredParents.join(' or ')} parent.`)
        return
      }
      if (parent && !canContain(parent.data.blockType, blockType)) {
        warnings.push(`${parent.data.blockType} cannot contain ${blockType}.`)
        return
      }

      const id = uniqueId(createId(blockType, index), nodes)
      const container = isContainer(blockType)
      const size = containerSize(blockType)
      const properties = {
        ...defaultProperties(blockType),
        ...normalizeProperties(blockType, action.properties),
      }
      const siblingCount = parentId
        ? nodes.filter((node) => (node.parentId ?? node.parentNode) === parentId).length
        : nodes.filter((node) => !node.parentId && !node.parentNode).length
      const position = parentId
        ? { x: 24 + (siblingCount % 2) * 140, y: 56 + Math.floor(siblingCount / 2) * 110 }
        : { x: 80 + (siblingCount % 4) * 250, y: 80 + Math.floor(siblingCount / 4) * 210 }
      const node: Node<DesignBlock> = {
        id,
        type: container ? 'azureContainer' : 'azureResource',
        position,
        ...(parentId ? { parentId, parentNode: parentId, extent: 'parent' as const } : {}),
        ...(container ? { style: { width: size.width, height: size.height }, zIndex: -1 } : {}),
        data: {
          label: action.label?.trim() || blockType,
          blockType,
          properties,
        },
      }
      nodes = [...nodes, node]
      refs.set(nodeRef.toLowerCase(), id)
      appliedActions += 1
      return
    }

    if (action.kind === 'updateNode') {
      const nodeId = resolveRef(action.nodeRef, refs)
      const existing = nodeId ? nodes.find((node) => node.id === nodeId) : undefined
      if (!existing || existing.data.origin?.kind === 'discovered') {
        warnings.push('Skipped an update to an unknown or discovered baseline resource.')
        return
      }
      const properties = normalizeProperties(existing.data.blockType, action.properties)
      nodes = nodes.map((node) => node.id === nodeId
        ? {
            ...node,
            data: {
              ...node.data,
              label: action.label?.trim() || node.data.label,
              properties: { ...node.data.properties, ...properties },
            },
          }
        : node)
      appliedActions += 1
      return
    }

    if (action.kind === 'connect') {
      const source = resolveRef(action.sourceRef, refs)
      const target = resolveRef(action.targetRef, refs)
      const sourceNode = source ? nodes.find((node) => node.id === source) : undefined
      const targetNode = target ? nodes.find((node) => node.id === target) : undefined
      if (!source || !target || !sourceNode || !targetNode || source === target) {
        warnings.push('Skipped a connection with an unknown or identical endpoint.')
        return
      }
      const relationship = canConnect(sourceNode.data.blockType, targetNode.data.blockType)
      if (!relationship.allowed || !relationship.label) {
        warnings.push(relationship.reason ?? `Cannot connect ${sourceNode.data.blockType} to ${targetNode.data.blockType}.`)
        return
      }
      if (edges.some((edge) => edge.source === source && edge.target === target)) {
        warnings.push(`Skipped duplicate connection from ${sourceNode.data.label} to ${targetNode.data.label}.`)
        return
      }
      edges = [...edges, {
        id: uniqueEdgeId(`e-${source}-${target}`, edges),
        source,
        target,
        label: relationship.label,
        data: { relationship: relationship.label, properties: {} },
      }]
      appliedActions += 1
    }
  })

  return { nodes, edges, warnings, appliedActions }
}

function resolveRef(value: string | null | undefined, refs: ReadonlyMap<string, string>): string | undefined {
  if (!value) return undefined
  return refs.get(value.trim().toLowerCase())
}

function normalizeProperties(blockType: string, values: Record<string, string>): Record<string, unknown> {
  const schema = getBlockSchema(blockType)
  if (!schema) return {}
  const fields = new Map(schema.fields.map((field) => [field.key, field]))
  const result: Record<string, unknown> = {}
  Object.entries(values ?? {}).forEach(([key, raw]) => {
    const field = fields.get(key)
    if (!field || typeof raw !== 'string') return
    if (field.type === 'cidrList' || field.type === 'tags' || field.type === 'multiselect') {
      result[key] = raw.split(',').map((value) => value.trim()).filter(Boolean)
    } else if (field.type === 'checkbox') {
      result[key] = raw.toLowerCase() === 'true'
    } else if (field.type === 'number') {
      const number = Number(raw)
      if (Number.isFinite(number)) result[key] = number
    } else {
      result[key] = raw.trim()
    }
  })
  return result
}

function defaultProperties(blockType: string): Record<string, unknown> {
  const schema = getBlockSchema(blockType)
  return Object.fromEntries(
    schema?.fields.filter((field) => field.default !== undefined)
      .map((field) => [field.key, field.default]) ?? [],
  )
}

function uniqueId(candidate: string, nodes: Node<DesignBlock>[]): string {
  const ids = new Set(nodes.map((node) => node.id))
  if (!ids.has(candidate)) return candidate
  let suffix = 2
  while (ids.has(`${candidate}-${suffix}`)) suffix += 1
  return `${candidate}-${suffix}`
}

function uniqueEdgeId(candidate: string, edges: Edge<DesignEdgeData>[]): string {
  const ids = new Set(edges.map((edge) => edge.id))
  if (!ids.has(candidate)) return candidate
  let suffix = 2
  while (ids.has(`${candidate}-${suffix}`)) suffix += 1
  return `${candidate}-${suffix}`
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resource'
}