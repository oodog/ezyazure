// Relationship rules for the designer.
// Defines which blocks can contain which (parent → child),
// and which blocks can connect to which (edge source → target).
//
// Rules sourced from Azure resource model (Microsoft.Network etc.):
//   - Subnets are children of VNets
//   - NSGs and Route Tables associate with Subnets (or NICs)
//   - Private DNS zones link to VNets via virtualNetworkLinks
//   - Private Endpoints sit in a Subnet and target a PaaS resource
//   - VHubs are children of a Virtual WAN
//   - Resource Groups contain almost everything

import type { FieldDef } from './blockSchemas'

export const containerTypes = new Set<string>([
  'Resource Group',
  'Subscription',
  'Management Group',
  'VNet',
  'Subnet',
  'Virtual WAN',
  'Virtual Hub',
])

// What each container can directly contain (immediate children).
export const containmentRules: Record<string, string[]> = {
  'Management Group': ['Management Group', 'Subscription', 'Policy Assignment'],
  Subscription: ['Resource Group', 'Policy Assignment'],
  'Resource Group': [
    'VNet','NSG','Route Table','NAT Gateway','Azure Firewall','VPN Gateway','ExpressRoute Gateway',
    'Private DNS Zone','Load Balancer','Application Gateway','Virtual WAN','Virtual Hub','NVA',
    'VM','VM Scale Set','AKS','Container App','Function App','App Service',
    'Storage Account','SQL Database','PostgreSQL','Cosmos DB','Key Vault',
    'Managed Identity','Bastion','Log Analytics','Defender for Cloud',
  ],
  VNet: ['Subnet'],
  Subnet: ['Private Endpoint'],
  'Virtual WAN': ['Virtual Hub'],
  'Virtual Hub': ['Route Intent','Azure Firewall','VPN Gateway','ExpressRoute Gateway','NVA'],
}

export function canContain(parentType: string, childType: string): boolean {
  return containmentRules[parentType]?.includes(childType) ?? false
}

export function isContainer(type: string): boolean {
  return containerTypes.has(type)
}

// Connection rules — edges represent associations / references.
// Format: source → list of allowed targets (and a label for the relationship).
export interface ConnectionRule {
  target: string
  label: string
}

