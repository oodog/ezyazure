namespace EasyAzure.Core.Models;

/// <summary>
/// A best-practice rule sourced from Microsoft documentation.
/// </summary>
public record BestPracticeRule
{
    public required string RuleId { get; init; }
    public required string Title { get; init; }
    public required string Severity { get; init; } // High, Medium, Low, Info
    public required string Check { get; init; }
    public required string Recommendation { get; init; }
    public IReadOnlyList<string> Framework { get; init; } = [];
    public string? DocReference { get; init; }
    public string? Remediation { get; init; }
    public string? IaCFix { get; init; }
}

public record BestPracticeReport
{
    public string? SubscriptionId { get; init; }
    public DateTimeOffset RunAt { get; init; } = DateTimeOffset.UtcNow;
    public Dictionary<string, double> PillarScores { get; init; } = [];
    public IReadOnlyList<BestPracticeRule> Findings { get; init; } = [];
    public double OverallScore { get; init; }
}
