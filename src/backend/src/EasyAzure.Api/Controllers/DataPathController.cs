using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace EasyAzure.Api.Controllers;

[ApiController]
[Route("api/datapath")]
[Authorize(Policy = "Reader")]
public class DataPathController : ControllerBase
{
    private readonly IDataPathService _dataPath;

    public DataPathController(IDataPathService dataPath)
    {
        _dataPath = dataPath;
    }

    [HttpPost("analyze")]
    public async Task<ActionResult<DataPathResult>> Analyze(
        [FromBody] DataPathRequest request, CancellationToken ct)
    {
        var result = await _dataPath.AnalyzeAsync(request, ct);
        return Ok(result);
    }
}
