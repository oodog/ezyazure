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
    private const string InternetNodeId = "easyazure://internet";
    private const string InternetNodeType = "EasyAzure.Network/Internet";

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
            allResources.AddRange(await SafeCollectAsync(() => _resourceGraph.GetSubnetsAsync(subscriptionId, ct), "Subnets", subscriptionId));
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

        // Resource Graph can return the same logical resource from different queries
        // with different property depths. Merge them by ID so edges and details use
        // the richest available shape.
        allResources = ConsolidateResources(allResources);
        EnsureInternetNode(allResources);

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
                var addressPrefix = (props["addressPrefix"] as JValue)?.Value<string>();
                if (!string.IsNullOrWhiteSpace(addressPrefix)) dict["addressPrefix"] = addressPrefix;

                if (props["addressPrefixes"] is JArray prefixes && prefixes.Count > 0)
                {
                    var clean = new JArray(prefixes.OfType<JValue>()
                        .Where(v => v.Type == JTokenType.String && !string.IsNullOrWhiteSpace(v.Value<string>())));
                    if (clean.Count > 0) dict["addressPrefixes"] = clean;
                }

                var nsgIdToken = (props["networkSecurityGroup"] as JObject)?["id"];
                var nsgId = nsgIdToken is JValue { Type: JTokenType.String } nsgJv ? nsgJv.Value<string>() : null;
                if (!string.IsNullOrWhiteSpace(nsgId)) dict["networkSecurityGroupId"] = nsgId;

                var rtIdToken = (props["routeTable"] as JObject)?["id"];
                var routeTableId = rtIdToken is JValue { Type: JTokenType.String } rtJv ? rtJv.Value<string>() : null;
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

    private static List<AzureResource> ConsolidateResources(List<AzureResource> resources)
    {
        var merged = new Dictionary<string, AzureResource>(StringComparer.OrdinalIgnoreCase);

        foreach (var r in resources)
        {
            if (string.IsNullOrWhiteSpace(r.Id)) continue;
            if (!merged.TryGetValue(r.Id, out var existing))
            {
                merged[r.Id] = r;
                continue;
            }

            var properties = new Dictionary<string, object>(existing.Properties, StringComparer.OrdinalIgnoreCase);
            foreach (var kv in r.Properties)
            {
                properties[kv.Key] = kv.Value;
            }

            var tags = new Dictionary<string, string>(existing.Tags, StringComparer.OrdinalIgnoreCase);
            foreach (var kv in r.Tags)
            {
                tags[kv.Key] = kv.Value;
            }

            merged[r.Id] = new AzureResource
            {
                Id = existing.Id,
                Type = string.IsNullOrWhiteSpace(existing.Type) ? r.Type : existing.Type,
                Name = string.IsNullOrWhiteSpace(existing.Name) ? r.Name : existing.Name,
                SubscriptionId = string.IsNullOrWhiteSpace(existing.SubscriptionId) ? r.SubscriptionId : existing.SubscriptionId,
                ResourceGroup = string.IsNullOrWhiteSpace(existing.ResourceGroup) ? r.ResourceGroup : existing.ResourceGroup,
                Location = string.IsNullOrWhiteSpace(existing.Location) ? r.Location : existing.Location,
                Properties = properties,
                Tags = tags,
            };
        }

        return merged.Values.ToList();
    }

    private static void EnsureInternetNode(List<AzureResource> resources)
    {
        if (resources.Any(r => string.Equals(r.Id, InternetNodeId, StringComparison.OrdinalIgnoreCase))) return;

        resources.Add(new AzureResource
        {
            Id = InternetNodeId,
            Type = InternetNodeType,
            Name = "Internet",
            SubscriptionId = "global",
            ResourceGroup = "global",
            Location = "global",
            Properties = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
            {
                ["kind"] = "internet",
            },
        });
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
        var hasDefaultRoute = false;
        var subnetsWithExplicitDefault = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var routeTableToSubnetIds = BuildRouteTableSubnetIndex(resources);
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
            if (!TryGetJArray(rt.Properties, "routes", out var routes)) continue;

            var attachedSubnetIds = new List<string>();
            if (TryGetRefIdList(rt.Properties, "subnets", out var fromRouteTable))
            {
                attachedSubnetIds.AddRange(fromRouteTable);
            }
            if (routeTableToSubnetIds.TryGetValue(rt.Id, out var fromSubnetRefs))
            {
                attachedSubnetIds.AddRange(fromSubnetRefs);
            }
            attachedSubnetIds = attachedSubnetIds
                .Where(id => !string.IsNullOrWhiteSpace(id))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            foreach (var route in routes.OfType<JObject>())
            {
                var routeProps = route["properties"] as JObject;
                var prefix = routeProps?["addressPrefix"]?.ToString();
                if (!string.Equals(prefix, "0.0.0.0/0", StringComparison.Ordinal)) continue;

                var rawNextHopType = routeProps?["nextHopType"]?.ToString() ?? string.Empty;
                var nextHopIp = routeProps?["nextHopIpAddress"]?.ToString() ?? string.Empty;
                var nextHopType = NormalizeDefaultRouteNextHopType(rawNextHopType, nextHopIp);
                var routeName = route["name"]?.ToString() ?? "default";
                hasDefaultRoute = true;

                foreach (var subnetId in attachedSubnetIds)
                {
                    if (string.IsNullOrEmpty(subnetId)) continue;
                    subnetsWithExplicitDefault.Add(subnetId);
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

                // Show the egress destination as a first-class node so users can
                // visually follow VM -> subnet -> route table -> Internet.
                Emit(new FlowEdge(
                    Id: $"defaultroute|{rt.Id}|{InternetNodeId}|{routeName}",
                    Source: rt.Id,
                    Target: InternetNodeId,
                    Label: $"default egress ({nextHopType})",
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

        if (hasDefaultRoute)
        {
            EnsureInternetNode(resources);
        }

        // Synthesise Azure system default route (0.0.0.0/0 → Internet) for any
        // subnet that has NO explicit UDR overriding the default. Azure's implicit
        // system routes send all unmatched traffic to the Internet next hop,
        // optionally filtered by an NSG. This makes egress visible on every subnet.
        var subnetsForSystemDefault = resources
            .Where(r => r.Type.Equals("Microsoft.Network/virtualNetworks/subnets", StringComparison.OrdinalIgnoreCase))
            .Where(s => !subnetsWithExplicitDefault.Contains(s.Id))
            .ToList();

        if (subnetsForSystemDefault.Count > 0)
        {
            EnsureInternetNode(resources);
            foreach (var subnet in subnetsForSystemDefault)
            {
                // If the subnet has an NSG, label that the egress passes through it.
                var nsgId = TryGetReferenceId(subnet.Properties, "networkSecurityGroup");
                var label = string.IsNullOrEmpty(nsgId)
                    ? "0.0.0.0/0 → Internet (system default)"
                    : "0.0.0.0/0 → Internet (via NSG, system default)";

                Emit(new FlowEdge(
                    Id: $"systemdefault|{subnet.Id}|{InternetNodeId}",
                    Source: subnet.Id,
                    Target: InternetNodeId,
                    Label: label,
                    Category: FlowEdgeCategory.DefaultRoute,
                    Metadata: new Dictionary<string, string>
                    {
                        ["addressPrefix"] = "0.0.0.0/0",
                        ["nextHopType"] = "Internet",
                        ["routeName"] = "system-default",
                        ["source"] = "system",
                    }));
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
        // Subnet → NSG association — try nested ref, flat fallback, and tostring()
        // column projected by Resource Graph (nsgIdFlat).
        var nsgId = TryGetReferenceId(subnet.Properties, "networkSecurityGroup")
            ?? TryGetString(subnet.Properties, "networkSecurityGroupId");
        if (!string.IsNullOrWhiteSpace(nsgId) && nsgId.StartsWith("/", StringComparison.Ordinal))
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
        if (!string.IsNullOrWhiteSpace(rtId) && rtId.StartsWith("/", StringComparison.Ordinal))
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

    private static string NormalizeDefaultRouteNextHopType(string nextHopType, string nextHopIp)
    {
        if (!string.IsNullOrWhiteSpace(nextHopIp)) return string.IsNullOrWhiteSpace(nextHopType) ? "VirtualAppliance" : nextHopType;

        if (string.IsNullOrWhiteSpace(nextHopType)) return "Internet";

        return nextHopType.Trim().ToLowerInvariant() switch
        {
            "nsg" => "Internet",
            "none" => "Internet",
            _ => nextHopType,
        };
    }

    private static Dictionary<string, HashSet<string>> BuildRouteTableSubnetIndex(List<AzureResource> resources)
    {
        var index = new Dictionary<string, HashSet<string>>(StringComparer.OrdinalIgnoreCase);

        foreach (var subnet in resources.Where(r =>
                     string.Equals(r.Type, "Microsoft.Network/virtualNetworks/subnets", StringComparison.OrdinalIgnoreCase)))
        {
            var routeTableId = TryGetReferenceId(subnet.Properties, "routeTable")
                ?? TryGetString(subnet.Properties, "routeTableId");
            if (string.IsNullOrWhiteSpace(routeTableId)) continue;

            if (!index.TryGetValue(routeTableId, out var set))
            {
                set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                index[routeTableId] = set;
            }
            set.Add(subnet.Id);
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

        JToken? idToken = null;
        if (value is JObject jo) idToken = jo["id"];
        else if (value is IDictionary<string, object> idict && TryGetValueCaseInsensitive(idict, "id", out var idVal))
        {
            return idVal switch
            {
                string s when !string.IsNullOrWhiteSpace(s) && s.StartsWith("/", StringComparison.Ordinal) => s,
                JValue jv when jv.Type == JTokenType.String && (jv.Value<string>()?.StartsWith("/", StringComparison.Ordinal) ?? false) => jv.Value<string>(),
                _ => null,
            };
        }

        if (idToken is JValue jvId && jvId.Type == JTokenType.String)
        {
            var s = jvId.Value<string>();
            return !string.IsNullOrWhiteSpace(s) && s.StartsWith("/", StringComparison.Ordinal) ? s : null;
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
                        // Only accept a real ARM resource id ("/subscriptions/..."),
                        // rejecting malformed shapes such as { id: [] } that Resource
                        // Graph occasionally returns for empty references.
                        if (jo["id"] is JValue { Type: JTokenType.String } jv)
                        {
                            var id = jv.Value<string>();
                            if (!string.IsNullOrWhiteSpace(id) && id.StartsWith("/", StringComparison.Ordinal))
                                ids.Add(id);
                        }
                        break;
                    }
                case JValue jv when jv.Type == JTokenType.String:
                    {
                        var id = jv.Value<string>();
                        if (!string.IsNullOrWhiteSpace(id) && id.StartsWith("/", StringComparison.Ordinal))
                            ids.Add(id);
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
