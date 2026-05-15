using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EasyAzure.Api.Controllers;

/// <summary>
/// Replicates a discovered environment (one or more source subscriptions) into a new
/// target subscription / resource group. The preview endpoint surfaces resources that
/// require a rename (globally-unique DNS names); the plan endpoint emits Bicep ready
/// to deploy.
///
/// Naming reference: https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules
/// </summary>
[ApiController]
[Route("api/replication")]
[Authorize(Policy = "Designer")]
public class ReplicationController : ControllerBase
{
    private readonly IReplicationService _replication;

    public ReplicationController(IReplicationService replication)
    {
        _replication = replication;
    }

    [HttpPost("preview")]
    public async Task<ActionResult<ReplicationPreview>> Preview(
        [FromBody] ReplicationPreviewRequest request, CancellationToken ct)
    {
        if (request is null || request.SourceSubscriptionIds is null || request.SourceSubscriptionIds.Count == 0)
        {
            return BadRequest(new { error = "At least one source subscription is required." });
        }
        if (string.IsNullOrWhiteSpace(request.TargetSubscriptionId)
            || string.IsNullOrWhiteSpace(request.TargetResourceGroup)
            || string.IsNullOrWhiteSpace(request.TargetLocation))
        {
            return BadRequest(new { error = "Target subscription, resource group and location are required." });
        }
        var preview = await _replication.PreviewAsync(request, ct);
        return Ok(preview);
    }

    [HttpPost("plan")]
    public async Task<ActionResult<ReplicationPlan>> Plan(
        [FromBody] ReplicationPlanRequest request, CancellationToken ct)
    {
        if (request is null || request.SourceSubscriptionIds is null || request.SourceSubscriptionIds.Count == 0)
        {
            return BadRequest(new { error = "At least one source subscription is required." });
        }
        var plan = await _replication.PlanAsync(request, ct);
        return Ok(plan);
    }
}
