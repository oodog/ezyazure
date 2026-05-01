using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using EasyAzure.Discovery.Services;
using Microsoft.Extensions.Logging;

namespace EasyAzure.Topology.Services;

/// <summary>
/// Builds an in-memory topology graph from discovered Azure resources.
/// Relationships are derived from resource properties (e.g., subnet → NSG association,
/// subnet → route table, NIC → subnet, VNet peering, private endpoints).
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

        var vnets = await _resourceGraph.GetVNetsAsync(subscriptionId, ct);
        var nsgs = await _resourceGraph.GetNSGsAsync(subscriptionId, ct);
        var routeTables = await _resourceGraph.GetRouteTablesAsync(subscriptionId, ct);
        var vms = await _resourceGraph.GetVMsAsync(subscriptionId, ct);
        var privateEndpoints = await _resourceGraph.GetPrivateEndpointsAsync(subscriptionId, ct);

        var allResources = vnets
            .Concat(nsgs)
            .Concat(routeTables)
            .Concat(vms)
            .Concat(privateEndpoints)
            .ToList();

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

    private static List<FlowNode> BuildNodes(List<AzureResource> resources)
    {
        var nodes = new List<FlowNode>();
        var layout = new SimpleGridLayout(columns: 5, spacingX: 250, spacingY: 150);

        foreach (var resource in resources)
        {
            var (x, y) = layout.NextPosition();
            nodes.Add(new FlowNode(
                Id: resource.Id,
                Type: "default",
                Position: new FlowPosition(x, y),
                Data: resource));
        }
        return nodes;
    }

    private static List<FlowEdge> BuildEdges(List<AzureResource> resources)
    {
        var edges = new List<FlowEdge>();
        var resourceIndex = resources.ToDictionary(r => r.Id, StringComparer.OrdinalIgnoreCase);

        foreach (var resource in resources)
        {
            // VNet → Subnet containment
            if (resource.Type.Equals("Microsoft.Network/virtualNetworks", StringComparison.OrdinalIgnoreCase))
            {
                if (resource.Properties.TryGetValue("subnets", out var subnetsObj) &&
                    subnetsObj is IEnumerable<object> subnets)
                {
                    foreach (var subnet in subnets)
                    {
                        if (subnet is IDictionary<string, object> s && s.TryGetValue("id", out var subnetId))
                        {
                            edges.Add(new FlowEdge(
                                Id: $"{resource.Id}->contains->{subnetId}",
                                Source: resource.Id,
                                Target: subnetId!.ToString()!,
                                Label: "contains"));
                        }
                    }
                }
            }

            // NSG → Subnet association (NSG has subnets it's associated to)
            if (resource.Type.Equals("Microsoft.Network/networkSecurityGroups", StringComparison.OrdinalIgnoreCase))
            {
                if (resource.Properties.TryGetValue("subnets", out var nsgSubnets) &&
                    nsgSubnets is IEnumerable<object> associatedSubnets)
                {
                    foreach (var subnet in associatedSubnets)
                    {
                        if (subnet is IDictionary<string, object> s && s.TryGetValue("id", out var subnetId))
                        {
                            edges.Add(new FlowEdge(
                                Id: $"{resource.Id}->associatedWith->{subnetId}",
                                Source: resource.Id,
                                Target: subnetId!.ToString()!,
                                Label: "associatedWith"));
                        }
                    }
                }
            }
        }

        return edges;
    }

    private sealed class SimpleGridLayout(int columns, double spacingX, double spacingY)
    {
        private int _index;

        public (double x, double y) NextPosition()
        {
            var col = _index % columns;
            var row = _index / columns;
            _index++;
            return (col * spacingX, row * spacingY);
        }
    }
}