export const connectionRules: Record<string, ConnectionRule[]> = {
  // NSGs attach to subnets or NICs (we don't model NICs, so VM/VMSS stand-in)
  NSG: [
    { target: 'Subnet', label: 'protects' },
    { target: 'VM', label: 'protects NIC' },
    { target: 'VM Scale Set', label: 'protects NIC' },
  ],
  // Route Tables attach to subnets
  'Route Table': [
    { target: 'Subnet', label: 'routes for' },
  ],
  // Private DNS zones link to VNets
  'Private DNS Zone': [
    { target: 'VNet', label: 'linked to' },
  ],
  // Private Endpoints target a PaaS resource (live inside a Subnet via containment)
  'Private Endpoint': [
    { target: 'Storage Account', label: 'targets' },
    { target: 'SQL Database', label: 'targets' },
    { target: 'PostgreSQL', label: 'targets' },
    { target: 'Cosmos DB', label: 'targets' },
    { target: 'Key Vault', label: 'targets' },
    { target: 'App Service', label: 'targets' },
    { target: 'Function App', label: 'targets' },
    { target: 'Container App', label: 'targets' },
  ],
  // VNet peering / vWAN VNet connection
  VNet: [
    { target: 'VNet', label: 'peers with' },
    { target: 'Virtual Hub', label: 'vnet connection' },
  ],
  // VPN Gateway / ER Gateway live in GatewaySubnet of a VNet (or in a VHub)
  'VPN Gateway': [
    { target: 'VNet', label: 'gateway for' },
  ],
  'ExpressRoute Gateway': [
    { target: 'VNet', label: 'gateway for' },
  ],
  // NAT Gateway attaches to a Subnet
  'NAT Gateway': [
    { target: 'Subnet', label: 'outbound for' },
  ],
  // Azure Firewall lives in AzureFirewallSubnet — link it to its VNet/Hub
  'Azure Firewall': [
    { target: 'VNet', label: 'protects' },
    { target: 'Virtual Hub', label: 'secures hub' },
  ],
  // NVAs sit in a VNet/VHub
  NVA: [
    { target: 'VNet', label: 'in' },
    { target: 'Virtual Hub', label: 'in' },
  ],
  // Load Balancer / App Gateway front compute
  'Load Balancer': [
    { target: 'VM', label: 'load balances' },
    { target: 'VM Scale Set', label: 'load balances' },
    { target: 'AKS', label: 'load balances' },
  ],
  'Application Gateway': [
    { target: 'App Service', label: 'fronts' },
    { target: 'Function App', label: 'fronts' },
    { target: 'Container App', label: 'fronts' },
    { target: 'AKS', label: 'fronts' },
    { target: 'VM Scale Set', label: 'fronts' },
  ],
  // Bastion sits in AzureBastionSubnet of a VNet
  Bastion: [
    { target: 'VNet', label: 'in' },
  ],
  // Compute uses identity / KV / storage
  VM: [
    { target: 'Managed Identity', label: 'uses' },
    { target: 'Key Vault', label: 'reads from' },
    { target: 'Storage Account', label: 'uses' },
  ],
  AKS: [
    { target: 'Managed Identity', label: 'uses' },
    { target: 'Key Vault', label: 'reads from' },
    { target: 'Log Analytics', label: 'logs to' },
  ],
  'App Service': [
    { target: 'Managed Identity', label: 'uses' },
    { target: 'Key Vault', label: 'reads from' },
    { target: 'SQL Database', label: 'connects to' },
    { target: 'PostgreSQL', label: 'connects to' },
    { target: 'Storage Account', label: 'uses' },
  ],
  'Function App': [
    { target: 'Managed Identity', label: 'uses' },
    { target: 'Key Vault', label: 'reads from' },
    { target: 'SQL Database', label: 'connects to' },
    { target: 'PostgreSQL', label: 'connects to' },
    { target: 'Storage Account', label: 'uses' },
    { target: 'Cosmos DB', label: 'connects to' },
  ],
  'Container App': [
    { target: 'Managed Identity', label: 'uses' },
    { target: 'Key Vault', label: 'reads from' },
    { target: 'Storage Account', label: 'uses' },
  ],
  // RBAC / policy
  'RBAC Assignment': [
    { target: 'Managed Identity', label: 'role of' },
    { target: 'Subscription', label: 'on' },
    { target: 'Resource Group', label: 'on' },
    { target: 'Key Vault', label: 'on' },
    { target: 'Storage Account', label: 'on' },
  ],
  // Route Intent points at a NVA or firewall
  'Route Intent': [
    { target: 'Azure Firewall', label: 'next-hop' },
    { target: 'NVA', label: 'next-hop' },
  ],
  // Diagnostic logs all go to Log Analytics — handled implicitly per resource if needed
}

export function canConnect(sourceType: string, targetType: string): { allowed: boolean; label?: string; reason?: string } {
  const rules = connectionRules[sourceType]
  if (!rules || rules.length === 0) {
    return { allowed: false, reason: `${sourceType} has no defined outgoing connections.` }
  }
  const match = rules.find((r) => r.target === targetType)
  if (!match) {
    return {
      allowed: false,
      reason: `${sourceType} cannot connect to ${targetType}. Allowed: ${rules.map((r) => r.target).join(', ')}.`,
    }
  }
  return { allowed: true, label: match.label }
}

// Recommended size for container nodes (px). Children sit inside.
export function containerSize(type: string): { width: number; height: number } {
  switch (type) {
    case 'Management Group': return { width: 720, height: 480 }
    case 'Subscription':     return { width: 640, height: 440 }
    case 'Resource Group':   return { width: 560, height: 400 }
    case 'Virtual WAN':      return { width: 560, height: 360 }
    case 'VNet':             return { width: 440, height: 320 }
    case 'Virtual Hub':      return { width: 400, height: 300 }
    case 'Subnet':           return { width: 280, height: 180 }
    default:                 return { width: 320, height: 220 }
  }
}

// ───────── Connection (edge) property schemas ─────────
// Some relationships carry their own settings (most notably vWAN VNet connections
// and VNet peering). The edge property editor renders these schemas.

export interface ConnectionSchema {
  /** Friendly name shown in the editor header. */
  title: string
  /** One-line description shown under the header. */
  description?: string
  /** Microsoft Learn reference for this relationship. */
  reference?: string
  /** Optional ordered group headings. */
  groups?: string[]
  fields: FieldDef[]
}

