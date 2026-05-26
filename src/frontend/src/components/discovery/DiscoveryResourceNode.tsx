import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { AzureResource } from '@/types/azure'
import { getAzureIconForResourceType } from '@/utils/azureIconMap'
import { getSubnetPrefixes, getVNetPrefixes } from '@/utils/azureResourceDetails'

/**
 * Maps a full Azure ARM resource `type` (e.g. `Microsoft.Network/virtualNetworks`)
 * to a friendly category + accent colour. Categories mirror the Designer's
 * `categoryStyles` so discovery boxes feel like the same component library.
 * Reference: https://learn.microsoft.com/azure/azure-resource-manager/management/resource-providers-and-types
 */
function categorise(type: string): { label: string; accent: string } {
  const t = type.toLowerCase()
  if (t === 'microsoft.network/virtualnetworks')
    return { label: 'VNet', accent: '#3b82f6' }
  if (t === 'microsoft.network/virtualnetworks/subnets')
    return { label: 'Subnet', accent: '#60a5fa' }
  if (t === 'microsoft.network/networksecuritygroups')
    return { label: 'NSG', accent: '#f43f5e' }
  if (t === 'microsoft.network/routetables')
    return { label: 'Route Table', accent: '#f59e0b' }
  if (t === 'microsoft.network/privateendpoints')
    return { label: 'Private Endpoint', accent: '#10b981' }
  if (t === 'easyazure.network/internet')
    return { label: 'Internet', accent: '#0ea5e9' }
  if (t === 'microsoft.compute/virtualmachines')
    return { label: 'VM', accent: '#8b5cf6' }
  if (t.startsWith('microsoft.storage/'))
    return { label: 'Storage', accent: '#0ea5e9' }
  if (t.startsWith('microsoft.sql/'))
    return { label: 'SQL', accent: '#0284c7' }
  return { label: type.split('/').pop() ?? 'Resource', accent: '#64748b' }
}

interface NodeData extends AzureResource {
  /** Suppressed by DiscoveryView when the resource was added manually */
  hint?: string
}

function DiscoveryResourceNode({ data, selected }: NodeProps<NodeData>) {
  const cat = categorise(data.type)
  const iconSrc = getAzureIconForResourceType(data.type)
  const prefix = getSubnetPrefixes(data)[0] ?? getVNetPrefixes(data)[0]
  return (
    <div
      className={`relative bg-white rounded-xl shadow-md border-2 transition-all duration-150 w-52 ${
        selected ? 'shadow-lg ring-2 ring-offset-1' : 'border-gray-200 hover:border-gray-300 hover:shadow-lg'
      }`}
      style={selected ? { borderColor: cat.accent } : { borderColor: '#e5e7eb' }}
    >
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
        style={{ backgroundColor: cat.accent }}
      />
      <Handle type="target" position={Position.Left} className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full" style={{ left: -6 }} />
      <Handle type="target" position={Position.Top} id="top" className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full" style={{ top: -6 }} />
      <div className="pl-3 pr-3 py-2.5">
        <div className="flex items-start gap-2">
          <div
            className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
            style={{ backgroundColor: cat.accent + '20' }}
          >
            <img src={iconSrc} alt="" className="w-4 h-4 object-contain" loading="lazy" decoding="async" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 leading-tight truncate" title={data.name}>{data.name}</p>
            <p className="text-[10px] font-medium mt-0.5 truncate" style={{ color: cat.accent }}>{cat.label}</p>
            {prefix && (
              <p className="text-[10px] text-blue-700 font-mono truncate" title={prefix}>{prefix}</p>
            )}
            {data.location && (
              <p className="text-[10px] text-gray-500 truncate" title={data.resourceGroup}>{data.location}</p>
            )}
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full" style={{ right: -6 }} />
      <Handle type="source" position={Position.Bottom} id="bottom" className="!w-3 !h-3 !border-2 !border-white !bg-gray-400 !rounded-full" style={{ bottom: -6 }} />
    </div>
  )
}

export default memo(DiscoveryResourceNode)
