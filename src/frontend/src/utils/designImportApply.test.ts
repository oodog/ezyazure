import { describe, expect, it } from 'vitest'
import type { DesignImportProposal } from '@/services/designImportService'
import { applyDesignImport } from './designImportApply'

const proposal: DesignImportProposal = {
  summary: 'Hub and spoke',
  sourceFileName: 'network.pdf',
  model: 'gpt-4o-mini',
  warnings: [],
  nodes: [
    { id: 'vnet', blockType: 'VNet', label: 'Hub', x: 100, y: 100, confidence: 0.95, evidence: 'label' },
    { id: 'subnet', blockType: 'Subnet', label: 'Workload', x: 150, y: 170, parentId: 'vnet', confidence: 0.9, evidence: 'inside hub' },
    { id: 'nsg', blockType: 'NSG', label: 'Workload NSG', x: 500, y: 170, confidence: 0.8, evidence: 'shield icon' },
  ],
  edges: [
    { id: 'protects', source: 'nsg', target: 'subnet', relationship: 'protects', confidence: 0.8, evidence: 'line' },
    { id: 'invalid', source: 'subnet', target: 'nsg', relationship: 'reverse', confidence: 0.3, evidence: 'line' },
  ],
}

describe('applyDesignImport', () => {
  it('creates valid containment and filters unsupported edge directions', () => {
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
    expect(result.edges).toHaveLength(1)
    expect(result.edges[0].label).toBe('protects')
    expect(result.warnings).toContainEqual(expect.stringContaining('Subnet has no defined outgoing connections'))
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