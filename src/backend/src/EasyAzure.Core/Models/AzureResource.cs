namespace EasyAzure.Core.Models;

/// <summary>
/// Represents a single Azure resource node in the topology graph.
/// The ID is the full ARM resource ID.
/// </summary>
public record AzureResource
{
    public required string Id { get; init; }
    public required string Type { get; init; }
    public required string Name { get; init; }
    public required string SubscriptionId { get; init; }
    public required string ResourceGroup { get; init; }
    public required string Location { get; init; }
    public Dictionary<string, object> Properties { get; init; } = [];
    public Dictionary<string, string> Tags { get; init; } = [];
    public DateTimeOffset DiscoveredAt { get; init; } = DateTimeOffset.UtcNow;
}

/// <summary>
/// Represents a directed relationship edge between two Azure resource nodes.
/// </summary>
public record ResourceEdge
{
    public required string From { get; init; }
    public required string To { get; init; }
    public required ResourceRelationship Relationship { get; init; }
}

public enum ResourceRelationship
{
    Contains,
    AssociatedWith,
    ConnectedTo,
    RoutesTo,
    Allows,
    Denies,
    PeeredWith,
    DependsOn,
    DeployedBy,
    UsesIdentity,
    UsesPrivateDnsZone,
}

public record TopologyGraph(
    IReadOnlyList<FlowNode> Nodes,
    IReadOnlyList<FlowEdge> Edges);

public record FlowNode(
    string Id,
    string Type,
    FlowPosition Position,
    AzureResource Data);

public record FlowEdge(
    string Id,
    string Source,
    string Target,
    string? Label = null);

public record FlowPosition(double X, double Y);

public record SubscriptionSummary(string Id, string DisplayName, string TenantId);

public record DashboardStats
{
    public int SubscriptionCount { get; init; }
    public int VNetCount { get; init; }
    public int ResourceCount { get; init; }
    public double? ComplianceScore { get; init; }
    public int DriftWarnings { get; init; }
    public int RecentDeployments { get; init; }
    public IReadOnlyList<DeploymentSummary> RecentDeploymentList { get; init; } = [];
    public IReadOnlyList<DriftWarning> DriftList { get; init; } = [];
}

public record DeploymentSummary(string Id, string Name, string Status);
public record DriftWarning(string ResourceId, string Message);

public record TriggerDiscoveryRequest(string SubscriptionId);

public record DiscoveryJobStatus
{
    public required string JobId { get; init; }
    public required string Status { get; init; }
    public int Progress { get; init; }
    public string? Message { get; init; }
}
