// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { Edge, Node } from 'reactflow'
import type { AzureResource } from '@/types/azure'
import { parseDrawioXml } from './designImportDocument'
import {
  createDrawioXml,
  getTopologyImageLayout,
  topologyExportFileName,
} from './topologyExport'

describe('topology export', () => {
  it('creates draw.io XML that round-trips nodes and edges', () => {
    const nodes = [
      resourceNode('vnet', 'Hub & Spoke VNet', 'Microsoft.Network/virtualNetworks', 20, 30),
      resourceNode('pe', 'Storage "Private" Endpoint', 'Microsoft.Network/privateEndpoints', 420, 180),
    ]
    const edges: Edge[] = [{
      id: 'connection',
      source: 'vnet',
      target: 'pe',
      label: 'connected to & secures',
      data: { category: 'connectedTo' },
    }]

    const xml = createDrawioXml(nodes, edges, 'Network & Private Link')
    const hints = parseDrawioXml(xml)

    expect(hints).toHaveLength(3)
    expect(hints).toContainEqual(expect.objectContaining({
      id: 'node-2',
      kind: 'shape',
      x: 20,
      y: 30,
      width: 220,
      height: 100,
    }))
    expect(hints).toContainEqual(expect.objectContaining({
      id: 'edge-2',
      kind: 'edge',
      sourceId: 'node-2',
      targetId: 'node-3',
    }))
    expect(xml).toContain('Hub &amp; Spoke VNet')
    expect(xml).toContain('easyazureResourceType="Microsoft.Network/privateEndpoints"')
    expect(xml).not.toContain('<parsererror')
  })

  it('sizes an image for the complete graph with default node dimensions', () => {
    const nodes = [
      resourceNode('left', 'Left', 'Microsoft.Network/virtualNetworks', 0, 0),
      resourceNode('right', 'Right', 'Microsoft.Network/privateEndpoints', 1800, 900),
    ]

    const layout = getTopologyImageLayout(nodes)

    expect(layout.bounds).toMatchObject({ x: 0, y: 0, width: 2020, height: 1000 })
    expect(layout.width).toBe(2180)
    expect(layout.height).toBe(1160)
    expect(layout.viewport.zoom).toBeGreaterThan(0)
  })

  it('expands the draw.io page to contain a large topology', () => {
    const nodes = [
      resourceNode('left', 'Left', 'Microsoft.Network/virtualNetworks', 0, 0),
      resourceNode('right', 'Right', 'Microsoft.Network/privateEndpoints', 1800, 900),
    ]

    const xml = createDrawioXml(nodes, [])

    expect(xml).toContain('pageWidth="2100"')
    expect(xml).toContain('pageHeight="1080"')
  })

  it('builds a dated, filesystem-safe filename', () => {
    expect(topologyExportFileName('Network + Compute', 'drawio', new Date('2026-08-15T10:00:00Z')))
      .toBe('easyazure-network-compute-2026-08-15.drawio')
  })
})

function resourceNode(
  id: string,
  name: string,
  type: string,
  x: number,
  y: number,
): Node<AzureResource> {
  return {
    id,
    position: { x, y },
    data: {
      id: `/subscriptions/sub/resourceGroups/rg/providers/${type}/${id}`,
      type,
      name,
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      location: 'australiaeast',
      properties: {},
    },
  }
}