export type CategoryName =
  | 'Management'
  | 'Networking'
  | 'Compute'
  | 'Data'
  | 'Security'
  | 'Patterns'

export interface BlockMeta {
  type: string
  label: string
  category: CategoryName
  description: string
}

// Tailwind classes for each category — used by both the library and the canvas nodes
export const categoryStyles: Record<
  CategoryName,
  { bg: string; text: string; border: string; lightBg: string; accent: string }
> = {
  Management: {
    bg: 'bg-slate-500',
    text: 'text-slate-700',
    border: 'border-slate-300',
    lightBg: 'bg-slate-50',
    accent: '#64748b',
  },
  Networking: {
    bg: 'bg-blue-500',
    text: 'text-blue-700',
    border: 'border-blue-300',
    lightBg: 'bg-blue-50',
    accent: '#3b82f6',
  },
  Compute: {
    bg: 'bg-violet-500',
    text: 'text-violet-700',
    border: 'border-violet-300',
    lightBg: 'bg-violet-50',
    accent: '#8b5cf6',
  },
  Data: {
    bg: 'bg-amber-500',
    text: 'text-amber-700',
    border: 'border-amber-300',
    lightBg: 'bg-amber-50',
    accent: '#f59e0b',
  },
  Security: {
    bg: 'bg-rose-500',
    text: 'text-rose-700',
    border: 'border-rose-300',
    lightBg: 'bg-rose-50',
    accent: '#f43f5e',
  },
  Patterns: {
    bg: 'bg-emerald-500',
    text: 'text-emerald-700',
    border: 'border-emerald-300',
    lightBg: 'bg-emerald-50',
    accent: '#10b981',
  },
}

// SVG path `d` values (24×24 viewBox, stroke-based Heroicons style)
export const blockIcons: Record<string, string> = {
  'Management Group':
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
  Subscription:
    'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  'Resource Group':
    'M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z',
  'Policy Assignment':
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  VNet: 'M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9',
  Subnet:
    'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z',
  NSG: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  'Route Table':
    'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
  'NAT Gateway':
    'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
  'Azure Firewall':
    'M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z',
  'VPN Gateway':
    'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  'ExpressRoute Gateway':
    'M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01',
  'Private DNS Zone':
    'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  'Private Endpoint':
    'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1',
  'Load Balancer':
    'M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3',
  'Application Gateway':
    'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z',
  'Virtual WAN':
    'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  'Virtual Hub':
    'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z',
  'Route Intent':
    'M13 7l5 5m0 0l-5 5m5-5H6',
  NVA:
    'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  VM: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z',
  'VM Scale Set':
    'M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4z',
  AKS: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  'Container App':
    'M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4',
  'Function App':
    'M13 10V3L4 14h7v7l9-11h-7z',
  'App Service':
    'M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18',
  'Storage Account':
    'M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4',
  'SQL Database':
    'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
  PostgreSQL:
    'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
  'Cosmos DB':
    'M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  'Key Vault':
    'M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z',
  'Managed Identity':
    'M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z',
  'RBAC Assignment':
    'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
  'Defender for Cloud':
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  Bastion:
    'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6',
  'Log Analytics':
    'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
  'Hub-spoke network':
    'M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1H7a1 1 0 01-1-1v-3a1 1 0 00-1-1H4a2 2 0 110-4h1a1 1 0 001-1V7a1 1 0 011-1h3a1 1 0 001-1V4z',
  'App landing zone':
    'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
  'Secure web app':
    'M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4',
  'Private app service':
    'M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z',
  'AKS baseline':
    'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
  'Three-tier app':
    'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
}

