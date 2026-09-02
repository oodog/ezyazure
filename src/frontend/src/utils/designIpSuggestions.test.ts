import { describe, expect, it } from 'vitest'
import type { Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import { applyDesignIpSuggestions, suggestMissingDesignIpRanges } from './designIpSuggestions'

describe('design IP suggestions', () => {
  it('allocates non-overlapping VNet, subnet and Virtual Hub examples', () => {
    const nodes = [
      node('existing-vnet', 'VNet', { addressSpace: ['10.0.0.0/16'] }),
      node('vnet', 'VNet'),
      node('web', 'Subnet', {}, 'vnet'),
      node('bastion', 'Subnet', {}, 'vnet', 'AzureBastionSubnet'),
      node('hub', 'Virtual Hub'),
    ]

    const suggestions = suggestMissingDesignIpRanges(nodes)

    expect(suggestions).toContainEqual(expect.objectContaining({ nodeId: 'vnet', value: '10.1.0.0/16' }))
    expect(suggestions).toContainEqual(expect.objectContaining({ nodeId: 'bastion', value: '10.1.1.0/26' }))
    expect(suggestions).toContainEqual(expect.objectContaining({ nodeId: 'web', value: '10.1.2.0/24' }))
    expect(suggestions).toContainEqual(expect.objectContaining({ nodeId: 'hub', value: '10.240.0.0/23' }))
  })

  it('never overwrites configured customer ranges', () => {
    const nodes = [
      node('vnet', 'VNet', { addressSpace: ['10.50.0.0/16'] }),
      node('configured', 'Subnet', { addressPrefix: '10.50.20.0/24' }, 'vnet'),
      node('missing', 'Subnet', {}, 'vnet'),
    ]
    const suggestions = suggestMissingDesignIpRanges(nodes)
    const updated = applyDesignIpSuggestions(nodes, suggestions)

    expect(suggestions).not.toContainEqual(expect.objectContaining({ nodeId: 'configured' }))
    expect(updated.find((item) => item.id === 'configured')?.data.properties.addressPrefix).toBe('10.50.20.0/24')
    expect(updated.find((item) => item.id === 'missing')?.data.properties.addressPrefix).toBe('10.50.1.0/24')
  })

  it('allocates correctly inside high-value RFC 1918 address space', () => {
    const nodes = [
      node('vnet', 'VNet', { addressSpace: ['192.168.0.0/16'] }),
      node('subnet', 'Subnet', {}, 'vnet'),
    ]

    const suggestions = suggestMissingDesignIpRanges(nodes)

    expect(suggestions).toContainEqual(expect.objectContaining({ nodeId: 'subnet', value: '192.168.1.0/24' }))
  })

  it('does not propose changes to immutable discovered baseline ranges', () => {
    const baseline = node('baseline-vnet', 'VNet')
    baseline.data.origin = {
      kind: 'discovered',
      resourceId: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/virtualNetworks/baseline',
      resourceType: 'Microsoft.Network/virtualNetworks',
      subscriptionId: 'sub',
      resourceGroup: 'rg',
      capturedAt: '2026-08-30T00:00:00Z',
    }

    expect(suggestMissingDesignIpRanges([baseline])).toEqual([])
  })
})

function node(
  id: string,
  blockType: string,
  properties: Record<string, unknown> = {},
  parentId?: string,
  label = id,
): Node<DesignBlock> {
  return {
    id,
    position: { x: 0, y: 0 },
    ...(parentId ? { parentId, parentNode: parentId } : {}),
    data: { label, blockType, properties },
  }
}