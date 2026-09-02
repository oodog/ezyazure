using EasyAzure.Core.Models;
using EasyAzure.Designer.Services;

namespace EasyAzure.Tests;

public class DiscoveryAssistantServiceTests
{
    private static readonly ProductSkillRegistry SkillRegistry = LoadSkillRegistry();

    [Fact]
    public void SkillCatalog_CoversEveryDiscoveryTechnology()
    {
        var expected = new[]
        {
            "networking", "compute", "avs", "storage", "databases", "web-apps",
            "containers", "ai-search", "security-identity", "monitoring", "other",
        };

        Assert.Equal(expected.Order(), SkillRegistry.Skills.Keys.Order());
        Assert.Equal("1.0.0", SkillRegistry.Version);
    }

    [Fact]
    public void SelectSkills_RoutesByFocusAndQuestion()
    {
        var request = new DiscoveryAssistantRequest
        {
            SubscriptionIds = ["sub"],
            Message = "Why can this storage private endpoint not resolve DNS?",
            FocusTechnologies = ["storage"],
        };
        var graph = Graph(
            Node("vnet", "Microsoft.Network/virtualNetworks"),
            Node("storage", "Microsoft.Storage/storageAccounts"));

        var skills = SkillRegistry.SelectSkills(request, graph);

        Assert.Equal("Storage", skills[0].Name);
        Assert.Contains(skills, skill => skill.Name == "Networking");
        Assert.True(skills.Count <= 3);
    }

