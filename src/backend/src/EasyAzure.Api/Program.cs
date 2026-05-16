using EasyAzure.Core.Interfaces;
using EasyAzure.Discovery.Services;
using EasyAzure.Topology.Services;
using EasyAzure.DataPath.Services;
using EasyAzure.Designer.Services;
using EasyAzure.IaC.Services;
using Microsoft.Identity.Web;
using Microsoft.AspNetCore.Authentication.JwtBearer;

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
builder.Services.AddScoped<IDataPathService, DataPathService>();
builder.Services.AddScoped<IDesignerService, DesignerService>();
builder.Services.AddScoped<IBestPracticeEngine, BestPracticeEngine>();
builder.Services.AddScoped<IBicepGeneratorService, BicepGeneratorService>();
builder.Services.AddScoped<IDeploymentService, DeploymentService>();
builder.Services.AddScoped<IReplicationService, ReplicationService>();

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
app.UseAuthorization();
app.MapControllers();

app.Run();
