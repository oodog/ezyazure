using EasyAzure.Core.Models;
using EasyAzure.Discovery.Services;
using EasyAzure.Topology.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Newtonsoft.Json.Linq;

namespace EasyAzure.Tests;

public class TopologyRelationshipTests
{
    private const string SubscriptionId = "00000000-0000-0000-0000-000000000001";
    private const string ResourceGroup = "network-rg";

    [Fact]
    public void BuildEdges_PrivateEndpointNativeProperties_ConnectsSubnetAndTargetService()
    {
        var subnetId = ResourceId("Microsoft.Network/virtualNetworks/vnet-a/subnets/private-endpoints");
        var storageId = ResourceId("Microsoft.Storage/storageAccounts/storagea");
        var privateEndpoint = Resource(
            ResourceId("Microsoft.Network/privateEndpoints/storage-pe"),
            "Microsoft.Network/privateEndpoints",
            new Dictionary<string, object>
            {
                ["subnet"] = new Dictionary<string, object> { ["id"] = subnetId },
                ["privateLinkServiceConnections"] = new List<object>
                {
                    new Dictionary<string, object>
                    {
                        ["properties"] = new Dictionary<string, object>
                        {
                            ["privateLinkServiceId"] = storageId,
                            ["groupIds"] = new List<object> { "blob" },
                            ["privateLinkServiceConnectionState"] = new Dictionary<string, object>
                            {
                                ["status"] = "Approved",
                            },
                        },
                    },
                },
            });
        var resources = new List<AzureResource>
        {
            privateEndpoint,
            Resource(subnetId, "Microsoft.Network/virtualNetworks/subnets"),
            Resource(storageId, "Microsoft.Storage/storageAccounts"),
        };

        var edges = TopologyService.BuildEdges(resources, []);

        Assert.Contains(edges, edge =>
            edge.Source == privateEndpoint.Id
            && edge.Target == subnetId
            && edge.Category == FlowEdgeCategory.AssociatedWith);
        var serviceEdge = Assert.Single(edges, edge =>
            edge.Source == privateEndpoint.Id
            && edge.Target == storageId);
        Assert.Equal(FlowEdgeCategory.AssociatedWith, serviceEdge.Category);
        Assert.Contains("blob", serviceEdge.Label);
        Assert.Contains("Approved", serviceEdge.Label);
    }

    [Fact]
    public void BuildEdges_AvsCircuitReference_CreatesGenericRelationship()
    {
        var circuitId = ResourceId("Microsoft.Network/expressRouteCircuits/avs-circuit");
        var privateCloud = Resource(
            ResourceId("Microsoft.AVS/privateClouds/avs-a"),
            "Microsoft.AVS/privateClouds",
            new Dictionary<string, object>
            {
                ["circuit"] = new Dictionary<string, object>
                {
                    ["expressRouteID"] = circuitId,
                },
            });
        var resources = new List<AzureResource>
        {
            privateCloud,
            Resource(circuitId, "Microsoft.Network/expressRouteCircuits"),
        };

        var edges = TopologyService.BuildEdges(resources, []);

        var edge = Assert.Single(edges, candidate =>
            candidate.Source == privateCloud.Id
            && candidate.Target == circuitId);
        Assert.Equal(FlowEdgeCategory.ConnectedTo, edge.Category);
        Assert.Equal("armReference", edge.Metadata?["relationship"]);
        Assert.Contains("expressRouteID", edge.Metadata?["propertyPath"]);
    }

    [Fact]
    public void BuildEdges_VmNetworkInterfaceAndNsg_CreatesCompleteAssociationChain()
    {
        var vmId = ResourceId("Microsoft.Compute/virtualMachines/vm-a");
        var nicId = ResourceId("Microsoft.Network/networkInterfaces/vm-a-nic");
        var nsgId = ResourceId("Microsoft.Network/networkSecurityGroups/vm-a-nsg");
        var vm = Resource(
            vmId,
            "Microsoft.Compute/virtualMachines",
            new Dictionary<string, object>
            {
                ["networkProfile"] = new Dictionary<string, object>
                {
                    ["networkInterfaces"] = new List<object>
                    {
                        new Dictionary<string, object> { ["id"] = nicId },
                    },
                },
            });
        var nic = Resource(
            nicId,
            "Microsoft.Network/networkInterfaces",
            new Dictionary<string, object>
            {
                ["networkSecurityGroup"] = new Dictionary<string, object> { ["id"] = nsgId },
            });
        var resources = new List<AzureResource>
        {
            vm,
            nic,
            Resource(nsgId, "Microsoft.Network/networkSecurityGroups"),
        };

        var edges = TopologyService.BuildEdges(resources, [nic]);

        var vmToNic = Assert.Single(edges, edge => edge.Source == vmId && edge.Target == nicId);
        Assert.Equal(FlowEdgeCategory.ConnectedTo, vmToNic.Category);
        Assert.Contains("networkInterfaces", vmToNic.Metadata?["propertyPath"]);

        var nicToNsg = Assert.Single(edges, edge => edge.Source == nicId && edge.Target == nsgId);
        Assert.Equal(FlowEdgeCategory.ConnectedTo, nicToNsg.Category);
        Assert.Contains("networkSecurityGroup", nicToNsg.Metadata?["propertyPath"]);
    }

