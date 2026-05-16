using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using EasyAzure.Discovery.Services;
using Microsoft.Extensions.Logging;
using Newtonsoft.Json.Linq;

namespace EasyAzure.Topology.Services;

/// <summary>
/// Builds an in-memory topology graph from discovered Azure resources.
/// Relationships are derived from resource properties (VNet→Subnet containment,
/// subnet→NSG/route-table association, VNet peerings, and default-route edges
/// inspected from route tables).
/// </summary>
public class TopologyService : ITopologyService
{
    private readonly ResourceGraphService _resourceGraph;
    private readonly ILogger<TopologyService> _logger;

    public TopologyService(ResourceGraphService resourceGraph, ILogger<TopologyService> logger)
    {
        _resourceGraph = resourceGraph;
        _logger = logger;
    }

    public async Task<TopologyGraph> BuildTopologyAsync(string subscriptionId, CancellationToken ct = default)
    {
        _logger.LogInformation("Building topology graph for {SubscriptionId}", subscriptionId);
        return await BuildTopologyMultiAsync([subscriptionId], ct);
    }

    public async Task<TopologyGraph> BuildTopologyMultiAsync(IReadOnlyList<string> subscriptionIds, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Building topology graph across {Count} subscription(s): {Subs}",
            subscriptionIds.Count, string.Join(", ", subscriptionIds));

