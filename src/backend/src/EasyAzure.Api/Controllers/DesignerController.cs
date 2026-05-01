using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EasyAzure.Api.Controllers;

[ApiController]
[Route("api/designer")]
[Authorize(Policy = "Designer")]
public class DesignerController : ControllerBase
{
    private readonly IDesignerService _designer;

    public DesignerController(IDesignerService designer)
    {
        _designer = designer;
    }

    [HttpGet]
    [Authorize(Policy = "Reader")]
    public async Task<ActionResult<IReadOnlyList<DesignEnvironmentSummary>>> ListEnvironments(CancellationToken ct)
    {
        var envs = await _designer.ListEnvironmentsAsync(ct);
        return Ok(envs);
    }

    [HttpGet("{id}")]
    [Authorize(Policy = "Reader")]
    public async Task<ActionResult<DesignEnvironment>> GetEnvironment(string id, CancellationToken ct)
    {
        var env = await _designer.GetEnvironmentAsync(id, ct);
        if (env is null) return NotFound();
        return Ok(env);
    }

    [HttpPost]
    public async Task<ActionResult<DesignEnvironment>> CreateEnvironment(
        [FromBody] CreateEnvironmentRequest request, CancellationToken ct)
    {
        var env = await _designer.CreateEnvironmentAsync(request, ct);
        return CreatedAtAction(nameof(GetEnvironment), new { id = env.Id }, env);
    }

    [HttpPut("{id}")]
    public async Task<ActionResult<DesignEnvironment>> UpdateEnvironment(
        string id, [FromBody] DesignEnvironment environment, CancellationToken ct)
    {
        if (id != environment.Id) return BadRequest("ID mismatch");
        var updated = await _designer.UpdateEnvironmentAsync(environment, ct);
        return Ok(updated);
    }

    [HttpPost("{id}/validate")]
    public async Task<ActionResult<ValidationResult>> Validate(string id, CancellationToken ct)
    {
        var result = await _designer.ValidateAsync(id, ct);
        return Ok(result);
    }
}
