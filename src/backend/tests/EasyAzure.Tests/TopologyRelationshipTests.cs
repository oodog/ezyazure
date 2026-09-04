using EasyAzure.Core.Models;
using EasyAzure.Topology.Services;

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
}