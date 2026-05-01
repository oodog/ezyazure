using EasyAzure.Core.Models;
using EasyAzure.DataPath.Services;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Moq;

namespace EasyAzure.DataPath.Tests;

public class DataPathServiceTests
{
    private static DataPathService CreateService()
    {
        var nsg = new NsgEvaluator(NullLogger<NsgEvaluator>.Instance);
        var route = new RouteEvaluator(NullLogger<RouteEvaluator>.Instance);
        var peering = new PeeringEvaluator(NullLogger<PeeringEvaluator>.Instance);
        return new DataPathService(nsg, route, peering, NullLogger<DataPathService>.Instance);
    }

    [Fact]
    public async Task Analyze_StandardTcpPath_ShouldReturnAllowed()
    {
        var svc = CreateService();
        var request = new DataPathRequest
        {
            SourceResourceId = "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-a",
            DestinationResourceId = "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/privateEndpoints/sql-pe",
            Protocol = "TCP",
            DestinationPort = 1433,
        };

        var result = await svc.AnalyzeAsync(request);

        result.Status.Should().Be(PathStatus.Allowed);
        result.Hops.Should().NotBeEmpty();
    }

    [Fact]
    public async Task Analyze_ManagementPort_ShouldIncludeRiskNote()
    {
        var svc = CreateService();
        var request = new DataPathRequest
        {
            SourceResourceId = "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-a",
            DestinationResourceId = "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-b",
            Protocol = "TCP",
            DestinationPort = 22,
        };

        var result = await svc.AnalyzeAsync(request);

        result.RiskNotes.Should().Contain(n => n.Contains("Bastion") || n.Contains("management"));
    }

    [Fact]
    public async Task Analyze_ShouldIncludeSourceAndDestinationHops()
    {
        var svc = CreateService();
        var request = new DataPathRequest
        {
            SourceResourceId = "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm-a",
            DestinationResourceId = "/subscriptions/test/resourceGroups/rg/providers/Microsoft.Network/privateEndpoints/pe-sql",
            Protocol = "TCP",
            DestinationPort = 443,
        };

        var result = await svc.AnalyzeAsync(request);

        result.Hops.Should().Contain(h => h.ResourceId.Contains("vm-a"));
        result.Hops.Should().Contain(h => h.ResourceId.Contains("pe-sql"));
    }
}
