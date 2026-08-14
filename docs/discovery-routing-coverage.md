# Discovery and routing coverage

EasyAzure treats inventory coverage and routing verification as separate concerns. Seeing a resource does not prove that every data-plane route to or from that resource is symmetric.

## Coverage contract

### Inventory

- Query the Azure Resource Graph `Resources` table for every selected subscription.
- Follow the Resource Graph skip token until all pages are read. Azure Resource Graph returns at most 1,000 rows per page.
- Keep every returned resource type. Service-specific code must enrich the generic inventory, not decide whether a resource is visible.
- Preserve the ARM resource ID, type, location, resource group, subscription, tags, and property bag.
- Report authorization, throttling, and partial-query failures. A partial result must not be presented as complete discovery.

### Relationships

- Create a generic `connectedTo` edge when one discovered resource property contains the ARM ID of another discovered resource.
- Add typed edges where Azure documents traffic semantics. Typed edges take precedence over generic references.
- Never create an edge to a resource outside the selected/discovered scope unless a placeholder node explicitly identifies it as unresolved.

Private endpoints require typed edges for:

- Private endpoint to subnet.
- Private endpoint to `privateLinkServiceId`.
- The selected `groupIds` and connection approval state.
- Private DNS zone groups and virtual-network links.
- The private endpoint network interface and IP configuration.

Azure VMware Solution requires typed relationships for:

- Private cloud to its managed ExpressRoute circuit.
- ExpressRoute authorization and connection resources.
- ExpressRoute gateway or Virtual WAN hub connectivity.
- Global Reach connections where visible to the selected identity.
- AVS management and workload prefixes learned through BGP.

### Routing findings

Every finding has a confidence value and evidence:

- `confirmed`: authoritative configuration or effective-route evidence proves the condition.
- `potential`: ARM configuration contains a pattern that can cause asymmetry, but effective routes have not proved both directions.
- `unknown`: required ownership, BGP, appliance, or effective-route evidence is unavailable.

A clean configuration scan does not prove symmetry. Confirmation requires the selected route in both directions, including applicable system routes, UDRs, BGP routes, peering settings, Virtual WAN route tables and routing intent, ExpressRoute propagation, and stateful appliance hops.

## Current implementation

- All Resource Graph pages and all resource types are collected.
- Generic ARM-ID relationships are emitted for discovered targets.
- VNets, subnets, peerings, NSGs, route tables, VMs, NICs, Azure Firewall, and default routes have specialized topology handling.
- Private endpoint subnet and target-service edges include group IDs and connection status.
- AVS managed-circuit references are visible through generic relationship extraction.
- Static UDR and peering analysis reports `confirmed`, `potential`, or `unknown` instead of presenting every risk as a proven outage.

## Required verification adapters

The following evidence providers are still required before route analysis can claim end-to-end verification:

1. NIC effective route tables and effective NSG rules.
2. Network Watcher next hop and connection troubleshoot for testable VM endpoints.
3. Virtual WAN hub effective routes, route tables, route maps, routing intent, and connection propagation.
4. ExpressRoute circuit, gateway, peering, route, and Global Reach state.
5. Azure VMware Solution managed-circuit and BGP prefix correlation.
6. Third-party NVA ownership, interfaces, health, and return-route evidence.
7. Private DNS zone groups, records, and resolver/link topology for private endpoints.
8. Load Balancer, Application Gateway, NAT Gateway, VPN Gateway, Route Server, Bastion, API Management, App Service VNet integration, AKS, and other service-specific traffic semantics.
9. IPv6 prefix and route matching. Current asymmetric-route CIDR comparison is IPv4-only.

Each adapter must fail closed to `unknown`; it must not assume a route is direct, allowed, or symmetric when Azure does not return evidence.

## Platform limits

An absolute 100 percent guarantee is not possible from inventory APIs alone:

- Azure Resource Graph is eventually consistent and has pagination and throttling limits.
- Results depend on the managed identity's RBAC scope and provider permissions.
- Some service-managed routes and internals are exposed only through service-specific effective-route or diagnostic APIs.
- Network Watcher next hop requires a VM/NIC source and does not confirm data paths through every Virtual WAN component.
- On-premises and third-party appliance routing state is outside ARM unless separately integrated.

EasyAzure's completeness claim must therefore state the selected subscriptions, successful evidence providers, failed/skipped providers, and timestamp.

## Microsoft references

- [Azure Resource Graph pagination](https://learn.microsoft.com/azure/governance/resource-graph/concepts/paging-results)
- [Working with large Resource Graph data sets](https://learn.microsoft.com/azure/governance/resource-graph/concepts/work-with-data)
- [Network Watcher next hop](https://learn.microsoft.com/azure/network-watcher/next-hop-overview)
- [Diagnose VM routing with effective routes](https://learn.microsoft.com/azure/network-watcher/diagnose-vm-network-routing-problem-cli)
- [Private endpoint resource properties](https://learn.microsoft.com/azure/templates/microsoft.network/2025-07-01/privateendpoints#property-values)
- [Private Link routing in Virtual WAN](https://learn.microsoft.com/azure/virtual-wan/howto-private-link#routing-considerations-with-private-link-in-virtual-wan)
- [Virtual WAN effective routes](https://learn.microsoft.com/azure/virtual-wan/effective-routes-virtual-hub)
- [Azure VMware Solution networking](https://learn.microsoft.com/azure/azure-vmware/architecture-networking)
- [Azure VMware Solution network design considerations](https://learn.microsoft.com/azure/azure-vmware/architecture-network-design-considerations)
- [Azure VMware Solution dynamic routing](https://learn.microsoft.com/azure/cloud-adoption-framework/scenarios/azure-vmware/azure-vmware-solution-network-basics#dynamic-routing-in-azure-vmware-solution)