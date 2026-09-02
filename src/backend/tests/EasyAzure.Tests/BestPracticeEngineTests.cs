using EasyAzure.Core.Models;
using EasyAzure.Designer.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EasyAzure.Tests;

public class BestPracticeEngineTests
{
    [Fact]
    public async Task ValidateDesign_FlagsSecuredVwanWhenPeRoutePolicyIsDisabled()
    {
        var request = VwanDesign("Disabled");

        var report = await CreateEngine().ValidateDesignAsync(request);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "PE.VWAN.RoutePolicy");
        Assert.Equal("rule", finding.Source);
        Assert.True(finding.RequiresAcknowledgement);
        Assert.Contains("RouteTableEnabled", finding.Message);
        Assert.Contains("Do not add the PE /32", finding.Message);
    }

    [Fact]
    public async Task ValidateDesign_AcceptsSecuredVwanWhenPeRoutePolicyIsEnabled()
    {
        var request = VwanDesign("RouteTableEnabled");

        var report = await CreateEngine().ValidateDesignAsync(request);

        Assert.DoesNotContain(report.Findings, item => item.RuleId == "PE.VWAN.RoutePolicy");
    }

    [Fact]
    public async Task ValidateDesign_FlagsBroadNvaRouteWithoutPeOverride()
    {
        var request = ClassicNvaDesign(includeOverride: false);

        var report = await CreateEngine().ValidateDesignAsync(request);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "PE.UDR.Asymmetry");
        Assert.Equal("rule", finding.Source);
        Assert.True(finding.RequiresAcknowledgement);
        Assert.Contains("10.20.1.4/32", finding.Message);
        Assert.Contains("UDR, not an NSG route", finding.Message);
    }

    [Fact]
    public async Task ValidateDesign_AcceptsMatchingPeRouteThroughSameNva()
    {
        var request = ClassicNvaDesign(includeOverride: true);

        var report = await CreateEngine().ValidateDesignAsync(request);

        Assert.DoesNotContain(report.Findings, item => item.RuleId == "PE.UDR.Asymmetry");
    }

    private static BestPracticeEngine CreateEngine() => new(
        NullLogger<BestPracticeEngine>.Instance,
        new ConfigurationBuilder().Build());

    private static DesignValidationRequest VwanDesign(string policy) => new()
    {
        UseAi = false,
        Nodes =
        [
            Node("vnet", "VNet", new() { ["addressSpace"] = new[] { "10.20.0.0/16" } }),
            Node("pe-subnet", "Subnet", new() { ["privateEndpointPolicies"] = policy }, "vnet"),
            Node("pe", "Private Endpoint", new() { ["privateIpAddress"] = "10.20.1.4" }, "pe-subnet"),
            Node("vwan", "Virtual WAN"),
            Node("hub", "Virtual Hub", parentId: "vwan"),
            Node("intent", "Route Intent", new()
            {
                ["privateTraffic"] = "NVA",
                ["nextHopResourceId"] = "/nva",
            }, "hub"),
        ],
        Edges = [Edge("vnet-hub", "vnet", "hub")],
    };

    private static DesignValidationRequest ClassicNvaDesign(bool includeOverride)
    {
        var routes = "private|10.0.0.0/8|VirtualAppliance|10.30.10.4";
        if (includeOverride)
            routes += "\npe|10.20.1.4/32|VirtualAppliance|10.30.10.4";

        return new DesignValidationRequest
        {
            UseAi = false,
            Nodes =
            [
                Node("vnet", "VNet", new() { ["addressSpace"] = new[] { "10.20.0.0/16" } }),
                Node("pe-subnet", "Subnet", new() { ["privateEndpointPolicies"] = "Enabled" }, "vnet"),
                Node("pe", "Private Endpoint", new() { ["privateIpAddress"] = "10.20.1.4" }, "pe-subnet"),
                Node("source-vnet", "VNet", new() { ["addressSpace"] = new[] { "10.30.0.0/16" } }),
                Node("source-subnet", "Subnet", parentId: "source-vnet"),
                Node("routes", "Route Table", new() { ["routes"] = routes }),
                Node("nva", "NVA"),
            ],
            Edges = [Edge("routes-source", "routes", "source-subnet")],
        };
    }

    private static DesignValidationNode Node(
        string id,
        string blockType,
        Dictionary<string, object?>? properties = null,
        string? parentId = null) => new()
        {
            Id = id,
            Label = id,
            BlockType = blockType,
            ParentId = parentId,
            Properties = properties ?? [],
        };

    private static DesignValidationEdge Edge(string id, string source, string target) => new()
    {
        Id = id,
        Source = source,
        Target = target,
    };
}