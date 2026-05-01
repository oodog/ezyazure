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
}
