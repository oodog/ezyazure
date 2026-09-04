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