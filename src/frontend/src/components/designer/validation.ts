// Validation engine — runs Microsoft best-practice rules against the design.
// Sources:
//   - https://learn.microsoft.com/azure/well-architected/
//   - https://learn.microsoft.com/azure/cloud-adoption-framework/
//   - https://learn.microsoft.com/azure/architecture/framework/
//   - Microsoft AKS / Hub-spoke / VWAN baseline architectures

import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'

export type Severity = 'error' | 'warning' | 'info'

export interface ValidationFinding {
  severity: Severity
  ruleId: string
  message: string
  nodeId?: string
  reference?: string
}

type DesignNode = Node<DesignBlock>

// Helpers
const prop = (n: DesignNode, k: string) => n.data?.properties?.[k]
const has = (n: DesignNode, k: string) => prop(n, k) !== undefined && prop(n, k) !== '' && prop(n, k) !== null

function parseCidr(cidr: string): { network: number; prefix: number } | null {
  const m = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  if (!m) return null
  const [, a, b, c, d, p] = m
  const oct = [+a, +b, +c, +d]
  if (oct.some((o) => o < 0 || o > 255)) return null
  const prefix = +p
  if (prefix < 0 || prefix > 32) return null
  const network = (oct[0] << 24) | (oct[1] << 16) | (oct[2] << 8) | oct[3]
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0
  return { network: network & mask, prefix }
}
function cidrsOverlap(a: string, b: string): boolean {
  const A = parseCidr(a), B = parseCidr(b)
  if (!A || !B) return false
  const minPrefix = Math.min(A.prefix, B.prefix)
  const mask = minPrefix === 0 ? 0 : (~0 << (32 - minPrefix)) >>> 0
  return (A.network & mask) === (B.network & mask)
}
function isRfc1918(cidr: string): boolean {
  const c = parseCidr(cidr)
  if (!c) return false
  const a = c.network >>> 24
  const b = (c.network >>> 16) & 0xff
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  return false
}

