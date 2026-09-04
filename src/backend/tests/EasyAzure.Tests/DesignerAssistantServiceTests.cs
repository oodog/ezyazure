using EasyAzure.Core.Models;
using EasyAzure.Designer.Services;

namespace EasyAzure.Tests;

public class DesignerAssistantServiceTests
{
    [Fact]
    public void NormalizePlan_DropsActionsWhenClarificationIsRequired()
    {
        var plan = new DesignerAssistantService.AiPlan(
            "A firewall IP is required.",
            true,
            "What is the firewall private IP?",
            [AddNode("routes", "Route Table")],
            []);

        var result = DesignerAssistantService.NormalizePlan(plan, Request(), "gpt-4o-mini");

        Assert.True(result.RequiresClarification);
        Assert.Empty(result.Actions);
        Assert.Equal("What is the firewall private IP?", result.Clarification);
    }

    [Fact]
    public void NormalizePlan_RejectsBaselineUpdatesAndUnknownConnections()
    {
        var plan = new DesignerAssistantService.AiPlan(
            "Add private access.",
            false,
            null,
            [
                new DesignerAssistantService.AiAction(
                    "updateNode", "baseline-vnet", null, null, null, null, null,
                    [new("addressSpace", "10.0.0.0/16")], "Change the VNet."),
                AddNode("storage", "Storage Account"),
                new DesignerAssistantService.AiAction(
                    "connect", null, "missing", "storage", null, null, null, [], "Connect resources."),
            ],
            []);

        var result = DesignerAssistantService.NormalizePlan(plan, Request(), "gpt-4o-mini");

        var action = Assert.Single(result.Actions);
        Assert.Equal("addNode", action.Kind);
        Assert.Equal("storage", action.NodeRef);
        Assert.Contains(result.Warnings, warning => warning.Contains("read-only", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(result.Warnings, warning => warning.Contains("unknown", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void NormalizePlan_FiltersUnsupportedPropertiesAndDuplicateRefs()
    {
        var first = AddNode("storage", "Storage Account") with
        {
            Properties =
            [
                new("resourceName", "stprojectdata"),
                new("connectionString", "must-not-pass"),
            ],
        };
        var plan = new DesignerAssistantService.AiPlan(
            "Add storage.",
            false,
            null,
            [first, AddNode("storage", "Storage Account")],
            []);

        var result = DesignerAssistantService.NormalizePlan(plan, Request(), "gpt-4o-mini");

        var action = Assert.Single(result.Actions);
        Assert.Equal("stprojectdata", action.Properties["resourceName"]);
        Assert.DoesNotContain("connectionString", action.Properties.Keys);
        Assert.Contains(result.Warnings, warning => warning.Contains("duplicate", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void NormalizePlan_ResolvesNormalizedParentsAndConnectionAliases()
    {
        var plan = new DesignerAssistantService.AiPlan(
            "Add private storage access.",
            false,
            null,
            [
                AddNode("Core VNet", "VNet"),
                AddNode("Data Subnet", "Subnet") with { ParentRef = "Core VNet" },
                AddNode("storageaccountstdatahack", "Storage Account") with { Label = "stdatahack" },
                AddNode("privateendpointblob", "Private Endpoint") with
                {
                    Label = "Private Endpoint",
                    ParentRef = "Data Subnet",
                },
                new DesignerAssistantService.AiAction(
                    "connect", null, "private-link", "target-service", null, null, null, [],
                    "Connect the Private Endpoint to storage."),
            ],
            []);

        var result = DesignerAssistantService.NormalizePlan(plan, Request(), "gpt-4o-mini");

        Assert.Equal(5, result.Actions.Count);
        Assert.Equal("core-vnet", result.Actions[1].ParentRef);
        Assert.Equal("data-subnet", result.Actions[3].ParentRef);
        Assert.Equal("privateendpointblob", result.Actions[4].SourceRef);
        Assert.Equal("storageaccountstdatahack", result.Actions[4].TargetRef);
        Assert.DoesNotContain(result.Warnings, warning => warning.Contains("unknown", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void NormalizePlan_DoesNotGuessAnAmbiguousPrivateEndpointTarget()
    {
        var plan = new DesignerAssistantService.AiPlan(
            "Add private storage access.",
            false,
            null,
            [
                AddNode("storage-one", "Storage Account"),
                AddNode("storage-two", "Storage Account"),
                AddNode("private-endpoint", "Private Endpoint"),
                new DesignerAssistantService.AiAction(
                    "connect", null, "private-link", "target-service", null, null, null, [],
                    "Connect the Private Endpoint to storage."),
            ],
            []);

        var result = DesignerAssistantService.NormalizePlan(plan, Request(), "gpt-4o-mini");

        Assert.Equal(3, result.Actions.Count);
        Assert.DoesNotContain(result.Actions, action => action.Kind == "connect");
        Assert.Contains(result.Warnings, warning => warning.Contains("unknown", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void NormalizePlan_OrientsRouteTableAssociationAndOmitsFirewallEdge()
    {
        var plan = new DesignerAssistantService.AiPlan(
            "Route the subnet through the firewall.",
            false,
            null,
            [
                AddNode("core", "VNet"),
                AddNode("data", "Subnet") with { ParentRef = "core" },
                AddNode("firewall", "Azure Firewall"),
                AddNode("routes", "Route Table") with { ParentRef = "core" },
                new DesignerAssistantService.AiAction(
                    "connect", null, "data", "routes", null, null, null, [], "Associate routes."),
                new DesignerAssistantService.AiAction(
                    "connect", null, "routes", "firewall", null, null, null, [], "Show the next hop."),
            ],
            []);

        var result = DesignerAssistantService.NormalizePlan(plan, Request(), "gpt-4o-mini");

        Assert.Equal(5, result.Actions.Count);
        var connection = Assert.Single(result.Actions, action => action.Kind == "connect");
        Assert.Equal("routes", connection.SourceRef);
        Assert.Equal("data", connection.TargetRef);
        Assert.Contains(result.Warnings, warning => warning.Contains("next-hop IP", StringComparison.OrdinalIgnoreCase));
    }

    private static DesignerAssistantService.AiAction AddNode(string nodeRef, string blockType) => new(
        "addNode", nodeRef, null, null, blockType, blockType, null, [], $"Add {blockType}.");

    private static DesignerAssistantRequest Request() => new()
    {
        Message = "Add a storage account.",
        Nodes =
        [
            new DesignerAssistantNode
            {
                Id = "baseline-vnet",
                BlockType = "VNet",
                Label = "Existing VNet",
                ReadOnly = true,
            },
        ],
    };
}