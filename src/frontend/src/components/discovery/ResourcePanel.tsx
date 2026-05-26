import type { AzureResource } from '@/types/azure'
import {
  getSubnetAssociations,
  getSubnetPrefixes,
  getVNetDnsServers,
  getVNetPrefixes,
  shortResourceId,
} from '@/utils/azureResourceDetails'

interface Props {
  resource: AzureResource
  onClose: () => void
}

function toDisplay(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function flattenProperties(value: unknown, prefix = '', depth = 0, out: Array<{ key: string; value: unknown }> = []) {
  if (depth > 3) {
    out.push({ key: prefix || 'value', value })
    return out
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ key: prefix || 'value', value: [] })
      return out
    }
    const primitiveArray = value.every((v) => typeof v !== 'object' || v === null)
    if (primitiveArray) {
      out.push({ key: prefix || 'value', value })
      return out
    }
    value.forEach((v, i) => flattenProperties(v, `${prefix}[${i}]`, depth + 1, out))
    return out
  }

  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) {
      out.push({ key: prefix || 'value', value: {} })
      return out
    }
    for (const [k, v] of entries) {
      const nextKey = prefix ? `${prefix}.${k}` : k
      if (v !== null && typeof v === 'object') {
        flattenProperties(v, nextKey, depth + 1, out)
      } else {
        out.push({ key: nextKey, value: v })
      }
    }
    return out
  }

  out.push({ key: prefix || 'value', value })
  return out
}

export default function ResourcePanel({ resource, onClose }: Props) {
  const vnetPrefixes = getVNetPrefixes(resource)
  const subnetPrefixes = getSubnetPrefixes(resource)
  const dnsServers = getVNetDnsServers(resource)
  const subnetAssoc = getSubnetAssociations(resource)
  const propertyRows = flattenProperties(resource.properties)

  return (
    <aside className="w-80 bg-white border border-gray-200 rounded-xl p-5 shrink-0 overflow-y-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h2 className="font-semibold text-gray-900 text-sm">{resource.name}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{resource.type}</p>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700 ml-2">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide">Resource Group</dt>
          <dd className="text-gray-700 mt-0.5">{resource.resourceGroup}</dd>
        </div>
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide">Subscription</dt>
          <dd className="text-gray-700 mt-0.5 font-mono text-xs">{resource.subscriptionId}</dd>
        </div>
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide">Location</dt>
          <dd className="text-gray-700 mt-0.5">{resource.location}</dd>
        </div>
        {vnetPrefixes.length > 0 && (
          <div>
            <dt className="text-gray-400 text-xs uppercase tracking-wide mb-1">VNet Address Space</dt>
            <dd className="flex flex-wrap gap-1">
              {vnetPrefixes.map((prefix) => (
                <span key={prefix} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full font-mono">
                  {prefix}
                </span>
              ))}
            </dd>
          </div>
        )}
        {dnsServers.length > 0 && (
          <div>
            <dt className="text-gray-400 text-xs uppercase tracking-wide mb-1">DNS Servers</dt>
            <dd className="flex flex-wrap gap-1">
              {dnsServers.map((dns) => (
                <span key={dns} className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-mono">
                  {dns}
                </span>
              ))}
            </dd>
          </div>
        )}
        {subnetPrefixes.length > 0 && (
          <div>
            <dt className="text-gray-400 text-xs uppercase tracking-wide mb-1">Subnet Prefixes</dt>
            <dd className="flex flex-wrap gap-1">
              {subnetPrefixes.map((prefix) => (
                <span key={prefix} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full font-mono">
                  {prefix}
                </span>
              ))}
            </dd>
          </div>
        )}
        {(subnetAssoc.nsgId || subnetAssoc.routeTableId) && (
          <div className="space-y-1">
            <dt className="text-gray-400 text-xs uppercase tracking-wide">Subnet Associations</dt>
            {subnetAssoc.nsgId && (
              <dd className="text-xs text-gray-700 font-mono">NSG: {shortResourceId(subnetAssoc.nsgId)}</dd>
            )}
            {subnetAssoc.routeTableId && (
              <dd className="text-xs text-gray-700 font-mono">Route table: {shortResourceId(subnetAssoc.routeTableId)}</dd>
            )}
          </div>
        )}
        {Object.keys(resource.tags ?? {}).length > 0 && (
          <div>
            <dt className="text-gray-400 text-xs uppercase tracking-wide mb-1">Tags</dt>
            <dd className="flex flex-wrap gap-1">
              {Object.entries(resource.tags!).map(([k, v]) => (
                <span key={k} className="bg-blue-50 text-blue-700 text-xs px-2 py-0.5 rounded-full">
                  {k}: {v}
                </span>
              ))}
            </dd>
          </div>
        )}
        <div>
          <dt className="text-gray-400 text-xs uppercase tracking-wide mb-1">Properties</dt>
          <dd className="space-y-1.5 max-h-64 overflow-auto pr-1">
            {propertyRows.length === 0 && (
              <div className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5 text-gray-500">No properties</div>
            )}
            {propertyRows.map((row) => (
              <div key={row.key} className="text-xs bg-gray-50 border border-gray-200 rounded px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">{row.key}</div>
                <div className="mt-0.5 text-gray-800 font-mono break-all">{toDisplay(row.value)}</div>
              </div>
            ))}
          </dd>
        </div>
      </dl>
    </aside>
  )
}
