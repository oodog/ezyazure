using EasyAzure.Discovery.Services;
using EasyAzure.Topology.Services;
using Microsoft.Extensions.Logging;

namespace EasyAzure.DiscoveryWorker;

/// <summary>
/// Container Apps Job entrypoint.
/// Triggered on a schedule or on-demand to discover and ingest Azure resources.
///
/// Container Apps Jobs reference:
/// https://learn.microsoft.com/azure/container-apps/jobs
/// </summary>
public class DiscoveryJob
{
    private readonly DiscoveryService _discovery;
    private readonly TopologyService _topology;
    private readonly ILogger<DiscoveryJob> _logger;

    public DiscoveryJob(
        DiscoveryService discovery,
        TopologyService topology,
        ILogger<DiscoveryJob> logger)
    {
        _discovery = discovery;
        _topology = topology;
        _logger = logger;
    }

    public async Task RunAsync(CancellationToken ct = default)
    {
        _logger.LogInformation("Discovery job started at {Time}", DateTimeOffset.UtcNow);

        var subscriptions = await _discovery.ListSubscriptionsAsync(ct);
        _logger.LogInformation("Discovered {Count} subscriptions", subscriptions.Count);

        foreach (var sub in subscriptions)
        {
            try
            {
                _logger.LogInformation("Building topology for subscription {Id} '{Name}'",
                    sub.Id, sub.DisplayName);

                var graph = await _topology.BuildTopologyAsync(sub.Id, ct);
                _logger.LogInformation(
                    "Subscription {Id}: {NodeCount} resources, {EdgeCount} relationships",
                    sub.Id, graph.Nodes.Count, graph.Edges.Count);

                // In production: persist graph nodes and edges to Cosmos DB Gremlin or PostgreSQL.
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process subscription {Id}", sub.Id);
            }
        }

        _logger.LogInformation("Discovery job completed at {Time}", DateTimeOffset.UtcNow);
    }
}
