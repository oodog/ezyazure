using EasyAzure.DiscoveryWorker;
using EasyAzure.Discovery.Services;
using EasyAzure.Topology.Services;
using EasyAzure.Core.Interfaces;

var builder = Host.CreateApplicationBuilder(args);

builder.Services.AddApplicationInsightsTelemetryWorkerService();
builder.Services.AddScoped<ResourceGraphService>();
builder.Services.AddScoped<ITopologyService, TopologyService>();
builder.Services.AddScoped<DiscoveryService>();
builder.Services.AddScoped<TopologyService>();
builder.Services.AddScoped<DiscoveryJob>();

var host = builder.Build();

// Container Apps Jobs run to completion — not a long-running host.
using var scope = host.Services.CreateScope();
var job = scope.ServiceProvider.GetRequiredService<DiscoveryJob>();
await job.RunAsync();
