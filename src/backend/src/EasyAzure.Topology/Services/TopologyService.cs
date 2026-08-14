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
        var successfulSubscriptionIds = new List<string>();
        var failures = new List<DiscoveryCoverageFailure>();
        foreach (var subscriptionId in subscriptionIds)
        {
            try
            {
                allResources.AddRange(await _resourceGraph.GetAllResourcesAsync(subscriptionId, ct));
                successfulSubscriptionIds.Add(subscriptionId);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Topology: collecting resources for subscription {Sub} failed; returning explicit partial coverage.",
                    subscriptionId);
                failures.Add(new DiscoveryCoverageFailure
                {
                    SubscriptionId = subscriptionId,
                    Stage = "AzureResourceGraph",
                    FailureType = ex.GetType().Name,
                    Message = "Azure Resource Graph discovery failed. Verify RBAC, provider access, and throttling before retrying.",
                });
            }
        }

        var networkInterfaces = allResources
            .Where(resource => resource.Type.Equals("Microsoft.Network/networkInterfaces", StringComparison.OrdinalIgnoreCase))
            .ToList();

        // Subnets are nested inside VNet.properties.subnets — promote them to first-
        // class nodes so they can be referenced by NSG/route-table association edges.
        var promotedSubnets = PromoteSubnets(allResources);
        allResources.AddRange(promotedSubnets);

        // Resource Graph can return the same logical resource from different queries
        // with different property depths. Merge them by ID so edges and details use
        // the richest available shape.
        allResources = ConsolidateResources(allResources);
        await EnrichSubnetsFromArmAsync(allResources, ct);
        await EnrichRouteTablesFromArmAsync(allResources, ct);
        EnrichVmPrivateIps(allResources, networkInterfaces);
        EnrichFirewallPrivateIps(allResources);
        EnsureInternetNode(allResources);

        var nodes = BuildNodes(allResources);
        var edges = BuildEdges(allResources, networkInterfaces);

        return new TopologyGraph(
            nodes,
            edges,
            new DiscoveryCoverage
            {
                RequestedSubscriptionIds = subscriptionIds,
                SuccessfulSubscriptionIds = successfulSubscriptionIds,
                Failures = failures,
            });
    }

    public async Task<IReadOnlyList<ResourceEdge>> GetEdgesAsync(string resourceId, CancellationToken ct = default)
    {
        // In production, this queries the graph store (Cosmos DB Gremlin).
        // Placeholder returns empty for now.
        await Task.CompletedTask;
        return [];
    }

    private async Task EnrichSubnetsFromArmAsync(List<AzureResource> resources, CancellationToken ct)
    {
        // Azure Resource Graph routinely returns subnet shapes with broken nested
        // references — e.g. `networkSecurityGroup: { id: [] }` and
        // `addressPrefixes: [ [] ]`. Filtering on those locally is unreliable, so we
        // unconditionally re-hydrate every subnet from ARM REST (which is the
        // authoritative source for subnet shape). This is bounded by the actual
        // subnet count, which is small for typical subscriptions.
        var subnets = resources
            .Where(r => string.Equals(r.Type, "Microsoft.Network/virtualNetworks/subnets", StringComparison.OrdinalIgnoreCase))
            .Where(r => !string.IsNullOrWhiteSpace(r.Id) && r.Id.StartsWith("/", StringComparison.Ordinal))
            .ToList();

        if (subnets.Count == 0) return;

        _logger.LogInformation("Enriching {Count} subnet(s) from ARM REST", subnets.Count);

        var byId = resources.ToDictionary(r => r.Id, StringComparer.OrdinalIgnoreCase);

        var fetches = subnets.Select(async s =>
        {
            var arm = await _resourceGraph.GetArmResourceAsync(s.Id, "2024-05-01", ct);
            if (arm is null) return;
            var armProps = arm["properties"] as JObject;
            if (armProps is null) return;

            if (!byId.TryGetValue(s.Id, out var current)) return;

            var dict = new Dictionary<string, object>(current.Properties, StringComparer.OrdinalIgnoreCase);
            foreach (var prop in armProps.Properties())
            {
                if (prop.Value is null || prop.Value.Type == JTokenType.Null) continue;
                // ARM is authoritative for subnet shape — overwrite even when the
                // existing key has a value, because that value may be the broken
                // ARG shape (e.g. id: []).
                // Convert JToken to native .NET types so System.Text.Json can
                // serialize them correctly (STJ doesn't know Newtonsoft JToken).
                var native = ResourceGraphService.NormalizeJTokenToNative(prop.Value);
                if (native is not null) dict[prop.Name] = native;
            }

            // Flatten high-value fields so edge builders that look for flat ID
            // strings can find them without re-parsing nested JObjects.
            if (armProps["addressPrefix"] is JValue { Type: JTokenType.String } apJv)
            {
                var ap = apJv.Value<string>();
                if (!string.IsNullOrWhiteSpace(ap)) dict["addressPrefix"] = ap;
            }
            if (armProps["addressPrefixes"] is JArray apArr && apArr.Count > 0)
            {
                var native = ResourceGraphService.NormalizeJTokenToNative(apArr);
                if (native is not null) dict["addressPrefixes"] = native;
            }
            if ((armProps["networkSecurityGroup"] as JObject)?["id"] is JValue { Type: JTokenType.String } nsgJv)
            {
                var nsgId = nsgJv.Value<string>();
                if (!string.IsNullOrWhiteSpace(nsgId) && nsgId.StartsWith("/", StringComparison.Ordinal))
                    dict["networkSecurityGroupId"] = nsgId;
            }
            if ((armProps["routeTable"] as JObject)?["id"] is JValue { Type: JTokenType.String } rtJv)
            {
                var rtId = rtJv.Value<string>();
                if (!string.IsNullOrWhiteSpace(rtId) && rtId.StartsWith("/", StringComparison.Ordinal))
                    dict["routeTableId"] = rtId;
            }

            byId[s.Id] = new AzureResource
            {
                Id = current.Id,
                Name = current.Name,
                Type = current.Type,
                Location = current.Location,
                ResourceGroup = current.ResourceGroup,
                SubscriptionId = current.SubscriptionId,
                Properties = dict,
                Tags = current.Tags,
            };
        }).ToArray();

        await Task.WhenAll(fetches);

        for (var i = 0; i < resources.Count; i++)
        {
            if (byId.TryGetValue(resources[i].Id, out var updated))
            {
                resources[i] = updated;
            }
        }
    }

    /// <summary>
    /// Re-hydrates route tables from ARM REST so their <c>routes</c> and <c>subnets</c>
    /// (association) collections are authoritative. Azure Resource Graph sometimes returns
    /// route tables without their nested routes/subnet links, which breaks routing analysis
    /// (asymmetric route detection depends on seeing the actual route entries + associations).
    /// </summary>
    private async Task EnrichRouteTablesFromArmAsync(List<AzureResource> resources, CancellationToken ct)
    {
        var routeTables = resources
            .Where(r => string.Equals(r.Type, "Microsoft.Network/routeTables", StringComparison.OrdinalIgnoreCase))
            .Where(r => !string.IsNullOrWhiteSpace(r.Id) && r.Id.StartsWith("/", StringComparison.Ordinal))
            .ToList();

        if (routeTables.Count == 0) return;

        _logger.LogInformation("Enriching {Count} route table(s) from ARM REST", routeTables.Count);

        var byId = resources.ToDictionary(r => r.Id, StringComparer.OrdinalIgnoreCase);

        var fetches = routeTables.Select(async rt =>
        {
            var arm = await _resourceGraph.GetArmResourceAsync(rt.Id, "2024-05-01", ct);
            if (arm is null) return;
            var armProps = arm["properties"] as JObject;
            if (armProps is null) return;
            if (!byId.TryGetValue(rt.Id, out var current)) return;

            var dict = new Dictionary<string, object>(current.Properties, StringComparer.OrdinalIgnoreCase);
            foreach (var prop in armProps.Properties())
            {
                if (prop.Value is null || prop.Value.Type == JTokenType.Null) continue;
                var native = ResourceGraphService.NormalizeJTokenToNative(prop.Value);
                if (native is not null) dict[prop.Name] = native;
            }

            byId[rt.Id] = new AzureResource
            {
                Id = current.Id,
                Name = current.Name,
                Type = current.Type,
                Location = current.Location,
                ResourceGroup = current.ResourceGroup,
                SubscriptionId = current.SubscriptionId,
                Properties = dict,
                Tags = current.Tags,
            };
        }).ToArray();

        await Task.WhenAll(fetches);

        for (var i = 0; i < resources.Count; i++)
        {
            if (byId.TryGetValue(resources[i].Id, out var updated))
            {
                resources[i] = updated;
            }
        }
    }

    /// <summary>
    /// Extracts private IP addresses from Azure Firewall ipConfigurations and stores
    /// them as <c>properties.privateIPAddresses</c> so the frontend can display them.
    /// </summary>
    private static void EnrichFirewallPrivateIps(List<AzureResource> resources)
    {
        for (var i = 0; i < resources.Count; i++)
        {
            var fw = resources[i];
            if (!string.Equals(fw.Type, "Microsoft.Network/azureFirewalls", StringComparison.OrdinalIgnoreCase))
                continue;

            if (!TryGetValueCaseInsensitive(fw.Properties, "ipConfigurations", out var ipCfgVal) || ipCfgVal is null)
                continue;

            IEnumerable<object>? items = null;
            if (ipCfgVal is JArray ja) items = ja;
            else if (ipCfgVal is IList<object> nativeList) items = nativeList;
            if (items is null) continue;

            var ips = new List<string>();
            foreach (var item in items)
            {
                string? ip = null;
                if (item is JObject jo)
                    ip = (jo["properties"] as JObject)?["privateIPAddress"]?.ToString();
                else if (item is IDictionary<string, object> d &&
                         TryGetValueCaseInsensitive(d, "properties", out var pVal) &&
                         pVal is IDictionary<string, object> pDict &&
                         TryGetValueCaseInsensitive(pDict, "privateIPAddress", out var ipVal))
                    ip = ipVal as string;
                if (!string.IsNullOrWhiteSpace(ip)) ips.Add(ip!);
            }

            if (ips.Count == 0) continue;

            var dict = new Dictionary<string, object>(fw.Properties, StringComparer.OrdinalIgnoreCase)
            {
                ["privateIPAddresses"] = ips.Distinct(StringComparer.OrdinalIgnoreCase).ToList<object>(),
            };
            resources[i] = new AzureResource
            {
                Id = fw.Id,
                Name = fw.Name,
                Type = fw.Type,
                Location = fw.Location,
                ResourceGroup = fw.ResourceGroup,
                SubscriptionId = fw.SubscriptionId,
                Properties = dict,
                Tags = fw.Tags,
            };
        }
    }

    /// <summary>
    /// Walks every VM's <c>properties.networkProfile.networkInterfaces[].id</c>,
    /// looks up the corresponding NIC from <paramref name="networkInterfaces"/>,
    /// and copies the primary private IP address(es) onto the VM's
    /// <c>properties.privateIPAddresses</c>. This lets the discovery node + side
    /// panel show the VM's IP without an extra ARM call per VM.
    /// </summary>
    private static void EnrichVmPrivateIps(List<AzureResource> resources, List<AzureResource> networkInterfaces)
    {
        if (networkInterfaces.Count == 0) return;

        var nicById = networkInterfaces.ToDictionary(n => n.Id, StringComparer.OrdinalIgnoreCase);

        for (var i = 0; i < resources.Count; i++)
        {
            var vm = resources[i];
            if (!string.Equals(vm.Type, "Microsoft.Compute/virtualMachines", StringComparison.OrdinalIgnoreCase))
                continue;

            var nicIds = new List<string>();

            // Handle both JObject (pre-normalization) and native dict (post-normalization)
            if (TryGetValueCaseInsensitive(vm.Properties, "networkProfile", out var npObj))
            {
                IEnumerable<object>? nicList = null;
                if (npObj is JObject np && np["networkInterfaces"] is JArray nicArr)
                    nicList = nicArr;
                else if (npObj is IDictionary<string, object> npDict &&
                         TryGetValueCaseInsensitive(npDict, "networkInterfaces", out var niVal) && niVal is IList<object> niList)
                    nicList = niList;

                if (nicList is not null)
                {
                    foreach (var item in nicList)
                    {
                        string? nicId = null;
                        if (item is JObject jo && jo["id"] is JValue { Type: JTokenType.String } idJv)
                            nicId = idJv.ToObject<string>();
                        else if (item is IDictionary<string, object> d && TryGetValueCaseInsensitive(d, "id", out var idVal) && idVal is string idStr)
                            nicId = idStr;
                        if (!string.IsNullOrWhiteSpace(nicId)) nicIds.Add(nicId!);
                    }
                }
            }

            if (nicIds.Count == 0) continue;

            var ips = new List<string>();
            foreach (var nicId in nicIds)
            {
                if (!nicById.TryGetValue(nicId, out var nic)) continue;
                if (!TryGetValueCaseInsensitive(nic.Properties, "ipConfigurations", out var cfgObj)) continue;

                IEnumerable<object>? cfgList = null;
                if (cfgObj is JArray cfgArr) cfgList = cfgArr;
                else if (cfgObj is IList<object> nativeCfgList) cfgList = nativeCfgList;
                if (cfgList is null) continue;

                foreach (var cfg in cfgList)
                {
                    string? ip = null;
                    if (cfg is JObject cfgJo)
                    {
                        ip = (cfgJo["properties"] as JObject)?["privateIPAddress"]?.ToObject<string>();
                    }
                    else if (cfg is IDictionary<string, object> cfgDict &&
                             TryGetValueCaseInsensitive(cfgDict, "properties", out var propsVal) &&
                             propsVal is IDictionary<string, object> propsDict &&
                             TryGetValueCaseInsensitive(propsDict, "privateIPAddress", out var ipVal))
                    {
                        ip = ipVal as string;
                    }
                    if (!string.IsNullOrWhiteSpace(ip)) ips.Add(ip!);
                }
            }

            if (ips.Count == 0) continue;

            var dict = new Dictionary<string, object>(vm.Properties, StringComparer.OrdinalIgnoreCase)
            {
                ["privateIPAddresses"] = ips.Distinct(StringComparer.OrdinalIgnoreCase).ToList<object>(),
            };
            resources[i] = new AzureResource
            {
                Id = vm.Id,
                Name = vm.Name,
                Type = vm.Type,
                Location = vm.Location,
                ResourceGroup = vm.ResourceGroup,
                SubscriptionId = vm.SubscriptionId,
                Properties = dict,
                Tags = vm.Tags,
            };
        }

        // Private Endpoints have networkInterfaces[].id directly in their properties
        for (var i = 0; i < resources.Count; i++)
        {
            var pe = resources[i];
            if (!string.Equals(pe.Type, "Microsoft.Network/privateEndpoints", StringComparison.OrdinalIgnoreCase))
                continue;

            var peNicIds = new List<string>();
            if (TryGetValueCaseInsensitive(pe.Properties, "networkInterfaces", out var peNiVal))
            {
                IEnumerable<object>? peNiList = null;
                if (peNiVal is JArray peNiArr) peNiList = peNiArr;
                else if (peNiVal is IList<object> peNiNative) peNiList = peNiNative;

                if (peNiList is not null)
                {
                    foreach (var item in peNiList)
                    {
                        string? nicId = null;
                        if (item is JObject jo && jo["id"] is JValue { Type: JTokenType.String } idJv)
                            nicId = idJv.ToObject<string>();
                        else if (item is IDictionary<string, object> d && TryGetValueCaseInsensitive(d, "id", out var idVal) && idVal is string idStr)
                            nicId = idStr;
                        if (!string.IsNullOrWhiteSpace(nicId)) peNicIds.Add(nicId!);
                    }
                }
            }

            if (peNicIds.Count == 0) continue;

            var peIps = new List<string>();
            foreach (var nicId in peNicIds)
            {
                if (!nicById.TryGetValue(nicId, out var nic)) continue;
                if (!TryGetValueCaseInsensitive(nic.Properties, "ipConfigurations", out var cfgObj2)) continue;

                IEnumerable<object>? cfgList2 = null;
                if (cfgObj2 is JArray cfgArr2) cfgList2 = cfgArr2;
                else if (cfgObj2 is IList<object> nCfg2) cfgList2 = nCfg2;
                if (cfgList2 is null) continue;

                foreach (var cfg in cfgList2)
                {
                    string? ip = null;
                    if (cfg is JObject cfgJo)
                        ip = (cfgJo["properties"] as JObject)?["privateIPAddress"]?.ToObject<string>();
                    else if (cfg is IDictionary<string, object> cfgDict &&
                             TryGetValueCaseInsensitive(cfgDict, "properties", out var pVal) &&
                             pVal is IDictionary<string, object> pDict &&
                             TryGetValueCaseInsensitive(pDict, "privateIPAddress", out var ipVal))
                        ip = ipVal as string;
                    if (!string.IsNullOrWhiteSpace(ip)) peIps.Add(ip!);
                }
            }

            if (peIps.Count == 0) continue;

            var peDict = new Dictionary<string, object>(pe.Properties, StringComparer.OrdinalIgnoreCase)
            {
                ["privateIPAddresses"] = peIps.Distinct(StringComparer.OrdinalIgnoreCase).ToList<object>(),
            };
            resources[i] = new AzureResource
            {
                Id = pe.Id,
                Name = pe.Name,
                Type = pe.Type,
                Location = pe.Location,
                ResourceGroup = pe.ResourceGroup,
                SubscriptionId = pe.SubscriptionId,
                Properties = peDict,
                Tags = pe.Tags,
            };
        }
    }

    /// <summary>
    /// Lifts each VNet's <c>properties.subnets[]</c> into its own
    /// <see cref="AzureResource"/> node (type <c>Microsoft.Network/virtualNetworks/subnets</c>).
    /// </summary>
    private async Task EnrichMissingSubnetPrefixesAsync(List<AzureResource> resources, CancellationToken ct)
    {
        // Some subnets (notably IPAM-managed or freshly created ones) are returned by
        // Azure Resource Graph without addressPrefix / addressPrefixes populated.
        // For each of those we fetch the authoritative shape directly from ARM.
        var subnetsNeedingArm = resources
            .Where(r => string.Equals(r.Type, "Microsoft.Network/virtualNetworks/subnets", StringComparison.OrdinalIgnoreCase))
            .Where(s => !HasCidr(s.Properties))
            .ToList();

        if (subnetsNeedingArm.Count == 0) return;

        _logger.LogInformation(
            "Falling back to ARM REST for {Count} subnet(s) missing addressPrefix",
            subnetsNeedingArm.Count);

        var byId = resources.ToDictionary(r => r.Id, StringComparer.OrdinalIgnoreCase);

        var fetches = subnetsNeedingArm.Select(async s =>
        {
            var arm = await _resourceGraph.GetArmResourceAsync(s.Id, "2024-05-01", ct);
            if (arm is null) return;
            var armProps = arm["properties"] as JObject;
            if (armProps is null) return;

            if (byId.TryGetValue(s.Id, out var current))
            {
                var dict = new Dictionary<string, object>(current.Properties, StringComparer.OrdinalIgnoreCase);
                foreach (var prop in armProps.Properties())
                {
                    if (prop.Value is null || prop.Value.Type == JTokenType.Null) continue;
                    dict[prop.Name] = prop.Value;
                }
                if (armProps["addressPrefix"] is JValue { Type: JTokenType.String } apJv)
                {
                    var ap = apJv.Value<string>();
                    if (!string.IsNullOrWhiteSpace(ap)) dict["addressPrefix"] = ap;
                }
                if (armProps["addressPrefixes"] is JArray apArr && apArr.Count > 0)
                {
                    dict["addressPrefixes"] = apArr;
                }

                byId[s.Id] = new AzureResource
                {
                    Id = current.Id,
                    Name = current.Name,
                    Type = current.Type,
                    Location = current.Location,
                    ResourceGroup = current.ResourceGroup,
                    SubscriptionId = current.SubscriptionId,
                    Properties = dict,
                    Tags = current.Tags,
                };
            }
        }).ToArray();

        await Task.WhenAll(fetches);

        for (var i = 0; i < resources.Count; i++)
        {
            if (byId.TryGetValue(resources[i].Id, out var updated))
            {
                resources[i] = updated;
            }
        }
    }

    private static bool HasCidr(IDictionary<string, object> properties)
    {
        // Treat the subnet as having a real CIDR only when addressPrefix or
        // addressPrefixes actually contains a usable string. We previously had a
        // permissive regex-on-serialized-properties fallback here, but that
        // matched stray CIDR-shaped strings in service endpoints / NSG rules and
        // suppressed the ARM REST enrichment for subnets that really did need it.
        if (TryGetValueCaseInsensitive(properties, "addressPrefix", out var ap))
        {
            if (ap is string apStr && !string.IsNullOrWhiteSpace(apStr)) return true;
            if (ap is JValue { Type: JTokenType.String } apJv &&
                !string.IsNullOrWhiteSpace(apJv.Value<string>())) return true;
        }

        if (TryGetValueCaseInsensitive(properties, "addressPrefixes", out var apx) &&
            apx is JArray apxArr)
        {
            foreach (var item in apxArr)
            {
                if (item is JValue { Type: JTokenType.String } jv &&
                    !string.IsNullOrWhiteSpace(jv.Value<string>()))
                {
                    return true;
                }
            }
        }

        return false;
    }

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
                var dict = ResourceGraphService.NormalizeJTokenToNative(props) as Dictionary<string, object>
                    ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                // Flatten high-value fields so the frontend can display subnet details
                // without deep JSON parsing assumptions.
                var addressPrefix = (props["addressPrefix"] as JValue)?.Value<string>();
                if (!string.IsNullOrWhiteSpace(addressPrefix)) dict["addressPrefix"] = addressPrefix;

                if (props["addressPrefixes"] is JArray prefixes && prefixes.Count > 0)
                {
                    var clean = new List<object>();
                    foreach (var v in prefixes.OfType<JValue>()
                        .Where(v => v.Type == JTokenType.String && !string.IsNullOrWhiteSpace(v.Value<string>())))
                    {
                        clean.Add(v.Value<string>()!);
                    }
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
        "microsoft.network/azurefirewalls" => 3,
        "microsoft.network/privateendpoints" => 4,
        "microsoft.compute/virtualmachines" => 4,
        _ => 5,
    };

    internal static List<FlowEdge> BuildEdges(List<AzureResource> resources, List<AzureResource> networkInterfaces)
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
        var firewallIpIndex = BuildFirewallPrivateIpIndex(resources);

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
                    AddPrivateEndpointEdges(resource, byId, Emit);
                    break;
                case "microsoft.compute/virtualmachines":
                    AddVmEdges(resource, nicToSubnetIds, Emit);
                    break;
            }

            AddGenericReferenceEdges(resource, byId, Emit);
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
                // visually follow the full data path including VNet peering hops.
                // When nextHopType is VirtualAppliance and the IP matches a discovered
                // firewall, route the edge through the firewall's subnet → firewall.
                if (!string.IsNullOrWhiteSpace(nextHopIp) && firewallIpIndex.TryGetValue(nextHopIp, out var fwInfo))
                {
                    var fwId = fwInfo.FirewallId;
                    var fwSubnetId = fwInfo.SubnetId;

                    // RT → Firewall Subnet (shows traffic crosses via peering into the FW subnet)
                    if (!string.IsNullOrWhiteSpace(fwSubnetId))
                    {
                        Emit(new FlowEdge(
                            Id: $"defaultroute|{rt.Id}|{fwSubnetId}|{routeName}",
                            Source: rt.Id,
                            Target: fwSubnetId,
                            Label: $"0.0.0.0/0 → {nextHopIp} (via peering)",
                            Category: FlowEdgeCategory.DefaultRoute,
                            Metadata: new Dictionary<string, string>
                            {
                                ["addressPrefix"] = "0.0.0.0/0",
                                ["nextHopType"] = nextHopType,
                                ["nextHopIpAddress"] = nextHopIp,
                                ["routeName"] = routeName,
                            }));
                        // Firewall Subnet → Firewall
                        Emit(new FlowEdge(
                            Id: $"defaultroute|{fwSubnetId}|{fwId}|{routeName}",
                            Source: fwSubnetId,
                            Target: fwId,
                            Label: "next hop",
                            Category: FlowEdgeCategory.DefaultRoute,
                            Metadata: new Dictionary<string, string>
                            {
                                ["addressPrefix"] = "0.0.0.0/0",
                                ["nextHopType"] = nextHopType,
                                ["nextHopIpAddress"] = nextHopIp,
                            }));
                    }
                    else
                    {
                        // No subnet info — fall back to direct RT → FW edge
                        Emit(new FlowEdge(
                            Id: $"defaultroute|{rt.Id}|{fwId}|{routeName}",
                            Source: rt.Id,
                            Target: fwId,
                            Label: $"0.0.0.0/0 → {nextHopIp}",
                            Category: FlowEdgeCategory.DefaultRoute,
                            Metadata: new Dictionary<string, string>
                            {
                                ["addressPrefix"] = "0.0.0.0/0",
                                ["nextHopType"] = nextHopType,
                                ["nextHopIpAddress"] = nextHopIp,
                                ["routeName"] = routeName,
                            }));
                    }

                    // Firewall → Internet
                    Emit(new FlowEdge(
                        Id: $"defaultroute|{fwId}|{InternetNodeId}|{routeName}",
                        Source: fwId,
                        Target: InternetNodeId,
                        Label: "egress (Internet)",
                        Category: FlowEdgeCategory.DefaultRoute,
                        Metadata: new Dictionary<string, string>
                        {
                            ["addressPrefix"] = "0.0.0.0/0",
                            ["nextHopType"] = "Internet",
                            ["routeName"] = routeName,
                        }));
                }
                else
                {
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
        // Also handle native list shape (after NormalizeJTokenToNative)
        else if (TryGetValueCaseInsensitive(vnet.Properties, "subnets", out var sVal) && sVal is IList<object> nativeSubnets)
        {
            foreach (var item in nativeSubnets)
            {
                if (item is IDictionary<string, object> d &&
                    TryGetValueCaseInsensitive(d, "id", out var idObj) && idObj is string id &&
                    !string.IsNullOrEmpty(id))
                {
                    emit(new FlowEdge(
                        Id: $"contains|{vnet.Id}|{id}",
                        Source: vnet.Id,
                        Target: id,
                        Label: "contains",
                        Category: FlowEdgeCategory.Contains));
                }
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

    private static void AddPrivateEndpointEdges(
        AzureResource pe,
        IReadOnlyDictionary<string, AzureResource> resourcesById,
        Action<FlowEdge> emit)
    {
        var subnetId = TryGetReferenceId(pe.Properties, "subnet");
        if (!string.IsNullOrEmpty(subnetId))
        {
            emit(new FlowEdge(
                Id: $"pe|{pe.Id}|{subnetId}",
                Source: pe.Id,
                Target: subnetId,
                Label: "in subnet",
                Category: FlowEdgeCategory.AssociatedWith));
        }

        foreach (var connectionKey in new[] { "privateLinkServiceConnections", "manualPrivateLinkServiceConnections" })
        {
            if (!TryGetArrayCaseInsensitive(pe.Properties, connectionKey, out var connections)) continue;

            foreach (var connection in connections.OfType<JObject>())
            {
                var properties = connection["properties"] as JObject;
                var targetId = properties?["privateLinkServiceId"]?.Value<string>();
                if (string.IsNullOrWhiteSpace(targetId) || !targetId.StartsWith("/", StringComparison.Ordinal)) continue;
                if (!resourcesById.ContainsKey(targetId)) continue;

                var groupIds = properties?["groupIds"] is JArray groups
                    ? groups.Values<string>().Where(group => !string.IsNullOrWhiteSpace(group)).ToArray()
                    : [];
                var status = properties?["privateLinkServiceConnectionState"]?["status"]?.Value<string>();
                var label = groupIds.Length == 0 ? "private link" : $"private link ({string.Join(", ", groupIds)})";
                if (!string.IsNullOrWhiteSpace(status)) label += $" - {status}";

                emit(new FlowEdge(
                    Id: $"reference|{pe.Id}|{targetId}",
                    Source: pe.Id,
                    Target: targetId,
                    Label: label,
                    Category: FlowEdgeCategory.AssociatedWith,
                    Metadata: new Dictionary<string, string>
                    {
                        ["relationship"] = "privateLinkService",
                        ["groupIds"] = string.Join(",", groupIds),
                        ["status"] = status ?? string.Empty,
                    }));
            }
        }
    }

    private static void AddGenericReferenceEdges(
        AzureResource resource,
        IReadOnlyDictionary<string, AzureResource> resourcesById,
        Action<FlowEdge> emit)
    {
        foreach (var (targetId, path) in EnumerateArmResourceReferences(resource.Properties, "properties")
                     .DistinctBy(reference => reference.TargetId, StringComparer.OrdinalIgnoreCase))
        {
            if (string.Equals(resource.Id, targetId, StringComparison.OrdinalIgnoreCase)) continue;
            if (!resourcesById.ContainsKey(targetId)) continue;

            emit(new FlowEdge(
                Id: $"reference|{resource.Id}|{targetId}",
                Source: resource.Id,
                Target: targetId,
                Label: $"references ({path})",
                Category: FlowEdgeCategory.ConnectedTo,
                Metadata: new Dictionary<string, string>
                {
                    ["relationship"] = "armReference",
                    ["propertyPath"] = path,
                }));
        }
    }

    private static IEnumerable<(string TargetId, string Path)> EnumerateArmResourceReferences(
        object? value,
        string path)
    {
        switch (value)
        {
            case string text when IsArmResourceId(text):
                yield return (text.TrimEnd('/'), path);
                yield break;

            case JValue { Type: JTokenType.String } jValue when IsArmResourceId(jValue.Value<string>()):
                yield return (jValue.Value<string>()!.TrimEnd('/'), path);
                yield break;

            case JObject jObject:
                foreach (var property in jObject.Properties())
                {
                    foreach (var reference in EnumerateArmResourceReferences(property.Value, $"{path}.{property.Name}"))
                        yield return reference;
                }
                yield break;

            case IDictionary<string, object> dictionary:
                foreach (var (key, item) in dictionary)
                {
                    foreach (var reference in EnumerateArmResourceReferences(item, $"{path}.{key}"))
                        yield return reference;
                }
                yield break;

            case JArray jArray:
                for (var index = 0; index < jArray.Count; index++)
                {
                    foreach (var reference in EnumerateArmResourceReferences(jArray[index], $"{path}[{index}]"))
                        yield return reference;
                }
                yield break;

            case IEnumerable<object> items:
                var itemIndex = 0;
                foreach (var item in items)
                {
                    foreach (var reference in EnumerateArmResourceReferences(item, $"{path}[{itemIndex}]"))
                        yield return reference;
                    itemIndex++;
                }
                yield break;
        }
    }

    private static bool IsArmResourceId(string? value) =>
        !string.IsNullOrWhiteSpace(value)
        && (value.StartsWith("/subscriptions/", StringComparison.OrdinalIgnoreCase)
            || value.StartsWith("/providers/", StringComparison.OrdinalIgnoreCase));

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

    /// <summary>
    /// Builds a mapping from firewall private IP address → (firewall resource ID, firewall subnet ID).
    /// Azure Firewall exposes its private IP in properties.ipConfigurations[].properties.privateIPAddress
    /// and its subnet in properties.ipConfigurations[].properties.subnet.id.
    /// </summary>
    private static Dictionary<string, (string FirewallId, string? SubnetId)> BuildFirewallPrivateIpIndex(List<AzureResource> resources)
    {
        var index = new Dictionary<string, (string FirewallId, string? SubnetId)>(StringComparer.OrdinalIgnoreCase);

        foreach (var fw in resources.Where(r =>
                     string.Equals(r.Type, "Microsoft.Network/azureFirewalls", StringComparison.OrdinalIgnoreCase)))
        {
            if (!TryGetValueCaseInsensitive(fw.Properties, "ipConfigurations", out var ipCfgVal) || ipCfgVal is null)
                continue;

            IEnumerable<object>? items = null;
            if (ipCfgVal is JArray ja) items = ja;
            else if (ipCfgVal is IList<object> nativeList) items = nativeList;
            if (items is null) continue;

            foreach (var item in items)
            {
                string? ip = null;
                string? subnetId = null;
                if (item is JObject jo)
                {
                    var props = jo["properties"] as JObject;
                    ip = props?["privateIPAddress"]?.ToString();
                    subnetId = (props?["subnet"] as JObject)?["id"]?.ToString();
                }
                else if (item is IDictionary<string, object> d &&
                         TryGetValueCaseInsensitive(d, "properties", out var pVal) &&
                         pVal is IDictionary<string, object> pDict)
                {
                    if (TryGetValueCaseInsensitive(pDict, "privateIPAddress", out var ipVal))
                        ip = ipVal as string;
                    if (TryGetValueCaseInsensitive(pDict, "subnet", out var subObj) &&
                        subObj is IDictionary<string, object> subDict &&
                        TryGetValueCaseInsensitive(subDict, "id", out var subIdVal))
                        subnetId = subIdVal as string;
                }

                if (!string.IsNullOrWhiteSpace(ip))
                    index[ip!] = (fw.Id, subnetId);
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
        else if (value is Dictionary<string, object> nativeDict)
        {
            if (TryGetValueCaseInsensitive(nativeDict, "id", out var nId) && nId is string nIdStr
                && !string.IsNullOrWhiteSpace(nIdStr) && nIdStr.StartsWith("/", StringComparison.Ordinal))
                return nIdStr;
            return null;
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

        // Also handle native Dictionary items (from NormalizeJTokenToNative).
        if (ids.Count == 0 && TryGetValueCaseInsensitive(dict, key, out var rawVal) && rawVal is IList<object> nativeList)
        {
            foreach (var item in nativeList)
            {
                if (item is IDictionary<string, object> d &&
                    TryGetValueCaseInsensitive(d, "id", out var idObj) &&
                    idObj is string idStr &&
                    !string.IsNullOrWhiteSpace(idStr) && idStr.StartsWith("/", StringComparison.Ordinal))
                {
                    ids.Add(idStr);
                }
                else if (item is string s && !string.IsNullOrWhiteSpace(s) && s.StartsWith("/", StringComparison.Ordinal))
                {
                    ids.Add(s);
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
