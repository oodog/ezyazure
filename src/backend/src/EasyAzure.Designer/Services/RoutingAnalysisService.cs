extern alias AzureIdentity;

using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace EasyAzure.Designer.Services;

/// <summary>
/// Detects routing issues — primarily asymmetric routing — by inspecting a discovered
/// topology graph. Deterministic rules run first; when Azure OpenAI is configured and
/// requested, each finding is enriched with AI-recommended remediation steps that cite
/// Microsoft Learn documentation only.
///
/// Asymmetric routing in Azure typically occurs when:
///   • Two peered VNets have mismatched forced-tunnel posture — one side sends 0.0.0.0/0
///     through a firewall/NVA while the peer routes directly. The firewall sees only one
///     direction of the flow and drops the asymmetric return traffic.
///   • A UDR points 0.0.0.0/0 at a virtual appliance, but the appliance's subnet (or peer)
///     lacks a symmetric return route to the originating subnet.
/// </summary>
public class RoutingAnalysisService : IRoutingAnalysisService
{
    private readonly ILogger<RoutingAnalysisService> _logger;
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory? _httpClientFactory;

    private const string SubnetType = "microsoft.network/virtualnetworks/subnets";
    private const string VNetType = "microsoft.network/virtualnetworks";
    private const string FirewallType = "microsoft.network/azurefirewalls";
    private const string RouteTableType = "microsoft.network/routetables";

    private const string LearnUdr = "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview";
    private const string LearnAsymmetric = "https://learn.microsoft.com/azure/firewall/firewall-known-issues";
    private const string LearnForcedTunnel = "https://learn.microsoft.com/azure/firewall/forced-tunneling";

    public RoutingAnalysisService(
        ILogger<RoutingAnalysisService> logger,
        IConfiguration config,
        IHttpClientFactory? httpClientFactory = null)
    {
        _logger = logger;
        _config = config;
        _httpClientFactory = httpClientFactory;
    }

    public async Task<RoutingAnalysisReport> AnalyzeAsync(TopologyGraph graph, bool useAi, CancellationToken ct = default)
    {
        var nodes = graph.Nodes ?? [];
        var edges = graph.Edges ?? [];
        var nodeById = nodes
            .GroupBy(n => n.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);

        var subnets = nodes.Where(n => TypeIs(n, SubnetType)).ToList();
        var findings = new List<RoutingFinding>();

        // ── Build indices ──

        // Subnet → owning VNet (parse from the subnet resource id).
        string? VNetOf(string subnetId)
        {
            var idx = subnetId.IndexOf("/subnets/", StringComparison.OrdinalIgnoreCase);
            return idx > 0 ? subnetId[..idx] : null;
        }

        string NameOf(string id) => nodeById.TryGetValue(id, out var n) ? n.Data?.Name ?? ShortName(id) : ShortName(id);

        // Default-route posture per subnet from default-route edges that originate at a subnet.
        // forced = next hop is a virtual appliance / firewall (explicit UDR 0.0.0.0/0 → appliance IP).
        var forcedTunnelSubnets = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var subnetNextHopIp = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in edges)
        {
            if (!string.Equals(e.Category, FlowEdgeCategory.DefaultRoute, StringComparison.OrdinalIgnoreCase)) continue;
            if (!TypeIs(nodeById.GetValueOrDefault(e.Source), SubnetType)) continue;
            var meta = e.Metadata;
            var nextHopType = meta != null && meta.TryGetValue("nextHopType", out var t) ? t : string.Empty;
            var nextHopIp = meta != null && meta.TryGetValue("nextHopIpAddress", out var ip) ? ip : string.Empty;
            if (string.Equals(nextHopType, "VirtualAppliance", StringComparison.OrdinalIgnoreCase)
                || !string.IsNullOrWhiteSpace(nextHopIp))
            {
                forcedTunnelSubnets.Add(e.Source);
                if (!string.IsNullOrWhiteSpace(nextHopIp)) subnetNextHopIp[e.Source] = nextHopIp;
            }
        }

