using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EasyAzure.Api.Controllers;

[ApiController]
[Route("api/discovery")]
[Authorize(Policy = "Reader")]
public class DiscoveryController : ControllerBase
{
    private readonly IDiscoveryService _discovery;
    private readonly IRoutingAnalysisService _routing;
    private readonly IDataPathService _dataPath;
    private readonly IDiscoveryAssistantService _assistant;
    private readonly ILogger<DiscoveryController> _logger;

    public DiscoveryController(
        IDiscoveryService discovery,
        IRoutingAnalysisService routing,
        IDataPathService dataPath,
        IDiscoveryAssistantService assistant,
        ILogger<DiscoveryController> logger)
    {
        _discovery = discovery;
        _routing = routing;
        _dataPath = dataPath;
        _assistant = assistant;
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

    /// <summary>
    /// Traces a data path through the discovered topology so the Discovery map can highlight
    /// the exact route between a source VM and a destination (resource ID or IP address).
    /// Returns ordered hops, NSG evaluation, risk notes, and the node IDs to highlight.
    /// </summary>
    [HttpPost("trace-path")]
    public async Task<ActionResult<DataPathResult>> TracePath(
        [FromBody] DataPathGraphRequest request, CancellationToken ct)
    {
        if (request?.SubscriptionIds is null || request.SubscriptionIds.Count == 0)
        {
            return BadRequest(new { error = "At least one subscriptionId is required." });
        }
        if (string.IsNullOrWhiteSpace(request.SourceResourceId) || string.IsNullOrWhiteSpace(request.Destination))
        {
            return BadRequest(new { error = "Both a source resource and a destination are required." });
        }

        var graph = await _discovery.GetTopologyMultiAsync(request.SubscriptionIds, ct);
        var result = await _dataPath.TraceOnGraphAsync(graph, request, ct);
        return Ok(result);
    }

    /// <summary>
    /// Answers an advisory support question using the server-rebuilt discovered topology,
    /// deterministic routing findings, and fixed technology-specific skill instructions.
    /// </summary>
    [HttpPost("assistant/chat")]
    [EnableRateLimiting("assistant")]
    public async Task<ActionResult<DiscoveryAssistantResponse>> AssistantChat(
        [FromBody] DiscoveryAssistantRequest request, CancellationToken ct)
    {
        if (request?.SubscriptionIds is null || request.SubscriptionIds.Count == 0 || request.SubscriptionIds.Count > 20)
            return BadRequest(new { error = "Provide between 1 and 20 subscriptionIds." });
        if (request.SubscriptionIds.Any(subscriptionId => !Guid.TryParse(subscriptionId, out _)))
            return BadRequest(new { error = "Every subscriptionId must be a valid GUID." });
        if (string.IsNullOrWhiteSpace(request.Message) || request.Message.Length > 2_000)
            return BadRequest(new { error = "Message is required and must be 2,000 characters or fewer." });
        if (request.History is null || request.FocusTechnologies is null ||
            request.History.Count > 6 ||
            request.History.Any(turn => turn is null || turn.Role is not ("user" or "assistant") ||
                turn.Content is null || turn.Content.Length > 2_000))
            return BadRequest(new { error = "Conversation history exceeds the supported limit." });
        if (request.FocusTechnologies.Count > 11 || request.FocusTechnologies.Any(technology => technology.Length > 50) ||
            request.FocusResourceId?.Length > 2_048)
            return BadRequest(new { error = "Assistant focus exceeds the supported limit." });

        var graph = await _discovery.GetTopologyMultiAsync(request.SubscriptionIds, ct);
        var routingReport = await _routing.AnalyzeAsync(graph, useAi: false, ct);
        var response = await _assistant.ChatAsync(request, graph, routingReport, ct);
        return Ok(response);
    }
}
