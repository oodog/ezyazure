using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EasyAzure.Api.Controllers;

/// <summary>
/// Discovery versioning — persists point-in-time topology snapshots and diffs them so
/// customers can see how their environment changed between discoveries.
/// </summary>
[ApiController]
[Route("api/discovery/snapshots")]
[Authorize(Policy = "Reader")]
public class SnapshotsController : ControllerBase
{
    private readonly ISnapshotService _snapshots;
    private readonly ILogger<SnapshotsController> _logger;

    public SnapshotsController(ISnapshotService snapshots, ILogger<SnapshotsController> logger)
    {
        _snapshots = snapshots;
        _logger = logger;
    }

    /// <summary>Captures the current topology for the given subscriptions and persists it.</summary>
    [HttpPost]
    [Authorize(Policy = "Designer")]
    public async Task<ActionResult<DiscoverySnapshotSummary>> Save(
        [FromBody] SaveSnapshotRequest request, CancellationToken ct)
    {
        if (request?.SubscriptionIds is null || request.SubscriptionIds.Count == 0)
        {
            return BadRequest(new { error = "At least one subscriptionId is required." });
        }

        try
        {
            var summary = await _snapshots.SaveAsync(request, ct);
            return Ok(summary);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Snapshot save failed — versioning not configured.");
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new { error = ex.Message });
        }
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DiscoverySnapshotSummary>>> List(CancellationToken ct)
    {
        var list = await _snapshots.ListAsync(ct);
        return Ok(list);
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<DiscoverySnapshot>> Get(string id, CancellationToken ct)
    {
        var snapshot = await _snapshots.GetAsync(id, ct);
        return snapshot is null ? NotFound() : Ok(snapshot);
    }

    /// <summary>Returns the difference (added/removed/changed resources) between two snapshots.</summary>
    [HttpGet("diff")]
    public async Task<ActionResult<DiscoveryDiff>> Diff(
        [FromQuery] string from, [FromQuery] string to, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(from) || string.IsNullOrWhiteSpace(to))
        {
            return BadRequest(new { error = "Both 'from' and 'to' snapshot IDs are required." });
        }

        var diff = await _snapshots.DiffAsync(from, to, ct);
        return diff is null ? NotFound(new { error = "One or both snapshots were not found." }) : Ok(diff);
    }

    [HttpDelete("{id}")]
    [Authorize(Policy = "Designer")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var deleted = await _snapshots.DeleteAsync(id, ct);
        return deleted ? NoContent() : NotFound();
    }
}
