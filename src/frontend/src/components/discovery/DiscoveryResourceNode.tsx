import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { AzureResource } from '@/types/azure'

/**
 * Maps a full Azure ARM resource `type` (e.g. `Microsoft.Network/virtualNetworks`)
 * to a friendly category + accent colour. Categories mirror the Designer's
 * `categoryStyles` so discovery boxes feel like the same component library.
 * Reference: https://learn.microsoft.com/azure/azure-resource-manager/management/resource-providers-and-types
 */
function categorise(type: string): { label: string; accent: string; icon: string } {
  const t = type.toLowerCase()
  if (t === 'microsoft.network/virtualnetworks')
    return { label: 'VNet', accent: '#3b82f6', icon: 'M21 12a9 9 0 11-18 0 9 9 0 0118 0zM3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18' }
  if (t === 'microsoft.network/virtualnetworks/subnets')
    return { label: 'Subnet', accent: '#60a5fa', icon: 'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z' }
  if (t === 'microsoft.network/networksecuritygroups')
    return { label: 'NSG', accent: '#f43f5e', icon: 'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z' }
  if (t === 'microsoft.network/routetables')
    return { label: 'Route Table', accent: '#f59e0b', icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7' }
  if (t === 'microsoft.network/privateendpoints')
    return { label: 'Private Endpoint', accent: '#10b981', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' }
  if (t === 'microsoft.compute/virtualmachines')
    return { label: 'VM', accent: '#8b5cf6', icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z' }
  if (t.startsWith('microsoft.storage/'))
    return { label: 'Storage', accent: '#0ea5e9', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' }
  if (t.startsWith('microsoft.sql/'))
    return { label: 'SQL', accent: '#0284c7', icon: 'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4' }
  return { label: type.split('/').pop() ?? 'Resource', accent: '#64748b', icon: 'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z' }
}

interface NodeData extends AzureResource {
  /** Suppressed by DiscoveryView when the resource was added manually */
  hint?: string
}

function DiscoveryResourceNode({ data, selected }: NodeProps<NodeData>) {
  const cat = categorise(data.type)
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
            <svg className="w-4 h-4" style={{ color: cat.accent }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
              <path strokeLinecap="round" strokeLinejoin="round" d={cat.icon} />
            </svg>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-gray-800 leading-tight truncate" title={data.name}>{data.name}</p>
            <p className="text-[10px] font-medium mt-0.5 truncate" style={{ color: cat.accent }}>{cat.label}</p>
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