export const blockCategories: { category: CategoryName; blocks: BlockMeta[] }[] = [
  {
    category: 'Management',
    blocks: [
      { type: 'Management Group', label: 'Management Group', category: 'Management', description: 'Organise subscriptions under a hierarchy' },
      { type: 'Subscription', label: 'Subscription', category: 'Management', description: 'Azure subscription boundary' },
      { type: 'Resource Group', label: 'Resource Group', category: 'Management', description: 'Container for related resources' },
      { type: 'Policy Assignment', label: 'Policy Assignment', category: 'Management', description: 'Azure Policy enforcement' },
    ],
  },
  {
    category: 'Networking',
    blocks: [
      { type: 'VNet', label: 'VNet', category: 'Networking', description: 'Virtual Network — isolation boundary' },
      { type: 'Subnet', label: 'Subnet', category: 'Networking', description: 'IP address range within a VNet' },
      { type: 'NSG', label: 'NSG', category: 'Networking', description: 'Network Security Group — L4 filtering' },
      { type: 'Route Table', label: 'Route Table', category: 'Networking', description: 'User-defined routes / UDRs' },
      { type: 'NAT Gateway', label: 'NAT Gateway', category: 'Networking', description: 'Outbound SNAT for subnets' },
      { type: 'Azure Firewall', label: 'Azure Firewall', category: 'Networking', description: 'L7 managed firewall / NVA' },
      { type: 'VPN Gateway', label: 'VPN Gateway', category: 'Networking', description: 'Site-to-site or P2S VPN' },
      { type: 'ExpressRoute Gateway', label: 'ExpressRoute', category: 'Networking', description: 'Private circuit gateway' },
      { type: 'Private DNS Zone', label: 'Private DNS Zone', category: 'Networking', description: 'Private DNS resolution' },
      { type: 'Private Endpoint', label: 'Private Endpoint', category: 'Networking', description: 'Private IP for PaaS services' },
      { type: 'Load Balancer', label: 'Load Balancer', category: 'Networking', description: 'L4 load distribution' },
      { type: 'Application Gateway', label: 'App Gateway', category: 'Networking', description: 'L7 WAF + load balancer' },
      { type: 'Virtual WAN', label: 'Virtual WAN', category: 'Networking', description: 'Global transit network — branches, VNets, ExpressRoute' },
      { type: 'Virtual Hub', label: 'Virtual Hub', category: 'Networking', description: 'Regional hub inside a Virtual WAN' },
      { type: 'Route Intent', label: 'Route Intent', category: 'Networking', description: 'VWAN routing policy — send all traffic via Firewall / NVA' },
      { type: 'NVA', label: 'Network Virtual Appliance', category: 'Networking', description: 'Third-party firewall / SD-WAN appliance (Palo Alto, Fortinet, etc.)' },
    ],
  },
  {
    category: 'Compute',
    blocks: [
      { type: 'VM', label: 'Virtual Machine', category: 'Compute', description: 'IaaS virtual machine' },
      { type: 'VM Scale Set', label: 'VM Scale Set', category: 'Compute', description: 'Auto-scaling VM group' },
      { type: 'AKS', label: 'AKS', category: 'Compute', description: 'Managed Kubernetes Service' },
      { type: 'Container App', label: 'Container App', category: 'Compute', description: 'Serverless containers' },
      { type: 'Function App', label: 'Function App', category: 'Compute', description: 'Event-driven serverless' },
      { type: 'App Service', label: 'App Service', category: 'Compute', description: 'Managed web app hosting' },
    ],
  },
  {
    category: 'Data',
    blocks: [
      { type: 'Storage Account', label: 'Storage Account', category: 'Data', description: 'Blob, file, queue, table' },
      { type: 'SQL Database', label: 'SQL Database', category: 'Data', description: 'Managed SQL Server PaaS' },
      { type: 'PostgreSQL', label: 'PostgreSQL', category: 'Data', description: 'Managed PostgreSQL Flexible' },
      { type: 'Cosmos DB', label: 'Cosmos DB', category: 'Data', description: 'Multi-model globally distributed DB' },
      { type: 'Key Vault', label: 'Key Vault', category: 'Data', description: 'Secrets, keys, certificates' },
    ],
  },
  {
    category: 'Security',
    blocks: [
      { type: 'Managed Identity', label: 'Managed Identity', category: 'Security', description: 'Azure-managed workload identity' },
      { type: 'RBAC Assignment', label: 'RBAC Assignment', category: 'Security', description: 'Role-based access control' },
      { type: 'Defender for Cloud', label: 'Defender for Cloud', category: 'Security', description: 'Cloud security posture management' },
      { type: 'Bastion', label: 'Bastion', category: 'Security', description: 'Secure RDP/SSH without public IP' },
      { type: 'Log Analytics', label: 'Log Analytics', category: 'Security', description: 'Centralised log workspace' },
    ],
  },
  {
    category: 'Patterns',
    blocks: [
      { type: 'Hub-spoke network', label: 'Hub-Spoke', category: 'Patterns', description: 'Hub-spoke network topology' },
      { type: 'App landing zone', label: 'App Landing Zone', category: 'Patterns', description: 'ALZ application landing zone' },
      { type: 'Secure web app', label: 'Secure Web App', category: 'Patterns', description: 'App Gateway + App Service + PE' },
      { type: 'Private app service', label: 'Private App Service', category: 'Patterns', description: 'App Service with private endpoint' },
      { type: 'AKS baseline', label: 'AKS Baseline', category: 'Patterns', description: 'Microsoft AKS baseline architecture' },
      { type: 'Three-tier app', label: 'Three-tier App', category: 'Patterns', description: 'Web / app / data tiers' },
    ],
  },
]

export function getBlockMeta(blockType: string): BlockMeta {
  for (const cat of blockCategories) {
    const found = cat.blocks.find((b) => b.type === blockType)
    if (found) return found
  }
  return { type: blockType, label: blockType, category: 'Management', description: '' }
}