    [Fact]
    public void BuildEdges_HubVirtualNetworkConnection_ConnectsVnetToParentHub()
    {
        var hubId = ResourceId("Microsoft.Network/virtualHubs/hub-a");
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/spoke-a");
        var connection = Resource(
            $"{hubId}/hubVirtualNetworkConnections/spoke-a",
            "Microsoft.Network/virtualHubs/hubVirtualNetworkConnections",
            new Dictionary<string, object>
            {
                ["provisioningState"] = "Succeeded",
                ["remoteVirtualNetwork"] = new Dictionary<string, object> { ["id"] = vnetId },
            });
        var resources = new List<AzureResource>
        {
            Resource(hubId, "Microsoft.Network/virtualHubs"),
            Resource(vnetId, "Microsoft.Network/virtualNetworks"),
            connection,
        };

        var edges = TopologyService.BuildEdges(resources, []);

        var edge = Assert.Single(edges, candidate => candidate.Source == vnetId && candidate.Target == hubId);
        Assert.Equal(FlowEdgeCategory.ConnectedTo, edge.Category);
        Assert.Contains("Virtual Hub", edge.Label);
        Assert.Equal("hubVirtualNetworkConnection", edge.Metadata?["relationship"]);
        Assert.Equal(connection.Id, edge.Metadata?["connectionId"]);
    }

    [Fact]
    public void BuildEdges_VirtualWanRoutingIntent_CreatesHierarchyAndPolicyRoutes()
    {
        var virtualWanId = ResourceId("Microsoft.Network/virtualWans/wan-a");
        var hubId = ResourceId("Microsoft.Network/virtualHubs/hub-a");
        var firewallId = ResourceId("Microsoft.Network/azureFirewalls/firewall-a");
        var routingIntentId = $"{hubId}/routingIntent/hubRoutingIntent";
        var hub = Resource(
            hubId,
            "Microsoft.Network/virtualHubs",
            new Dictionary<string, object>
            {
                ["virtualWan"] = new Dictionary<string, object> { ["id"] = virtualWanId },
            });
        var routingIntent = Resource(
            routingIntentId,
            "Microsoft.Network/virtualHubs/routingIntent",
            new Dictionary<string, object>
            {
                ["routingPolicies"] = new List<object>
                {
                    new Dictionary<string, object>
                    {
                        ["name"] = "Internet",
                        ["destinations"] = new List<object> { "Internet" },
                        ["nextHop"] = firewallId,
                    },
                    new Dictionary<string, object>
                    {
                        ["name"] = "PrivateTraffic",
                        ["destinations"] = new List<object> { "PrivateTraffic" },
                        ["nextHop"] = firewallId,
                    },
                },
            });
        var resources = new List<AzureResource>
        {
            Resource(virtualWanId, "Microsoft.Network/virtualWans"),
            hub,
            routingIntent,
            Resource(firewallId, "Microsoft.Network/azureFirewalls"),
        };

        var edges = TopologyService.BuildEdges(resources, []);

        Assert.Contains(edges, edge =>
            edge.Source == virtualWanId
            && edge.Target == hubId
            && edge.Category == FlowEdgeCategory.Contains);
        Assert.Contains(edges, edge =>
            edge.Source == hubId
            && edge.Target == routingIntentId
            && edge.Category == FlowEdgeCategory.Contains);
        var policyRoutes = edges.Where(edge =>
            edge.Source == routingIntentId
            && edge.Target == firewallId).ToList();
        Assert.Equal(2, policyRoutes.Count);
        Assert.Contains(policyRoutes, edge =>
            edge.Metadata?["destinations"] == "Internet"
            && edge.Category == FlowEdgeCategory.DefaultRoute);
        Assert.Contains(policyRoutes, edge =>
            edge.Metadata?["destinations"] == "PrivateTraffic"
            && edge.Category == FlowEdgeCategory.Route);
        Assert.DoesNotContain(edges, edge =>
            edge.Source == hubId
            && edge.Target == virtualWanId
            && edge.Metadata?["relationship"] == "armReference");
    }

