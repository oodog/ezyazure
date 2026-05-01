using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EasyAzure.Api.Controllers;

[ApiController]
[Route("api/iac")]
[Authorize(Policy = "Designer")]
public class IaCController : ControllerBase
{
    private readonly IBicepGeneratorService _generator;
    private readonly IDeploymentService _deployment;

    public IaCController(IBicepGeneratorService generator, IDeploymentService deployment)
    {
        _generator = generator;
        _deployment = deployment;
    }

    [HttpPost("generate")]
    public async Task<ActionResult<GenerateBicepResult>> GenerateBicep(
        [FromBody] GenerateBicepRequest request, CancellationToken ct)
    {
        var result = await _generator.GenerateBicepAsync(request.EnvironmentId, ct);
        return Ok(result);
    }

    [HttpPost("whatif")]
    [Authorize(Policy = "Operator")]
    public async Task<ActionResult<WhatIfResult>> RunWhatIf(
        [FromBody] WhatIfRequest request, CancellationToken ct)
    {
        var result = await _deployment.RunWhatIfAsync(request, ct);
        return Ok(result);
    }

    [HttpPost("deploy")]
    [Authorize(Policy = "Operator")]
    public async Task<ActionResult<DeploymentRecord>> Deploy(
        [FromBody] DeployRequest request, CancellationToken ct)
    {
        var record = await _deployment.DeployAsync(request, ct);
        return Accepted(record);
    }

    [HttpGet("deployments/{deploymentId}")]
    [Authorize(Policy = "Reader")]
    public async Task<ActionResult<DeploymentRecord>> GetDeploymentStatus(
        string deploymentId, CancellationToken ct)
    {
        var record = await _deployment.GetDeploymentStatusAsync(deploymentId, ct);
        if (record is null) return NotFound();
        return Ok(record);
    }
}
