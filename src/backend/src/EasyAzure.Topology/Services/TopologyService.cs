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
        var networkInterfaces = new List<AzureResource>();
        foreach (var subscriptionId in subscriptionIds)
        {
            // Each collector is wrapped so missing RBAC on a single resource type
            // never blocks the whole topology. Errors are logged + skipped.
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetVNetsAsync(subscriptionId, ct), "VNets", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetNSGsAsync(subscriptionId, ct), "NSGs", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetRouteTablesAsync(subscriptionId, ct), "RouteTables", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetVMsAsync(subscriptionId, ct), "VMs", subscriptionId));
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetPrivateEndpointsAsync(subscriptionId, ct), "PrivateEndpoints", subscriptionId));
            networkInterfaces.AddRange(await SafeCollectAsync(() => _resourceGraph.GetNetworkInterfacesAsync(subscriptionId, ct), "NICs", subscriptionId));
        }

        // Subnets are nested inside VNet.properties.subnets — promote them to first-
        // class nodes so they can be referenced by NSG/route-table association edges.
        var promotedSubnets = PromoteSubnets(allResources);
        allResources.AddRange(promotedSubnets);

        var nodes = BuildNodes(allResources);
        var edges = BuildEdges(allResources, networkInterfaces);

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
                var dict = props.ToObject<Dictionary<string, object>>() ?? [];
                // Flatten high-value fields so the frontend can display subnet details
                // without deep JSON parsing assumptions.
                var addressPrefix = props["addressPrefix"]?.ToString();
                if (!string.IsNullOrWhiteSpace(addressPrefix)) dict["addressPrefix"] = addressPrefix;

                if (props["addressPrefixes"] is JArray prefixes)
                {
                    dict["addressPrefixes"] = prefixes;
                }

                var nsgId = (props["networkSecurityGroup"] as JObject)?["id"]?.ToString();
                if (!string.IsNullOrWhiteSpace(nsgId)) dict["networkSecurityGroupId"] = nsgId;

                var routeTableId = (props["routeTable"] as JObject)?["id"]?.ToString();
                if (!string.IsNullOrWhiteSpace(routeTableId)) dict["routeTableId"] = routeTableId;

                subnets.Add(new AzureResource
                {
                    Id = id,
                    Name = name,
                    Type = "Microsoft.Network/virtualNetworks/subnets",
                    Location = vnet.Location,
                    ResourceGroup = vnet.ResourceGroup,
                    SubscriptionId = vnet.SubscriptionId,
                    Properties = dict,
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

    private static List<FlowEdge> BuildEdges(List<AzureResource> resources, List<AzureResource> networkInterfaces)
    {
        var edges = new List<FlowEdge>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var byId = resources.ToDictionary(r => r.Id, StringComparer.OrdinalIgnoreCase);
        var nicToSubnetIds = BuildNicSubnetIndex(networkInterfaces);
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
                    AddVmEdges(resource, nicToSubnetIds, Emit);
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
        var nsgId = TryGetReferenceId(subnet.Properties, "networkSecurityGroup")
            ?? TryGetString(subnet.Properties, "networkSecurityGroupId");
        if (!string.IsNullOrWhiteSpace(nsgId))
        {
            emit(new FlowEdge(
                Id: $"nsg|{subnet.Id}|{nsgId}",
                Source: subnet.Id,
                Target: nsgId,
                Label: "NSG",
                Category: FlowEdgeCategory.AssociatedWith));
        }

        // Subnet → Route Table association
        var rtId = TryGetReferenceId(subnet.Properties, "routeTable")
            ?? TryGetString(subnet.Properties, "routeTableId");
        if (!string.IsNullOrWhiteSpace(rtId))
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
        if (!TryGetRefIdList(nsg.Properties, "subnets", out var attachedSubnetIds)) return;
        foreach (var id in attachedSubnetIds)
        {
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
        if (!TryGetRefIdList(rt.Properties, "subnets", out var attachedSubnetIds)) return;
        foreach (var id in attachedSubnetIds)
        {
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

    private static void AddVmEdges(AzureResource vm, Dictionary<string, HashSet<string>> nicToSubnetIds, Action<FlowEdge> emit)
    {
        if (!TryGetObjectCaseInsensitive(vm.Properties, "networkProfile", out var networkProfileObj)) return;
        if (!TryGetRefIdList(networkProfileObj, "networkInterfaces", out var nicIds)) return;

        foreach (var nicId in nicIds)
        {
            if (!nicToSubnetIds.TryGetValue(nicId, out var subnetIds)) continue;
            foreach (var subnetId in subnetIds)
            {
                emit(new FlowEdge(
                    Id: $"vm|{vm.Id}|{subnetId}",
                    Source: vm.Id,
                    Target: subnetId,
                    Label: "in subnet",
                    Category: FlowEdgeCategory.AssociatedWith));
            }
        }
    }

    private static Dictionary<string, HashSet<string>> BuildNicSubnetIndex(List<AzureResource> networkInterfaces)
    {
        var index = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var nic in networkInterfaces)
        {
            if (!TryGetRefIdList(nic.Properties, "ipConfigurations", out var _))
            {
                // ipConfigurations is an array of objects containing properties.subnet.id
                // so we parse it manually below; this probe keeps behavior explicit.
            }

            if (!TryGetArrayCaseInsensitive(nic.Properties, "ipConfigurations", out var ipConfigs)) continue;
            foreach (var ipCfg in ipConfigs)
            {
                if (ipCfg is not JObject ipCfgObj) continue;
                var subnetId = ((ipCfgObj["properties"] as JObject)?["subnet"] as JObject)?["id"]?.ToString();
                if (string.IsNullOrWhiteSpace(subnetId)) continue;

                if (!index.TryGetValue(nic.Id, out var set))
                {
                    set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                    index[nic.Id] = set;
                }
                set.Add(subnetId);
            }
        }

        return index;
    }

    private static bool TryGetObjectCaseInsensitive(IDictionary<string, object> dict, string key, out IDictionary<string, object> obj)
    {
        obj = new Dictionary<string, object>();
        if (!TryGetValueCaseInsensitive(dict, key, out var value) || value is null) return false;

        if (value is JObject jo)
        {
            obj = jo.ToObject<Dictionary<string, object>>() ?? new Dictionary<string, object>();
            return true;
        }

        if (value is IDictionary<string, object> idict)
        {
            obj = idict;
            return true;
        }

        return false;
    }

    private static string? TryGetString(IDictionary<string, object> dict, string key)
    {
        if (!TryGetValueCaseInsensitive(dict, key, out var value) || value is null) return null;
        return value switch
        {
            string s when !string.IsNullOrWhiteSpace(s) => s,
            JValue jv when jv.Type == JTokenType.String && !string.IsNullOrWhiteSpace(jv.ToString()) => jv.ToString(),
            _ => null,
        };
    }

    private static string? TryGetReferenceId(IDictionary<string, object> dict, string key)
    {
        if (!TryGetValueCaseInsensitive(dict, key, out var value) || value is null) return null;

        if (value is JObject jo)
        {
            return jo["id"]?.ToString();
        }

        if (value is IDictionary<string, object> idict)
        {
            return TryGetString(idict, "id");
        }

        return null;
    }

    private static bool TryGetArrayCaseInsensitive(IDictionary<string, object> dict, string key, out JArray array)
    {
        array = [];
        if (!TryGetValueCaseInsensitive(dict, key, out var value) || value is null) return false;
        if (value is JArray ja)
        {
            array = ja;
            return true;
        }

        if (value is IEnumerable<object> enumerable)
        {
            array = JArray.FromObject(enumerable);
            return true;
        }

        return false;
    }

    private static bool TryGetRefIdList(IDictionary<string, object> dict, string key, out List<string> ids)
    {
        ids = new List<string>();
        if (!TryGetArrayCaseInsensitive(dict, key, out var arr)) return false;

        foreach (var item in arr)
        {
            switch (item)
            {
                case JObject jo:
                    {
                        var id = jo["id"]?.ToString();
                        if (!string.IsNullOrWhiteSpace(id)) ids.Add(id);
                        break;
                    }
                case JValue jv when jv.Type == JTokenType.String:
                    {
                        var id = jv.ToString();
                        if (!string.IsNullOrWhiteSpace(id)) ids.Add(id);
                        break;
                    }
            }
        }

        return ids.Count > 0;
    }

    private static bool TryGetValueCaseInsensitive(IDictionary<string, object> dict, string key, out object? value)
    {
        foreach (var kvp in dict)
        {
            if (string.Equals(kvp.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                value = kvp.Value;
                return true;
            }
        }
        value = null;
        return false;
    }

    private static bool TryGetJArray(IDictionary<string, object> dict, string key, out JArray array)
    {
        array = [];
        if (!TryGetValueCaseInsensitive(dict, key, out var v) || v is null) return false;
        if (v is JArray ja) { array = ja; return true; }
        if (v is IEnumerable<object> enumerable)
        {
            array = JArray.FromObject(enumerable);
            return true;
        }
        return false;
    }
}
