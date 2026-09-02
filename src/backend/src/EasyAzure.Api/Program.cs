using EasyAzure.Core.Interfaces;
using EasyAzure.Discovery.Services;
using EasyAzure.Topology.Services;
using EasyAzure.DataPath.Services;
using EasyAzure.Designer.Services;
using EasyAzure.IaC.Services;
using Microsoft.Identity.Web;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using System.Threading.RateLimiting;

var builder = WebApplication.CreateBuilder(args);

// Authentication — Microsoft Entra ID
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddMicrosoftIdentityWebApi(builder.Configuration.GetSection("AzureAd"));

builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("Reader", policy => policy.RequireRole("Reader", "Designer", "Reviewer", "Operator", "Admin"));
    options.AddPolicy("Designer", policy => policy.RequireRole("Designer", "Operator", "Admin"));
    options.AddPolicy("Operator", policy => policy.RequireRole("Operator", "Admin"));
    options.AddPolicy("Admin", policy => policy.RequireRole("Admin"));
});

// Application services
// ResourceGraphService is a concrete dependency of DiscoveryService and TopologyService.
builder.Services.AddScoped<ResourceGraphService>();
builder.Services.AddScoped<IDiscoveryService, DiscoveryService>();
builder.Services.AddScoped<ITopologyService, TopologyService>();
// DataPathService depends on these concrete evaluators — they must be registered too.
builder.Services.AddScoped<EasyAzure.DataPath.Services.NsgEvaluator>();
builder.Services.AddScoped<EasyAzure.DataPath.Services.RouteEvaluator>();
builder.Services.AddScoped<EasyAzure.DataPath.Services.PeeringEvaluator>();
builder.Services.AddScoped<IDataPathService, DataPathService>();
builder.Services.AddScoped<IDesignerService, DesignerService>();
builder.Services.AddScoped<IDesignImportService, DesignImportService>();
builder.Services.AddScoped<IBestPracticeEngine, BestPracticeEngine>();
builder.Services.AddScoped<IRoutingAnalysisService, RoutingAnalysisService>();
builder.Services.AddSingleton<IProductSkillProvider, JsonProductSkillProvider>();
builder.Services.AddSingleton<ProductSkillRegistry>();
builder.Services.AddScoped<IDiscoveryAssistantService, DiscoveryAssistantService>();
builder.Services.AddScoped<IBicepGeneratorService, BicepGeneratorService>();
builder.Services.AddScoped<IDeploymentService, DeploymentService>();
builder.Services.AddScoped<IReplicationService, ReplicationService>();
builder.Services.AddScoped<ISnapshotService, SnapshotService>();

// ProblemDetails ensures unhandled exceptions return a JSON payload (with CORS
// headers attached by UseCors) rather than an empty 500 that the browser
// reports as an opaque "Network Error" because the response carries no
// Access-Control-Allow-Origin header. See:
// https://learn.microsoft.com/aspnet/core/fundamentals/error-handling#problem-details
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<EasyAzure.Api.Middleware.GlobalExceptionHandler>();

// HttpClientFactory is required by BestPracticeEngine to call Azure OpenAI for
// AI-augmented design validation. See:
// https://learn.microsoft.com/aspnet/core/fundamentals/http-requests
builder.Services.AddHttpClient();

builder.Services.AddControllers();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "EasyAzure API", Version = "v1" });
});

builder.Services.AddApplicationInsightsTelemetry();

builder.Services.AddRateLimiter(options =>
{
    options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    options.AddPolicy("assistant", context =>
        RateLimitPartition.GetFixedWindowLimiter(
            context.User.FindFirst("oid")?.Value
                ?? context.User.FindFirst("http://schemas.microsoft.com/identity/claims/objectidentifier")?.Value
                ?? context.Connection.RemoteIpAddress?.ToString()
                ?? "unknown",
            _ => new FixedWindowRateLimiterOptions
            {
                PermitLimit = 12,
                Window = TimeSpan.FromMinutes(1),
                QueueLimit = 0,
                AutoReplenishment = true,
            }));
});

builder.Services.AddCors(options =>
{
    options.AddPolicy("Frontend", policy =>
    {
        policy.WithOrigins(builder.Configuration.GetSection("AllowedOrigins").Get<string[]>() ?? ["http://localhost:3000"])
              .AllowAnyHeader()
              .AllowAnyMethod();
    });
});

var app = builder.Build();

// Load once at startup so an invalid or incomplete skill bundle cannot receive traffic.
_ = app.Services.GetRequiredService<ProductSkillRegistry>();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI();
}

// Exception handler must run BEFORE CORS so the 500 response still gets the
// Access-Control-Allow-Origin header written by the CORS middleware's
// OnStarting callback.
app.UseExceptionHandler();
app.UseStatusCodePages();

app.UseHttpsRedirection();
app.UseCors("Frontend");
app.UseAuthentication();
app.UseRateLimiter();
app.UseAuthorization();
app.MapGet("/health", () => Results.Ok(new
{
    status = "healthy",
    service = "easyazure-api",
    timestamp = DateTimeOffset.UtcNow,
})).AllowAnonymous();
app.MapControllers();

app.Run();
