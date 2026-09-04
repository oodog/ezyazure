import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { DesignerAssistantAction } from '@/services/designerAssistantService'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from '@/utils/designEdges'
import { applyDesignerAssistantActions } from './designerAssistantActions'

describe('applyDesignerAssistantActions', () => {
  it('creates a subnet, storage account, private endpoint, and target connection', () => {
    const actions: DesignerAssistantAction[] = [
      add('subnet', 'Subnet', 'Data endpoints', 'vnet-id', { addressPrefix: '10.20.4.0/24' }),
      add('storage', 'Storage Account', 'Project storage', undefined, { resourceName: 'stprojectdata' }),
      add('pe', 'Private Endpoint', 'Storage private endpoint', 'subnet', { groupId: 'blob' }),
      connect('pe', 'storage'),
    ]

    const result = applyDesignerAssistantActions(
      [node('vnet-id', 'VNet', {}, undefined, false)],
      [],
      actions,
      (prefix, index) => `${prefix.toLowerCase().replace(/ /g, '-')}-${index}`,
    )

    expect(result.appliedActions).toBe(4)
    expect(result.warnings).toEqual([])
    const subnet = result.nodes.find((item) => item.data.blockType === 'Subnet')
    const endpoint = result.nodes.find((item) => item.data.blockType === 'Private Endpoint')
    const storage = result.nodes.find((item) => item.data.blockType === 'Storage Account')
    expect(subnet?.parentId).toBe('vnet-id')
    expect(subnet?.data.properties.addressPrefix).toBe('10.20.4.0/24')
    expect(endpoint?.parentId).toBe(subnet?.id)
    expect(result.edges).toContainEqual(expect.objectContaining({ source: endpoint?.id, target: storage?.id }))
  })

  it('rejects invalid containment and relationships', () => {
    const result = applyDesignerAssistantActions(
      [node('storage', 'Storage Account')],
      [],
      [
        add('subnet', 'Subnet', 'Invalid subnet', 'storage', { addressPrefix: '10.0.1.0/24' }),
        connect('storage', 'storage'),
      ],
    )

    expect(result.appliedActions).toBe(0)
    expect(result.warnings).toHaveLength(2)
  })

  it('does not update discovered baseline nodes', () => {
    const baseline = node('baseline', 'VNet', { addressSpace: ['10.0.0.0/16'] }, undefined, true)
    const result = applyDesignerAssistantActions(
      [baseline],
      [],
      [{
        kind: 'updateNode',
        nodeRef: 'baseline',
        properties: { addressSpace: '10.99.0.0/16' },
        explanation: 'Change address space.',
      }],
    )

    expect(result.appliedActions).toBe(0)
    expect(result.nodes[0].data.properties.addressSpace).toEqual(['10.0.0.0/16'])
    expect(result.warnings[0]).toContain('baseline')
  })

  it('applies a default route through a firewall IP and associates it to a subnet', () => {
    const existingNodes = [
      node('vnet', 'VNet'),
      node('subnet', 'Subnet', { addressPrefix: '10.0.1.0/24' }, 'vnet'),
      node('firewall', 'Azure Firewall', { privateIpAddress: '10.0.0.4' }),
    ]
    const actions: DesignerAssistantAction[] = [
      add('routes', 'Route Table', 'Firewall routes', undefined, {
        routes: 'to-firewall|0.0.0.0/0|VirtualAppliance|10.0.0.4',
      }),
      connect('routes', 'subnet'),
    ]

    const result = applyDesignerAssistantActions(existingNodes, [], actions, () => 'routes-id')

    expect(result.appliedActions).toBe(2)
    expect(result.nodes.find((item) => item.id === 'routes-id')?.data.properties.routes)
      .toBe('to-firewall|0.0.0.0/0|VirtualAppliance|10.0.0.4')
    expect(result.edges).toContainEqual(expect.objectContaining({ source: 'routes-id', target: 'subnet' }))
  })
})

function add(
  nodeRef: string,
  blockType: string,
  label: string,
  parentRef?: string,
  properties: Record<string, string> = {},
): DesignerAssistantAction {
  return { kind: 'addNode', nodeRef, blockType, label, parentRef, properties, explanation: `Add ${label}.` }
}

function connect(sourceRef: string, targetRef: string): DesignerAssistantAction {
  return { kind: 'connect', sourceRef, targetRef, properties: {}, explanation: 'Connect resources.' }
}

function node(
  id: string,
  blockType: string,
  properties: Record<string, unknown> = {},
  parentId?: string,
  discovered = false,
): Node<DesignBlock> {
  return {
    id,
    type: blockType === 'VNet' || blockType === 'Subnet' ? 'azureContainer' : 'azureResource',
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId, parentNode: parentId } : {}),
    data: {
      label: blockType,
      blockType,
      properties,
      ...(discovered ? {
        origin: {
          kind: 'discovered' as const,
          resourceId: `/resources/${id}`,
          resourceType: blockType,
          subscriptionId: 'sub',
          resourceGroup: 'rg',
          capturedAt: '2026-09-04T00:00:00Z',
        },
      } : {}),
    },
  }
}

const _edgeTypeCheck: Edge<DesignEdgeData>[] = []
void _edgeTypeCheck