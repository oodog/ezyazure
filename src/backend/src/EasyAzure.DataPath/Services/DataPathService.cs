using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.DataPath.Services;

/// <summary>
/// Traces the network data path between two Azure resources.
/// Evaluates NSG rules, route tables, VNet peering, private endpoints, firewalls.
///
/// Example question: "Can VM-A talk to SQL private endpoint on port 1433?"
/// </summary>
public class DataPathService : IDataPathService
{
    private readonly NsgEvaluator _nsgEvaluator;
    private readonly RouteEvaluator _routeEvaluator;
    private readonly PeeringEvaluator _peeringEvaluator;
    private readonly ILogger<DataPathService> _logger;

    public DataPathService(
        NsgEvaluator nsgEvaluator,
        RouteEvaluator routeEvaluator,
        PeeringEvaluator peeringEvaluator,
        ILogger<DataPathService> logger)
    {
        _nsgEvaluator = nsgEvaluator;
        _routeEvaluator = routeEvaluator;
        _peeringEvaluator = peeringEvaluator;
        _logger = logger;
    }

    public async Task<DataPathResult> AnalyzeAsync(DataPathRequest request, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Analyzing data path: {Source} -> {Destination} {Protocol}/{Port}",
            request.SourceResourceId, request.DestinationResourceId,
            request.Protocol, request.DestinationPort);

        var hops = new List<PathHop>();
        var riskNotes = new List<string>();
        var status = PathStatus.Unknown;
        string? blockingRule = null;

        // 1. Resolve source NIC/subnet
        var sourceHop = await ResolveResourceHopAsync(request.SourceResourceId, ct);
        hops.Add(sourceHop);

        // 2. Evaluate source NSG outbound rules
        var outboundNsgResult = await _nsgEvaluator.EvaluateOutboundAsync(
            request.SourceResourceId, request.Protocol, request.DestinationPort, ct);

        if (outboundNsgResult.Hop is not null) hops.Add(outboundNsgResult.Hop);
        if (outboundNsgResult.RiskNotes.Count > 0) riskNotes.AddRange(outboundNsgResult.RiskNotes);
        if (!outboundNsgResult.IsAllowed)
        {
            return new DataPathResult
            {
                Status = PathStatus.Blocked,
                BlockingRule = outboundNsgResult.MatchedRule,
                Hops = hops,
                RiskNotes = riskNotes,
            };
        }

        // 3. Evaluate route table / UDR
        var routeResult = await _routeEvaluator.EvaluateAsync(
            request.SourceResourceId, request.DestinationResourceId, ct);

        if (routeResult.Hop is not null) hops.Add(routeResult.Hop);
        if (routeResult.RiskNotes.Count > 0) riskNotes.AddRange(routeResult.RiskNotes);

        // 4. Check VNet peering path
        var peeringResult = await _peeringEvaluator.EvaluateAsync(
            request.SourceResourceId, request.DestinationResourceId, ct);

        if (peeringResult.Hops.Count > 0) hops.AddRange(peeringResult.Hops);
        if (peeringResult.RiskNotes.Count > 0) riskNotes.AddRange(peeringResult.RiskNotes);

        // 5. Evaluate destination NSG inbound rules
        var inboundNsgResult = await _nsgEvaluator.EvaluateInboundAsync(
            request.DestinationResourceId, request.Protocol, request.DestinationPort, ct);

        if (inboundNsgResult.Hop is not null) hops.Add(inboundNsgResult.Hop);
        if (inboundNsgResult.RiskNotes.Count > 0) riskNotes.AddRange(inboundNsgResult.RiskNotes);

        if (!inboundNsgResult.IsAllowed)
        {
            return new DataPathResult
            {
                Status = PathStatus.Blocked,
                BlockingRule = inboundNsgResult.MatchedRule,
                Hops = hops,
                RiskNotes = riskNotes,
            };
        }

        // 6. Resolve destination resource
        var destinationHop = await ResolveResourceHopAsync(request.DestinationResourceId, ct);
        hops.Add(destinationHop);

        // Add risk notes for common patterns
        if (request.DestinationPort == 22 || request.DestinationPort == 3389)
        {
            riskNotes.Add("Direct management port access detected. Consider using Azure Bastion or JIT access instead.");
        }

        status = PathStatus.Allowed;

