using EasyAzure.Core.Models;
using EasyAzure.Designer.Services;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace EasyAzure.Tests;

public class RoutingAnalysisTests
{
    private const string SubscriptionId = "00000000-0000-0000-0000-000000000001";

    [Fact]
    public async Task Analyze_OneWayPeeringUdr_ReportsPotentialAsymmetryWithEvidence()
    {
        var vnetAId = ResourceId("Microsoft.Network/virtualNetworks/vnet-a");
        var vnetBId = ResourceId("Microsoft.Network/virtualNetworks/vnet-b");
        var subnetAId = $"{vnetAId}/subnets/workload";
        var subnetBId = $"{vnetBId}/subnets/workload";
        var routeTableAId = ResourceId("Microsoft.Network/routeTables/rt-a");
        var graph = new TopologyGraph(
        [
            Node(vnetAId, "Microsoft.Network/virtualNetworks", AddressSpace("10.0.0.0/16")),
            Node(vnetBId, "Microsoft.Network/virtualNetworks", AddressSpace("10.1.0.0/16")),
            Node(subnetAId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.0.1.0/24",
                ["routeTableId"] = routeTableAId,
            }),
            Node(subnetBId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.1.1.0/24",
            }),
            Node(routeTableAId, "Microsoft.Network/routeTables", Routes(
                ("to-vnet-b", "10.1.0.0/16", "VirtualAppliance", "10.0.10.4"))),
        ],
        [
            new FlowEdge("peering", vnetAId, vnetBId, "peered", FlowEdgeCategory.Peering),
        ]);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "RT-ASYM-004");
        Assert.Equal("potential", finding.Confidence);
        Assert.Contains(finding.Evidence, item => item.Contains("No matching reverse UDR"));
        Assert.False(report.EffectiveRoutesEvaluated);
        Assert.NotEmpty(report.Limitations);
    }

    [Fact]
    public async Task Analyze_DefaultRouteOnAzureFirewallSubnet_ReportsConfirmedLoop()
    {
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/hub");
        var subnetId = $"{vnetId}/subnets/AzureFirewallSubnet";
        var routeTableId = ResourceId("Microsoft.Network/routeTables/firewall-subnet-rt");
        var graph = new TopologyGraph(
        [
            Node(vnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.0.0.0/16")),
            Node(subnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.0.0.0/26",
                ["routeTableId"] = routeTableId,
            }),
            Node(routeTableId, "Microsoft.Network/routeTables", Routes(
                ("default", "0.0.0.0/0", "VirtualAppliance", "10.0.0.4"))),
        ],
        []);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "RT-LOOP-001");
        Assert.Equal("confirmed", finding.Confidence);
        Assert.Contains(finding.Evidence, item => item.Contains("AzureFirewallSubnet"));
    }

    private static RoutingAnalysisService CreateService() =>
        new(
            NullLogger<RoutingAnalysisService>.Instance,
            new ConfigurationBuilder().Build());

    private static FlowNode Node(string id, string type, Dictionary<string, object> properties) =>
        new(
            id,
            "azureResource",
            new FlowPosition(0, 0),
            new AzureResource
            {
                Id = id,
                Name = id[(id.LastIndexOf('/') + 1)..],
                Type = type,
                SubscriptionId = SubscriptionId,
                ResourceGroup = "network-rg",
                Location = "australiaeast",
                Properties = properties,
            });

    private static Dictionary<string, object> AddressSpace(string prefix) =>
        new()
        {
            ["addressSpace"] = new Dictionary<string, object>
            {
                ["addressPrefixes"] = new List<object> { prefix },
            },
        };

    private static Dictionary<string, object> Routes(
        params (string Name, string Prefix, string NextHopType, string NextHopIp)[] routes) =>
        new()
        {
            ["routes"] = routes.Select(route => (object)new Dictionary<string, object>
            {
                ["name"] = route.Name,
                ["properties"] = new Dictionary<string, object>
                {
                    ["addressPrefix"] = route.Prefix,
                    ["nextHopType"] = route.NextHopType,
                    ["nextHopIpAddress"] = route.NextHopIp,
                },
            }).ToList(),
        };

    private static string ResourceId(string suffix) =>
        $"/subscriptions/{SubscriptionId}/resourceGroups/network-rg/providers/{suffix}";
}