using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.DataPath.Services;

public record NsgEvalResult(bool IsAllowed, PathHop? Hop, string? MatchedRule, IReadOnlyList<string> RiskNotes);

/// <summary>
/// Evaluates NSG inbound and outbound rules for a given resource, protocol, and port.
/// </summary>
public class NsgEvaluator
{
    private readonly ILogger<NsgEvaluator> _logger;

    public NsgEvaluator(ILogger<NsgEvaluator> logger)
    {
        _logger = logger;
    }

    public Task<NsgEvalResult> EvaluateOutboundAsync(
        string resourceId, string protocol, int port, CancellationToken ct = default)
    {
        _logger.LogDebug("Evaluating outbound NSG for {ResourceId} {Protocol}/{Port}", resourceId, protocol, port);

        // Production: fetch effective NSG rules via Azure Network Watcher.
        // Placeholder returns allowed with a representative hop.
        var hop = new PathHop
        {
            ResourceId = $"{resourceId}/nsg-outbound",
            ResourceName = "NSG (outbound)",
            ResourceType = "Microsoft.Network/networkSecurityGroups",
            Detail = $"Evaluating outbound {protocol}/{port}",
            MatchedRule = "DefaultOutboundAllowed",
        };
        return Task.FromResult(new NsgEvalResult(true, hop, "DefaultOutboundAllowed", []));
    }

    public Task<NsgEvalResult> EvaluateInboundAsync(
        string resourceId, string protocol, int port, CancellationToken ct = default)
    {
        _logger.LogDebug("Evaluating inbound NSG for {ResourceId} {Protocol}/{Port}", resourceId, protocol, port);

        var riskNotes = new List<string>();
        var hop = new PathHop
        {
            ResourceId = $"{resourceId}/nsg-inbound",
            ResourceName = "NSG (inbound)",
            ResourceType = "Microsoft.Network/networkSecurityGroups",
            Detail = $"Evaluating inbound {protocol}/{port}",
            MatchedRule = "AllowVnetInBound",
        };
        return Task.FromResult(new NsgEvalResult(true, hop, "AllowVnetInBound", riskNotes));
    }
}