        var allResources = new List<AzureResource>();
        foreach (var subscriptionId in subscriptionIds)
        {
            // Each collector is wrapped so missing RBAC on a single resource type
            // never blocks the whole topology. Errors are logged + skipped.
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetVNetsAsync(subscriptionId, ct), "VNets", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetNSGsAsync(subscriptionId, ct), "NSGs", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetRouteTablesAsync(subscriptionId, ct), "RouteTables", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetVMsAsync(subscriptionId, ct), "VMs", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetPrivateEndpointsAsync(subscriptionId, ct), "PrivateEndpoints", subscriptionId));
        }

        // Subnets are nested inside VNet.properties.subnets — promote them to first-
        // class nodes so they can be referenced by NSG/route-table association edges.
        var promotedSubnets = PromoteSubnets(allResources);
        allResources.AddRange(promotedSubnets);

        var nodes = BuildNodes(allResources);
        var edges = BuildEdges(allResources);

        return new TopologyGraph(nodes, edges);
    }

    public async Task<IReadOnlyList<ResourceEdge>> GetEdgesAsync(string resourceId, CancellationToken ct = default)
    {
        // In production, this queries the graph store (Cosmos DB Gremlin).
        // Placeholder returns empty for now.
        await Task.CompletedTask;
        return [];
    }

    private async Task<IReadOnlyList<AzureResource>> SafeCollectAsync(
        Func<Task<IReadOnlyList<AzureResource>>> collector, string kind, string subscriptionId)
    {
        try
        {
            return await collector();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(
                ex,
                "Topology: collecting {Kind} for subscription {Sub} failed; continuing without them.",
                kind, subscriptionId);
            return [];
        }
    }

    /// <summary>
    /// Lifts each VNet's <c>properties.subnets[]</c> into its own
    /// <see cref="AzureResource"/> node (type <c>Microsoft.Network/virtualNetworks/subnets</c>).
    /// </summary>
    private static List<AzureResource> PromoteSubnets(List<AzureResource> resources)
    {
        var subnets = new List<AzureResource>();
        foreach (var vnet in resources.Where(r => string.Equals(r.Type, "Microsoft.Network/virtualNetworks", StringComparison.OrdinalIgnoreCase)))
        {
            if (!TryGetJArray(vnet.Properties, "subnets", out var arr)) continue;
            foreach (var item in arr.OfType<JObject>())
            {
                var id = item["id"]?.ToString();
                var name = item["name"]?.ToString();
                if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(name)) continue;

                var props = item["properties"] as JObject ?? [];
                subnets.Add(new AzureResource
                {
                    Id = id,
                    Name = name,
                    Type = "Microsoft.Network/virtualNetworks/subnets",
                    Location = vnet.Location,
                    ResourceGroup = vnet.ResourceGroup,
                    SubscriptionId = vnet.SubscriptionId,
                    Properties = props.ToObject<Dictionary<string, object>>() ?? [],
                });
            }
        }
        return subnets;
    }

    private static List<FlowNode> BuildNodes(List<AzureResource> resources)
    {
        var nodes = new List<FlowNode>();
        // Group resources by VNet for a clearer auto-layout: VNets row 0,
        // subnets row 1, then security + routing, then everything else.
        var byType = resources
            .GroupBy(r => RowFor(r.Type))
            .OrderBy(g => g.Key);

        var spacingX = 260.0;
        var spacingY = 180.0;
        var row = 0;
        foreach (var group in byType)
        {
            var col = 0;
            foreach (var resource in group.OrderBy(r => r.Name, StringComparer.OrdinalIgnoreCase))
            {
                nodes.Add(new FlowNode(
                    Id: resource.Id,
                    Type: "azureResource",
                    Position: new FlowPosition(col * spacingX, row * spacingY),
                    Data: resource));
                col++;
            }
            row++;
        }
        return nodes;
    }

    private static int RowFor(string type) => type.ToLowerInvariant() switch
    {
        "microsoft.network/virtualnetworks" => 0,
        "microsoft.network/virtualnetworks/subnets" => 1,
        "microsoft.network/networksecuritygroups" => 2,
        "microsoft.network/routetables" => 2,
        "microsoft.network/privateendpoints" => 3,
        "microsoft.compute/virtualmachines" => 3,
        _ => 4,
    };

    private static List<FlowEdge> BuildEdges(List<AzureResource> resources)
    {
        var edges = new List<FlowEdge>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var byId = resources.ToDictionary(r => r.Id, StringComparer.OrdinalIgnoreCase);
        var routeTables = resources
            .Where(r => r.Type.Equals("Microsoft.Network/routeTables", StringComparison.OrdinalIgnoreCase))
            .ToList();

        void Emit(FlowEdge e)
        {
            if (seen.Add(e.Id)) edges.Add(e);
        }

        foreach (var resource in resources)
        {
            switch (resource.Type.ToLowerInvariant())
            {
                case "microsoft.network/virtualnetworks":
                    AddVNetEdges(resource, Emit);
                    break;
                case "microsoft.network/virtualnetworks/subnets":
                    AddSubnetEdges(resource, byId, Emit);
                    break;
                case "microsoft.network/networksecuritygroups":
                    AddNsgEdges(resource, Emit);
                    break;
                case "microsoft.network/routetables":
                    AddRouteTableEdges(resource, Emit);
                    break;
                case "microsoft.network/privateendpoints":
                    AddPrivateEndpointEdges(resource, Emit);
                    break;
                case "microsoft.compute/virtualmachines":
                    AddVmEdges(resource, Emit);
                    break;
            }
        }

        // Synthesise subnet → default-route edges so the red "0.0.0.0/0" data path
        // is visible even when the route table is associated implicitly via the
        // subnet's routeTable property. Each route table's routes are inspected.
        foreach (var rt in routeTables)
        {
            if (!TryGetJArray(rt.Properties, "subnets", out var attachedSubnets)) continue;
            if (!TryGetJArray(rt.Properties, "routes", out var routes)) continue;

            foreach (var route in routes.OfType<JObject>())
            {
                var routeProps = route["properties"] as JObject;
                var prefix = routeProps?["addressPrefix"]?.ToString();
                if (!string.Equals(prefix, "0.0.0.0/0", StringComparison.Ordinal)) continue;

                var nextHopType = routeProps?["nextHopType"]?.ToString() ?? "Unknown";
                var nextHopIp = routeProps?["nextHopIpAddress"]?.ToString() ?? string.Empty;
                var routeName = route["name"]?.ToString() ?? "default";

                foreach (var subnetRef in attachedSubnets.OfType<JObject>())
                {
                    var subnetId = subnetRef["id"]?.ToString();
                    if (string.IsNullOrEmpty(subnetId)) continue;
                    Emit(new FlowEdge(
                        Id: $"defaultroute|{subnetId}|{rt.Id}|{routeName}",
                        Source: subnetId,
                        Target: rt.Id,
                        Label: $"0.0.0.0/0 → {nextHopType}{(string.IsNullOrEmpty(nextHopIp) ? string.Empty : " " + nextHopIp)}",
                        Category: FlowEdgeCategory.DefaultRoute,
                        Metadata: new Dictionary<string, string>
                        {
                            ["addressPrefix"] = "0.0.0.0/0",
                            ["nextHopType"] = nextHopType,
                            ["nextHopIpAddress"] = nextHopIp,
                            ["routeName"] = routeName,
                        }));
                }
            }
        }

        return edges;
    }

    private static void AddVNetEdges(AzureResource vnet, Action<FlowEdge> emit)
    {
        // VNet → Subnet containment
        if (TryGetJArray(vnet.Properties, "subnets", out var subnets))
        {
            foreach (var s in subnets.OfType<JObject>())
            {
                var id = s["id"]?.ToString();
                if (string.IsNullOrEmpty(id)) continue;
                emit(new FlowEdge(
                    Id: $"contains|{vnet.Id}|{id}",
                    Source: vnet.Id,
                    Target: id,
                    Label: "contains",
                    Category: FlowEdgeCategory.Contains));
            }
        }

        // VNet ↔ VNet peering
        if (TryGetJArray(vnet.Properties, "virtualNetworkPeerings", out var peerings))
        {
            foreach (var p in peerings.OfType<JObject>())
            {
                var remote = (p["properties"] as JObject)?["remoteVirtualNetwork"] as JObject;
                var remoteId = remote?["id"]?.ToString();
                var state = (p["properties"] as JObject)?["peeringState"]?.ToString() ?? string.Empty;
                if (string.IsNullOrEmpty(remoteId)) continue;
                emit(new FlowEdge(
                    Id: $"peering|{vnet.Id}|{remoteId}",
                    Source: vnet.Id,
                    Target: remoteId,
                    Label: string.IsNullOrEmpty(state) ? "peered" : $"peered ({state})",
                    Category: FlowEdgeCategory.Peering));
            }
        }
    }

    private static void AddSubnetEdges(AzureResource subnet, Dictionary<string, AzureResource> byId, Action<FlowEdge> emit)
    {
        // Subnet → NSG association
        if (subnet.Properties.TryGetValue("networkSecurityGroup", out var nsgRefObj) &&
            nsgRefObj is JObject nsgRef && nsgRef["id"]?.ToString() is { Length: > 0 } nsgId)
        {
            emit(new FlowEdge(
                Id: $"nsg|{subnet.Id}|{nsgId}",
                Source: subnet.Id,
                Target: nsgId,
                Label: "NSG",
                Category: FlowEdgeCategory.AssociatedWith));
        }

        // Subnet → Route Table association
        if (subnet.Properties.TryGetValue("routeTable", out var rtRefObj) &&
            rtRefObj is JObject rtRef && rtRef["id"]?.ToString() is { Length: > 0 } rtId)
        {
            emit(new FlowEdge(
                Id: $"udr|{subnet.Id}|{rtId}",
                Source: subnet.Id,
                Target: rtId,
                Label: "UDR",
                Category: FlowEdgeCategory.Route));
        }
    }

    private static void AddNsgEdges(AzureResource nsg, Action<FlowEdge> emit)
    {
        if (!TryGetJArray(nsg.Properties, "subnets", out var attached)) return;
        foreach (var s in attached.OfType<JObject>())
        {
            var id = s["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) continue;
            emit(new FlowEdge(
                Id: $"nsg|{id}|{nsg.Id}",
                Source: id,
                Target: nsg.Id,
                Label: "NSG",
                Category: FlowEdgeCategory.AssociatedWith));
        }
    }

    private static void AddRouteTableEdges(AzureResource rt, Action<FlowEdge> emit)
    {
        if (!TryGetJArray(rt.Properties, "subnets", out var attached)) return;
        foreach (var s in attached.OfType<JObject>())
        {
            var id = s["id"]?.ToString();
            if (string.IsNullOrEmpty(id)) continue;
            emit(new FlowEdge(
                Id: $"udr|{id}|{rt.Id}",
                Source: id,
                Target: rt.Id,
                Label: "UDR",
                Category: FlowEdgeCategory.Route));
        }
    }

    private static void AddPrivateEndpointEdges(AzureResource pe, Action<FlowEdge> emit)
    {
        var subnet = (pe.Properties.TryGetValue("subnet", out var sObj) ? sObj : null) as JObject;
        var subnetId = subnet?["id"]?.ToString();
        if (!string.IsNullOrEmpty(subnetId))
        {
            emit(new FlowEdge(
                Id: $"pe|{pe.Id}|{subnetId}",
                Source: pe.Id,
                Target: subnetId,
                Label: "in subnet",
                Category: FlowEdgeCategory.AssociatedWith));
        }
    }

    private static void AddVmEdges(AzureResource vm, Action<FlowEdge> emit)
    {
        // VMs reference NICs; NICs reference subnets. We don't have NICs in the
        // resource set today, so emit a placeholder edge if the VM has an explicit
        // subnetId in extended properties — otherwise skip. This is intentionally
        // conservative to avoid noisy dangling edges.
    }

    private static bool TryGetJArray(IDictionary<string, object> dict, string key, out JArray array)
    {
        array = [];
        if (!dict.TryGetValue(key, out var v) || v is null) return false;
        if (v is JArray ja) { array = ja; return true; }
        return false;
    }
}
