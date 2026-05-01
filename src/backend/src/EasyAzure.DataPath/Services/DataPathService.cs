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
}