        return new DataPathResult
        {
            Status = status,
            BlockingRule = blockingRule,
            Hops = hops,
            RiskNotes = riskNotes,
        };
    }

    private static Task<PathHop> ResolveResourceHopAsync(string resourceId, CancellationToken ct)
    {
        // Parse name from the ARM resource ID
        var parts = resourceId.TrimEnd('/').Split('/');
        var name = parts.Length > 0 ? parts[^1] : resourceId;
        var type = parts.Length >= 8 ? $"{parts[^4]}/{parts[^3]}" : "Unknown";

        return Task.FromResult(new PathHop
        {
            ResourceId = resourceId,
            ResourceName = name,
            ResourceType = type,
        });
    }

    // ───────────────────────────── Graph-based trace ─────────────────────────────

    private const string InternetNodeId = "easyazure://internet";
    private const string SubnetType = "microsoft.network/virtualnetworks/subnets";
    private const string NsgType = "microsoft.network/networksecuritygroups";

    /// <summary>
    /// Traces a path through the already-built topology graph. Resolves the destination
    /// (resource ID or IP) to a node, runs a shortest-path search over the network edges,
    /// evaluates any NSGs encountered, and returns ordered hops + node IDs for map highlighting.
    /// </summary>
    public Task<DataPathResult> TraceOnGraphAsync(TopologyGraph graph, DataPathGraphRequest request, CancellationToken ct = default)
    {
        var nodes = graph.Nodes ?? [];
        var edges = graph.Edges ?? [];
        var nodeById = new Dictionary<string, FlowNode>(StringComparer.OrdinalIgnoreCase);
        foreach (var n in nodes) nodeById[n.Id] = n;

        var riskNotes = new List<string>();
        var bestPractice = new List<string>();

        // ── Resolve source ────────────────────────────────────────────────
        if (!nodeById.TryGetValue(request.SourceResourceId, out var sourceNode))
        {
            return Task.FromResult(new DataPathResult
            {
                Status = PathStatus.Unknown,
                RiskNotes = ["Source resource was not found in the discovered topology. Re-run discovery and try again."],
            });
        }

        // ── Resolve destination to a node ─────────────────────────────────
        var (destNodeId, destSummary) = ResolveDestination(request.Destination, nodes, nodeById);
        if (destNodeId is null)
        {
            return Task.FromResult(new DataPathResult
            {
                Status = PathStatus.Unknown,
                DestinationSummary = destSummary,
                RiskNotes = [$"Destination '{request.Destination}' could not be resolved to a subnet, resource, or the Internet."],
            });
        }

        // ── Shortest path over network edges (treated as undirected) ──────
        var adjacency = BuildAdjacency(edges);
        var path = ShortestPath(request.SourceResourceId, destNodeId, adjacency);

        if (path is null || path.Count == 0)
        {
            return Task.FromResult(new DataPathResult
            {
                Status = PathStatus.Unknown,
                DestinationSummary = destSummary,
                RiskNotes =
                [
                    "No connected path was found on the topology map between the source and destination. " +
                    "There may be no peering/route linking them, or the relevant resources were not discovered.",
                ],
            });
        }

        // ── Build hops + evaluate NSGs along the way ──────────────────────
        var hops = new List<PathHop>();
        var status = PathStatus.Allowed;
        string? blockingRule = null;

        foreach (var nodeId in path)
        {
            if (nodeId == InternetNodeId)
            {
                hops.Add(new PathHop
                {
                    ResourceId = InternetNodeId,
                    ResourceName = "Internet",
                    ResourceType = "Internet",
                    Detail = "Public egress / ingress boundary",
                });
                continue;
            }

            if (!nodeById.TryGetValue(nodeId, out var node)) continue;
            var res = node.Data;
            var typeLower = res.Type.ToLowerInvariant();

            string? detail = null;
            string? matchedRule = null;

            if (typeLower == NsgType)
            {
                var (allowed, rule) = EvaluateNsg(res, request.Protocol, request.DestinationPort);
                matchedRule = rule;
                detail = allowed
                    ? $"Allowed {request.Protocol}/{request.DestinationPort}"
                    : $"Blocks {request.Protocol}/{request.DestinationPort}";
                if (!allowed && status != PathStatus.Blocked)
                {
                    status = PathStatus.Blocked;
                    blockingRule = $"{res.Name}: {rule}";
                }
            }
            else if (typeLower == SubnetType)
            {
                var prefixes = string.Join(", ", GetSubnetAddressPrefixes(res));
                detail = string.IsNullOrWhiteSpace(prefixes) ? null : prefixes;
            }
            else if (typeLower == "microsoft.network/azurefirewalls")
            {
                detail = "Traffic inspected by Azure Firewall";
            }

            hops.Add(new PathHop
            {
                ResourceId = res.Id,
                ResourceName = res.Name,
                ResourceType = res.Type,
                Detail = detail,
                MatchedRule = matchedRule,
            });
        }

        // ── Risk + best-practice notes ────────────────────────────────────
        if (request.DestinationPort is 22 or 3389)
        {
            riskNotes.Add("Direct management port (SSH/RDP) access detected. Consider Azure Bastion or just-in-time (JIT) access instead.");
        }

        var traversesFirewall = path.Any(id =>
            nodeById.TryGetValue(id, out var n) &&
            n.Data.Type.Equals("Microsoft.Network/azureFirewalls", StringComparison.OrdinalIgnoreCase));
        if (destNodeId == InternetNodeId && !traversesFirewall)
        {
            riskNotes.Add("Egress to the Internet does not appear to traverse an Azure Firewall or NVA. Outbound traffic is not centrally inspected.");
        }
        if (traversesFirewall)
        {
            bestPractice.Add("Path traverses an Azure Firewall — confirm a symmetric return route exists so the stateful firewall sees both directions of the flow.");
        }

        return Task.FromResult(new DataPathResult
        {
            Status = status,
            BlockingRule = blockingRule,
            Hops = hops,
            RiskNotes = riskNotes,
            BestPracticeNotes = bestPractice,
            PathNodeIds = path,
            DestinationSummary = destSummary,
        });
    }

    /// <summary>Resolves a destination string (resource ID or IP) to a topology node ID.</summary>
    private static (string? NodeId, string Summary) ResolveDestination(
        string destination,
        IReadOnlyList<FlowNode> nodes,
        IReadOnlyDictionary<string, FlowNode> nodeById)
    {
        if (string.IsNullOrWhiteSpace(destination))
            return (null, "empty destination");

        var dest = destination.Trim();

        // Exact resource-ID match.
        if (nodeById.TryGetValue(dest, out var exact))
        {
            // If the destination is a subnet, target it directly; otherwise find its subnet.
            if (exact.Data.Type.Equals(SubnetType, StringComparison.OrdinalIgnoreCase))
                return (exact.Id, $"subnet {exact.Data.Name}");
            return (exact.Id, $"{exact.Data.Name} ({exact.Data.Type})");
        }

        // Raw IPv4 address — find the subnet whose prefix contains it.
        if (TryParseIp(dest, out var ip))
        {
            FlowNode? best = null;
            uint bestMask = 0;
            foreach (var n in nodes)
            {
                if (!n.Data.Type.Equals(SubnetType, StringComparison.OrdinalIgnoreCase)) continue;
                foreach (var prefix in GetSubnetAddressPrefixes(n.Data))
                {
                    if (!TryParseCidr(prefix, out var baseAddr, out var mask)) continue;
                    if ((ip & mask) == baseAddr && mask >= bestMask)
                    {
                        best = n;
                        bestMask = mask;
                    }
                }
            }
            if (best is not null)
                return (best.Id, $"IP {dest} resolves to subnet {best.Data.Name}");

            // Not in any discovered subnet → treat as Internet egress, if present.
            if (nodeById.ContainsKey(InternetNodeId))
                return (InternetNodeId, $"IP {dest} is outside all discovered subnets (Internet egress)");
            return (null, $"IP {dest} is not within any discovered subnet");
        }

        return (null, $"'{dest}' is neither a discovered resource ID nor a valid IPv4 address");
    }

    private static Dictionary<string, List<string>> BuildAdjacency(IReadOnlyList<FlowEdge> edges)
    {
        // Network-relevant categories that represent real traffic paths.
        var allowed = new HashSet<string?>(StringComparer.OrdinalIgnoreCase)
        {
            FlowEdgeCategory.AssociatedWith,
            FlowEdgeCategory.Route,
            FlowEdgeCategory.DefaultRoute,
            FlowEdgeCategory.Peering,
            FlowEdgeCategory.Contains,
        };

        var adj = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        void Link(string a, string b)
        {
            if (!adj.TryGetValue(a, out var list)) { list = []; adj[a] = list; }
            if (!list.Contains(b, StringComparer.OrdinalIgnoreCase)) list.Add(b);
        }

        foreach (var e in edges)
        {
            if (!allowed.Contains(e.Category)) continue;
            // Undirected — traffic can be traced in either direction across these links.
            Link(e.Source, e.Target);
            Link(e.Target, e.Source);
        }
        return adj;
    }

    private static List<string>? ShortestPath(string start, string goal, Dictionary<string, List<string>> adj)
    {
        if (string.Equals(start, goal, StringComparison.OrdinalIgnoreCase))
            return [start];

        var queue = new Queue<string>();
        var cameFrom = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { start };
        queue.Enqueue(start);

        while (queue.Count > 0)
        {
            var current = queue.Dequeue();
            if (!adj.TryGetValue(current, out var neighbors)) continue;
            foreach (var next in neighbors)
            {
                if (!visited.Add(next)) continue;
                cameFrom[next] = current;
                if (string.Equals(next, goal, StringComparison.OrdinalIgnoreCase))
                {
                    // Reconstruct.
                    var path = new List<string> { next };
                    var cur = next;
                    while (cameFrom.TryGetValue(cur, out var prev))
                    {
                        path.Add(prev);
                        cur = prev;
                    }
                    path.Reverse();
                    return path;
                }
                queue.Enqueue(next);
            }
        }
        return null;
    }

    /// <summary>
    /// Best-effort NSG evaluation: walks securityRules ordered by priority and returns whether
    /// the given protocol/destination port is allowed, plus the matched rule name.
    /// </summary>
    private static (bool Allowed, string? Rule) EvaluateNsg(AzureResource nsg, string protocol, int port)
    {
        if (nsg.Properties is null) return (true, null);
        if (!nsg.Properties.TryGetValue("securityRules", out var raw) || raw is not IEnumerable<object> rules)
            return (true, null);

        var ordered = new List<(int Priority, string Name, bool Allow, string Direction, string Proto, string PortRange)>();
        foreach (var item in rules)
        {
            if (item is not IDictionary<string, object> rule) continue;
            var name = rule.TryGetValue("name", out var n) ? n?.ToString() ?? string.Empty : string.Empty;
            if (!rule.TryGetValue("properties", out var p) || p is not IDictionary<string, object> props) continue;
            var direction = props.TryGetValue("direction", out var d) ? d?.ToString() ?? string.Empty : string.Empty;
            if (!direction.Equals("Inbound", StringComparison.OrdinalIgnoreCase)) continue; // evaluate inbound exposure
            var access = props.TryGetValue("access", out var a) ? a?.ToString() ?? string.Empty : string.Empty;
            var proto = props.TryGetValue("protocol", out var pr) ? pr?.ToString() ?? "*" : "*";
            var portRange = props.TryGetValue("destinationPortRange", out var dp) ? dp?.ToString() ?? "*" : "*";
            var priority = props.TryGetValue("priority", out var pri) && int.TryParse(pri?.ToString(), out var pv) ? pv : int.MaxValue;
            ordered.Add((priority, name, access.Equals("Allow", StringComparison.OrdinalIgnoreCase), direction, proto, portRange));
        }

        foreach (var rule in ordered.OrderBy(r => r.Priority))
        {
            var protoMatch = rule.Proto == "*" || rule.Proto.Equals(protocol, StringComparison.OrdinalIgnoreCase);
            var portMatch = PortRangeMatches(rule.PortRange, port);
            if (protoMatch && portMatch)
                return (rule.Allow, rule.Name);
        }
        return (true, null); // no explicit match → default allow within VNet
    }

    private static bool PortRangeMatches(string range, int port)
    {
        if (string.IsNullOrWhiteSpace(range) || range == "*") return true;
        foreach (var part in range.Split(','))
        {
            var p = part.Trim();
            if (p.Contains('-'))
            {
                var bounds = p.Split('-');
                if (bounds.Length == 2 && int.TryParse(bounds[0], out var lo) && int.TryParse(bounds[1], out var hi)
                    && port >= lo && port <= hi)
                    return true;
            }
            else if (int.TryParse(p, out var single) && single == port)
            {
                return true;
            }
        }
        return false;
    }

    private static IEnumerable<string> GetSubnetAddressPrefixes(AzureResource subnet)
    {
        if (subnet.Properties is null) yield break;
        if (subnet.Properties.TryGetValue("addressPrefix", out var single) && single is string s && !string.IsNullOrWhiteSpace(s))
            yield return s;
        if (subnet.Properties.TryGetValue("addressPrefixes", out var raw) && raw is IEnumerable<object> list)
        {
            foreach (var p in list)
            {
                var ps = p?.ToString();
                if (!string.IsNullOrWhiteSpace(ps)) yield return ps;
            }
        }
    }

    private static bool TryParseIp(string ip, out uint addr)
    {
        addr = 0;
        if (string.IsNullOrWhiteSpace(ip)) return false;
        var octets = ip.Trim().Split('.');
        if (octets.Length != 4) return false;
        foreach (var oct in octets)
        {
            if (!byte.TryParse(oct, out var b)) return false;
            addr = (addr << 8) | b;
        }
        return true;
    }

    private static bool TryParseCidr(string cidr, out uint baseAddr, out uint mask)
    {
        baseAddr = 0;
        mask = 0;
        if (string.IsNullOrWhiteSpace(cidr)) return false;
        var slash = cidr.IndexOf('/');
        if (slash < 0) return false;
        if (!TryParseIp(cidr[..slash], out var addr)) return false;
        if (!int.TryParse(cidr[(slash + 1)..], out var prefixLen) || prefixLen < 0 || prefixLen > 32) return false;
        mask = prefixLen == 0 ? 0u : 0xFFFFFFFFu << (32 - prefixLen);
        baseAddr = addr & mask;
        return true;
    }
}
