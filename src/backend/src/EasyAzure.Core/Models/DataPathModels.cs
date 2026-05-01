namespace EasyAzure.Core.Models;

public record DataPathRequest
{
    public required string SourceResourceId { get; init; }
    public required string DestinationResourceId { get; init; }
    public string Protocol { get; init; } = "TCP";
    public int DestinationPort { get; init; } = 443;
    public int? SourcePort { get; init; }
}

public record DataPathResult
{
    public required PathStatus Status { get; init; }
    public string? BlockingRule { get; init; }
    public IReadOnlyList<PathHop> Hops { get; init; } = [];
    public IReadOnlyList<string> RiskNotes { get; init; } = [];
    public IReadOnlyList<string> BestPracticeNotes { get; init; } = [];
}

public enum PathStatus
{
    Allowed,
    Blocked,
    Unknown,
}

public record PathHop
{
    public required string ResourceId { get; init; }
    public required string ResourceName { get; init; }
    public required string ResourceType { get; init; }
    public string? Detail { get; init; }
    public string? MatchedRule { get; init; }
}
