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
    private readonly IDesignImportService _designImport;

    public DesignerController(IDesignerService designer, IDesignImportService designImport)
    {
        _designer = designer;
        _designImport = designImport;
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

    [HttpPost("import/analyze")]
    [RequestSizeLimit(25_000_000)]
    public async Task<ActionResult<DesignImportProposal>> AnalyzeImport(
        [FromBody] DesignImportRequest request,
        CancellationToken ct)
    {
        try
        {
            var proposal = await _designImport.AnalyzeAsync(request, ct);
            return Ok(proposal);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new ProblemDetails
            {
                Title = "The document could not be analyzed",
                Detail = ex.Message,
                Status = StatusCodes.Status400BadRequest,
            });
        }
        catch (InvalidOperationException ex)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new ProblemDetails
            {
                Title = "Azure AI document analysis is unavailable",
                Detail = ex.Message,
                Status = StatusCodes.Status503ServiceUnavailable,
            });
        }
    }
}
