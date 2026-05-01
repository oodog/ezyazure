// Schema-driven property definitions for each block type.
// Settings are sourced from Microsoft public documentation:
//   - https://learn.microsoft.com/azure/virtual-network/
//   - https://learn.microsoft.com/azure/virtual-wan/
//   - https://learn.microsoft.com/azure/firewall/
//   - https://learn.microsoft.com/azure/aks/
//   - https://learn.microsoft.com/azure/well-architected/
//   - https://learn.microsoft.com/azure/cloud-adoption-framework/

export type FieldType =
  | 'text'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'cidrList'
  | 'tags'
  | 'textarea'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  placeholder?: string
  help?: string
  options?: { value: string; label: string }[]
  default?: unknown
  group?: string
  required?: boolean
}

export interface BlockSchema {
  groups?: string[]
  fields: FieldDef[]
}

const azureRegions = [
  'australiaeast', 'australiasoutheast', 'eastus', 'eastus2', 'westus2', 'westus3',
  'centralus', 'northeurope', 'westeurope', 'uksouth', 'ukwest', 'southeastasia', 'eastasia',
  'japaneast', 'koreacentral', 'canadacentral', 'brazilsouth',
].map((r) => ({ value: r, label: r }))

// Common fields reused across block types
const locationField: FieldDef = {
  key: 'location', label: 'Region', type: 'select', options: azureRegions,
  default: 'australiaeast', group: 'General', required: true,
}
const nameField: FieldDef = {
  key: 'name', label: 'Resource name', type: 'text', placeholder: 'my-resource',
  group: 'General', required: true,
  help: 'Lowercase letters, numbers, hyphens. 1–80 chars depending on resource.',
}
const tagsField: FieldDef = {
  key: 'tags', label: 'Tags', type: 'tags',
  placeholder: 'env=prod, costCenter=1234',
  group: 'Governance',
  help: 'Comma-separated key=value pairs. Recommended: env, owner, costCenter.',
}

