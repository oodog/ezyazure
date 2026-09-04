using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace EasyAzure.Api.Controllers;

[ApiController]
[Route("api/designer")]
[Authorize(Policy = "Designer")]
public class DesignerController : ControllerBase
{
    private readonly IDesignerService _designer;
    private readonly IDesignImportService _designImport;
    private readonly IDesignerAssistantService _assistant;

    public DesignerController(
        IDesignerService designer,
        IDesignImportService designImport,
        IDesignerAssistantService assistant)
    {
        _designer = designer;
        _designImport = designImport;
        _assistant = assistant;
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

    [HttpPost("assistant/chat")]
    [EnableRateLimiting("assistant")]
    [RequestSizeLimit(1_000_000)]
    public async Task<ActionResult<DesignerAssistantResponse>> AssistantChat(
        [FromBody] DesignerAssistantRequest request,
        CancellationToken ct)
    {
        if (request is null || string.IsNullOrWhiteSpace(request.Message) || request.Message.Length > 2_000)
            return BadRequest(new { error = "Message is required and must be 2,000 characters or fewer." });
        if (request.History is null || request.History.Count > 6 ||
            request.History.Any(turn => turn is null || turn.Role is not ("user" or "assistant") ||
                string.IsNullOrWhiteSpace(turn.Content) || turn.Content.Length > 2_000))
            return BadRequest(new { error = "Conversation history exceeds the supported limit." });
        if (request.Nodes is null || request.Nodes.Count > 120 || request.Edges is null || request.Edges.Count > 240)
            return BadRequest(new { error = "The Designer canvas exceeds the supported assistant limit." });
        if (request.Nodes.Any(node => node is null || string.IsNullOrWhiteSpace(node.Id) || node.Id.Length > 100 ||
                string.IsNullOrWhiteSpace(node.BlockType) || node.BlockType.Length > 80 ||
                string.IsNullOrWhiteSpace(node.Label) || node.Label.Length > 120 ||
                node.ParentId?.Length > 100 || node.Properties is null || node.Properties.Count > 40) ||
            request.Nodes.Select(node => node.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count() != request.Nodes.Count)
            return BadRequest(new { error = "The Designer canvas contains invalid nodes." });
        if (request.Edges.Any(edge => edge is null || string.IsNullOrWhiteSpace(edge.Id) || edge.Id.Length > 100 ||
                string.IsNullOrWhiteSpace(edge.Source) || edge.Source.Length > 100 ||
                string.IsNullOrWhiteSpace(edge.Target) || edge.Target.Length > 100 || edge.Relationship?.Length > 80))
            return BadRequest(new { error = "The Designer canvas contains invalid relationships." });

        return Ok(await _assistant.PlanAsync(request, ct));
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
