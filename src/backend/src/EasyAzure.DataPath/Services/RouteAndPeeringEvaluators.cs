using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.DataPath.Services;

public record RouteEvalResult(PathHop? Hop, string? NextHop, IReadOnlyList<string> RiskNotes);
public record PeeringEvalResult(IReadOnlyList<PathHop> Hops, IReadOnlyList<string> RiskNotes);

/// <summary>
/// Evaluates route tables and UDRs to determine the next hop and identify
/// asymmetric routing risks.
/// </summary>
public class RouteEvaluator
{
    private readonly ILogger<RouteEvaluator> _logger;

    public RouteEvaluator(ILogger<RouteEvaluator> logger)
    {
        _logger = logger;
    }

    public Task<RouteEvalResult> EvaluateAsync(
        string sourceResourceId, string destinationResourceId, CancellationToken ct = default)
    {
        _logger.LogDebug("Evaluating routes from {Source} to {Destination}", sourceResourceId, destinationResourceId);

        // Production: fetch effective routes via Network Watcher API.
        // Placeholder returns a direct VNet route.
        var hop = new PathHop
        {
            ResourceId = $"{sourceResourceId}/effective-route",
            ResourceName = "Route Table",
            ResourceType = "Microsoft.Network/routeTables",
            Detail = "Route: 0.0.0.0/0 → Internet (default system route)",
            MatchedRule = "default-internet-route",
        };
        return Task.FromResult(new RouteEvalResult(hop, "Internet", []));
    }
}

/// <summary>
/// Evaluates VNet peering paths between source and destination.
/// Warns about non-transitive peering.
/// </summary>
public class PeeringEvaluator
{
    private readonly ILogger<PeeringEvaluator> _logger;

    public PeeringEvaluator(ILogger<PeeringEvaluator> logger)
    {
        _logger = logger;
    }

    public Task<PeeringEvalResult> EvaluateAsync(
        string sourceResourceId, string destinationResourceId, CancellationToken ct = default)
    {
        _logger.LogDebug("Evaluating peering from {Source} to {Destination}", sourceResourceId, destinationResourceId);

        // Production: resolve peering via Resource Graph query on VNet peerings.
        // Placeholder returns no additional peering hops.
        return Task.FromResult(new PeeringEvalResult([], []));
    }
}
