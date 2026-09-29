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

    [Theory]
    [InlineData("gpt-4o-mini", null, false)]
    [InlineData("gpt-4.1", null, false)]
    [InlineData("gpt-5", null, true)]
    [InlineData("gpt-5-mini", null, true)]
    [InlineData("gpt-5-chat", null, false)]
    [InlineData("o4-mini", null, true)]
    [InlineData("gpt-5.6-luna", null, true)]
    [InlineData("gpt-6-luna", null, true)]
    [InlineData("gpt-6-astra", null, true)]
    [InlineData("gpt-6-chat", null, false)]
    [InlineData("design-import", "true", true)]
    [InlineData("gpt-5", "false", false)]
    public void IsReasoningDeployment_DetectsModelFamilyWithOverride(string deployment, string? configured, bool expected)
    {
        Assert.Equal(expected, DesignImportService.IsReasoningDeployment(deployment, configured));
    }

    [Fact]
    public void CreateRequestBody_UsesModelFamilySpecificParameters()
    {
        var standard = DesignImportService.CreateRequestBody("system", new object[0], reasoning: false);
        Assert.Equal(16_384, standard["max_tokens"]);
        Assert.Equal(0.0, standard["temperature"]);
        Assert.False(standard.ContainsKey("max_completion_tokens"));

        var reasoning = DesignImportService.CreateRequestBody("system", new object[0], reasoning: true);
        Assert.True(reasoning.ContainsKey("max_completion_tokens"));
        Assert.False(reasoning.ContainsKey("max_tokens"));
        Assert.False(reasoning.ContainsKey("temperature"));
    }

    [Fact]
    public void ParseCompletion_ReportsTruncatedOutputClearly()
    {
        using var document = System.Text.Json.JsonDocument.Parse(
            """{"choices":[{"finish_reason":"length","message":{"content":"{\"summary\":\"cut"}}]}""");

        var error = Assert.Throws<InvalidOperationException>(
            () => DesignImportService.ParseCompletion(document.RootElement));
        Assert.Contains("too large", error.Message);
    }

    [Fact]
    public void ParseCompletion_ReadsStructuredProposal()
    {
        using var document = System.Text.Json.JsonDocument.Parse(
            """{"choices":[{"finish_reason":"stop","message":{"content":"{\"summary\":\"Hub\",\"nodes\":[{\"id\":\"v\",\"blockType\":\"VNet\",\"label\":\"Hub\",\"x\":1,\"y\":2,\"width\":300,\"height\":200}],\"edges\":[],\"warnings\":[]}"}}]}""");

        var proposal = DesignImportService.ParseCompletion(document.RootElement);
        var normalized = DesignImportService.NormalizeProposal(proposal, "hub.png", "gpt-4.1");

        var node = Assert.Single(normalized.Nodes);
        Assert.Equal(300, node.Width);
        Assert.Equal(200, node.Height);
    }
}
