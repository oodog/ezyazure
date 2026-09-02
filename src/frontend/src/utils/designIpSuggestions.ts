import type { Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'

export interface DesignIpSuggestion {
  nodeId: string
  nodeLabel: string
  blockType: 'VNet' | 'Subnet' | 'Virtual Hub'
  propertyKey: 'addressSpace' | 'addressPrefix'
  value: string
  rationale: string
}

interface ParsedCidr {
  network: number
  prefix: number
}

export function suggestMissingDesignIpRanges(nodes: Node<DesignBlock>[]): DesignIpSuggestion[] {
  const suggestions: DesignIpSuggestion[] = []
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const usedRanges = collectExistingRanges(nodes)
  const vnetRangeById = new Map<string, string>()

  for (const vnet of nodes.filter((node) => node.data.blockType === 'VNet' && node.data.origin?.kind !== 'discovered').sort(compareNodes)) {
    const existing = stringList(vnet.data.properties.addressSpace).find((cidr) => parseCidr(cidr))
    if (existing) {
      vnetRangeById.set(vnet.id, existing)
      continue
    }
    const value = findAvailableRange(10, 0, 239, 16, usedRanges)
    if (!value) continue
    usedRanges.push(value)
    vnetRangeById.set(vnet.id, value)
    suggestions.push({
      nodeId: vnet.id,
      nodeLabel: vnet.data.label,
      blockType: 'VNet',
      propertyKey: 'addressSpace',
      value,
      rationale: 'RFC 1918 /16 example leaves room for workload, platform and Private Endpoint subnets.',
    })
  }

  const usedSubnetRanges = nodes
    .filter((node) => node.data.blockType === 'Subnet')
    .map((node) => node.data.properties.addressPrefix)
    .filter((value): value is string => typeof value === 'string' && parseCidr(value) !== null)
  for (const subnet of nodes.filter((node) => node.data.blockType === 'Subnet' && node.data.origin?.kind !== 'discovered').sort(compareNodes)) {
    const existing = subnet.data.properties.addressPrefix
    if (typeof existing === 'string' && parseCidr(existing)) continue
    const parentId = subnet.parentId ?? subnet.parentNode
    const parent = parentId ? nodeById.get(parentId) : undefined
    if (!parent || parent.data.blockType !== 'VNet') continue
    const parentRange = vnetRangeById.get(parent.id)
      ?? stringList(parent.data.properties.addressSpace).find((cidr) => parseCidr(cidr))
    if (!parentRange) continue
    const reservedSubnet = /bastion|firewall|gateway/i.test(subnet.data.label)
    const value = findChildRange(parentRange, reservedSubnet ? 26 : 24, usedSubnetRanges)
    if (!value) continue
    usedSubnetRanges.push(value)
    suggestions.push({
      nodeId: subnet.id,
      nodeLabel: subnet.data.label,
      blockType: 'Subnet',
      propertyKey: 'addressPrefix',
      value,
      rationale: reservedSubnet
        ? 'A /26 example provides adequate space for Azure platform gateway or security services.'
        : 'A /24 example provides practical growth room while keeping subnet boundaries easy to operate.',
    })
  }

  for (const hub of nodes.filter((node) => node.data.blockType === 'Virtual Hub' && node.data.origin?.kind !== 'discovered').sort(compareNodes)) {
    const existing = hub.data.properties.addressPrefix
    if (typeof existing === 'string' && parseCidr(existing)) continue
    const value = findAvailableRange(10, 240, 255, 23, usedRanges)
    if (!value) continue
    usedRanges.push(value)
    suggestions.push({
      nodeId: hub.id,
      nodeLabel: hub.data.label,
      blockType: 'Virtual Hub',
      propertyKey: 'addressPrefix',
      value,
      rationale: 'A /23 example supports a Virtual Hub with gateways and secured-hub services.',
    })
  }

  return suggestions
}

export function applyDesignIpSuggestions(
  nodes: Node<DesignBlock>[],
  suggestions: readonly DesignIpSuggestion[],
): Node<DesignBlock>[] {
  const byNodeId = new Map(suggestions.map((suggestion) => [suggestion.nodeId, suggestion]))
  return nodes.map((node) => {
    const suggestion = byNodeId.get(node.id)
    if (!suggestion) return node
    const current = node.data.properties[suggestion.propertyKey]
    const alreadyConfigured = Array.isArray(current)
      ? current.some((value) => typeof value === 'string' && value.trim().length > 0)
      : typeof current === 'string' && current.trim().length > 0
    if (alreadyConfigured) return node
    return {
      ...node,
      data: {
        ...node.data,
        properties: {
          ...node.data.properties,
          [suggestion.propertyKey]: suggestion.propertyKey === 'addressSpace'
            ? [suggestion.value]
            : suggestion.value,
        },
      },
    }
  })
}

function collectExistingRanges(nodes: Node<DesignBlock>[]): string[] {
  return nodes.flatMap((node) => {
    if (node.data.blockType === 'VNet') return stringList(node.data.properties.addressSpace)
    if (node.data.blockType === 'Virtual Hub' && typeof node.data.properties.addressPrefix === 'string')
      return [node.data.properties.addressPrefix]
    return []
  }).filter((cidr) => parseCidr(cidr) !== null)
}

function findAvailableRange(
  firstOctet: number,
  secondStart: number,
  secondEnd: number,
  prefix: number,
  usedRanges: readonly string[],
): string | null {
  const step = prefix === 23 ? 2 : 1
  for (let second = secondStart; second <= secondEnd; second += step) {
    const candidate = `${firstOctet}.${second}.0.0/${prefix}`
    if (!usedRanges.some((used) => cidrsOverlap(candidate, used))) return candidate
  }
  return null
}

function findChildRange(parentCidr: string, preferredPrefix: number, usedRanges: readonly string[]): string | null {
  const parent = parseCidr(parentCidr)
  if (!parent) return null
  const targetPrefix = Math.min(29, Math.max(preferredPrefix, parent.prefix + 1))
  const blockSize = 2 ** (32 - targetPrefix)
  const parentSize = 2 ** (32 - parent.prefix)
  const planningSlotSize = targetPrefix >= 24 && parent.prefix < 24 ? 2 ** 8 : blockSize
  const blockCount = Math.floor(parentSize / planningSlotSize)
  const startIndex = blockCount > 1 ? 1 : 0
  for (let offset = 0; offset < blockCount; offset += 1) {
    const index = (startIndex + offset) % blockCount
    const candidate = `${numberToIp(parent.network + index * planningSlotSize)}/${targetPrefix}`
    if (!usedRanges.some((used) => cidrsOverlap(candidate, used))) return candidate
  }
  return null
}

function parseCidr(value: string): ParsedCidr | null {
  const [ip, prefixText, ...extra] = value.split('/')
  const prefix = Number(prefixText)
  const address = ipToNumber(ip)
  if (extra.length > 0 || address === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  const blockSize = 2 ** (32 - prefix)
  return { network: Math.floor(address / blockSize) * blockSize, prefix }
}

function cidrsOverlap(left: string, right: string): boolean {
  const a = parseCidr(left)
  const b = parseCidr(right)
  if (!a || !b) return false
  const aSize = 2 ** (32 - a.prefix)
  const bSize = 2 ** (32 - b.prefix)
  return a.network < b.network + bSize && b.network < a.network + aSize
}

function ipToNumber(value: string): number | null {
  const octets = value.split('.').map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return null
  return octets[0] * 2 ** 24 + octets[1] * 2 ** 16 + octets[2] * 2 ** 8 + octets[3]
}

function numberToIp(value: number): string {
  return [
    Math.floor(value / 2 ** 24) % 256,
    Math.floor(value / 2 ** 16) % 256,
    Math.floor(value / 2 ** 8) % 256,
    value % 256,
  ].join('.')
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
}

function compareNodes(left: Node<DesignBlock>, right: Node<DesignBlock>): number {
  return left.id.localeCompare(right.id)
}