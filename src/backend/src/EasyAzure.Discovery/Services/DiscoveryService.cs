extern alias AzureIdentity;
using Azure.ResourceManager;
using Azure.ResourceManager.Resources;
using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.Discovery.Services;

/// <summary>
/// Orchestrates cross-subscription Azure resource discovery using Azure Resource Graph
/// and Azure SDK fallback collectors.
/// </summary>
public class DiscoveryService : IDiscoveryService
{
    private readonly ResourceGraphService _resourceGraph;
    private readonly ITopologyService _topology;
    private readonly ILogger<DiscoveryService> _logger;

    public DiscoveryService(
        ResourceGraphService resourceGraph,
        ITopologyService topology,
        ILogger<DiscoveryService> logger)
    {
        _resourceGraph = resourceGraph;
        _topology = topology;
        _logger = logger;
    }

    public async Task<DashboardStats> GetDashboardStatsAsync(CancellationToken ct = default)
    {
        // Each tile is fetched independently so a single failure (missing RBAC,
        // network blip, transient Resource Graph error) downgrades the affected
        // metric to zero rather than failing the entire dashboard request.
        var subscriptionCount = 0;
        try
        {
            var subscriptions = await ListSubscriptionsAsync(ct);
            subscriptionCount = subscriptions.Count;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Dashboard: listing subscriptions failed; defaulting to 0.");
        }

        var resourceCount = 0;
        try { resourceCount = await _resourceGraph.CountAllResourcesAsync(ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Dashboard: counting resources failed; defaulting to 0."); }

        var vnetCount = 0;
        try { vnetCount = await _resourceGraph.CountResourceTypeAsync("Microsoft.Network/virtualNetworks", ct); }
        catch (Exception ex) { _logger.LogWarning(ex, "Dashboard: counting VNets failed; defaulting to 0."); }

        return new DashboardStats
        {
            SubscriptionCount = subscriptionCount,
            ResourceCount = resourceCount,
            VNetCount = vnetCount,
            DriftWarnings = 0,
            RecentDeployments = 0,
        };
    }

    public async Task<IReadOnlyList<SubscriptionSummary>> ListSubscriptionsAsync(CancellationToken ct = default)
    {
        var credential = new AzureIdentity::Azure.Identity.DefaultAzureCredential();
        var armClient = new ArmClient(credential);

        var result = new List<SubscriptionSummary>();
        await foreach (var sub in armClient.GetSubscriptions().GetAllAsync(ct))
        {
            result.Add(new SubscriptionSummary(
                sub.Data.SubscriptionId ?? string.Empty,
                sub.Data.DisplayName ?? string.Empty,
                sub.Data.TenantId?.ToString() ?? string.Empty));
        }
        return result;
    }

    public async Task<TopologyGraph> GetTopologyAsync(string subscriptionId, CancellationToken ct = default)
    {
        _logger.LogInformation("Building topology for subscription {SubscriptionId}", subscriptionId);
        return await _topology.BuildTopologyAsync(subscriptionId, ct);
    }

    public async Task<TopologyGraph> GetTopologyMultiAsync(IReadOnlyList<string> subscriptionIds, CancellationToken ct = default)
    {
        _logger.LogInformation("Building topology across {Count} subscription(s)", subscriptionIds.Count);
        return await _topology.BuildTopologyMultiAsync(subscriptionIds, ct);
    }

    public Task<DiscoveryJobStatus> TriggerDiscoveryAsync(string subscriptionId, CancellationToken ct = default)
    {
        // In production, enqueue a Container Apps Job.
        // For MVP, run inline and return a completed status.
        var jobId = Guid.NewGuid().ToString();
        _logger.LogInformation("Discovery job {JobId} triggered for {SubscriptionId}", jobId, subscriptionId);
        return Task.FromResult(new DiscoveryJobStatus
        {
            JobId = jobId,
            Status = "Accepted",
            Progress = 0,
            Message = "Discovery job queued.",
        });
    }

    public Task<DiscoveryJobStatus?> GetJobStatusAsync(string jobId, CancellationToken ct = default)
    {
        // Placeholder — production implementation reads from a job store.
        return Task.FromResult<DiscoveryJobStatus?>(null);
    }
}