export const blockSchemas: Record<string, BlockSchema> = {
  // ─────────────────────────────────────────── Management ───────────────────────────────────────────
  'Management Group': {
    groups: ['General'],
    fields: [
      nameField,
      { key: 'displayName', label: 'Display name', type: 'text', group: 'General' },
      { key: 'parentId', label: 'Parent management group ID', type: 'text', group: 'General' },
    ],
  },
  Subscription: {
    groups: ['General', 'Governance'],
    fields: [
      nameField,
      { key: 'subscriptionId', label: 'Subscription ID', type: 'text', group: 'General' },
      { key: 'offerType', label: 'Offer type', type: 'select', group: 'General',
        options: ['MS-AZR-0017P','MS-AZR-0148P','MS-AZR-0023P','MS-AZR-0003P','EA','CSP'].map(v=>({value:v,label:v})) },
      tagsField,
    ],
  },
  'Resource Group': {
    groups: ['General', 'Governance'],
    fields: [nameField, locationField, tagsField],
  },
  'Policy Assignment': {
    groups: ['General', 'Policy'],
    fields: [
      nameField,
      { key: 'policyDefinitionId', label: 'Policy definition ID', type: 'text', group: 'Policy', required: true,
        placeholder: '/providers/Microsoft.Authorization/policyDefinitions/...'},
      { key: 'enforcementMode', label: 'Enforcement', type: 'select', group: 'Policy',
        options: [{value:'Default',label:'Default (deny / audit applied)'},{value:'DoNotEnforce',label:'Do not enforce (test mode)'}], default: 'Default' },
      { key: 'scope', label: 'Scope', type: 'text', group: 'Policy' },
    ],
  },

  // ─────────────────────────────────────────── Networking ───────────────────────────────────────────
  VNet: {
    groups: ['General', 'Address space', 'DNS', 'DDoS', 'Governance'],
    fields: [
      nameField, locationField,
      { key: 'addressSpace', label: 'Address space (CIDR)', type: 'cidrList', group: 'Address space', required: true,
        default: ['10.0.0.0/16'], help: 'Use RFC 1918 ranges. Avoid 172.17.0.0/16 (Docker).' },
      { key: 'dnsServers', label: 'Custom DNS servers', type: 'cidrList', group: 'DNS',
        help: 'Leave empty for Azure-provided DNS. Set DNS server IPs for hub-spoke / on-prem resolution.' },
      { key: 'ddosProtection', label: 'Enable DDoS Network Protection', type: 'checkbox', group: 'DDoS', default: false,
        help: 'Recommended for production-facing VNets. ~AUD $4,500/mo per protection plan covers up to 100 resources.' },
      { key: 'enableEncryption', label: 'VNet encryption', type: 'checkbox', group: 'Address space', default: false,
        help: 'Encrypts traffic between Azure VMs in the same VNet.' },
      { key: 'flowTimeout', label: 'Flow timeout (minutes)', type: 'number', group: 'General', default: 4 },
      tagsField,
    ],
  },
  Subnet: {
    groups: ['General', 'Delegation', 'Endpoints'],
    fields: [
      nameField,
      { key: 'addressPrefix', label: 'Address prefix (CIDR)', type: 'text', group: 'General', required: true,
        placeholder: '10.0.1.0/24', help: 'Min /29. Azure reserves 5 addresses (.0, .1, .2, .3, broadcast).' },
      { key: 'delegation', label: 'Service delegation', type: 'select', group: 'Delegation',
        default: 'none', options: [
          {value:'none',label:'None'},
          {value:'Microsoft.Web/serverFarms',label:'App Service / Function (VNet integration)'},
          {value:'Microsoft.ContainerInstance/containerGroups',label:'Container Instances'},
          {value:'Microsoft.DBforPostgreSQL/flexibleServers',label:'PostgreSQL Flexible Server'},
          {value:'Microsoft.DBforMySQL/flexibleServers',label:'MySQL Flexible Server'},
          {value:'Microsoft.Network/dnsResolvers',label:'DNS Private Resolver'},
          {value:'Microsoft.App/environments',label:'Container Apps environment'},
        ] },
      { key: 'serviceEndpoints', label: 'Service endpoints', type: 'multiselect', group: 'Endpoints',
        options: ['Microsoft.Storage','Microsoft.Sql','Microsoft.KeyVault','Microsoft.ServiceBus',
          'Microsoft.EventHub','Microsoft.CognitiveServices','Microsoft.Web','Microsoft.AzureCosmosDB']
          .map(v=>({value:v,label:v})) },
      { key: 'privateEndpointPolicies', label: 'Private endpoint network policies', type: 'select', group: 'Endpoints',
        default: 'Disabled', options: [{value:'Disabled',label:'Disabled (default)'},{value:'Enabled',label:'Enabled (NSG applies to PE)'}] },
    ],
  },
  NSG: {
    groups: ['General', 'Rules', 'Diagnostics'],
    fields: [
      nameField, locationField,
      { key: 'rules', label: 'Inbound rules (priority|name|action|src|dst|port|proto)', type: 'textarea', group: 'Rules',
        placeholder: '100|AllowHTTPS|Allow|Internet|VirtualNetwork|443|Tcp',
        help: 'One rule per line. Lower priority = evaluated first. Default: deny all inbound.' },
      { key: 'flowLogs', label: 'Enable NSG flow logs', type: 'checkbox', group: 'Diagnostics', default: true,
        help: 'WAF recommended. Required for Traffic Analytics.' },
      { key: 'flowLogsRetention', label: 'Flow log retention (days)', type: 'number', group: 'Diagnostics', default: 30 },
    ],
  },
  'Route Table': {
    groups: ['General', 'Routes'],
    fields: [
      nameField, locationField,
      { key: 'disableBgpPropagation', label: 'Disable BGP route propagation', type: 'checkbox', group: 'Routes', default: false },
      { key: 'routes', label: 'User-defined routes (name|prefix|nextHopType|nextHopIp)', type: 'textarea', group: 'Routes',
        placeholder: 'to-firewall|0.0.0.0/0|VirtualAppliance|10.0.0.4' },
    ],
  },
  'NAT Gateway': {
    groups: ['General', 'Outbound'],
    fields: [
      nameField, locationField,
      { key: 'idleTimeoutMinutes', label: 'Idle timeout (minutes)', type: 'number', group: 'Outbound', default: 4,
        help: '4–120. Increase for long-lived TCP connections.' },
      { key: 'publicIpCount', label: 'Public IPs', type: 'number', group: 'Outbound', default: 1, help: '1–16. Each adds 64,000 SNAT ports.' },
      { key: 'zones', label: 'Availability zones', type: 'multiselect', group: 'General',
        options: [{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}],
        help: 'NAT Gateway is zonal — pick exactly one zone or none.' },
    ],
  },
  'Azure Firewall': {
    groups: ['General', 'SKU', 'Threat intel', 'DNS'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'SKU tier', type: 'select', group: 'SKU', default: 'Standard',
        options: [{value:'Basic',label:'Basic (SMB, no IDPS)'},{value:'Standard',label:'Standard'},{value:'Premium',label:'Premium (IDPS, TLS inspection)'}] },
      { key: 'firewallPolicyId', label: 'Firewall Policy ID', type: 'text', group: 'General' },
      { key: 'threatIntelMode', label: 'Threat intel mode', type: 'select', group: 'Threat intel', default: 'Alert',
        options: [{value:'Off',label:'Off'},{value:'Alert',label:'Alert'},{value:'Deny',label:'Deny (recommended)'}] },
      { key: 'idpsMode', label: 'IDPS mode (Premium only)', type: 'select', group: 'Threat intel', default: 'Alert',
        options: [{value:'Off',label:'Off'},{value:'Alert',label:'Alert'},{value:'Deny',label:'Deny'}] },
      { key: 'dnsProxy', label: 'DNS proxy enabled', type: 'checkbox', group: 'DNS', default: true,
        help: 'Required for FQDN-based network rules.' },
      { key: 'zones', label: 'Availability zones', type: 'multiselect', group: 'General',
        options: [{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}], default: ['1','2','3'],
        help: 'WAF: deploy across 3 zones for 99.99% SLA.' },
    ],
  },
  'VPN Gateway': {
    groups: ['General', 'SKU', 'BGP'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'SKU', type: 'select', group: 'SKU', default: 'VpnGw2',
        options: ['Basic','VpnGw1','VpnGw2','VpnGw3','VpnGw4','VpnGw5','VpnGw1AZ','VpnGw2AZ','VpnGw3AZ','VpnGw4AZ','VpnGw5AZ'].map(v=>({value:v,label:v})),
        help: 'Avoid Basic for production. Use *AZ SKUs for zone redundancy.' },
      { key: 'vpnType', label: 'VPN type', type: 'select', group: 'General', default: 'RouteBased',
        options: [{value:'RouteBased',label:'RouteBased (recommended)'},{value:'PolicyBased',label:'PolicyBased (legacy)'}] },
      { key: 'activeActive', label: 'Active-active', type: 'checkbox', group: 'General', default: false },
      { key: 'enableBgp', label: 'BGP enabled', type: 'checkbox', group: 'BGP', default: false },
      { key: 'asn', label: 'ASN', type: 'number', group: 'BGP', default: 65515 },
    ],
  },
  'ExpressRoute Gateway': {
    groups: ['General', 'SKU'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'SKU', type: 'select', group: 'SKU', default: 'ErGw2AZ',
        options: ['Standard','HighPerformance','UltraPerformance','ErGw1AZ','ErGw2AZ','ErGw3AZ'].map(v=>({value:v,label:v})) },
      { key: 'expressRouteCircuitId', label: 'ExpressRoute circuit ID', type: 'text', group: 'General' },
      { key: 'allowNonIPsecTraffic', label: 'Allow non-IPsec', type: 'checkbox', group: 'General', default: false },
    ],
  },
  'Private DNS Zone': {
    groups: ['General', 'Zones'],
    fields: [
      { key: 'name', label: 'Zone name (FQDN)', type: 'text', required: true, group: 'General',
        placeholder: 'privatelink.blob.core.windows.net',
        help: 'For Private Endpoint: use Microsoft-recommended privatelink.* names.' },
      { key: 'registrationVnets', label: 'Auto-registration VNet IDs', type: 'cidrList', group: 'Zones' },
    ],
  },
  'Private Endpoint': {
    groups: ['General', 'Target', 'DNS'],
    fields: [
      nameField, locationField,
      { key: 'targetResourceId', label: 'Target resource ID', type: 'text', group: 'Target', required: true },
      { key: 'groupId', label: 'Group ID (subresource)', type: 'select', group: 'Target',
        options: ['blob','file','queue','table','dfs','web','sqlServer','mariadbServer','postgresqlServer','mysqlServer','vault','sites','registry','managedInstance']
          .map(v=>({value:v,label:v})) },
      { key: 'privateDnsZoneId', label: 'Private DNS zone ID', type: 'text', group: 'DNS',
        help: 'WAF: link a privatelink.* zone for hostname resolution to private IP.' },
    ],
  },
  'Load Balancer': {
    groups: ['General', 'SKU', 'Backend'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'SKU', type: 'select', group: 'SKU', default: 'Standard',
        options: [{value:'Basic',label:'Basic (deprecated 2025)'},{value:'Standard',label:'Standard'},{value:'Gateway',label:'Gateway'}] },
      { key: 'tier', label: 'Tier', type: 'select', group: 'SKU', default: 'Regional',
        options: [{value:'Regional',label:'Regional'},{value:'Global',label:'Global (cross-region)'}] },
      { key: 'frontendIpType', label: 'Frontend IP type', type: 'select', group: 'General',
        default: 'Public', options: [{value:'Public',label:'Public'},{value:'Private',label:'Internal'}] },
      { key: 'zones', label: 'Availability zones', type: 'multiselect', group: 'General',
        options: [{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}], default: ['1','2','3'] },
    ],
  },
  'Application Gateway': {
    groups: ['General', 'SKU', 'WAF'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'SKU', type: 'select', group: 'SKU', default: 'WAF_v2',
        options: [{value:'Standard_v2',label:'Standard_v2'},{value:'WAF_v2',label:'WAF_v2 (recommended)'}] },
      { key: 'capacity', label: 'Min instance count', type: 'number', group: 'SKU', default: 2, help: 'WAF: minimum 2 instances for HA.' },
      { key: 'maxCapacity', label: 'Max instance count (autoscale)', type: 'number', group: 'SKU', default: 10 },
      { key: 'wafMode', label: 'WAF mode', type: 'select', group: 'WAF', default: 'Prevention',
        options: [{value:'Detection',label:'Detection'},{value:'Prevention',label:'Prevention (recommended)'}] },
      { key: 'wafRuleSet', label: 'WAF managed rule set', type: 'select', group: 'WAF', default: 'OWASP_3.2',
        options: [{value:'OWASP_3.2',label:'OWASP 3.2'},{value:'Microsoft_DefaultRuleSet_2.1',label:'Microsoft DRS 2.1'}] },
      { key: 'http2Enabled', label: 'HTTP/2 enabled', type: 'checkbox', group: 'General', default: true },
      { key: 'zones', label: 'Availability zones', type: 'multiselect', group: 'General',
        options: [{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}], default: ['1','2','3'] },
    ],
  },

  // ─────────── New networking blocks ───────────
  'Virtual WAN': {
    groups: ['General', 'Type'],
    fields: [
      nameField, locationField,
      { key: 'type', label: 'WAN type', type: 'select', group: 'Type', default: 'Standard',
        options: [{value:'Basic',label:'Basic (S2S only)'},{value:'Standard',label:'Standard (recommended)'}] },
      { key: 'allowBranchToBranch', label: 'Allow branch-to-branch traffic', type: 'checkbox', group: 'Type', default: true },
      { key: 'disableVpnEncryption', label: 'Disable VPN encryption', type: 'checkbox', group: 'Type', default: false },
      tagsField,
    ],
  },
  'Virtual Hub': {
    groups: ['General', 'Routing', 'Security'],
    fields: [
      nameField, locationField,
      { key: 'addressPrefix', label: 'Hub address prefix (CIDR)', type: 'text', group: 'General', required: true,
        placeholder: '10.100.0.0/23', help: 'Minimum /24. Recommended /23 to support all gateways and Firewall.' },
      { key: 'virtualWanId', label: 'Parent Virtual WAN ID', type: 'text', group: 'General', required: true },
      { key: 'sku', label: 'Hub SKU', type: 'select', group: 'General', default: 'Standard',
        options: [{value:'Basic',label:'Basic'},{value:'Standard',label:'Standard'}] },
      { key: 'preferredRoutingGateway', label: 'Preferred routing gateway', type: 'select', group: 'Routing', default: 'ExpressRoute',
        options: [{value:'ExpressRoute',label:'ExpressRoute'},{value:'VpnGateway',label:'VPN'},{value:'None',label:'None'}] },
      { key: 'hubRoutingPreference', label: 'Hub routing preference', type: 'select', group: 'Routing', default: 'ExpressRoute',
        options: [{value:'ExpressRoute',label:'ExpressRoute'},{value:'VpnGateway',label:'VPN'},{value:'ASPath',label:'AS Path'}] },
      { key: 'secureHub', label: 'Secured Virtual Hub (Azure Firewall)', type: 'checkbox', group: 'Security', default: false,
        help: 'Deploys Azure Firewall in the hub for filtering branch/internet traffic.' },
    ],
  },
  'Route Intent': {
    groups: ['General', 'Intent'],
    fields: [
      nameField,
      { key: 'virtualHubId', label: 'Virtual Hub ID', type: 'text', group: 'General', required: true },
      { key: 'internetTraffic', label: 'Internet traffic next-hop', type: 'select', group: 'Intent', default: 'AzureFirewall',
        options: [{value:'None',label:'None'},{value:'AzureFirewall',label:'Azure Firewall'},{value:'NVA',label:'Third-party NVA'}] },
      { key: 'privateTraffic', label: 'Private traffic next-hop', type: 'select', group: 'Intent', default: 'AzureFirewall',
        options: [{value:'None',label:'None'},{value:'AzureFirewall',label:'Azure Firewall'},{value:'NVA',label:'Third-party NVA'}] },
      { key: 'nextHopResourceId', label: 'Next-hop resource ID', type: 'text', group: 'Intent',
        help: 'Required if either next-hop = NVA. Should reference a Network Virtual Appliance in the same hub.' },
    ],
  },
  NVA: {
    groups: ['General', 'Vendor', 'HA', 'Networking'],
    fields: [
      nameField, locationField,
      { key: 'vendor', label: 'Vendor', type: 'select', group: 'Vendor', default: 'Palo Alto',
        options: ['Palo Alto','Fortinet','Check Point','Cisco','Barracuda','Citrix','F5','Custom']
          .map(v=>({value:v,label:v})) },
      { key: 'productSku', label: 'Marketplace plan / SKU', type: 'text', group: 'Vendor',
        placeholder: 'vmseries-flex-byol' },
      { key: 'vmSize', label: 'VM size', type: 'select', group: 'General', default: 'Standard_D8s_v5',
        options: ['Standard_D4s_v5','Standard_D8s_v5','Standard_D16s_v5','Standard_F8s_v2','Standard_F16s_v2','Standard_DS3_v2','Standard_DS4_v2']
          .map(v=>({value:v,label:v})) },
      { key: 'haPair', label: 'Deploy HA pair', type: 'checkbox', group: 'HA', default: true,
        help: 'WAF: deploy minimum 2 instances behind a Standard Load Balancer.' },
      { key: 'zones', label: 'Availability zones', type: 'multiselect', group: 'HA',
        options: [{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}], default: ['1','2'] },
      { key: 'trustSubnetId', label: 'Trust subnet ID', type: 'text', group: 'Networking' },
      { key: 'untrustSubnetId', label: 'Untrust subnet ID', type: 'text', group: 'Networking' },
      { key: 'mgmtSubnetId', label: 'Management subnet ID', type: 'text', group: 'Networking' },
      { key: 'enableIpForwarding', label: 'Enable IP forwarding', type: 'checkbox', group: 'Networking', default: true },
    ],
  },

  // ─────────────────────────────────────────── Compute ───────────────────────────────────────────
  VM: {
    groups: ['General', 'Compute', 'OS', 'Disks', 'Networking', 'Security'],
    fields: [
      nameField, locationField,
      { key: 'vmSize', label: 'VM size', type: 'select', group: 'Compute', default: 'Standard_D2s_v5',
        options: ['Standard_B2s','Standard_D2s_v5','Standard_D4s_v5','Standard_D8s_v5','Standard_E4s_v5','Standard_F4s_v2','Standard_F8s_v2']
          .map(v=>({value:v,label:v})) },
      { key: 'osType', label: 'OS', type: 'select', group: 'OS', default: 'Linux',
        options: [{value:'Linux',label:'Linux'},{value:'Windows',label:'Windows'}] },
      { key: 'osImage', label: 'OS image', type: 'text', group: 'OS', placeholder: 'Canonical:0001-com-ubuntu-server-jammy:22_04-lts-gen2:latest' },
      { key: 'osDiskType', label: 'OS disk SKU', type: 'select', group: 'Disks', default: 'Premium_LRS',
        options: [{value:'Standard_LRS',label:'Standard HDD'},{value:'StandardSSD_LRS',label:'Standard SSD'},{value:'Premium_LRS',label:'Premium SSD'},{value:'PremiumV2_LRS',label:'Premium SSD v2'},{value:'UltraSSD_LRS',label:'Ultra SSD'}] },
      { key: 'osDiskSizeGB', label: 'OS disk size (GB)', type: 'number', group: 'Disks', default: 64 },
      { key: 'subnetId', label: 'Subnet ID', type: 'text', group: 'Networking', required: true },
      { key: 'enableAcceleratedNetworking', label: 'Accelerated networking', type: 'checkbox', group: 'Networking', default: true },
      { key: 'zones', label: 'Availability zone', type: 'multiselect', group: 'Compute',
        options: [{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}] },
      { key: 'identityType', label: 'Managed identity', type: 'select', group: 'Security', default: 'SystemAssigned',
        options: [{value:'None',label:'None'},{value:'SystemAssigned',label:'System-assigned'},{value:'UserAssigned',label:'User-assigned'},{value:'Both',label:'System + User'}] },
      { key: 'encryptionAtHost', label: 'Encryption at host', type: 'checkbox', group: 'Security', default: true,
        help: 'WAF: encrypt OS + temp disks at host level.' },
      { key: 'bootDiagnostics', label: 'Boot diagnostics', type: 'checkbox', group: 'Security', default: true },
      tagsField,
    ],
  },
  'VM Scale Set': {
    groups: ['General', 'Scale', 'Networking', 'Health'],
    fields: [
      nameField, locationField,
      { key: 'vmSize', label: 'VM size', type: 'text', group: 'General', default: 'Standard_D2s_v5' },
      { key: 'capacity', label: 'Initial capacity', type: 'number', group: 'Scale', default: 2 },
      { key: 'minCapacity', label: 'Min capacity (autoscale)', type: 'number', group: 'Scale', default: 2 },
      { key: 'maxCapacity', label: 'Max capacity (autoscale)', type: 'number', group: 'Scale', default: 10 },
      { key: 'orchestrationMode', label: 'Orchestration mode', type: 'select', group: 'General', default: 'Flexible',
        options: [{value:'Uniform',label:'Uniform'},{value:'Flexible',label:'Flexible (recommended)'}] },
      { key: 'zones', label: 'Availability zones', type: 'multiselect', group: 'Scale',
        options: [{value:'1',label:'1'},{value:'2',label:'2'},{value:'3',label:'3'}], default: ['1','2','3'] },
      { key: 'overprovision', label: 'Overprovision', type: 'checkbox', group: 'Scale', default: true },
      { key: 'singlePlacementGroup', label: 'Single placement group', type: 'checkbox', group: 'Scale', default: false },
      { key: 'subnetId', label: 'Subnet ID', type: 'text', group: 'Networking', required: true },
      { key: 'healthProbeId', label: 'Health probe ID', type: 'text', group: 'Health' },
      { key: 'automaticRepairs', label: 'Automatic instance repairs', type: 'checkbox', group: 'Health', default: true },
    ],
  },
  AKS: {
    groups: ['General', 'Cluster', 'Networking', 'Security', 'Observability'],
    fields: [
      nameField, locationField,
      { key: 'kubernetesVersion', label: 'Kubernetes version', type: 'text', group: 'Cluster', default: '1.30' },
      { key: 'tier', label: 'Tier', type: 'select', group: 'Cluster', default: 'Standard',
        options: [{value:'Free',label:'Free (dev only)'},{value:'Standard',label:'Standard (99.95% SLA)'},{value:'Premium',label:'Premium (LTS)'}] },
      { key: 'nodeCount', label: 'System node count', type: 'number', group: 'Cluster', default: 3 },
      { key: 'nodeSize', label: 'Node VM size', type: 'text', group: 'Cluster', default: 'Standard_D4s_v5' },
      { key: 'autoscaler', label: 'Cluster autoscaler', type: 'checkbox', group: 'Cluster', default: true },
      { key: 'networkPlugin', label: 'Network plugin', type: 'select', group: 'Networking', default: 'azure',
        options: [{value:'azure',label:'Azure CNI'},{value:'kubenet',label:'Kubenet (legacy)'},{value:'azure-overlay',label:'Azure CNI Overlay'}] },
      { key: 'networkPolicy', label: 'Network policy', type: 'select', group: 'Networking', default: 'cilium',
        options: [{value:'none',label:'None'},{value:'azure',label:'Azure NPM'},{value:'calico',label:'Calico'},{value:'cilium',label:'Cilium (Azure CNI Powered by Cilium)'}] },
      { key: 'serviceCidr', label: 'Service CIDR', type: 'text', group: 'Networking', default: '10.100.0.0/16' },
      { key: 'dnsServiceIp', label: 'DNS service IP', type: 'text', group: 'Networking', default: '10.100.0.10' },
      { key: 'podCidr', label: 'Pod CIDR (overlay/kubenet)', type: 'text', group: 'Networking', default: '10.244.0.0/16' },
      { key: 'privateCluster', label: 'Private cluster', type: 'checkbox', group: 'Security', default: true,
        help: 'WAF baseline: API server private endpoint only.' },
      { key: 'rbacEnabled', label: 'Kubernetes RBAC', type: 'checkbox', group: 'Security', default: true },
      { key: 'aadIntegration', label: 'AAD / Entra ID integration', type: 'checkbox', group: 'Security', default: true },
      { key: 'workloadIdentity', label: 'Workload Identity', type: 'checkbox', group: 'Security', default: true },
      { key: 'oidcIssuer', label: 'OIDC issuer', type: 'checkbox', group: 'Security', default: true },
      { key: 'defenderEnabled', label: 'Defender for Containers', type: 'checkbox', group: 'Security', default: true },
      { key: 'logAnalyticsWorkspaceId', label: 'Log Analytics workspace ID', type: 'text', group: 'Observability' },
      { key: 'azureMonitorEnabled', label: 'Container Insights', type: 'checkbox', group: 'Observability', default: true },
    ],
  },
  'Container App': {
    groups: ['General', 'Compute', 'Ingress', 'Identity'],
    fields: [
      nameField, locationField,
      { key: 'environmentId', label: 'Container Apps environment ID', type: 'text', group: 'General', required: true },
      { key: 'image', label: 'Container image', type: 'text', group: 'Compute', placeholder: 'myacr.azurecr.io/app:1.0' },
      { key: 'cpu', label: 'CPU (cores)', type: 'number', group: 'Compute', default: 0.5 },
      { key: 'memoryGi', label: 'Memory (Gi)', type: 'number', group: 'Compute', default: 1 },
      { key: 'minReplicas', label: 'Min replicas', type: 'number', group: 'Compute', default: 1, help: 'WAF: ≥1 in production for cold-start avoidance.' },
      { key: 'maxReplicas', label: 'Max replicas', type: 'number', group: 'Compute', default: 10 },
      { key: 'ingressEnabled', label: 'Ingress enabled', type: 'checkbox', group: 'Ingress', default: true },
      { key: 'ingressExternal', label: 'External ingress', type: 'checkbox', group: 'Ingress', default: false },
      { key: 'targetPort', label: 'Target port', type: 'number', group: 'Ingress', default: 8080 },
      { key: 'identityType', label: 'Managed identity', type: 'select', group: 'Identity', default: 'SystemAssigned',
        options: [{value:'None',label:'None'},{value:'SystemAssigned',label:'System-assigned'},{value:'UserAssigned',label:'User-assigned'}] },
    ],
  },
  'Function App': {
    groups: ['General', 'Plan', 'Runtime', 'Network'],
    fields: [
      nameField, locationField,
      { key: 'plan', label: 'Hosting plan', type: 'select', group: 'Plan', default: 'FlexConsumption',
        options: [{value:'Consumption',label:'Consumption (Y1)'},{value:'FlexConsumption',label:'Flex Consumption'},{value:'Premium',label:'Elastic Premium'},{value:'Dedicated',label:'Dedicated (App Service Plan)'}] },
      { key: 'runtime', label: 'Runtime', type: 'select', group: 'Runtime', default: 'dotnet-isolated',
        options: ['dotnet-isolated','node','python','java','powershell','custom'].map(v=>({value:v,label:v})) },
      { key: 'runtimeVersion', label: 'Runtime version', type: 'text', group: 'Runtime', default: '8.0' },
      { key: 'httpsOnly', label: 'HTTPS only', type: 'checkbox', group: 'Network', default: true },
      { key: 'minTlsVersion', label: 'Min TLS version', type: 'select', group: 'Network', default: '1.2',
        options: [{value:'1.0',label:'1.0'},{value:'1.1',label:'1.1'},{value:'1.2',label:'1.2'},{value:'1.3',label:'1.3'}] },
      { key: 'vnetIntegrationSubnetId', label: 'VNet integration subnet', type: 'text', group: 'Network' },
      { key: 'publicNetworkAccess', label: 'Public network access', type: 'select', group: 'Network', default: 'Enabled',
        options: [{value:'Enabled',label:'Enabled'},{value:'Disabled',label:'Disabled (PE only)'}] },
    ],
  },
  'App Service': {
    groups: ['General', 'Plan', 'Network', 'Security'],
    fields: [
      nameField, locationField,
      { key: 'planSku', label: 'Plan SKU', type: 'select', group: 'Plan', default: 'P1v3',
        options: ['F1','B1','S1','P1v2','P2v2','P1v3','P2v3','P3v3','I1v2','I2v2','I3v2'].map(v=>({value:v,label:v})) },
      { key: 'workers', label: 'Worker count', type: 'number', group: 'Plan', default: 2, help: 'WAF: ≥2 for HA.' },
      { key: 'zoneRedundant', label: 'Zone redundant', type: 'checkbox', group: 'Plan', default: true },
      { key: 'httpsOnly', label: 'HTTPS only', type: 'checkbox', group: 'Security', default: true },
      { key: 'minTlsVersion', label: 'Min TLS version', type: 'select', group: 'Security', default: '1.2',
        options: [{value:'1.0',label:'1.0'},{value:'1.1',label:'1.1'},{value:'1.2',label:'1.2'},{value:'1.3',label:'1.3'}] },
      { key: 'ftpsState', label: 'FTPS state', type: 'select', group: 'Security', default: 'Disabled',
        options: [{value:'AllAllowed',label:'All allowed'},{value:'FtpsOnly',label:'FTPS only'},{value:'Disabled',label:'Disabled (recommended)'}] },
      { key: 'vnetIntegrationSubnetId', label: 'VNet integration subnet', type: 'text', group: 'Network' },
      { key: 'publicNetworkAccess', label: 'Public network access', type: 'select', group: 'Network', default: 'Enabled',
        options: [{value:'Enabled',label:'Enabled'},{value:'Disabled',label:'Disabled (PE only)'}] },
    ],
  },

  // ─────────────────────────────────────────── Data ───────────────────────────────────────────
  'Storage Account': {
    groups: ['General', 'Performance', 'Redundancy', 'Security', 'Network'],
    fields: [
      nameField, locationField,
      { key: 'kind', label: 'Account kind', type: 'select', group: 'General', default: 'StorageV2',
        options: [{value:'StorageV2',label:'StorageV2 (general)'},{value:'BlockBlobStorage',label:'BlockBlobStorage'},{value:'FileStorage',label:'FileStorage'}] },
      { key: 'sku', label: 'SKU', type: 'select', group: 'Redundancy', default: 'Standard_ZRS',
        options: [{value:'Standard_LRS',label:'Standard LRS'},{value:'Standard_ZRS',label:'Standard ZRS'},{value:'Standard_GRS',label:'Standard GRS'},{value:'Standard_RAGRS',label:'Standard RA-GRS'},{value:'Standard_GZRS',label:'Standard GZRS'},{value:'Standard_RAGZRS',label:'Standard RA-GZRS'},{value:'Premium_LRS',label:'Premium LRS'},{value:'Premium_ZRS',label:'Premium ZRS'}] },
      { key: 'accessTier', label: 'Access tier', type: 'select', group: 'Performance', default: 'Hot',
        options: [{value:'Hot',label:'Hot'},{value:'Cool',label:'Cool'},{value:'Cold',label:'Cold'}] },
      { key: 'httpsOnly', label: 'HTTPS only', type: 'checkbox', group: 'Security', default: true },
      { key: 'minTlsVersion', label: 'Min TLS version', type: 'select', group: 'Security', default: 'TLS1_2',
        options: [{value:'TLS1_0',label:'1.0'},{value:'TLS1_1',label:'1.1'},{value:'TLS1_2',label:'1.2'},{value:'TLS1_3',label:'1.3'}] },
      { key: 'allowSharedKeyAccess', label: 'Allow shared key access', type: 'checkbox', group: 'Security', default: false,
        help: 'WAF: prefer Entra ID. Disable shared keys to enforce identity-based access.' },
      { key: 'allowBlobPublicAccess', label: 'Allow blob public access', type: 'checkbox', group: 'Security', default: false },
      { key: 'publicNetworkAccess', label: 'Public network access', type: 'select', group: 'Network', default: 'Disabled',
        options: [{value:'Enabled',label:'Enabled'},{value:'Disabled',label:'Disabled (PE only)'}] },
      { key: 'softDeleteBlobDays', label: 'Blob soft delete (days)', type: 'number', group: 'Security', default: 7 },
      { key: 'softDeleteContainerDays', label: 'Container soft delete (days)', type: 'number', group: 'Security', default: 7 },
      { key: 'infrastructureEncryption', label: 'Infrastructure encryption', type: 'checkbox', group: 'Security', default: false },
    ],
  },
  'SQL Database': {
    groups: ['General', 'Compute', 'Backup', 'Security'],
    fields: [
      nameField, locationField,
      { key: 'serverName', label: 'Logical server name', type: 'text', group: 'General', required: true },
      { key: 'sku', label: 'Service objective', type: 'select', group: 'Compute', default: 'GP_Gen5_2',
        options: ['Basic','S0','S1','S2','GP_Gen5_2','GP_Gen5_4','GP_Gen5_8','BC_Gen5_4','BC_Gen5_8','HS_Gen5_4','HS_Gen5_8'].map(v=>({value:v,label:v})) },
      { key: 'maxSizeGB', label: 'Max size (GB)', type: 'number', group: 'Compute', default: 100 },
      { key: 'zoneRedundant', label: 'Zone redundant', type: 'checkbox', group: 'Compute', default: true },
      { key: 'backupRedundancy', label: 'Backup redundancy', type: 'select', group: 'Backup', default: 'Geo',
        options: [{value:'Local',label:'Local (LRS)'},{value:'Zone',label:'Zone (ZRS)'},{value:'Geo',label:'Geo (recommended)'},{value:'GeoZone',label:'Geo-Zone'}] },
      { key: 'pitrRetentionDays', label: 'PITR retention (days)', type: 'number', group: 'Backup', default: 7 },
      { key: 'ltrRetentionWeeks', label: 'LTR weekly retention (weeks)', type: 'number', group: 'Backup', default: 0 },
      { key: 'tdeEnabled', label: 'Transparent Data Encryption', type: 'checkbox', group: 'Security', default: true },
      { key: 'auditEnabled', label: 'Auditing enabled', type: 'checkbox', group: 'Security', default: true },
      { key: 'publicNetworkAccess', label: 'Public network access', type: 'select', group: 'Security', default: 'Disabled',
        options: [{value:'Enabled',label:'Enabled'},{value:'Disabled',label:'Disabled (PE only)'}] },
    ],
  },
  PostgreSQL: {
    groups: ['General', 'Compute', 'HA', 'Backup', 'Security'],
    fields: [
      nameField, locationField,
      { key: 'version', label: 'PostgreSQL version', type: 'select', group: 'General', default: '16',
        options: ['11','12','13','14','15','16'].map(v=>({value:v,label:v})) },
      { key: 'sku', label: 'Compute SKU', type: 'select', group: 'Compute', default: 'Standard_D2ds_v5',
        options: ['Standard_B1ms','Standard_B2s','Standard_D2ds_v5','Standard_D4ds_v5','Standard_D8ds_v5','Standard_E2ds_v5','Standard_E4ds_v5'].map(v=>({value:v,label:v})) },
      { key: 'storageGB', label: 'Storage (GB)', type: 'number', group: 'Compute', default: 128 },
      { key: 'storageTier', label: 'Storage tier', type: 'select', group: 'Compute', default: 'P10',
        options: ['P4','P6','P10','P15','P20','P30','P40','P50','P60','P70','P80'].map(v=>({value:v,label:v})) },
      { key: 'haMode', label: 'High availability', type: 'select', group: 'HA', default: 'ZoneRedundant',
        options: [{value:'Disabled',label:'Disabled'},{value:'SameZone',label:'Same zone'},{value:'ZoneRedundant',label:'Zone redundant (recommended)'}] },
      { key: 'backupRetentionDays', label: 'Backup retention (days)', type: 'number', group: 'Backup', default: 14 },
      { key: 'geoRedundantBackup', label: 'Geo-redundant backup', type: 'checkbox', group: 'Backup', default: true },
      { key: 'subnetId', label: 'Delegated subnet ID', type: 'text', group: 'Security', help: 'For VNet-integrated mode.' },
      { key: 'publicNetworkAccess', label: 'Public network access', type: 'select', group: 'Security', default: 'Disabled',
        options: [{value:'Enabled',label:'Enabled'},{value:'Disabled',label:'Disabled'}] },
      { key: 'aadOnly', label: 'Entra ID auth only', type: 'checkbox', group: 'Security', default: false },
    ],
  },
  'Cosmos DB': {
    groups: ['General', 'API', 'Replication', 'Consistency', 'Backup'],
    fields: [
      nameField, locationField,
      { key: 'apiKind', label: 'API', type: 'select', group: 'API', default: 'Sql',
        options: [{value:'Sql',label:'NoSQL (SQL)'},{value:'MongoDB',label:'MongoDB'},{value:'Cassandra',label:'Cassandra'},{value:'Gremlin',label:'Gremlin'},{value:'Table',label:'Table'}] },
      { key: 'capacityMode', label: 'Capacity mode', type: 'select', group: 'API', default: 'Provisioned',
        options: [{value:'Provisioned',label:'Provisioned throughput'},{value:'Serverless',label:'Serverless'}] },
      { key: 'consistencyLevel', label: 'Consistency level', type: 'select', group: 'Consistency', default: 'Session',
        options: [{value:'Strong',label:'Strong'},{value:'BoundedStaleness',label:'Bounded staleness'},{value:'Session',label:'Session (default)'},{value:'ConsistentPrefix',label:'Consistent prefix'},{value:'Eventual',label:'Eventual'}] },
      { key: 'multiRegionWrites', label: 'Multi-region writes', type: 'checkbox', group: 'Replication', default: false },
      { key: 'zoneRedundant', label: 'Zone redundant', type: 'checkbox', group: 'Replication', default: true },
      { key: 'additionalRegions', label: 'Additional regions', type: 'tags', group: 'Replication',
        placeholder: 'westus2, westeurope' },
      { key: 'backupPolicy', label: 'Backup policy', type: 'select', group: 'Backup', default: 'Continuous',
        options: [{value:'Periodic',label:'Periodic'},{value:'Continuous',label:'Continuous (PITR)'}] },
      { key: 'publicNetworkAccess', label: 'Public network access', type: 'select', group: 'API', default: 'Disabled',
        options: [{value:'Enabled',label:'Enabled'},{value:'Disabled',label:'Disabled'}] },
    ],
  },
  'Key Vault': {
    groups: ['General', 'SKU', 'Access', 'Security'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'SKU', type: 'select', group: 'SKU', default: 'Standard',
        options: [{value:'Standard',label:'Standard'},{value:'Premium',label:'Premium (HSM)'}] },
      { key: 'accessModel', label: 'Permission model', type: 'select', group: 'Access', default: 'RBAC',
        options: [{value:'RBAC',label:'Azure RBAC (recommended)'},{value:'AccessPolicy',label:'Vault access policy (legacy)'}] },
      { key: 'softDeleteRetentionDays', label: 'Soft delete retention (days)', type: 'number', group: 'Security', default: 90,
        help: 'Mandatory. Min 7, max 90. Cannot be disabled.' },
      { key: 'purgeProtection', label: 'Purge protection', type: 'checkbox', group: 'Security', default: true,
        help: 'WAF: enable for production. Cannot be disabled once on.' },
      { key: 'publicNetworkAccess', label: 'Public network access', type: 'select', group: 'Security', default: 'Disabled',
        options: [{value:'Enabled',label:'Enabled'},{value:'Disabled',label:'Disabled (PE only)'}] },
      { key: 'enabledForDeployment', label: 'Enabled for VM deployment', type: 'checkbox', group: 'Access', default: false },
      { key: 'enabledForTemplateDeployment', label: 'Enabled for ARM template', type: 'checkbox', group: 'Access', default: false },
      { key: 'enabledForDiskEncryption', label: 'Enabled for disk encryption', type: 'checkbox', group: 'Access', default: false },
    ],
  },

  // ─────────────────────────────────────────── Security ───────────────────────────────────────────
  'Managed Identity': {
    groups: ['General'],
    fields: [
      nameField, locationField,
      { key: 'identityType', label: 'Type', type: 'select', group: 'General', default: 'UserAssigned',
        options: [{value:'SystemAssigned',label:'System-assigned'},{value:'UserAssigned',label:'User-assigned'}] },
    ],
  },
  'RBAC Assignment': {
    groups: ['General'],
    fields: [
      { key: 'principalId', label: 'Principal ID', type: 'text', required: true },
      { key: 'principalType', label: 'Principal type', type: 'select',
        options: ['User','Group','ServicePrincipal','ManagedIdentity'].map(v=>({value:v,label:v})), default: 'ManagedIdentity' },
      { key: 'roleDefinitionId', label: 'Role definition ID', type: 'text', required: true,
        help: 'e.g. /providers/Microsoft.Authorization/roleDefinitions/<guid>' },
      { key: 'scope', label: 'Scope', type: 'text', required: true },
      { key: 'condition', label: 'Condition (ABAC)', type: 'textarea',
        help: 'Optional ABAC condition expression.' },
    ],
  },
  'Defender for Cloud': {
    groups: ['Plans'],
    fields: [
      { key: 'serversPlan', label: 'Servers plan', type: 'select',
        options: [{value:'Off',label:'Off'},{value:'P1',label:'Plan 1'},{value:'P2',label:'Plan 2 (recommended)'}], default: 'P2' },
      { key: 'storagePlan', label: 'Storage', type: 'checkbox', default: true },
      { key: 'sqlPlan', label: 'SQL', type: 'checkbox', default: true },
      { key: 'containersPlan', label: 'Containers', type: 'checkbox', default: true },
      { key: 'keyVaultPlan', label: 'Key Vault', type: 'checkbox', default: true },
      { key: 'appServicePlan', label: 'App Service', type: 'checkbox', default: true },
      { key: 'arms', label: 'ARM', type: 'checkbox', default: true },
      { key: 'dnsPlan', label: 'DNS', type: 'checkbox', default: true },
    ],
  },
  Bastion: {
    groups: ['General', 'SKU'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'SKU', type: 'select', group: 'SKU', default: 'Standard',
        options: [{value:'Basic',label:'Basic'},{value:'Standard',label:'Standard'},{value:'Premium',label:'Premium'}] },
      { key: 'scaleUnits', label: 'Scale units', type: 'number', group: 'SKU', default: 2 },
      { key: 'subnetCidr', label: 'AzureBastionSubnet CIDR', type: 'text', group: 'General',
        placeholder: '10.0.255.0/26', help: 'Subnet must be named "AzureBastionSubnet" with min /26.' },
      { key: 'enableTunneling', label: 'Enable native client tunneling', type: 'checkbox', group: 'SKU', default: false },
      { key: 'enableShareableLink', label: 'Shareable link', type: 'checkbox', group: 'SKU', default: false },
    ],
  },
  'Log Analytics': {
    groups: ['General', 'Retention'],
    fields: [
      nameField, locationField,
      { key: 'sku', label: 'Pricing tier', type: 'select', group: 'General', default: 'PerGB2018',
        options: [{value:'PerGB2018',label:'Pay-as-you-go'},{value:'CapacityReservation',label:'Commitment tier'}] },
      { key: 'retentionDays', label: 'Retention (days)', type: 'number', group: 'Retention', default: 90,
        help: 'WAF: ≥30 for security investigation. Up to 730 (interactive) + archive up to 12y.' },
      { key: 'dailyCapGB', label: 'Daily cap (GB, 0 = none)', type: 'number', group: 'Retention', default: 0 },
    ],
  },
}

export function getBlockSchema(blockType: string): BlockSchema | undefined {
  return blockSchemas[blockType]
}
