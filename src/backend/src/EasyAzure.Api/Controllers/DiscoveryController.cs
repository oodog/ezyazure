using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EasyAzure.Api.Controllers;

[ApiController]
[Route("api/discovery")]
[Authorize(Policy = "Reader")]
public class DiscoveryController : ControllerBase
{
    private readonly IDiscoveryService _discovery;
    private readonly IRoutingAnalysisService _routing;
    private readonly ILogger<DiscoveryController> _logger;

    public DiscoveryController(
        IDiscoveryService discovery,
        IRoutingAnalysisService routing,
        ILogger<DiscoveryController> logger)
    {
        _discovery = discovery;
        _routing = routing;
        _logger = logger;
    }

    [HttpGet("dashboard")]
    public async Task<ActionResult<DashboardStats>> GetDashboard(CancellationToken ct)
    {
        var stats = await _discovery.GetDashboardStatsAsync(ct);
        return Ok(stats);
    }

    [HttpGet("subscriptions")]
    public async Task<ActionResult<IReadOnlyList<SubscriptionSummary>>> ListSubscriptions(CancellationToken ct)
    {
        // The API runs as a Container App managed identity that may not have
        // visibility into the caller's subscriptions. Return an empty list with
        // a logged warning instead of failing — the SPA allows users to add
        // subscription IDs manually for resources the MI has been granted on.
        try
        {
            var subs = await _discovery.ListSubscriptionsAsync(ct);
            return Ok(subs);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ListSubscriptions: managed identity could not enumerate subscriptions.");
            return Ok(Array.Empty<SubscriptionSummary>());
        }
    }

    [HttpGet("topology/{subscriptionId}")]
    public async Task<ActionResult<TopologyGraph>> GetTopology(string subscriptionId, CancellationToken ct)
    {
        var graph = await _discovery.GetTopologyAsync(subscriptionId, ct);
        return Ok(graph);
    }

    [HttpPost("topology")]
    public async Task<ActionResult<TopologyGraph>> GetTopologyMulti(
        [FromBody] MultiSubscriptionRequest request, CancellationToken ct)
    {
        if (request.SubscriptionIds is null || request.SubscriptionIds.Count == 0)
        {
            return BadRequest(new { error = "At least one subscriptionId is required." });
        }
        var graph = await _discovery.GetTopologyMultiAsync(request.SubscriptionIds, ct);
        return Ok(graph);
    }

    [HttpPost("run")]
    [Authorize(Policy = "Reader")]
    public async Task<ActionResult<DiscoveryJobStatus>> TriggerDiscovery(
        [FromBody] TriggerDiscoveryRequest request, CancellationToken ct)
    {
        var job = await _discovery.TriggerDiscoveryAsync(request.SubscriptionId, ct);
        return Accepted(job);
    }

    [HttpGet("jobs/{jobId}")]
    public async Task<ActionResult<DiscoveryJobStatus>> GetJobStatus(string jobId, CancellationToken ct)
    {
        var status = await _discovery.GetJobStatusAsync(jobId, ct);
        if (status is null) return NotFound();
        return Ok(status);
    }

    /// <summary>
    /// Analyses the discovered topology for routing issues — primarily asymmetric routing
    /// across VNet peerings and forced-tunnel mismatches. When <c>useAi</c> is true and Azure
    /// OpenAI is configured, each finding is enriched with AI-recommended remediation steps.
    /// </summary>
    [HttpPost("analyze-routing")]
    public async Task<ActionResult<RoutingAnalysisReport>> AnalyzeRouting(
        [FromBody] RoutingAnalysisRequest request, CancellationToken ct)
    {
        if (request?.SubscriptionIds is null || request.SubscriptionIds.Count == 0)
        {
            return BadRequest(new { error = "At least one subscriptionId is required." });
        }

        var graph = await _discovery.GetTopologyMultiAsync(request.SubscriptionIds, ct);
        var report = await _routing.AnalyzeAsync(graph, request.UseAi, ct);
        return Ok(report);
    }
}
