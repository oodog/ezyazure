namespace EasyAzure.Core.Models;

public record DiscoveryAssistantRequest
{
    public required IReadOnlyList<string> SubscriptionIds { get; init; }
    public required string Message { get; init; }
    public IReadOnlyList<DiscoveryAssistantTurn> History { get; init; } = [];
    public IReadOnlyList<string> FocusTechnologies { get; init; } = [];
    public string? FocusResourceId { get; init; }
}

public record DiscoveryAssistantTurn
{
    public required string Role { get; init; } // user | assistant
    public required string Content { get; init; }
}

public record DiscoveryAssistantCitation
{
    public required string Title { get; init; }
    public required string Url { get; init; }
}

public record DiscoveryAssistantResponse
{
    public required string Answer { get; init; }
    public IReadOnlyList<string> Skills { get; init; } = [];
    public string SkillBundleVersion { get; init; } = string.Empty;
    public IReadOnlyDictionary<string, string> SkillVersions { get; init; } = new Dictionary<string, string>();
    public IReadOnlyList<DiscoveryAssistantCitation> Citations { get; init; } = [];
    public IReadOnlyList<string> SuggestedChecks { get; init; } = [];
    public string Confidence { get; init; } = "low"; // high | medium | low
    public IReadOnlyList<string> Limitations { get; init; } = [];
    public bool AiUsed { get; init; }
    public string? AiModel { get; init; }
}