    [Fact]
    public async Task BuildTopology_ResourceGraphOmitsVwanChildren_HydratesThemFromArmCollections()
    {
        var virtualWanId = ResourceId("Microsoft.Network/virtualWans/wan-a");
        var hubId = ResourceId("Microsoft.Network/virtualHubs/hub-a");
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/spoke-a");
        var firewallId = ResourceId("Microsoft.Network/azureFirewalls/firewall-a");
        var connectionId = $"{hubId}/hubVirtualNetworkConnections/spoke-a";
        var routingIntentId = $"{hubId}/routingIntent/hubRoutingIntent";
        var inventory = new List<AzureResource>
        {
            Resource(virtualWanId, "Microsoft.Network/virtualWans"),
            Resource(
                hubId,
                "Microsoft.Network/virtualHubs",
                new Dictionary<string, object>
                {
                    ["virtualWan"] = new Dictionary<string, object> { ["id"] = virtualWanId },
                }),
            Resource(vnetId, "Microsoft.Network/virtualNetworks"),
            Resource(firewallId, "Microsoft.Network/azureFirewalls"),
        };
        var armResponses = new Dictionary<string, JObject>(StringComparer.OrdinalIgnoreCase)
        {
            [$"{hubId}/hubVirtualNetworkConnections"] = JObject.Parse($$"""
                { "value": [{ "id": "{{connectionId}}", "name": "spoke-a", "type": "Microsoft.Network/virtualHubs/hubVirtualNetworkConnections", "properties": { "provisioningState": "Succeeded", "remoteVirtualNetwork": { "id": "{{vnetId}}" } } }] }
                """),
            [$"{hubId}/routingIntent"] = JObject.Parse($$"""
                { "value": [{ "id": "{{routingIntentId}}", "name": "hubRoutingIntent", "type": "Microsoft.Network/virtualHubs/routingIntent", "properties": { "provisioningState": "Succeeded", "routingPolicies": [{ "name": "PrivateTraffic", "destinations": ["PrivateTraffic"], "nextHop": "{{firewallId}}" }] } }] }
                """),
        };
        var topology = new TopologyService(
            new StubResourceGraphService(inventory, armResponses),
            NullLogger<TopologyService>.Instance);

        var graph = await topology.BuildTopologyAsync(SubscriptionId);

        Assert.Contains(graph.Nodes, node => node.Id == connectionId);
        Assert.Contains(graph.Nodes, node => node.Id == routingIntentId);
        Assert.Contains(graph.Edges, edge => edge.Source == vnetId && edge.Target == hubId);
        Assert.Contains(graph.Edges, edge =>
            edge.Source == routingIntentId
            && edge.Target == firewallId
            && edge.Metadata?["destinations"] == "PrivateTraffic");
    }

    [Fact]
    public void BuildEdges_InternetRoutingIntent_ReplacesDirectSystemDefaultWithSecuredHubPath()
    {
        var virtualWanId = ResourceId("Microsoft.Network/virtualWans/wan-a");
        var hubId = ResourceId("Microsoft.Network/virtualHubs/hub-a");
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/spoke-a");
        var subnetId = $"{vnetId}/subnets/default";
        var firewallId = ResourceId("Microsoft.Network/azureFirewalls/firewall-a");
        var routingIntentId = $"{hubId}/routingIntent/hubRoutingIntent";
        var resources = new List<AzureResource>
        {
            Resource(virtualWanId, "Microsoft.Network/virtualWans"),
            Resource(hubId, "Microsoft.Network/virtualHubs", new Dictionary<string, object>
            {
                ["virtualWan"] = new Dictionary<string, object> { ["id"] = virtualWanId },
            }),
            Resource(vnetId, "Microsoft.Network/virtualNetworks"),
            Resource(subnetId, "Microsoft.Network/virtualNetworks/subnets"),
            Resource(firewallId, "Microsoft.Network/azureFirewalls"),
            Resource(
                $"{hubId}/hubVirtualNetworkConnections/spoke-a",
                "Microsoft.Network/virtualHubs/hubVirtualNetworkConnections",
                new Dictionary<string, object>
                {
                    ["provisioningState"] = "Succeeded",
                    ["enableInternetSecurity"] = true,
                    ["remoteVirtualNetwork"] = new Dictionary<string, object> { ["id"] = vnetId },
                }),
            Resource(
                routingIntentId,
                "Microsoft.Network/virtualHubs/routingIntent",
                new Dictionary<string, object>
                {
                    ["provisioningState"] = "Succeeded",
                    ["routingPolicies"] = new List<object>
                    {
                        new Dictionary<string, object>
                        {
                            ["name"] = "Internet",
                            ["destinations"] = new List<object> { "Internet" },
                            ["nextHop"] = firewallId,
                        },
                    },
                }),
        };

        var edges = TopologyService.BuildEdges(resources, []);

        Assert.DoesNotContain(edges, edge =>
            edge.Source == subnetId
            && edge.Target == "easyazure://internet");
        var subnetToHub = Assert.Single(edges, edge =>
            edge.Source == subnetId
            && edge.Target == hubId
            && edge.Category == FlowEdgeCategory.DefaultRoute);
        Assert.Equal("vwanRoutingIntent", subnetToHub.Metadata?["source"]);
        Assert.Contains(edges, edge =>
            edge.Source == routingIntentId
            && edge.Target == firewallId
            && edge.Category == FlowEdgeCategory.DefaultRoute);
        Assert.Contains(edges, edge =>
            edge.Source == firewallId
            && edge.Target == "easyazure://internet"
            && edge.Category == FlowEdgeCategory.DefaultRoute);
    }

