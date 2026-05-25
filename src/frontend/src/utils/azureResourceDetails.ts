import type { AzureResource } from '@/types/azure'

type Obj = Record<string, unknown>

function asObj(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function asStrList(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.map(asStr).filter((x): x is string => !!x)
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values))
}

export function getVNetPrefixes(resource: AzureResource): string[] {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks') return []
  const props = resource.properties ?? {}
  const addressSpace = asObj(props.addressSpace)
  const fromAddressSpace = asStrList(addressSpace?.addressPrefixes)
  const fromFlat = asStrList((props as Obj).addressPrefixes)
  return uniq([...fromAddressSpace, ...fromFlat])
}

export function getSubnetPrefixes(resource: AzureResource): string[] {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks/subnets') return []
  const props = resource.properties ?? {}
  const one = asStr((props as Obj).addressPrefix)
  const many = asStrList((props as Obj).addressPrefixes)
  return uniq([...(one ? [one] : []), ...many])
}

export function getSubnetAssociations(resource: AzureResource): { nsgId?: string; routeTableId?: string } {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks/subnets') return {}
  const props = resource.properties ?? {}
  const nsg = asObj((props as Obj).networkSecurityGroup)
  const routeTable = asObj((props as Obj).routeTable)
  return {
    nsgId: asStr(nsg?.id) ?? asStr((props as Obj).networkSecurityGroupId) ?? undefined,
    routeTableId: asStr(routeTable?.id) ?? asStr((props as Obj).routeTableId) ?? undefined,
  }
}

export function getVNetDnsServers(resource: AzureResource): string[] {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks') return []
  const props = resource.properties ?? {}
  const dhcp = asObj((props as Obj).dhcpOptions)
  return asStrList(dhcp?.dnsServers)
}

export function shortResourceId(id: string | undefined): string {
  if (!id) return ''
  const clean = id.trim()
  const seg = clean.split('/').filter(Boolean)
  if (seg.length >= 2) return `${seg[seg.length - 2]}/${seg[seg.length - 1]}`
  return clean
}
