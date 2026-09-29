import { describe, expect, it } from 'vitest'
import type { DesignImportProposal } from '@/services/designImportService'
import { applyDesignImport } from './designImportApply'

const proposal: DesignImportProposal = {
  summary: 'Hub and spoke',
  sourceFileName: 'network.pdf',
  model: 'gpt-4o-mini',
  warnings: [],
  nodes: [
    { id: 'vnet', blockType: 'VNet', label: 'Hub', x: 100, y: 100, confidence: 0.95, evidence: 'label', properties: { addressSpace: ['10.20.0.0/16'] } },
    { id: 'subnet', blockType: 'Subnet', label: 'Workload', x: 150, y: 170, parentId: 'vnet', confidence: 0.9, evidence: 'inside hub', properties: { addressPrefix: '10.20.1.0/24' } },
    { id: 'nsg', blockType: 'NSG', label: 'Workload NSG', x: 500, y: 170, confidence: 0.8, evidence: 'shield icon', properties: {} },
  ],
  edges: [
    { id: 'protects', source: 'nsg', target: 'subnet', relationship: 'protects', confidence: 0.8, evidence: 'line' },
    { id: 'invalid', source: 'subnet', target: 'nsg', relationship: 'reverse', confidence: 0.3, evidence: 'line' },
  ],
}

describe('applyDesignImport', () => {
  it('creates valid containment and repairs reversed edge directions', () => {
    const result = applyDesignImport(
      proposal,
      new Set(proposal.nodes.map((node) => node.id)),
      [],
      [],
      'replace',
      'test',
    )

    expect(result.nodes).toHaveLength(3)
    const subnet = result.nodes.find((node) => node.data.blockType === 'Subnet')
    expect(subnet?.parentId).toBe('import-test-vnet')
    expect(subnet?.position).toEqual({ x: 50, y: 70 })
    expect(subnet?.data.properties.addressPrefix).toBe('10.20.1.0/24')
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].label).toBe('protects')
    expect(result.edges[0].source).toBe('import-test-nsg')
    expect(result.warnings).toEqual([])
  })

  it('grows containers to fit children and scales small source icons', () => {
    const nested: DesignImportProposal = {
      ...proposal,
      nodes: [
        { id: 'vnet', blockType: 'VNet', label: 'Hub', x: 0, y: 0, width: 200, height: 120, confidence: 1, evidence: '', properties: {} },
        { id: 'subnet', blockType: 'Subnet', label: 'App', x: 20, y: 30, width: 160, height: 80, parentId: 'vnet', confidence: 1, evidence: '', properties: {} },
        { id: 'vm1', blockType: 'VM', label: 'vm1', x: 30, y: 50, width: 50, height: 50, parentId: 'subnet', confidence: 1, evidence: '', properties: {} },
        { id: 'vm2', blockType: 'VM', label: 'vm2', x: 110, y: 50, width: 50, height: 50, parentId: 'subnet', confidence: 1, evidence: '', properties: {} },
      ],
      edges: [
        { id: 'contains', source: 'vnet', target: 'subnet', relationship: 'contains', confidence: 1, evidence: '' },
      ],
    }

    const result = applyDesignImport(nested, new Set(nested.nodes.map((node) => node.id)), [], [], 'replace', 't')
    const byId = new Map(result.nodes.map((node) => [node.id, node]))
    const vm1 = byId.get('import-t-vm1')!
    const vm2 = byId.get('import-t-vm2')!
    const subnet = byId.get('import-t-subnet')!
    const vnet = byId.get('import-t-vnet')!

    // Leaf cards must not overlap after scaling.
    expect(vm2.position.x - vm1.position.x).toBeGreaterThanOrEqual(176)
    expect(subnet.style?.width).toBeGreaterThanOrEqual(vm2.position.x + 176)
    expect(vnet.style?.width).toBeGreaterThanOrEqual(subnet.position.x + (subnet.style?.width as number))
    expect(vnet.style?.height).toBeGreaterThanOrEqual(subnet.position.y + (subnet.style?.height as number))
    // Containment connectors are represented by nesting, not by an edge or warning.
    expect(result.edges).toHaveLength(0)
    expect(result.warnings).toEqual([])
  })

  it('merges selected nodes to the right of existing content', () => {
    const existing = [{
      id: 'existing',
      position: { x: 100, y: 20 },
      style: { width: 220 },
      data: { label: 'Existing', blockType: 'VM', properties: {} },
    }]
    const result = applyDesignImport(
      proposal,
      new Set(['vnet']),
      existing,
      [],
      'merge',
      'merge',
    )

    expect(result.nodes).toHaveLength(2)
    expect(result.nodes[1].position.x).toBeGreaterThan(320)
    expect(result.edges).toHaveLength(0)
  })

  it('avoids imported ID collisions with existing canvas content', () => {
    const existing = [{
      id: 'import-collision-vnet',
      position: { x: 0, y: 0 },
      data: { label: 'Existing', blockType: 'VM', properties: {} },
    }]

    const result = applyDesignImport(
      proposal,
      new Set(['vnet']),
      existing,
      [],
      'merge',
      'collision',
    )

    expect(result.nodes.map((node) => node.id)).toEqual([
      'import-collision-vnet',
      'import-collision-vnet-2',
    ])
  })
})