    [Fact]
    public void BuildGroundingSummary_RemovesSecretsAndTags()
    {
        var resource = Node("storage", "Microsoft.Storage/storageAccounts", new()
        {
            ["publicNetworkAccess"] = "Disabled",
            ["connectionString"] = "secret-value",
            ["apiKey"] = "secret-key",
        }) with
        {
            Data = Node("storage", "Microsoft.Storage/storageAccounts").Data with
            {
                Properties = new()
                {
                    ["publicNetworkAccess"] = "Disabled",
                    ["connectionString"] = "secret-value",
                    ["apiKey"] = "secret-key",
                },
                Tags = new() { ["owner"] = "private@example.com" },
            },
        };
        var request = new DiscoveryAssistantRequest
        {
            SubscriptionIds = ["sub"],
            Message = "Help with storage",
        };

        var summary = DiscoveryAssistantService.BuildGroundingSummary(request, Graph(resource), Routing(), SkillRegistry);

        var grounded = Assert.Single(summary.Resources);
        Assert.Equal("Disabled", grounded.Properties["publicNetworkAccess"]);
        Assert.DoesNotContain("connectionString", grounded.Properties.Keys, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("apiKey", grounded.Properties.Keys, StringComparer.OrdinalIgnoreCase);
        Assert.DoesNotContain("private@example.com", System.Text.Json.JsonSerializer.Serialize(summary));
    }

    [Fact]
    public void NormalizeResponse_RejectsNonMicrosoftAndDuplicateCitations()
    {
        var skills = SkillRegistry.SelectSkills(
            new DiscoveryAssistantRequest { SubscriptionIds = ["sub"], Message = "Check routing", FocusTechnologies = ["networking"] },
            Graph(Node("vnet", "Microsoft.Network/virtualNetworks")));
        const string response = """
            {
              "answer": "Review the route evidence before changing the UDR.",
              "citations": [
                {"title":"Routes","url":"https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview"},
                {"title":"Duplicate","url":"https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview"},
                {"title":"Untrusted","url":"https://example.com/advice"}
              ],
              "suggestedChecks": ["Inspect effective routes."],
              "confidence": "medium",
              "limitations": ["Effective routes were not collected."]
            }
            """;

        var result = DiscoveryAssistantService.NormalizeResponse(response, skills, Routing(), "gpt-4o-mini", SkillRegistry.Version);

        var citation = Assert.Single(result.Citations);
        Assert.StartsWith("https://learn.microsoft.com/", citation.Url);
        Assert.Equal("medium", result.Confidence);
        Assert.True(result.AiUsed);
        Assert.Equal("1.0.0", result.SkillBundleVersion);
        Assert.Equal("1.0.0", result.SkillVersions["networking"]);
    }

    [Fact]
    public void SelectSkills_ActivatesAvsSpecialist()
    {
        var request = new DiscoveryAssistantRequest
        {
            SubscriptionIds = ["sub"],
            Message = "My HCX path into AVS is failing",
        };

        var skills = SkillRegistry.SelectSkills(
            request,
            Graph(Node("avs", "Microsoft.AVS/privateClouds")));

        Assert.Contains(skills, skill => skill.Name == "Azure VMware Solution");
    }

    [Theory]
    [InlineData("Why is this route asymmetric?", "networking")]
    [InlineData("Check this virtual machine extension", "compute")]
    [InlineData("Diagnose the HCX private cloud path", "avs")]
    [InlineData("Review blob storage access", "storage")]
    [InlineData("Check PostgreSQL database failover", "databases")]
    [InlineData("Review App Service ingress", "web-apps")]
    [InlineData("Why can this Kubernetes pod not pull from ACR?", "containers")]
    [InlineData("Check the OpenAI model deployment", "ai-search")]
    [InlineData("Review Key Vault RBAC permissions", "security-identity")]
    [InlineData("Review the Log Analytics alert", "monitoring")]
    [InlineData("Review the discovered architecture", "other")]
    public void SelectSkills_RoutesGoldenProductIntents(string question, string expectedSkill)
    {
        var skills = SkillRegistry.SelectSkills(
            new DiscoveryAssistantRequest { SubscriptionIds = ["sub"], Message = question },
            Graph());

        Assert.Contains(skills, skill => skill.Id == expectedSkill);
    }

    [Theory]
    [InlineData("Microsoft.Network/virtualNetworks", "networking")]
    [InlineData("Microsoft.Compute/virtualMachines", "compute")]
    [InlineData("Microsoft.AVS/privateClouds", "avs")]
    [InlineData("Microsoft.Storage/storageAccounts", "storage")]
    [InlineData("Microsoft.DBforPostgreSQL/flexibleServers", "databases")]
    [InlineData("Microsoft.Web/sites", "web-apps")]
    [InlineData("Microsoft.App/containerApps", "containers")]
    [InlineData("Microsoft.CognitiveServices/accounts", "ai-search")]
    [InlineData("Microsoft.KeyVault/vaults", "security-identity")]
    [InlineData("Microsoft.Insights/components", "monitoring")]
    [InlineData("Contoso.Unknown/widgets", "other")]
    public void TechnologyFor_UsesExternalResourceMappings(string resourceType, string expectedSkill)
    {
        Assert.Equal(expectedSkill, SkillRegistry.TechnologyFor(resourceType));
    }

    [Fact]
    public void Registry_RejectsNonMicrosoftReference()
    {
        var bundle = new ProductSkillBundle("1.0.0", "test", [
            Skill("other", reference: "https://example.com/architecture"),
        ]);

        var exception = Assert.Throws<InvalidOperationException>(() => new ProductSkillRegistry(bundle));

        Assert.Contains("HTTPS Microsoft Learn URL", exception.Message);
    }

    [Fact]
    public void Registry_RejectsDuplicateResourceMapping()
    {
        var bundle = new ProductSkillBundle("1.0.0", "test", [
            Skill("networking", resourceTypes: ["microsoft.network/virtualnetworks"]),
            Skill("other", resourceTypes: ["microsoft.network/virtualnetworks"]),
        ]);

        var exception = Assert.Throws<InvalidOperationException>(() => new ProductSkillRegistry(bundle));

        Assert.Contains("assigned to multiple product skills", exception.Message);
    }

    [Fact]
    public void Registry_RejectsDuplicateResourcePrefixMapping()
    {
        var bundle = new ProductSkillBundle("1.0.0", "test", [
            Skill("networking", resourceTypePrefixes: ["microsoft.network/"]),
            Skill("other", resourceTypePrefixes: ["microsoft.network/"]),
        ]);

        var exception = Assert.Throws<InvalidOperationException>(() => new ProductSkillRegistry(bundle));

        Assert.Contains("prefix 'microsoft.network/' is assigned to multiple", exception.Message);
    }

    [Fact]
    public void SelectSkills_DoesNotMatchKeywordInsideAnotherWord()
    {
        var skills = SkillRegistry.SelectSkills(
            new DiscoveryAssistantRequest { SubscriptionIds = ["sub"], Message = "Is this design suitable?" },
            Graph());

        Assert.DoesNotContain(skills, skill => skill.Id == "storage");
        Assert.Equal("other", Assert.Single(skills).Id);
    }

    [Fact]
    public void Registry_RequiresFallbackSkill()
    {
        var bundle = new ProductSkillBundle("1.0.0", "test", [Skill("networking")]);

        var exception = Assert.Throws<InvalidOperationException>(() => new ProductSkillRegistry(bundle));

        Assert.Contains("'other' fallback skill", exception.Message);
    }

    [Fact]
    public void JsonProvider_RejectsManifestPathTraversal()
    {
        var directory = Path.Combine(Path.GetTempPath(), $"easyazure-skills-{Guid.NewGuid():N}");
        Directory.CreateDirectory(directory);
        try
        {
            File.WriteAllText(
                Path.Combine(directory, "skill-bundle.json"),
                """{"bundleVersion":"1.0.0","skills":["../outside.skill.json"]}""");

            var exception = Assert.Throws<InvalidOperationException>(() =>
                JsonProductSkillProvider.LoadDirectory(directory));

            Assert.Contains("invalid file name", exception.Message);
        }
        finally
        {
            Directory.Delete(directory, true);
        }
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("{\"choices\":[]}")]
    [InlineData("{\"choices\":[{}]}")]
    [InlineData("{\"choices\":[{\"message\":{}}]}")]
    public void ExtractAssistantContent_RejectsMalformedEnvelope(string json)
    {
        using var document = System.Text.Json.JsonDocument.Parse(json);
        Assert.Null(DiscoveryAssistantService.ExtractAssistantContent(document.RootElement));
    }

    private static RoutingAnalysisReport Routing() => new()
    {
        EffectiveRoutesEvaluated = false,
        Limitations = ["Effective routes were not evaluated."],
    };

    private static TopologyGraph Graph(params FlowNode[] nodes) => new(nodes, []);

    private static ProductSkillRegistry LoadSkillRegistry()
    {
        var relativePath = JsonProductSkillProvider.DefaultRelativePath.Replace('/', Path.DirectorySeparatorChar);
        var bundle = JsonProductSkillProvider.LoadDirectory(Path.Combine(AppContext.BaseDirectory, relativePath));
        return new ProductSkillRegistry(bundle);
    }

    private static ProductSkillDefinition Skill(
        string id,
        string reference = "https://learn.microsoft.com/azure/well-architected/",
        IReadOnlyList<string>? resourceTypes = null,
        IReadOnlyList<string>? resourceTypePrefixes = null) => new()
        {
            Id = id,
            Version = "1.0.0",
            Name = id,
            Instructions = "Use grounded evidence.",
            Reference = reference,
            ResourceTypes = resourceTypes ?? [],
            ResourceTypePrefixes = resourceTypePrefixes ?? [],
        };

    private static FlowNode Node(
        string id,
        string type,
        Dictionary<string, object>? properties = null) => new(
            id,
            "azureResource",
            new FlowPosition(0, 0),
            new AzureResource
            {
                Id = id,
                Name = id,
                Type = type,
                SubscriptionId = "sub",
                ResourceGroup = "rg",
                Location = "australiaeast",
                Properties = properties ?? [],
            });
}