    [Theory]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public void BuildEdges_InternetRoutingIntentNotApplied_KeepsDirectSystemDefault(
        bool enableInternetSecurity,
        bool includeInternetPolicy)
    {
        var hubId = ResourceId("Microsoft.Network/virtualHubs/hub-a");
        var vnetId = ResourceId("Microsoft.Network/virtualNetworks/spoke-a");
        var subnetId = $"{vnetId}/subnets/default";
        var firewallId = ResourceId("Microsoft.Network/azureFirewalls/firewall-a");
        var resources = new List<AzureResource>
        {
            Resource(hubId, "Microsoft.Network/virtualHubs"),
            Resource(vnetId, "Microsoft.Network/virtualNetworks"),
            Resource(subnetId, "Microsoft.Network/virtualNetworks/subnets"),
            Resource(firewallId, "Microsoft.Network/azureFirewalls"),
            Resource(
                $"{hubId}/hubVirtualNetworkConnections/spoke-a",
                "Microsoft.Network/virtualHubs/hubVirtualNetworkConnections",
                new Dictionary<string, object>
                {
                    ["enableInternetSecurity"] = enableInternetSecurity,
                    ["remoteVirtualNetwork"] = new Dictionary<string, object> { ["id"] = vnetId },
                }),
        };
        if (includeInternetPolicy)
        {
            resources.Add(Resource(
                $"{hubId}/routingIntent/hubRoutingIntent",
                "Microsoft.Network/virtualHubs/routingIntent",
                new Dictionary<string, object>
                {
                    ["routingPolicies"] = new List<object>
                    {
                        new Dictionary<string, object>
                        {
                            ["name"] = "Internet",
                            ["destinations"] = new List<object> { "Internet" },
                            ["nextHop"] = firewallId,
                        },
                    },
                }));
        }

        var edges = TopologyService.BuildEdges(resources, []);

        Assert.Contains(edges, edge =>
            edge.Source == subnetId
            && edge.Target == "easyazure://internet"
            && edge.Metadata?["source"] == "system");
        Assert.DoesNotContain(edges, edge =>
            edge.Source == subnetId
            && edge.Target == hubId
            && edge.Metadata?["source"] == "vwanRoutingIntent");
    }

    private static AzureResource Resource(
        string id,
        string type,
        Dictionary<string, object>? properties = null) =>
        new()
        {
            Id = id,
            Name = id[(id.LastIndexOf('/') + 1)..],
            Type = type,
            SubscriptionId = SubscriptionId,
            ResourceGroup = ResourceGroup,
            Location = "australiaeast",
            Properties = properties ?? [],
        };

    private static string ResourceId(string suffix) =>
        $"/subscriptions/{SubscriptionId}/resourceGroups/{ResourceGroup}/providers/{suffix}";

    private sealed class StubResourceGraphService(
        IReadOnlyList<AzureResource> resources,
        IReadOnlyDictionary<string, JObject> armResponses)
        : ResourceGraphService(NullLogger<ResourceGraphService>.Instance)
    {
        public override Task<IReadOnlyList<AzureResource>> GetAllResourcesAsync(
            string subscriptionId,
            CancellationToken ct = default) =>
            Task.FromResult(resources);

        public override Task<JObject?> GetArmResourceAsync(
            string resourceId,
            string apiVersion,
            CancellationToken ct = default) =>
            Task.FromResult(armResponses.GetValueOrDefault(resourceId));
    }
}