import type { AzureResource } from '@/types/azure'

type Obj = Record<string, unknown>

function getCI(obj: Obj | null | undefined, key: string): unknown {
  if (!obj) return undefined
  const hit = Object.keys(obj).find((k) => k.toLowerCase() === key.toLowerCase())
  return hit ? obj[hit] : undefined
}

function asObj(v: unknown): Obj | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Obj) : null
}

function asStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null
}

function asStrList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map(asStr).filter((x): x is string => !!x)
  }

  // Some payloads can arrive as { $values: [...] } depending on serializer shape.
  const obj = asObj(v)
  const values = obj ? getCI(obj, '$values') : undefined
  if (Array.isArray(values)) {
    return values.map(asStr).filter((x): x is string => !!x)
  }

  const one = asStr(v)
  return one ? [one] : []
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values))
}

const CIDR_RE = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/

function collectCidrs(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || value === null || value === undefined) return out

  if (typeof value === 'string') {
    const v = value.trim()
    if (CIDR_RE.test(v)) out.push(v)
    return out
  }

  if (Array.isArray(value)) {
    for (const item of value) collectCidrs(item, out, depth + 1)
    return out
  }

  const obj = asObj(value)
  if (!obj) return out
  for (const v of Object.values(obj)) {
    collectCidrs(v, out, depth + 1)
  }
  return out
}

export function getVNetPrefixes(resource: AzureResource): string[] {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks') return []
  const props = resource.properties ?? {}
  const p = props as Obj
  const addressSpace = asObj(getCI(p, 'addressSpace'))
  const fromAddressSpace = asStrList(getCI(addressSpace, 'addressPrefixes'))
  const fromFlat = asStrList(getCI(p, 'addressPrefixes'))

  // Last fallback: scan all nested objects for an addressPrefixes array.
  const fromNested: string[] = []
  const scan = (node: unknown, depth = 0) => {
    if (depth > 4) return
    const o = asObj(node)
    if (!o) return
    const maybe = asStrList(getCI(o, 'addressPrefixes'))
    if (maybe.length > 0) fromNested.push(...maybe)
    for (const value of Object.values(o)) {
      if (Array.isArray(value)) {
        for (const item of value) scan(item, depth + 1)
      } else {
        scan(value, depth + 1)
      }
    }
  }
  scan(p)

  const fromRecursive = collectCidrs(props)

  // Ultra-defensive fallback: parse CIDRs out of stringified JSON for odd token wrappers.
  const serialized = JSON.stringify(props)
  const fromSerialized = serialized.match(/(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})/g) ?? []

  return uniq([...fromAddressSpace, ...fromFlat, ...fromNested, ...fromRecursive, ...fromSerialized])
}

export function getSubnetPrefixes(resource: AzureResource): string[] {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks/subnets') return []
  const props = resource.properties ?? {}
  const p = props as Obj
  const one = asStr(getCI(p, 'addressPrefix'))
  const many = asStrList(getCI(p, 'addressPrefixes'))
  const fromRecursive = collectCidrs(props)
  const serialized = JSON.stringify(props)
  const fromSerialized = serialized.match(/(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})/g) ?? []
  return uniq([...(one ? [one] : []), ...many, ...fromRecursive, ...fromSerialized])
}

export function getVmPrivateIps(resource: AzureResource): string[] {
  const allowedTypes = [
    'microsoft.compute/virtualmachines',
    'microsoft.network/privateendpoints',
    'microsoft.network/azurefirewalls',
  ]
  if (!allowedTypes.includes(resource.type.toLowerCase())) return []
  const props = resource.properties ?? {}
  const p = props as Obj
  // Backend enrichment flattens NIC IPs to properties.privateIPAddresses
  const flat = asStrList(getCI(p, 'privateIPAddresses'))
  if (flat.length > 0) return uniq(flat)

  // Fallback: parse nested networkProfile (VMs) or networkInterfaces (PEs)
  const np = asObj(getCI(p, 'networkProfile'))
  const nicsFromProfile = Array.isArray(getCI(np, 'networkInterfaces')) ? (getCI(np, 'networkInterfaces') as unknown[]) : []
  const nicsFromPE = Array.isArray(getCI(p, 'networkInterfaces')) ? (getCI(p, 'networkInterfaces') as unknown[]) : []
  const nics = [...nicsFromProfile, ...nicsFromPE]
  const found: string[] = []
  for (const nic of nics) {
    const nicProps = asObj((nic as Obj)?.properties)
    const cfgs = Array.isArray(getCI(nicProps, 'ipConfigurations'))
      ? (getCI(nicProps, 'ipConfigurations') as unknown[])
      : []
    for (const cfg of cfgs) {
      const cfgProps = asObj((cfg as Obj)?.properties)
      const ip = asStr(getCI(cfgProps, 'privateIPAddress'))
      if (ip) found.push(ip)
    }
  }
  return uniq(found)
}

export function getSubnetAssociations(resource: AzureResource): { nsgId?: string; routeTableId?: string } {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks/subnets') return {}
  const props = resource.properties ?? {}
  const p = props as Obj
  const nsg = asObj(getCI(p, 'networkSecurityGroup'))
  const routeTable = asObj(getCI(p, 'routeTable'))
  return {
    nsgId: asStr(getCI(nsg, 'id')) ?? asStr(getCI(p, 'networkSecurityGroupId')) ?? undefined,
    routeTableId: asStr(getCI(routeTable, 'id')) ?? asStr(getCI(p, 'routeTableId')) ?? undefined,
  }
}

export function getVNetDnsServers(resource: AzureResource): string[] {
  if (resource.type.toLowerCase() !== 'microsoft.network/virtualnetworks') return []
  const props = resource.properties ?? {}
  const p = props as Obj
  const dhcp = asObj(getCI(p, 'dhcpOptions'))
  return asStrList(getCI(dhcp, 'dnsServers'))
}

export function shortResourceId(id: string | undefined): string {
  if (!id) return ''
  const clean = id.trim()
  const seg = clean.split('/').filter(Boolean)
  if (seg.length >= 2) return `${seg[seg.length - 2]}/${seg[seg.length - 1]}`
  return clean
}
