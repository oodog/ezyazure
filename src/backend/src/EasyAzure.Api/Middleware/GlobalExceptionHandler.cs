using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Http;

namespace EasyAzure.Api.Middleware;

/// <summary>
/// Returns a ProblemDetails JSON body for every unhandled exception. This
/// guarantees the response is written (so the CORS OnStarting callback runs and
/// attaches Access-Control-Allow-Origin) instead of Kestrel resetting the
/// connection — which the browser would otherwise surface as an opaque
/// "Network Error" to the client.
/// Reference: https://learn.microsoft.com/aspnet/core/fundamentals/error-handling#iexceptionhandler
/// </summary>
public sealed class GlobalExceptionHandler : IExceptionHandler
{
    private readonly ILogger<GlobalExceptionHandler> _logger;

    public GlobalExceptionHandler(ILogger<GlobalExceptionHandler> logger)
    {
        _logger = logger;
    }

    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        _logger.LogError(exception, "Unhandled exception for {Method} {Path}",
            httpContext.Request.Method, httpContext.Request.Path);

        httpContext.Response.StatusCode = StatusCodes.Status500InternalServerError;
        httpContext.Response.ContentType = "application/problem+json";

        var problem = new
        {
            type = "https://datatracker.ietf.org/doc/html/rfc7231#section-6.6.1",
            title = "An unexpected error occurred.",
            status = 500,
            detail = exception.Message,
            instance = httpContext.Request.Path.Value,
        };

        await httpContext.Response.WriteAsJsonAsync(problem, cancellationToken);
        return true;
    }
}