        // Robust fallback: inspect route tables directly from node data. The synthesised
        // default-route edges depend on ARM enrichment + firewall-IP matching succeeding;
        // reading the route table resources guarantees we still see forced-tunnel routes
        // (0.0.0.0/0 → VirtualAppliance/IP) even when edge synthesis was incomplete.
        var subnetToRouteTable = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in subnets)
        {
            var rtId = GetSubnetRouteTableId(s.Data);
            if (!string.IsNullOrWhiteSpace(rtId)) subnetToRouteTable[s.Id] = rtId!;
        }

        var routeTableToSubnets = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var (subnetId, rtId) in subnetToRouteTable)
        {
            (routeTableToSubnets.TryGetValue(rtId, out var l) ? l : routeTableToSubnets[rtId] = []).Add(subnetId);
        }
        foreach (var rtNode in nodes.Where(n => TypeIs(n, RouteTableType)))
        {
            foreach (var subnetId in GetRouteTableSubnetRefs(rtNode.Data))
            {
                if (!subnetToRouteTable.ContainsKey(subnetId)) subnetToRouteTable[subnetId] = rtNode.Id;
                var list = routeTableToSubnets.TryGetValue(rtNode.Id, out var l) ? l : routeTableToSubnets[rtNode.Id] = [];
                if (!list.Contains(subnetId, StringComparer.OrdinalIgnoreCase)) list.Add(subnetId);
            }
        }

        foreach (var rtNode in nodes.Where(n => TypeIs(n, RouteTableType)))
        {
            var associated = routeTableToSubnets.GetValueOrDefault(rtNode.Id, []);
            if (associated.Count == 0) continue;
            foreach (var (prefix, nextHopType, nextHopIp, _) in ParseRoutes(rtNode.Data))
            {
                if (!string.Equals(prefix, "0.0.0.0/0", StringComparison.Ordinal)) continue;
                var forces = string.Equals(nextHopType, "VirtualAppliance", StringComparison.OrdinalIgnoreCase)
                    || !string.IsNullOrWhiteSpace(nextHopIp);
                if (!forces) continue;
                foreach (var subnetId in associated)
                {
                    forcedTunnelSubnets.Add(subnetId);
                    if (!string.IsNullOrWhiteSpace(nextHopIp)) subnetNextHopIp[subnetId] = nextHopIp;
                }
            }
        }

        // Per-VNet forced-tunnel posture.
        var vnetForcesTunnel = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        var vnetForcedSubnets = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        var vnetDirectSubnets = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in subnets)
        {
            var vnet = VNetOf(s.Id);
            if (vnet is null) continue;
            var forced = forcedTunnelSubnets.Contains(s.Id);
            if (forced)
            {
                vnetForcesTunnel[vnet] = true;
                (vnetForcedSubnets.TryGetValue(vnet, out var fl) ? fl : vnetForcedSubnets[vnet] = []).Add(s.Id);
            }
            else
            {
                (vnetDirectSubnets.TryGetValue(vnet, out var dl) ? dl : vnetDirectSubnets[vnet] = []).Add(s.Id);
                vnetForcesTunnel.TryAdd(vnet, false);
            }
        }

        // Peering adjacency (VNet ↔ VNet).
        var peerings = new List<(string A, string B)>();
        var seenPeer = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in edges)
        {
            if (!string.Equals(e.Category, FlowEdgeCategory.Peering, StringComparison.OrdinalIgnoreCase)) continue;
            var key = string.CompareOrdinal(e.Source, e.Target) < 0 ? $"{e.Source}|{e.Target}" : $"{e.Target}|{e.Source}";
            if (seenPeer.Add(key)) peerings.Add((e.Source, e.Target));
        }

        // Firewall private IPs discovered in the graph (to verify NVA next hops).
        var firewallIps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var fw in nodes.Where(n => TypeIs(n, FirewallType)))
        {
            foreach (var ip in ExtractPrivateIps(fw.Data))
            {
                firewallIps.Add(ip);
            }
        }

        // ── Broadened indices for specific-prefix UDR asymmetry ──
        // Address space per VNet and per subnet (used for CIDR-overlap reasoning).
        var vnetPrefixes = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var v in nodes.Where(n => TypeIs(n, VNetType)))
        {
            var prefixes = GetVNetAddressPrefixes(v.Data).ToList();
            if (prefixes.Count > 0) vnetPrefixes[v.Id] = prefixes;
        }
        var subnetPrefixes = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var s in subnets)
        {
            var prefixes = GetSubnetAddressPrefixes(s.Data).ToList();
            if (prefixes.Count > 0) subnetPrefixes[s.Id] = prefixes;
        }

        // All NVA/appliance routes (ANY destination prefix, not just 0.0.0.0/0) per subnet,
        // derived from each subnet's associated route table. This is what catches the
        // "I added a route to steer specific traffic through the firewall" asymmetry case.
        var nvaRoutesBySubnet = new Dictionary<string, List<(string Prefix, string Ip, string Name)>>(StringComparer.OrdinalIgnoreCase);
        var allNvaNextHopIps = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var rtNodeById = nodes.Where(n => TypeIs(n, RouteTableType))
            .GroupBy(n => n.Id, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(g => g.Key, g => g.First(), StringComparer.OrdinalIgnoreCase);
        foreach (var (subnetId, rtId) in subnetToRouteTable)
        {
            if (!rtNodeById.TryGetValue(rtId, out var rtNode)) continue;
            foreach (var (prefix, nextHopType, nextHopIp, name) in ParseRoutes(rtNode.Data))
            {
                var isNva = string.Equals(nextHopType, "VirtualAppliance", StringComparison.OrdinalIgnoreCase)
                    || !string.IsNullOrWhiteSpace(nextHopIp);
                if (!isNva) continue;
                (nvaRoutesBySubnet.TryGetValue(subnetId, out var l) ? l : nvaRoutesBySubnet[subnetId] = [])
                    .Add((prefix, nextHopIp, name));
                if (!string.IsNullOrWhiteSpace(nextHopIp)) allNvaNextHopIps.Add(nextHopIp);
            }
        }

        // Does any subnet in `vnet` steer traffic destined for `targetPrefixes` through an NVA?
        // Returns the (subnetId, nextHopIp) of the first such route, or null.
        (string SubnetId, string Ip)? VNetSteersToNvaFor(string vnet, IReadOnlyList<string> targetPrefixes)
        {
            foreach (var s in subnets)
            {
                if (!string.Equals(VNetOf(s.Id), vnet, StringComparison.OrdinalIgnoreCase)) continue;
                if (!nvaRoutesBySubnet.TryGetValue(s.Id, out var routes)) continue;
                foreach (var (prefix, ip, _) in routes)
                {
                    // 0.0.0.0/0 covers everything; otherwise require CIDR overlap with the target.
                    if (string.Equals(prefix, "0.0.0.0/0", StringComparison.Ordinal)
                        || targetPrefixes.Any(tp => CidrOverlaps(prefix, tp)))
                    {
                        return (s.Id, ip);
                    }
                }
            }
            return null;
        }

        // ── RULE RT-ASYM-001: Asymmetric routing across VNet peering ──
        // Peered VNets where one side forces tunneling through an NVA/firewall and the other
        // routes directly. Inter-VNet traffic is asymmetric: forward via firewall, return direct.
        foreach (var (a, b) in peerings)
        {
            var aForces = vnetForcesTunnel.GetValueOrDefault(a, false);
            var bForces = vnetForcesTunnel.GetValueOrDefault(b, false);
            if (aForces == bForces) continue; // symmetric posture — no asymmetry from this rule

            var forcedVnet = aForces ? a : b;
            var directVnet = aForces ? b : a;
            var affected = new List<string> { forcedVnet, directVnet };
            affected.AddRange(vnetForcedSubnets.GetValueOrDefault(forcedVnet, []));
            affected.AddRange(vnetDirectSubnets.GetValueOrDefault(directVnet, []));

            findings.Add(new RoutingFinding
            {
                Severity = "warning",
                RuleId = "RT-ASYM-001",
                Title = "Asymmetric routing risk across VNet peering",
                Message =
                    $"VNet \"{NameOf(forcedVnet)}\" forces traffic through a network virtual appliance " +
                    $"(0.0.0.0/0 → appliance), but its peer \"{NameOf(directVnet)}\" routes directly. " +
                    "Traffic between these VNets can take the firewall on the forward path and bypass it on the " +
                    "return path, so the firewall sees only one direction of the flow and drops it.",
                AffectedNodeIds = affected.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
                Recommendation =
                    $"Apply a matching user-defined route on the subnets in \"{NameOf(directVnet)}\" so that return " +
                    $"traffic to \"{NameOf(forcedVnet)}\" address ranges uses the same appliance as the next hop. " +
                    "Both directions of a flow must traverse the same stateful device.",
                Reference = LearnAsymmetric,
                Source = "rule",
            });
        }

        // ── RULE RT-ASYM-002: Forced tunnel to an unverified next hop appliance ──
        // A subnet routes 0.0.0.0/0 to a virtual-appliance IP that does not match any
        // discovered Azure Firewall. The return path cannot be verified.
        foreach (var (subnetId, ip) in subnetNextHopIp)
        {
            if (firewallIps.Contains(ip)) continue; // matched a known firewall — covered elsewhere
            findings.Add(new RoutingFinding
            {
                Severity = "info",
                RuleId = "RT-ASYM-002",
                Title = "Forced tunnel to an unverified appliance",
                Message =
                    $"Subnet \"{NameOf(subnetId)}\" sends 0.0.0.0/0 to next hop {ip}, which is not a discovered " +
                    "Azure Firewall. If this appliance does not have a symmetric return route to this subnet, " +
                    "flows through it will be asymmetric.",
                AffectedNodeIds = [subnetId],
                Recommendation =
                    $"Confirm the appliance at {ip} has a route back to this subnet's address range, and that the " +
                    "appliance subnet's route table sends return traffic via the same device. Ensure the NVA performs " +
                    "stateful inspection symmetrically.",
                Reference = LearnUdr,
                Source = "rule",
            });
        }

        // ── RULE RT-ASYM-003: Mixed egress within a single VNet ──
        // Some subnets in the same VNet force-tunnel egress while others go direct. East-west or
        // shared-service flows between these subnets can be asymmetric.
        foreach (var vnet in vnetForcesTunnel.Keys)
        {
            var forced = vnetForcedSubnets.GetValueOrDefault(vnet, []);
            var direct = vnetDirectSubnets.GetValueOrDefault(vnet, []);
            if (forced.Count == 0 || direct.Count == 0) continue;
            var affected = new List<string> { vnet };
            affected.AddRange(forced);
            affected.AddRange(direct);
            findings.Add(new RoutingFinding
            {
                Severity = "info",
                RuleId = "RT-ASYM-003",
                Title = "Mixed egress posture within a VNet",
                Message =
                    $"VNet \"{NameOf(vnet)}\" has {forced.Count} subnet(s) forcing egress through an appliance and " +
                    $"{direct.Count} subnet(s) routing directly. Flows between these subnets may be asymmetric if they " +
                    "transit a stateful appliance in only one direction.",
                AffectedNodeIds = affected.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
                Recommendation =
                    "Standardise the egress posture across subnets that communicate with each other, or add explicit " +
                    "UDRs so both directions of inter-subnet flows traverse the same appliance.",
                Reference = LearnUdr,
                Source = "rule",
            });
        }

        // ── RULE RT-ASYM-004: One-way UDR steering across a peering (specific-prefix asymmetry) ──
        // This is the classic "I added a route on one side only" mistake: VNet A has a UDR that
        // sends traffic destined for VNet B through a firewall/NVA, but VNet B has no matching
        // route to send the return traffic for VNet A back through the same appliance. The
        // appliance is stateful, so it sees the forward packets, the asymmetric return bypasses
        // it, and the flow is dropped. Works for any destination prefix, not just 0.0.0.0/0.
        foreach (var (a, b) in peerings)
        {
            var aPrefixes = vnetPrefixes.GetValueOrDefault(a, []);
            var bPrefixes = vnetPrefixes.GetValueOrDefault(b, []);

            var aSteersForB = bPrefixes.Count > 0 ? VNetSteersToNvaFor(a, bPrefixes) : null;
            var bSteersForA = aPrefixes.Count > 0 ? VNetSteersToNvaFor(b, aPrefixes) : null;

            // Asymmetric when exactly one side steers the cross-VNet traffic through an NVA.
            if ((aSteersForB is not null) == (bSteersForA is not null)) continue;

            var steeringVnet = aSteersForB is not null ? a : b;
            var otherVnet = aSteersForB is not null ? b : a;
            var steer = (aSteersForB ?? bSteersForA)!.Value;
            var affected = new List<string> { steeringVnet, otherVnet, steer.SubnetId };

            findings.Add(new RoutingFinding
            {
                Severity = "warning",
                RuleId = "RT-ASYM-004",
                Title = "One-way route steering across VNet peering",
                Message =
                    $"VNet \"{NameOf(steeringVnet)}\" has a user-defined route that sends traffic destined for " +
                    $"\"{NameOf(otherVnet)}\" through a network virtual appliance" +
                    (string.IsNullOrWhiteSpace(steer.Ip) ? string.Empty : $" ({steer.Ip})") +
                    $", but \"{NameOf(otherVnet)}\" has no matching route to send return traffic back through the " +
                    "same appliance. The forward path traverses the stateful appliance and the return path bypasses " +
                    "it, so the appliance sees only one direction of the flow and drops it.",
                AffectedNodeIds = affected.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
                Recommendation =
                    $"Add a user-defined route on the subnets in \"{NameOf(otherVnet)}\" for \"{NameOf(steeringVnet)}\"'s " +
                    "address ranges with the same virtual appliance as the next hop, so both directions of the flow " +
                    "traverse the same stateful device.",
                Reference = LearnUdr,
                Source = "rule",
            });
        }

        // ── RULE RT-NVA-001: UDR next hop does not match any discovered appliance ──
        // A route points at a virtual-appliance IP that is not the private IP of any discovered
        // Azure Firewall. The next hop may be a third-party NVA (fine) or a stale/typo'd IP that
        // blackholes traffic. Flag it so the user can confirm.
        foreach (var ip in allNvaNextHopIps)
        {
            if (firewallIps.Contains(ip)) continue;
            var affected = nvaRoutesBySubnet
                .Where(kv => kv.Value.Any(r => string.Equals(r.Ip, ip, StringComparison.OrdinalIgnoreCase)))
                .Select(kv => kv.Key)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            findings.Add(new RoutingFinding
            {
                Severity = "info",
                RuleId = "RT-NVA-001",
                Title = "Route next hop is not a discovered firewall",
                Message =
                    $"One or more user-defined routes send traffic to next-hop appliance {ip}, which is not the " +
                    "private IP of any discovered Azure Firewall. If this is not an intentional third-party NVA, the " +
                    "route may blackhole traffic, and return paths cannot be verified for symmetry.",
                AffectedNodeIds = affected,
                Recommendation =
                    $"Confirm an appliance actually owns {ip} and that it has a symmetric return route to each " +
                    "source subnet. Remove or correct the route if the appliance no longer exists.",
                Reference = LearnUdr,
                Source = "rule",
            });
        }

        // ── RULE RT-LOOP-001: Default route on AzureFirewallSubnet (routing loop) ──
        // The firewall's own subnet (AzureFirewallSubnet) must not carry a 0.0.0.0/0 UDR that
        // sends traffic to a virtual appliance/firewall — it forces the firewall to route its
        // own egress back through itself, creating a loop and breaking outbound connectivity.
        foreach (var subnetId in forcedTunnelSubnets)
        {
            if (!subnetId.EndsWith("/subnets/AzureFirewallSubnet", StringComparison.OrdinalIgnoreCase)) continue;
            findings.Add(new RoutingFinding
            {
                Severity = "error",
                RuleId = "RT-LOOP-001",
                Title = "Routing loop on AzureFirewallSubnet",
                Message =
                    $"The AzureFirewallSubnet in \"{NameOf(VNetOf(subnetId) ?? subnetId)}\" has a user-defined route " +
                    "for 0.0.0.0/0 pointing at a virtual appliance. The Azure Firewall's own subnet must not force its " +
                    "egress through an appliance — this creates a routing loop and breaks the firewall's outbound traffic.",
                AffectedNodeIds = [subnetId],
                Recommendation =
                    "Remove the 0.0.0.0/0 user-defined route from the route table associated with AzureFirewallSubnet. " +
                    "The firewall manages its own egress; only spoke/workload subnets should route 0.0.0.0/0 to the firewall.",
                Reference = LearnForcedTunnel,
                Source = "rule",
            });
        }

        var report = new RoutingAnalysisReport
        {
            Findings = findings,
            SubnetsAnalyzed = subnets.Count,
            AiUsed = false,
        };

        if (useAi && findings.Count > 0)
        {
            var (enriched, model) = await TryRunAiRecommendationsAsync(graph, findings, ct);
            if (enriched is not null)
            {
                report = report with { Findings = enriched, AiUsed = true, AiModel = model };
            }
        }

        return report;
    }

    // ───────── AI augmentation ─────────

    /// <summary>
    /// Calls Azure OpenAI to produce detailed, Microsoft-Learn-cited remediation steps for each
    /// deterministic finding. Returns the findings with <see cref="RoutingFinding.AiRecommendation"/>
    /// populated, or (null, null) if AI is unavailable / fails.
    /// </summary>
    private async Task<(IReadOnlyList<RoutingFinding>? Findings, string? Model)> TryRunAiRecommendationsAsync(
        TopologyGraph graph, IReadOnlyList<RoutingFinding> findings, CancellationToken ct)
    {
        var endpoint = _config["AzureOpenAI:Endpoint"];
        var deployment = _config["AzureOpenAI:DeploymentName"];
        var apiKey = _config["AzureOpenAI:ApiKey"];
        var apiVersion = _config["AzureOpenAI:ApiVersion"] ?? "2024-10-21";

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(deployment))
        {
            _logger.LogInformation("Azure OpenAI not configured — skipping AI routing recommendations.");
            return (null, null);
        }
        if (_httpClientFactory is null)
        {
            _logger.LogWarning("IHttpClientFactory not registered — cannot call Azure OpenAI.");
            return (null, null);
        }

        try
        {
            var systemPrompt =
                "You are a senior Azure network engineer. You are given a list of detected routing findings " +
                "(primarily asymmetric routing) from a discovered Azure network topology, plus a compact summary of " +
                "the relevant route tables, subnets, VNet peerings and firewalls. " +
                "For EACH finding (identified by its index), provide concrete, step-by-step remediation guidance " +
                "specific to Azure (user-defined routes, route table associations, firewall/NVA configuration, " +
                "peering settings). Base your guidance ONLY on Microsoft documentation (learn.microsoft.com). " +
                "Output a JSON object with this exact shape: " +
                "{\"recommendations\":[{\"index\":0,\"steps\":\"1. ...\\n2. ...\",\"reference\":\"https://learn.microsoft.com/...\"}]} " +
                "Every reference MUST be a learn.microsoft.com URL. Be specific and actionable; do not restate the problem.";

            var payload = JsonSerializer.Serialize(new
            {
                findings = findings.Select((f, i) => new
                {
                    index = i,
                    ruleId = f.RuleId,
                    title = f.Title,
                    message = f.Message,
                    affectedNodeIds = f.AffectedNodeIds,
                }),
                topology = SummarizeTopology(graph),
            });

            var body = new
            {
                messages = new object[]
                {
                    new { role = "system", content = systemPrompt },
                    new { role = "user", content = "Provide remediation steps as JSON only.\n\n" + payload },
                },
                temperature = 0.1,
                top_p = 1.0,
                response_format = new { type = "json_object" },
                max_tokens = 2000,
            };

            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(45);
            var url = $"{endpoint.TrimEnd('/')}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}";
            using var msg = new HttpRequestMessage(HttpMethod.Post, url);
            msg.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            if (!string.IsNullOrEmpty(apiKey))
            {
                msg.Headers.Add("api-key", apiKey);
            }
            else
            {
                var cred = new AzureIdentity::Azure.Identity.DefaultAzureCredential();
                var token = await cred.GetTokenAsync(
                    new Azure.Core.TokenRequestContext(["https://cognitiveservices.azure.com/.default"]), ct);
                msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
            }

            using var response = await client.SendAsync(msg, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Azure OpenAI returned {Status} for routing recommendations", (int)response.StatusCode);
                return (null, null);
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var content = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            if (string.IsNullOrWhiteSpace(content)) return (null, deployment);

            var merged = MergeAiRecommendations(findings, content);
            return (merged, deployment);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AI routing recommendation failed — returning rule-only findings.");
            return (null, null);
        }
    }

    private static readonly Regex LearnUrlPattern =
        new(@"^https://learn\.microsoft\.com/", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static IReadOnlyList<RoutingFinding> MergeAiRecommendations(IReadOnlyList<RoutingFinding> findings, string json)
    {
        var result = findings.ToList();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("recommendations", out var arr) || arr.ValueKind != JsonValueKind.Array)
                return result;
            foreach (var r in arr.EnumerateArray())
            {
                if (!r.TryGetProperty("index", out var idxEl) || idxEl.ValueKind != JsonValueKind.Number) continue;
                var idx = idxEl.GetInt32();
                if (idx < 0 || idx >= result.Count) continue;
                var steps = r.TryGetProperty("steps", out var s) ? s.GetString() : null;
                if (string.IsNullOrWhiteSpace(steps)) continue;
                var reference = r.TryGetProperty("reference", out var refEl) ? refEl.GetString() : null;
                var validRef = !string.IsNullOrWhiteSpace(reference) && LearnUrlPattern.IsMatch(reference!)
                    ? reference
                    : result[idx].Reference;
                result[idx] = result[idx] with { AiRecommendation = steps, Reference = validRef };
            }
        }
        catch
        {
            // Ignore malformed AI output — keep rule findings as-is.
        }
        return result;
    }

    // ───────── Helpers ─────────

    // FlowNode.Type is always the ReactFlow node kind ("azureResource"); the real Azure
    // resource type lives in node.Data.Type. Comparisons must use Data.Type.
    private static bool TypeIs(FlowNode? node, string lowerType) =>
        node?.Data is not null && string.Equals(node.Data.Type, lowerType, StringComparison.OrdinalIgnoreCase);

    private static string ShortName(string id)
    {
        var parts = id.Split('/', StringSplitOptions.RemoveEmptyEntries);
        return parts.Length > 0 ? parts[^1] : id;
    }

    private static IEnumerable<string> ExtractPrivateIps(AzureResource? res)
    {
        if (res?.Properties is null) yield break;
        if (res.Properties.TryGetValue("privateIPAddresses", out var raw) && raw is IEnumerable<object> list)
        {
            foreach (var ip in list)
            {
                var s = ip?.ToString();
                if (!string.IsNullOrWhiteSpace(s)) yield return s;
            }
        }
    }

    /// <summary>Reads the route table resource ID associated with a subnet (flat or nested form).</summary>
    private static string? GetSubnetRouteTableId(AzureResource? subnet)
    {
        if (subnet?.Properties is null) return null;
        if (subnet.Properties.TryGetValue("routeTableId", out var flat) && flat is string fs && !string.IsNullOrWhiteSpace(fs))
            return fs;
        if (subnet.Properties.TryGetValue("routeTable", out var rt) && rt is IDictionary<string, object> rtObj
            && rtObj.TryGetValue("id", out var idVal) && idVal is string id && !string.IsNullOrWhiteSpace(id))
            return id;
        return null;
    }

    /// <summary>Reads the subnet resource IDs that a route table reports as associated.</summary>
    private static IEnumerable<string> GetRouteTableSubnetRefs(AzureResource? routeTable)
    {
        if (routeTable?.Properties is null) yield break;
        if (!routeTable.Properties.TryGetValue("subnets", out var raw) || raw is not IEnumerable<object> list) yield break;
        foreach (var item in list)
        {
            if (item is IDictionary<string, object> obj && obj.TryGetValue("id", out var idVal)
                && idVal is string id && !string.IsNullOrWhiteSpace(id))
                yield return id;
        }
    }

    /// <summary>Parses the routes of a route table resource into (prefix, nextHopType, nextHopIp, name) tuples.</summary>
    private static IEnumerable<(string Prefix, string NextHopType, string NextHopIp, string Name)> ParseRoutes(AzureResource? routeTable)
    {
        if (routeTable?.Properties is null) yield break;
        if (!routeTable.Properties.TryGetValue("routes", out var raw) || raw is not IEnumerable<object> list) yield break;
        foreach (var item in list)
        {
            if (item is not IDictionary<string, object> route) continue;
            var name = route.TryGetValue("name", out var n) ? n?.ToString() ?? string.Empty : string.Empty;
            if (!route.TryGetValue("properties", out var p) || p is not IDictionary<string, object> props) continue;
            var prefix = props.TryGetValue("addressPrefix", out var pre) ? pre?.ToString() ?? string.Empty : string.Empty;
            var nextHopType = props.TryGetValue("nextHopType", out var t) ? t?.ToString() ?? string.Empty : string.Empty;
            var nextHopIp = props.TryGetValue("nextHopIpAddress", out var ip) ? ip?.ToString() ?? string.Empty : string.Empty;
            if (string.IsNullOrWhiteSpace(prefix)) continue;
            yield return (prefix, nextHopType, nextHopIp, name);
        }
    }

    /// <summary>Reads a VNet's address space prefixes from properties.addressSpace.addressPrefixes.</summary>
    private static IEnumerable<string> GetVNetAddressPrefixes(AzureResource? vnet)
    {
        if (vnet?.Properties is null) yield break;
        if (vnet.Properties.TryGetValue("addressSpace", out var asRaw) && asRaw is IDictionary<string, object> asObj
            && asObj.TryGetValue("addressPrefixes", out var apRaw) && apRaw is IEnumerable<object> apList)
        {
            foreach (var p in apList)
            {
                var s = p?.ToString();
                if (!string.IsNullOrWhiteSpace(s)) yield return s;
            }
        }
    }

    /// <summary>Reads a subnet's address prefix(es) from properties.addressPrefix / addressPrefixes.</summary>
    private static IEnumerable<string> GetSubnetAddressPrefixes(AzureResource? subnet)
    {
        if (subnet?.Properties is null) yield break;
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

    /// <summary>
    /// Returns true if two IPv4 CIDR ranges overlap (either contains the other or they intersect).
    /// Returns false for unparseable / IPv6 inputs (we conservatively skip rather than false-positive).
    /// </summary>
    private static bool CidrOverlaps(string cidrA, string cidrB)
    {
        if (!TryParseCidr(cidrA, out var baseA, out var maskA)) return false;
        if (!TryParseCidr(cidrB, out var baseB, out var maskB)) return false;
        var mask = maskA & maskB; // the shorter (less-specific) of the two masks
        return (baseA & mask) == (baseB & mask);
    }

    private static bool TryParseCidr(string cidr, out uint baseAddr, out uint mask)
    {
        baseAddr = 0;
        mask = 0;
        if (string.IsNullOrWhiteSpace(cidr)) return false;
        var slash = cidr.IndexOf('/');
        if (slash < 0) return false;
        var ipPart = cidr[..slash];
        var prefixPart = cidr[(slash + 1)..];
        if (!int.TryParse(prefixPart, out var prefixLen) || prefixLen < 0 || prefixLen > 32) return false;
        var octets = ipPart.Split('.');
        if (octets.Length != 4) return false; // IPv4 only
        uint addr = 0;
        foreach (var oct in octets)
        {
            if (!byte.TryParse(oct, out var b)) return false;
            addr = (addr << 8) | b;
        }
        mask = prefixLen == 0 ? 0u : 0xFFFFFFFFu << (32 - prefixLen);
        baseAddr = addr & mask;
        return true;
    }

    /// <summary>Compact, AI-friendly summary of the routing-relevant parts of the topology.</summary>
    private static object SummarizeTopology(TopologyGraph graph)
    {
        var nodes = graph.Nodes ?? [];
        var edges = graph.Edges ?? [];
        return new
        {
            vnets = nodes.Where(n => string.Equals(n.Data?.Type, VNetType, StringComparison.OrdinalIgnoreCase))
                .Select(n => new { id = n.Id, name = n.Data?.Name }),
            subnets = nodes.Where(n => string.Equals(n.Data?.Type, SubnetType, StringComparison.OrdinalIgnoreCase))
                .Select(n => new { id = n.Id, name = n.Data?.Name }),
            firewalls = nodes.Where(n => string.Equals(n.Data?.Type, FirewallType, StringComparison.OrdinalIgnoreCase))
                .Select(n => new { id = n.Id, name = n.Data?.Name }),
            peerings = edges.Where(e => string.Equals(e.Category, FlowEdgeCategory.Peering, StringComparison.OrdinalIgnoreCase))
                .Select(e => new { e.Source, e.Target, e.Label }),
            defaultRoutes = edges.Where(e => string.Equals(e.Category, FlowEdgeCategory.DefaultRoute, StringComparison.OrdinalIgnoreCase))
                .Select(e => new { e.Source, e.Target, e.Label, e.Metadata }),
        };
    }
}
