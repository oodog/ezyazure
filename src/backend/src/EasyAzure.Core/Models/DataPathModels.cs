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

    /// <summary>
    /// Ordered list of topology node IDs that make up the path, so the Discovery map can
    /// highlight the exact source → … → destination route the traffic takes.
    /// </summary>
    public IReadOnlyList<string> PathNodeIds { get; init; } = [];

    /// <summary>Human-readable description of where the destination resolved (subnet, peer VNet, Internet).</summary>
    public string? DestinationSummary { get; init; }
}

/// <summary>
/// Request to trace a data path against an already-discovered topology. The destination may be
/// a full ARM resource ID or a raw IP address; the analyzer resolves which subnet (if any) it
/// belongs to. Used by the Discovery map's integrated data-path tracer.
/// </summary>
public record DataPathGraphRequest
{
    public IReadOnlyList<string> SubscriptionIds { get; init; } = [];
    public required string SourceResourceId { get; init; }
    /// <summary>Destination ARM resource ID or raw IPv4 address.</summary>
    public required string Destination { get; init; }
    public string Protocol { get; init; } = "TCP";
    public int DestinationPort { get; init; } = 443;
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
