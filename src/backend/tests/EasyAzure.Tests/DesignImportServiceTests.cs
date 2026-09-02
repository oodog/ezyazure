using EasyAzure.Designer.Services;

namespace EasyAzure.Tests;

public class DesignImportServiceTests
{
    [Fact]
    public void NormalizeProposal_FiltersUnsupportedNodesAndInvalidEdges()
    {
        var proposal = new DesignImportService.AiProposal
        {
            Summary = "Imported architecture",
            Nodes =
            [
                new() { Id = "vnet 1", BlockType = "VNet", Label = "Core VNet", Confidence = 1.2 },
                new() { Id = "script", BlockType = "Run PowerShell", Label = "Ignore me", Confidence = 0.9 },
            ],
            Edges =
            [
                new() { Id = "bad-edge", Source = "vnet 1", Target = "script", Relationship = "executes", Confidence = 0.8 },
            ],
        };

        var result = DesignImportService.NormalizeProposal(proposal, "architecture.png", "gpt-4o-mini");

        var node = Assert.Single(result.Nodes);
        Assert.Equal("vnet-1", node.Id);
        Assert.Equal(1, node.Confidence);
        Assert.Empty(result.Edges);
        Assert.Contains(result.Warnings, warning => warning.Contains("unsupported resource type"));
        Assert.Contains(result.Warnings, warning => warning.Contains("source or target"));
    }

    [Fact]
    public void NormalizeProposal_RemapsParentsAndDuplicateIds()
    {
        var proposal = new DesignImportService.AiProposal
        {
            Summary = "Nested network",
            Nodes =
            [
                new() { Id = "network", BlockType = "VNet", Label = "VNet", X = 10, Y = 20, Confidence = 0.9 },
                new() { Id = "subnet", BlockType = "Subnet", Label = "Web", ParentId = "network", Confidence = 0.8 },
                new() { Id = "network", BlockType = "NSG", Label = "Duplicate ID", Confidence = -1 },
            ],
            Edges =
            [
                new() { Id = "protects", Source = "network", Target = "subnet", Relationship = "protects", Confidence = 0.75 },
            ],
        };

        var result = DesignImportService.NormalizeProposal(proposal, "network.drawio", "gpt-4o-mini");

        Assert.Equal(3, result.Nodes.Count);
        Assert.Equal(3, result.Nodes.Select(node => node.Id).Distinct(StringComparer.OrdinalIgnoreCase).Count());
        Assert.Equal("network", result.Nodes.Single(node => node.BlockType == "Subnet").ParentId);
        Assert.Equal(0, result.Nodes.Single(node => node.BlockType == "NSG").Confidence);
        var edge = Assert.Single(result.Edges);
        Assert.Equal("network", edge.Source);
        Assert.Equal("subnet", edge.Target);
    }

    [Fact]
    public void NormalizeProposal_RemovesCyclicParentReferences()
    {
        var proposal = new DesignImportService.AiProposal
        {
            Summary = "Invalid nesting",
            Nodes =
            [
                new() { Id = "vnet", BlockType = "VNet", Label = "VNet", ParentId = "subnet" },
                new() { Id = "subnet", BlockType = "Subnet", Label = "Subnet", ParentId = "vnet" },
            ],
        };

        var result = DesignImportService.NormalizeProposal(proposal, "cycle.drawio", "gpt-4o-mini");

        Assert.All(result.Nodes, node => Assert.Null(node.ParentId));
        Assert.Contains(result.Warnings, warning => warning.Contains("cyclic parent"));
    }

    [Fact]
    public void NormalizeProposal_PreservesOnlyValidVisibleNetworkProperties()
    {
        var proposal = new DesignImportService.AiProposal
        {
            Summary = "Addressed network",
            Nodes =
            [
                new() { Id = "vnet", BlockType = "VNet", Label = "VNet", AddressSpace = ["10.40.0.0/16", "not-cidr"] },
                new() { Id = "subnet", BlockType = "Subnet", Label = "Subnet", ParentId = "vnet", AddressPrefix = "10.40.1.0/24" },
                new() { Id = "pe", BlockType = "Private Endpoint", Label = "PE", ParentId = "subnet", PrivateIpAddress = "10.40.1.4" },
            ],
        };

        var result = DesignImportService.NormalizeProposal(proposal, "network.png", "gpt-4o-mini");

        Assert.Equal(new[] { "10.40.0.0/16" }, result.Nodes.Single(node => node.Id == "vnet").Properties["addressSpace"]);
        Assert.Equal("10.40.1.0/24", result.Nodes.Single(node => node.Id == "subnet").Properties["addressPrefix"]);
        Assert.Equal("10.40.1.4", result.Nodes.Single(node => node.Id == "pe").Properties["privateIpAddress"]);
    }
}