import { memo } from 'react'
import { Handle, Position, type NodeProps } from 'reactflow'
import type { AzureResource } from '@/types/azure'
import { getAzureIconForResourceType } from '@/utils/azureIconMap'
import { getSubnetPrefixes, getVNetPrefixes, getVmPrivateIps } from '@/utils/azureResourceDetails'

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
  if (t === 'microsoft.network/privatelinkservices')
    return { label: 'Private Link Service', accent: '#059669' }
  if (t === 'microsoft.network/azurefirewalls')
    return { label: 'Azure Firewall', accent: '#dc2626' }
  if (t === 'microsoft.network/applicationgateways')
    return { label: 'Application Gateway', accent: '#d97706' }
  if (t === 'microsoft.network/loadbalancers')
    return { label: 'Load Balancer', accent: '#0891b2' }
  if (t === 'microsoft.network/publicipaddresses')
    return { label: 'Public IP', accent: '#0284c7' }
  if (t === 'microsoft.network/natgateways')
    return { label: 'NAT Gateway', accent: '#0f766e' }
  if (t === 'microsoft.network/virtualnetworkgateways')
    return { label: 'VNet Gateway', accent: '#7c3aed' }
  if (t === 'microsoft.network/localnetworkgateways')
    return { label: 'Local Gateway', accent: '#6d28d9' }
  if (t === 'microsoft.network/connections')
    return { label: 'Gateway Connection', accent: '#8b5cf6' }
  if (t === 'microsoft.network/virtualwans')
    return { label: 'Virtual WAN', accent: '#4f46e5' }
  if (t === 'microsoft.network/virtualhubs')
    return { label: 'Virtual Hub', accent: '#6366f1' }
  if (t === 'microsoft.network/vpngateways')
    return { label: 'VPN Gateway', accent: '#7c3aed' }
  if (t === 'microsoft.network/vpnsites')
    return { label: 'VPN Site', accent: '#8b5cf6' }
  if (t === 'microsoft.network/expressroutecircuits')
    return { label: 'ExpressRoute Circuit', accent: '#9333ea' }
  if (t === 'microsoft.network/expressroutegateways')
    return { label: 'ExpressRoute Gateway', accent: '#7e22ce' }
  if (t === 'microsoft.network/bastionhosts')
    return { label: 'Azure Bastion', accent: '#0369a1' }
  if (t === 'microsoft.avs/privateclouds')
    return { label: 'AVS Private Cloud', accent: '#2563eb' }
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
  const prefix =
    getSubnetPrefixes(data)[0] ??
    getVNetPrefixes(data)[0] ??
    getVmPrivateIps(data)[0]
  return (
    <div
      className={`relative w-56 min-h-28 bg-white rounded-xl shadow-md border-2 transition-all duration-150 ${
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
            <p className="text-xs font-semibold text-gray-800 leading-4 break-words" title={data.name}>{data.name}</p>
            <p className="text-[10px] font-medium mt-0.5 break-words" style={{ color: cat.accent }}>{cat.label}</p>
            {prefix && (
              <p className="text-[10px] text-blue-700 font-mono break-all" title={prefix}>{prefix}</p>
            )}
            {data.location && (
              <p className="text-[10px] text-gray-500 break-words" title={data.resourceGroup}>{data.location}</p>
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
