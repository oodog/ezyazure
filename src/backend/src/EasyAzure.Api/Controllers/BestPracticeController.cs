using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EasyAzure.Api.Controllers;

[ApiController]
[Route("api/bestpractice")]
[Authorize(Policy = "Reader")]
public class BestPracticeController : ControllerBase
{
    private readonly IBestPracticeEngine _engine;

    public BestPracticeController(IBestPracticeEngine engine)
    {
        _engine = engine;
    }

    [HttpGet("review")]
    public async Task<ActionResult<BestPracticeReport>> RunReview(
        [FromQuery] string? subscriptionId, CancellationToken ct)
    {
        var report = await _engine.RunReviewAsync(subscriptionId, ct);
        return Ok(report);
    }

    [HttpGet("rules")]
    public async Task<ActionResult<IReadOnlyList<BestPracticeRule>>> ListRules(CancellationToken ct)
    {
        var rules = await _engine.ListRulesAsync(ct);
        return Ok(rules);
    }

    /// <summary>
    /// Validates a designer canvas against Microsoft best practice. Combines deterministic
    /// rule checks with an optional Azure OpenAI review (when configured). Every finding
    /// returned cites a Microsoft Learn URL only.
    /// </summary>
    [HttpPost("validate-design")]
    [Authorize(Policy = "Designer")]
    public async Task<ActionResult<DesignValidationReport>> ValidateDesign(
        [FromBody] DesignValidationRequest request, CancellationToken ct)
    {
        if (request is null || request.Nodes is null || request.Nodes.Count == 0)
        {
            return BadRequest(new { error = "Design must contain at least one node." });
        }
        var report = await _engine.ValidateDesignAsync(request, ct);
        return Ok(report);
    }
}
