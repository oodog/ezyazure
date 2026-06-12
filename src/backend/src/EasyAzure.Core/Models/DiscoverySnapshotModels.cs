namespace EasyAzure.Core.Models;

/// <summary>
/// A point-in-time, persisted snapshot of a discovered topology. Stored in blob storage so
/// customers can compare how their environment changed between discoveries (versioning).
/// </summary>
public record DiscoverySnapshot
{
    public required string Id { get; init; }
    public required DateTimeOffset CapturedAt { get; init; }
    public IReadOnlyList<string> SubscriptionIds { get; init; } = [];
    public string? Label { get; init; }
    public int NodeCount { get; init; }
    public int EdgeCount { get; init; }
    public TopologyGraph? Graph { get; init; }
}

/// <summary>Lightweight snapshot metadata for listing version history (no graph payload).</summary>
public record DiscoverySnapshotSummary
{
    public required string Id { get; init; }
    public required DateTimeOffset CapturedAt { get; init; }
    public IReadOnlyList<string> SubscriptionIds { get; init; } = [];
    public string? Label { get; init; }
    public int NodeCount { get; init; }
    public int EdgeCount { get; init; }
}

public record SaveSnapshotRequest
{
    public IReadOnlyList<string> SubscriptionIds { get; init; } = [];
    public string? Label { get; init; }
}

/// <summary>
/// The difference between two discovery snapshots: resources added, removed, or whose
/// properties changed. Drives the "what changed between discoveries" diff UI.
/// </summary>
public record DiscoveryDiff
{
    public required string FromSnapshotId { get; init; }
    public required string ToSnapshotId { get; init; }
    public required DateTimeOffset FromCapturedAt { get; init; }
    public required DateTimeOffset ToCapturedAt { get; init; }
    public IReadOnlyList<DiffResource> Added { get; init; } = [];
    public IReadOnlyList<DiffResource> Removed { get; init; } = [];
    public IReadOnlyList<DiffChangedResource> Changed { get; init; } = [];
}

public record DiffResource
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Type { get; init; }
}

public record DiffChangedResource
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Type { get; init; }
    public IReadOnlyList<DiffField> Changes { get; init; } = [];
}

public record DiffField
{
    public required string Path { get; init; }
    public string? OldValue { get; init; }
    public string? NewValue { get; init; }
}