// Key format: `${sourceType}→${targetType}`
export const connectionSchemas: Record<string, ConnectionSchema> = {
  // ── vWAN: VNet connection (VNet → Virtual Hub) ──
  'VNet→Virtual Hub': {
    title: 'Virtual Network Connection',
    description: 'Connects a VNet (spoke) to a Virtual Hub. Defines hub routing, security, and propagation.',
    reference: 'https://learn.microsoft.com/azure/virtual-wan/about-virtual-hub-routing',
    groups: ['Connection', 'Routing', 'Security', 'Static routes'],
    fields: [
      { key: 'connectionName', label: 'Connection name', type: 'text', group: 'Connection',
        placeholder: 'spoke-prod-to-hub', required: true,
        help: 'Name of the hubVirtualNetworkConnection resource.' },
      { key: 'enableInternetSecurity', label: 'Secure internet traffic via hub', type: 'checkbox',
        group: 'Security', default: true,
        help: 'Sends 0.0.0.0/0 traffic from the VNet through Azure Firewall / NVA in the hub (Secured Virtual Hub).' },
      { key: 'allowHubToRemoteVnetTransit', label: 'Allow hub → remote VNet transit', type: 'checkbox',
        group: 'Routing', default: true,
        help: 'Hub can route traffic to this VNet (transit gateway behaviour).' },
      { key: 'allowRemoteVnetToUseHubVnetGateways', label: 'Use hub VPN/ER gateways', type: 'checkbox',
        group: 'Routing', default: true,
        help: 'This VNet can use VPN / ExpressRoute gateways deployed in the hub.' },
      { key: 'associatedRouteTable', label: 'Associated route table', type: 'select',
        group: 'Routing', default: 'defaultRouteTable',
        options: [
          { value: 'defaultRouteTable', label: 'Default route table' },
          { value: 'noneRouteTable', label: 'None (isolated)' },
          { value: 'custom', label: 'Custom route table' },
        ],
        help: 'Route table this connection associates with — determines what routes the VNet learns.' },
      { key: 'associatedRouteTableId', label: 'Custom route table resource ID', type: 'text',
        group: 'Routing', placeholder: '/subscriptions/.../hubRouteTables/...',
        help: 'Required only when "Associated route table" is set to Custom.' },
      { key: 'propagatedLabels', label: 'Propagated labels', type: 'tags',
        group: 'Routing', default: ['default'],
        placeholder: 'default, prod',
        help: 'Route-table labels this VNet\'s routes are propagated to.' },
      { key: 'propagatedRouteTableIds', label: 'Propagated route tables (IDs)', type: 'tags',
        group: 'Routing',
        placeholder: '/subscriptions/.../hubRouteTables/rt1, ...',
        help: 'Specific hub route table resource IDs to propagate to (in addition to labels).' },
      { key: 'staticRoutes', label: 'Static routes (CIDR → next-hop IP)', type: 'textarea',
        group: 'Static routes',
        placeholder: '10.50.0.0/16=10.0.0.4\n0.0.0.0/0=10.0.0.4',
        help: 'One per line — addressPrefix=nextHopIP. Use to override propagated routes (e.g. force via NVA).' },
      { key: 'enableInternetSecurityNote', label: 'Notes', type: 'textarea',
        group: 'Connection', placeholder: 'Free text — purpose, ticket #, owner.' },
    ],
  },

  // ── Classic VNet peering (VNet → VNet) ──
  'VNet→VNet': {
    title: 'Virtual Network Peering',
    description: 'Bi-directional peering between two VNets. These flags configure the LOCAL side.',
    reference: 'https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview',
    groups: ['Peering', 'Gateway transit'],
    fields: [
      { key: 'peeringName', label: 'Peering name', type: 'text', group: 'Peering',
        placeholder: 'hub-to-spoke1', required: true },
      { key: 'allowVirtualNetworkAccess', label: 'Allow access from local VNet to remote VNet', type: 'checkbox',
        group: 'Peering', default: true,
        help: 'When disabled, traffic between the two VNets is blocked at the platform (the "local network access" flag).' },
      { key: 'allowForwardedTraffic', label: 'Allow forwarded traffic', type: 'checkbox',
        group: 'Peering', default: false,
        help: 'Allow traffic forwarded from outside the remote VNet (e.g. via NVA) to enter the local VNet.' },
      { key: 'allowGatewayTransit', label: 'Allow gateway transit', type: 'checkbox',
        group: 'Gateway transit', default: false,
        help: 'Local VNet shares its VPN/ER gateway with the remote VNet. Set on the hub side.' },
      { key: 'useRemoteGateways', label: 'Use remote gateways', type: 'checkbox',
        group: 'Gateway transit', default: false,
        help: 'Local VNet uses the gateway in the remote VNet. Set on the spoke side. Mutually exclusive with the local VNet having its own gateway.' },
      { key: 'doNotVerifyRemoteGateways', label: 'Do not verify remote gateways', type: 'checkbox',
        group: 'Gateway transit', default: false,
        help: 'Skip checking that the remote gateway is provisioned (advanced).' },
    ],
  },

  // ── NSG → Subnet (association) ──
  'NSG→Subnet': {
    title: 'NSG ↔ Subnet association',
    description: 'Associates a Network Security Group with a subnet. Rules in the NSG apply to all NICs in the subnet.',
    reference: 'https://learn.microsoft.com/azure/virtual-network/network-security-group-how-it-works',
    fields: [
      { key: 'note', label: 'Notes', type: 'textarea', placeholder: 'Document why this NSG is on this subnet.' },
    ],
  },

  // ── Route Table → Subnet ──
  'Route Table→Subnet': {
    title: 'UDR ↔ Subnet association',
    description: 'Associates a route table with a subnet. UDRs override system routes.',
    reference: 'https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview',
    fields: [
      { key: 'disableBgpRoutePropagation', label: 'Disable BGP route propagation', type: 'checkbox',
        default: false,
        help: 'When true, on-prem routes learned via VPN/ER are NOT propagated to this subnet.' },
    ],
  },

  // ── Private DNS Zone → VNet (virtualNetworkLink) ──
  'Private DNS Zone→VNet': {
    title: 'Private DNS Zone link',
    description: 'Links a Private DNS Zone to a VNet so VMs can resolve records in the zone.',
    reference: 'https://learn.microsoft.com/azure/dns/private-dns-virtual-network-links',
    fields: [
      { key: 'linkName', label: 'Link name', type: 'text', placeholder: 'spoke1-link', required: true },
      { key: 'registrationEnabled', label: 'Auto-registration', type: 'checkbox', default: false,
        help: 'When true, VMs in this VNet auto-register A records in the zone.' },
      { key: 'resolutionPolicy', label: 'Resolution policy', type: 'select',
        default: 'Default',
        options: [
          { value: 'Default', label: 'Default (private resolution only)' },
          { value: 'NxDomainRedirect', label: 'NXDOMAIN redirect (fallback to public DNS)' },
        ] },
    ],
  },

  // ── Private Endpoint → PaaS resource ──
  ...Object.fromEntries(
    ['Storage Account','SQL Database','PostgreSQL','Cosmos DB','Key Vault','App Service','Function App','Container App'].map((t) => [
      `Private Endpoint→${t}`,
      {
        title: `Private Endpoint → ${t}`,
        description: `Targets the ${t} via a private endpoint connection.`,
        reference: 'https://learn.microsoft.com/azure/private-link/private-endpoint-overview',
        fields: [
          { key: 'groupId', label: 'Sub-resource (groupId)', type: 'text',
            placeholder: t === 'Storage Account' ? 'blob | file | queue | table | dfs | web' : '',
            help: 'Target sub-resource. Required by Private Link.' , required: true },
          { key: 'privateDnsZoneGroup', label: 'Private DNS zone group name', type: 'text',
            placeholder: 'default' },
          { key: 'manualApproval', label: 'Manual approval required', type: 'checkbox', default: false },
        ] as FieldDef[],
      } as ConnectionSchema,
    ]),
  ),

  // ── Route Intent → next-hop ──
  'Route Intent→Azure Firewall': {
    title: 'Route Intent next-hop = Azure Firewall',
    description: 'Sends internet/private traffic from the hub through Azure Firewall.',
    reference: 'https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies',
    fields: [
      { key: 'note', label: 'Notes', type: 'textarea' },
    ],
  },
  'Route Intent→NVA': {
    title: 'Route Intent next-hop = NVA',
    description: 'Sends internet/private traffic from the hub through a third-party NVA.',
    reference: 'https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies',
    fields: [
      { key: 'note', label: 'Notes', type: 'textarea' },
    ],
  },
}

export function getConnectionSchema(sourceType: string, targetType: string): ConnectionSchema | undefined {
  return connectionSchemas[`${sourceType}→${targetType}`]
}
