using EasyAzure.Core.Models;
using EasyAzure.Discovery.Services;
using EasyAzure.Topology.Services;
using Microsoft.Extensions.Logging.Abstractions;

namespace EasyAzure.Tests;

public class DiscoveryCoverageTests
{
    [Fact]
    public async Task BuildTopologyMulti_WhenOneSubscriptionFails_ReturnsPartialCoverage()
    {
        var resourceGraph = new StubResourceGraphService("denied-subscription");
        var topology = new TopologyService(resourceGraph, NullLogger<TopologyService>.Instance);

        var graph = await topology.BuildTopologyMultiAsync(["visible-subscription", "denied-subscription"]);

        Assert.NotNull(graph.Coverage);
        Assert.False(graph.Coverage.IsComplete);
        Assert.Equal(["visible-subscription", "denied-subscription"], graph.Coverage.RequestedSubscriptionIds);
        Assert.Equal(["visible-subscription"], graph.Coverage.SuccessfulSubscriptionIds);
        var failure = Assert.Single(graph.Coverage.Failures);
        Assert.Equal("denied-subscription", failure.SubscriptionId);
        Assert.Equal("AzureResourceGraph", failure.Stage);
        Assert.Equal(nameof(UnauthorizedAccessException), failure.FailureType);
    }

    private sealed class StubResourceGraphService(string failingSubscriptionId)
        : ResourceGraphService(NullLogger<ResourceGraphService>.Instance)
    {
        public override Task<IReadOnlyList<AzureResource>> GetAllResourcesAsync(
            string subscriptionId,
            CancellationToken ct = default) =>
            subscriptionId == failingSubscriptionId
                ? Task.FromException<IReadOnlyList<AzureResource>>(
                    new UnauthorizedAccessException("Simulated RBAC failure."))
                : Task.FromResult<IReadOnlyList<AzureResource>>([]);
    }
}