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

    [Fact]
    public async Task Analyze_SecuredVwanPrivateEndpointWithPoliciesDisabled_ReportsDocumentedFix()
    {
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/private-link-spoke");
        var subnetId = $"{vnetId}/subnets/private-endpoints";
        var peId = ResourceId("Microsoft.Network/privateEndpoints/storage-pe");
        var hubId = ResourceId("Microsoft.Network/virtualHubs/secured-hub");
        var connectionId = $"{hubId}/hubVirtualNetworkConnections/private-link-spoke";
        var intentId = $"{hubId}/routingIntent/default";
        var nvaId = ResourceId("Microsoft.Network/networkVirtualAppliances/security-nva");
        var graph = new TopologyGraph(
        [
            Node(vnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.20.0.0/16")),
            Node(subnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.20.1.0/24",
                ["privateEndpointNetworkPolicies"] = "Disabled",
            }),
            Node(peId, "Microsoft.Network/privateEndpoints", PrivateEndpointProperties("10.20.1.4")),
            Node(connectionId, "Microsoft.Network/virtualHubs/hubVirtualNetworkConnections", new()
            {
                ["remoteVirtualNetwork"] = new Dictionary<string, object> { ["id"] = vnetId },
            }),
            Node(intentId, "Microsoft.Network/virtualHubs/routingIntent", RoutingIntent(nvaId)),
            Node(nvaId, "Microsoft.Network/networkVirtualAppliances", []),
        ],
        [
            new FlowEdge("pe-subnet", peId, subnetId, "in subnet", FlowEdgeCategory.AssociatedWith),
        ]);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "RT-PE-VWAN-001");
        Assert.Equal("confirmed", finding.Confidence);
        Assert.Contains("RouteTableEnabled", finding.Recommendation);
        Assert.Contains("Do not add the Private Endpoint /32", finding.Recommendation);
        Assert.Equal("https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies#troubleshooting", finding.Reference);
    }

    [Fact]
    public async Task Analyze_SecuredVwanPrivateEndpointWithRoutePolicyEnabled_DoesNotFlagPolicy()
    {
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/private-link-spoke");
        var subnetId = $"{vnetId}/subnets/private-endpoints";
        var peId = ResourceId("Microsoft.Network/privateEndpoints/storage-pe");
        var hubId = ResourceId("Microsoft.Network/virtualHubs/secured-hub");
        var graph = new TopologyGraph(
        [
            Node(vnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.20.0.0/16")),
            Node(subnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.20.1.0/24",
                ["privateEndpointNetworkPolicies"] = "RouteTableEnabled",
            }),
            Node(peId, "Microsoft.Network/privateEndpoints", PrivateEndpointProperties("10.20.1.4")),
            Node($"{hubId}/hubVirtualNetworkConnections/private-link-spoke", "Microsoft.Network/virtualHubs/hubVirtualNetworkConnections", new()
            {
                ["remoteVirtualNetwork"] = new Dictionary<string, object> { ["id"] = vnetId },
            }),
            Node($"{hubId}/routingIntent/default", "Microsoft.Network/virtualHubs/routingIntent", RoutingIntent("/providers/test/nva")),
        ],
        [
            new FlowEdge("pe-subnet", peId, subnetId, "in subnet", FlowEdgeCategory.AssociatedWith),
        ]);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        Assert.DoesNotContain(report.Findings, item => item.RuleId == "RT-PE-VWAN-001");
    }

    [Fact]
    public async Task Analyze_SecuredVwanPrivateEndpointWithoutIp_StillFlagsPolicy()
    {
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/private-link-spoke");
        var subnetId = $"{vnetId}/subnets/private-endpoints";
        var peId = ResourceId("Microsoft.Network/privateEndpoints/storage-pe");
        var hubId = ResourceId("Microsoft.Network/virtualHubs/secured-hub");
        var graph = new TopologyGraph(
        [
            Node(vnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.20.0.0/16")),
            Node(subnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.20.1.0/24",
                ["privateEndpointNetworkPolicies"] = "Disabled",
            }),
            Node(peId, "Microsoft.Network/privateEndpoints", PrivateEndpointProperties()),
            Node($"{hubId}/hubVirtualNetworkConnections/private-link-spoke", "Microsoft.Network/virtualHubs/hubVirtualNetworkConnections", new()
            {
                ["remoteVirtualNetwork"] = new Dictionary<string, object> { ["id"] = vnetId },
            }),
            Node($"{hubId}/routingIntent/default", "Microsoft.Network/virtualHubs/routingIntent", RoutingIntent("/providers/test/nva")),
        ],
        [
            new FlowEdge("pe-subnet", peId, subnetId, "in subnet", FlowEdgeCategory.AssociatedWith),
        ]);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "RT-PE-VWAN-001");
        Assert.Contains(finding.Evidence, item => item.Contains("IP enrichment was unavailable"));
    }

    [Fact]
    public async Task Analyze_BroadNvaUdrToPrivateEndpoint_ReportsSpecificOverride()
    {
        var sourceVnetId = ResourceId("Microsoft.Network/virtualNetworks/source");
        var sourceSubnetId = $"{sourceVnetId}/subnets/workload";
        var routeTableId = ResourceId("Microsoft.Network/routeTables/source-routes");
        var peVnetId = ResourceId("Microsoft.Network/virtualNetworks/private-link-spoke");
        var peSubnetId = $"{peVnetId}/subnets/private-endpoints";
        var peId = ResourceId("Microsoft.Network/privateEndpoints/storage-pe");
        var graph = new TopologyGraph(
        [
            Node(sourceVnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.30.0.0/16")),
            Node(sourceSubnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.30.1.0/24",
                ["routeTableId"] = routeTableId,
            }),
            Node(routeTableId, "Microsoft.Network/routeTables", Routes(
                ("private-via-nva", "10.0.0.0/8", "VirtualAppliance", "10.30.10.4"))),
            Node(peVnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.20.0.0/16")),
            Node(peSubnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.20.1.0/24",
                ["privateEndpointNetworkPolicies"] = "Enabled",
            }),
            Node(peId, "Microsoft.Network/privateEndpoints", PrivateEndpointProperties("10.20.1.4")),
        ],
        [
            new FlowEdge("pe-subnet", peId, peSubnetId, "in subnet", FlowEdgeCategory.AssociatedWith),
        ]);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "RT-PE-UDR-001");
        Assert.Equal("potential", finding.Confidence);
        Assert.Contains("10.20.1.4/32", finding.Recommendation);
        Assert.Contains("route table, not an NSG", finding.Recommendation);
    }

    [Fact]
    public async Task Analyze_PrivateEndpointWithSpecificNvaUdr_DoesNotFlagBypass()
    {
        var sourceVnetId = ResourceId("Microsoft.Network/virtualNetworks/source");
        var sourceSubnetId = $"{sourceVnetId}/subnets/workload";
        var routeTableId = ResourceId("Microsoft.Network/routeTables/source-routes");
        var peVnetId = ResourceId("Microsoft.Network/virtualNetworks/private-link-spoke");
        var peSubnetId = $"{peVnetId}/subnets/private-endpoints";
        var peId = ResourceId("Microsoft.Network/privateEndpoints/storage-pe");
        var graph = new TopologyGraph(
        [
            Node(sourceVnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.30.0.0/16")),
            Node(sourceSubnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.30.1.0/24",
                ["routeTableId"] = routeTableId,
            }),
            Node(routeTableId, "Microsoft.Network/routeTables", Routes(
                ("private-via-nva", "10.0.0.0/8", "VirtualAppliance", "10.30.10.4"),
                ("storage-pe-via-nva", "10.20.1.4/32", "VirtualAppliance", "10.30.10.4"))),
            Node(peVnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.20.0.0/16")),
            Node(peSubnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.20.1.0/24",
                ["privateEndpointNetworkPolicies"] = "Enabled",
            }),
            Node(peId, "Microsoft.Network/privateEndpoints", PrivateEndpointProperties("10.20.1.4")),
        ],
        [
            new FlowEdge("pe-subnet", peId, peSubnetId, "in subnet", FlowEdgeCategory.AssociatedWith),
        ]);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        Assert.DoesNotContain(report.Findings, item => item.RuleId == "RT-PE-UDR-001");
    }

    [Fact]
    public async Task Analyze_MultiIpPrivateEndpoint_EvaluatesEachIpIndependently()
    {
        var sourceVnetId = ResourceId("Microsoft.Network/virtualNetworks/source");
        var sourceSubnetId = $"{sourceVnetId}/subnets/workload";
        var routeTableId = ResourceId("Microsoft.Network/routeTables/source-routes");
        var peVnetId = ResourceId("Microsoft.Network/virtualNetworks/private-link-spoke");
        var peSubnetId = $"{peVnetId}/subnets/private-endpoints";
        var peId = ResourceId("Microsoft.Network/privateEndpoints/multi-ip-pe");
        var graph = new TopologyGraph(
        [
            Node(sourceVnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.30.0.0/16")),
            Node(sourceSubnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.30.1.0/24",
                ["routeTableId"] = routeTableId,
            }),
            Node(routeTableId, "Microsoft.Network/routeTables", Routes(
                ("private-via-nva", "10.0.0.0/8", "VirtualAppliance", "10.30.10.4"),
                ("first-pe-ip-via-nva", "10.20.1.4/32", "VirtualAppliance", "10.30.10.4"))),
            Node(peVnetId, "Microsoft.Network/virtualNetworks", AddressSpace("10.20.0.0/16")),
            Node(peSubnetId, "Microsoft.Network/virtualNetworks/subnets", new()
            {
                ["addressPrefix"] = "10.20.1.0/24",
                ["privateEndpointNetworkPolicies"] = "Enabled",
            }),
            Node(peId, "Microsoft.Network/privateEndpoints", PrivateEndpointProperties("10.20.1.4", "10.20.1.5")),
        ],
        [
            new FlowEdge("pe-subnet", peId, peSubnetId, "in subnet", FlowEdgeCategory.AssociatedWith),
        ]);

        var report = await CreateService().AnalyzeAsync(graph, useAi: false);

        var finding = Assert.Single(report.Findings, item => item.RuleId == "RT-PE-UDR-001");
        Assert.Contains("10.20.1.5/32", finding.Recommendation);
        Assert.DoesNotContain("10.20.1.4/32", finding.Recommendation);
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

    private static Dictionary<string, object> PrivateEndpointProperties(params string[] ips) =>
        new()
        {
            ["privateIPAddresses"] = ips.Cast<object>().ToList(),
        };

    private static Dictionary<string, object> RoutingIntent(string nextHopId) =>
        new()
        {
            ["routingPolicies"] = new List<object>
            {
                new Dictionary<string, object>
                {
                    ["name"] = "PrivateTraffic",
                    ["destinations"] = new List<object> { "PrivateTraffic" },
                    ["nextHop"] = nextHopId,
                },
            },
        };

    private static string ResourceId(string suffix) =>
        $"/subscriptions/{SubscriptionId}/resourceGroups/network-rg/providers/{suffix}";
}