export function validateDesign(nodes: DesignNode[], _edges: Edge[]): ValidationFinding[] {
  const findings: ValidationFinding[] = []
  const byType = (t: string) => nodes.filter((n) => n.data?.blockType === t)
  const add = (
    severity: Severity, ruleId: string, message: string,
    nodeId?: string, reference?: string,
  ) => findings.push({ severity, ruleId, message, nodeId, reference })

  // ───────── Structural / containment rules ─────────
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const parentOf = (n: DesignNode) => (n.parentId ? nodeById.get(n.parentId) : undefined)
  const parentTypeOf = (n: DesignNode) => (parentOf(n)?.data as { blockType?: string } | undefined)?.blockType
  for (const n of nodes) {
    const t = n.data.blockType
    if (t === 'Subnet' && parentTypeOf(n) !== 'VNet') {
      add('error', 'Subnet.Parent', `Subnet "${n.data.label}" must be placed inside a VNet.`, n.id,
        'https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-subnet')
    }
    if (t === 'Virtual Hub' && parentTypeOf(n) !== 'Virtual WAN') {
      add('error', 'VHub.Parent', `Virtual Hub "${n.data.label}" must be placed inside a Virtual WAN.`, n.id)
    }
    if (t === 'Route Intent' && parentTypeOf(n) !== 'Virtual Hub') {
      add('error', 'RouteIntent.Parent', `Route Intent "${n.data.label}" must be placed inside a Virtual Hub.`, n.id)
    }
    if (t === 'Private Endpoint' && parentTypeOf(n) !== 'Subnet') {
      add('error', 'PE.Parent', `Private Endpoint "${n.data.label}" must be placed inside a Subnet.`, n.id)
    }
  }

  // ───────── VNet rules ─────────
  const vnets = byType('VNet')
  const vnetCidrs: { node: DesignNode; cidr: string }[] = []
  for (const v of vnets) {
    const space = (prop(v, 'addressSpace') as string[] | undefined) ?? []
    if (!space.length) {
      add('error', 'VNet.AddressSpace.Required',
        `VNet "${v.data.label}" has no address space.`, v.id,
        'https://learn.microsoft.com/azure/virtual-network/concepts-and-best-practices')
    }
    for (const cidr of space) {
      if (!parseCidr(cidr)) {
        add('error', 'VNet.AddressSpace.Invalid',
          `VNet "${v.data.label}" has invalid CIDR "${cidr}".`, v.id)
      } else if (!isRfc1918(cidr)) {
        add('warning', 'VNet.AddressSpace.NonRFC1918',
          `VNet "${v.data.label}" uses non-RFC1918 range "${cidr}". Use 10.x / 172.16-31.x / 192.168.x.`,
          v.id, 'https://datatracker.ietf.org/doc/html/rfc1918')
      } else {
        vnetCidrs.push({ node: v, cidr })
      }
    }
  }
  // Cross-VNet overlap detection
  for (let i = 0; i < vnetCidrs.length; i++) {
    for (let j = i + 1; j < vnetCidrs.length; j++) {
      if (vnetCidrs[i].node.id === vnetCidrs[j].node.id) continue
      if (cidrsOverlap(vnetCidrs[i].cidr, vnetCidrs[j].cidr)) {
        add('error', 'VNet.AddressSpace.Overlap',
          `Address space "${vnetCidrs[i].cidr}" of "${vnetCidrs[i].node.data.label}" overlaps "${vnetCidrs[j].cidr}" of "${vnetCidrs[j].node.data.label}". Peering will fail.`,
          vnetCidrs[i].node.id,
          'https://learn.microsoft.com/azure/virtual-network/virtual-network-peering-overview')
      }
    }
  }
  // DDoS for hub
  for (const v of vnets) {
    if (!prop(v, 'ddosProtection')) {
      add('info', 'VNet.DDoS.Recommended',
        `VNet "${v.data.label}": enable DDoS Network Protection for production-facing VNets.`,
        v.id, 'https://learn.microsoft.com/azure/ddos-protection/ddos-protection-overview')
    }
  }

  // ───────── Subnet rules ─────────
  const subnets = byType('Subnet')
  for (const s of subnets) {
    const cidr = prop(s, 'addressPrefix') as string | undefined
    if (!cidr) {
      add('error', 'Subnet.Prefix.Required', `Subnet "${s.data.label}" has no address prefix.`, s.id)
    } else if (!parseCidr(cidr)) {
      add('error', 'Subnet.Prefix.Invalid', `Subnet "${s.data.label}" has invalid CIDR.`, s.id)
    } else {
      const p = parseCidr(cidr)!.prefix
      if (p > 29) add('error', 'Subnet.Prefix.TooSmall',
        `Subnet "${s.data.label}" prefix /${p} is smaller than /29 minimum (Azure reserves 5 IPs).`, s.id)
    }
    // Bastion subnet rule
    if (s.data.label.toLowerCase().includes('bastion')) {
      if (cidr) {
        const p = parseCidr(cidr)?.prefix ?? 32
        if (p > 26) add('error', 'Bastion.Subnet.Size',
          `AzureBastionSubnet must be /26 or larger (found /${p}).`, s.id,
          'https://learn.microsoft.com/azure/bastion/configuration-settings#subnet')
      }
    }
  }

  // ───────── NSG / subnet pairing ─────────
  // (heuristic: warn if subnets exist with no NSG anywhere)
  if (subnets.length > 0 && byType('NSG').length === 0) {
    add('warning', 'NSG.Missing',
      'No Network Security Groups in the design. WAF requires NSGs on every subnet (except gateway / Bastion / firewall).',
      undefined, 'https://learn.microsoft.com/azure/well-architected/security/networking')
  }

  // ───────── Azure Firewall ─────────
  const firewalls = byType('Azure Firewall')
  for (const f of firewalls) {
    if (prop(f, 'sku') === 'Basic') {
      add('warning', 'Firewall.SKU.Basic',
        `Azure Firewall "${f.data.label}" uses Basic SKU — no IDPS, no TLS inspection. Standard or Premium recommended for production.`,
        f.id, 'https://learn.microsoft.com/azure/firewall/choose-firewall-sku')
    }
    if (prop(f, 'threatIntelMode') !== 'Deny') {
      add('info', 'Firewall.ThreatIntel.Mode',
        `Azure Firewall "${f.data.label}": set threat intel mode to Deny for production.`,
        f.id, 'https://learn.microsoft.com/azure/firewall/threat-intel')
    }
    const zones = (prop(f, 'zones') as string[] | undefined) ?? []
    if (zones.length < 3) {
      add('warning', 'Firewall.Zones',
        `Azure Firewall "${f.data.label}" deployed across <3 zones — 99.99% SLA requires zones 1, 2 and 3.`,
        f.id, 'https://learn.microsoft.com/azure/firewall/features#availability-zones')
    }
  }

  // ───────── VPN Gateway ─────────
  for (const g of byType('VPN Gateway')) {
    if (prop(g, 'sku') === 'Basic') {
      add('error', 'VpnGw.SKU.Basic',
        `VPN Gateway "${g.data.label}" uses Basic SKU — no SLA, no BGP, no AZ. Use VpnGw1AZ+ for production.`,
        g.id, 'https://learn.microsoft.com/azure/vpn-gateway/vpn-gateway-about-vpngateways')
    }
  }

  // ───────── Virtual WAN topology ─────────
  const vwans = byType('Virtual WAN')
  const hubs = byType('Virtual Hub')
  const intents = byType('Route Intent')
  if (hubs.length > 0 && vwans.length === 0) {
    add('error', 'VWAN.Hub.NoParent',
      'Virtual Hubs exist without a parent Virtual WAN.',
      undefined, 'https://learn.microsoft.com/azure/virtual-wan/virtual-wan-about')
  }
  for (const h of hubs) {
    const cidr = prop(h, 'addressPrefix') as string | undefined
    if (cidr) {
      const p = parseCidr(cidr)?.prefix ?? 32
      if (p > 24) add('warning', 'VHub.Prefix.Size',
        `Virtual Hub "${h.data.label}" prefix /${p} is smaller than recommended /24 (use /23 if deploying gateways + Firewall).`,
        h.id, 'https://learn.microsoft.com/azure/virtual-wan/hub-settings')
    }
  }
  for (const ri of intents) {
    const internet = prop(ri, 'internetTraffic') as string
    const priv = prop(ri, 'privateTraffic') as string
    if ((internet === 'NVA' || priv === 'NVA') && !has(ri, 'nextHopResourceId')) {
      add('error', 'RouteIntent.NVA.NextHopMissing',
        `Route Intent "${ri.data.label}": NVA next-hop selected but no NVA resource ID provided.`,
        ri.id, 'https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies')
    }
    if (internet === 'None' && priv === 'None') {
      add('warning', 'RouteIntent.NoOp',
        `Route Intent "${ri.data.label}" has no traffic types selected — it will not be applied.`, ri.id)
    }
  }

  // ───────── NVA ─────────
  for (const nva of byType('NVA')) {
    if (!prop(nva, 'haPair')) {
      add('error', 'NVA.HA.Required',
        `NVA "${nva.data.label}" is single-instance — WAF requires an HA pair (≥2 instances behind Standard LB).`,
        nva.id, 'https://learn.microsoft.com/azure/architecture/networking/guide/network-virtual-appliances/nva-ha')
    }
    if (!prop(nva, 'enableIpForwarding')) {
      add('error', 'NVA.IpForwarding.Required',
        `NVA "${nva.data.label}" must have IP forwarding enabled on its NICs to route traffic.`, nva.id)
    }
    const zones = (prop(nva, 'zones') as string[] | undefined) ?? []
    if (zones.length < 2) {
      add('warning', 'NVA.Zones',
        `NVA "${nva.data.label}" should span ≥2 availability zones for zonal redundancy.`, nva.id)
    }
  }

  // ───────── AKS baseline ─────────
  for (const a of byType('AKS')) {
    if (!prop(a, 'privateCluster')) {
      add('warning', 'AKS.PrivateCluster',
        `AKS "${a.data.label}": enable private cluster (API server private endpoint) per AKS baseline.`,
        a.id, 'https://learn.microsoft.com/azure/architecture/reference-architectures/containers/aks/baseline-aks')
    }
    if (!prop(a, 'rbacEnabled')) add('error', 'AKS.RBAC',
      `AKS "${a.data.label}": Kubernetes RBAC must be enabled.`, a.id)
    if (!prop(a, 'aadIntegration')) add('warning', 'AKS.AAD',
      `AKS "${a.data.label}": enable Entra ID integration for cluster auth.`, a.id)
    if (!prop(a, 'workloadIdentity')) add('warning', 'AKS.WorkloadIdentity',
      `AKS "${a.data.label}": enable Workload Identity (replaces pod-managed identity).`, a.id)
    if (prop(a, 'tier') === 'Free') add('warning', 'AKS.Tier.Free',
      `AKS "${a.data.label}" uses Free tier — no SLA. Use Standard for production.`, a.id)
    if (!prop(a, 'azureMonitorEnabled')) add('info', 'AKS.Monitor',
      `AKS "${a.data.label}": enable Container Insights for observability.`, a.id)
    if (prop(a, 'networkPlugin') === 'kubenet') add('warning', 'AKS.NetworkPlugin.Kubenet',
      `AKS "${a.data.label}": kubenet is legacy; use Azure CNI Overlay or Cilium.`, a.id)
  }

  // ───────── Storage Account ─────────
  for (const sa of byType('Storage Account')) {
    if (prop(sa, 'allowSharedKeyAccess')) add('warning', 'Storage.SharedKey',
      `Storage "${sa.data.label}": disable shared key access; use Entra ID identity-based access.`,
      sa.id, 'https://learn.microsoft.com/azure/storage/common/shared-key-authorization-prevent')
    if (prop(sa, 'allowBlobPublicAccess')) add('warning', 'Storage.BlobPublic',
      `Storage "${sa.data.label}": disable public blob access.`, sa.id)
    if (prop(sa, 'minTlsVersion') !== 'TLS1_2' && prop(sa, 'minTlsVersion') !== 'TLS1_3')
      add('warning', 'Storage.TLS', `Storage "${sa.data.label}": min TLS should be 1.2+.`, sa.id)
    if (prop(sa, 'sku') === 'Standard_LRS')
      add('info', 'Storage.SKU.LRS',
        `Storage "${sa.data.label}" uses LRS — single-DC. Use ZRS / GZRS for production.`, sa.id)
  }

  // ───────── SQL DB ─────────
  for (const s of byType('SQL Database')) {
    if (prop(s, 'publicNetworkAccess') === 'Enabled')
      add('warning', 'Sql.PublicAccess', `SQL DB "${s.data.label}": disable public access; use Private Endpoint.`, s.id)
    if (!prop(s, 'tdeEnabled'))
      add('error', 'Sql.TDE', `SQL DB "${s.data.label}": Transparent Data Encryption must be enabled.`, s.id)
    if (!prop(s, 'auditEnabled'))
      add('warning', 'Sql.Audit', `SQL DB "${s.data.label}": enable auditing to a Log Analytics workspace.`, s.id)
    if (!prop(s, 'zoneRedundant'))
      add('info', 'Sql.ZoneRedundant', `SQL DB "${s.data.label}": enable zone-redundancy for production.`, s.id)
  }

  // ───────── Key Vault ─────────
  for (const k of byType('Key Vault')) {
    if (!prop(k, 'purgeProtection'))
      add('warning', 'KV.PurgeProtection', `Key Vault "${k.data.label}": enable purge protection for production.`, k.id,
        'https://learn.microsoft.com/azure/key-vault/general/soft-delete-overview')
    if (prop(k, 'accessModel') === 'AccessPolicy')
      add('info', 'KV.RBAC', `Key Vault "${k.data.label}": migrate from access policies to Azure RBAC.`, k.id)
    if (prop(k, 'publicNetworkAccess') === 'Enabled')
      add('warning', 'KV.PublicAccess', `Key Vault "${k.data.label}": disable public access; use Private Endpoint.`, k.id)
  }

  // ───────── App Service ─────────
  for (const app of byType('App Service')) {
    if (!prop(app, 'httpsOnly')) add('error', 'AppService.HttpsOnly',
      `App Service "${app.data.label}": HTTPS only must be on.`, app.id)
    if (prop(app, 'minTlsVersion') !== '1.2' && prop(app, 'minTlsVersion') !== '1.3')
      add('warning', 'AppService.TLS', `App Service "${app.data.label}": min TLS should be 1.2+.`, app.id)
    if (prop(app, 'ftpsState') === 'AllAllowed')
      add('warning', 'AppService.FTPS', `App Service "${app.data.label}": disable plain FTP.`, app.id)
    if (!prop(app, 'zoneRedundant'))
      add('info', 'AppService.Zones', `App Service "${app.data.label}": enable zone-redundancy for production.`, app.id)
  }

  // ───────── Connectivity heuristics ─────────
  if (firewalls.length === 0 && (vnets.length > 0 || hubs.length > 0)) {
    add('info', 'Topology.Firewall.Missing',
      'No Azure Firewall (or NVA) detected. WAF Hub-spoke baseline routes egress through a hub firewall.',
      undefined, 'https://learn.microsoft.com/azure/architecture/reference-architectures/hybrid-networking/hub-spoke')
  }
  if (byType('Log Analytics').length === 0 && nodes.length > 0) {
    add('warning', 'Observability.Missing',
      'No Log Analytics workspace in design — required for diagnostic settings, NSG flow logs, AKS Container Insights.',
      undefined, 'https://learn.microsoft.com/azure/well-architected/operational-excellence/observability')
  }

  return findings
}
