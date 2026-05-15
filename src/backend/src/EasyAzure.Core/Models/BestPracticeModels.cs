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

// ───────── Design-time validation (used by the "Validate" button) ─────────

public record DesignValidationRequest
{
    /// <summary>Nodes in the design canvas. Each node is the raw object from the UI.</summary>
    public required IReadOnlyList<DesignValidationNode> Nodes { get; init; }
    public IReadOnlyList<DesignValidationEdge> Edges { get; init; } = [];
    /// <summary>
    /// When true, the engine will also call Azure OpenAI (if configured) for an
    /// additional pass of best-practice review. Azure OpenAI is given a strict
    /// system prompt that requires citing Microsoft Learn URLs only.
    /// </summary>
    public bool UseAi { get; init; } = true;
}

public record DesignValidationNode
{
    public required string Id { get; init; }
    public required string BlockType { get; init; }
    public string Label { get; init; } = "";
    public string? ParentId { get; init; }
    public Dictionary<string, object?> Properties { get; init; } = [];
}

public record DesignValidationEdge
{
    public required string Id { get; init; }
    public required string Source { get; init; }
    public required string Target { get; init; }
    public string? Relationship { get; init; }
    public Dictionary<string, object?> Properties { get; init; } = [];
}

public record DesignFinding
{
    public required string Severity { get; init; } // error | warning | info
    public required string RuleId { get; init; }
    public required string Message { get; init; }
    public string? NodeId { get; init; }
    /// <summary>Microsoft Learn URL only.</summary>
    public string? Reference { get; init; }
    /// <summary>Source of the finding: "rule" | "ai".</summary>
    public string Source { get; init; } = "rule";
    /// <summary>
    /// When true, the UI gates "Generate Bicep" until the user explicitly
    /// acknowledges this finding does not follow best practice.
    /// </summary>
    public bool RequiresAcknowledgement { get; init; }
}

public record DesignValidationReport
{
    public IReadOnlyList<DesignFinding> Findings { get; init; } = [];
    public bool AiUsed { get; init; }
    public string? AiModel { get; init; }
    public DateTimeOffset RunAt { get; init; } = DateTimeOffset.UtcNow;
}

// ───────── Replication (discover → deploy into a new subscription) ─────────

public record ReplicationPreviewRequest
{
    public required IReadOnlyList<string> SourceSubscriptionIds { get; init; }
    public required string TargetSubscriptionId { get; init; }
    public required string TargetResourceGroup { get; init; }
    public required string TargetLocation { get; init; }
}

public record ReplicationPreview
{
    /// <summary>Total number of resources that would be replicated.</summary>
    public int ResourceCount { get; init; }
    /// <summary>Resources whose names must be globally unique — the UI must prompt the user.</summary>
    public IReadOnlyList<RenameCandidate> RenameRequired { get; init; } = [];
    /// <summary>Resources that will keep their original name.</summary>
    public IReadOnlyList<ReplicatedResourceSummary> KeepName { get; init; } = [];
    /// <summary>Resources that cannot be replicated (e.g. classic resources) — surfaced for transparency.</summary>
    public IReadOnlyList<string> Skipped { get; init; } = [];
}

public record RenameCandidate
{
    public required string SourceResourceId { get; init; }
    public required string ResourceType { get; init; } // ARM type
    public required string OriginalName { get; init; }
    public required string SuggestedName { get; init; }
    public string? Reason { get; init; } // "globally unique DNS name" etc.
    public string? DocReference { get; init; }
}

public record ReplicatedResourceSummary(string ResourceType, string Name);

public record ReplicationPlanRequest
{
    public required IReadOnlyList<string> SourceSubscriptionIds { get; init; }
    public required string TargetSubscriptionId { get; init; }
    public required string TargetResourceGroup { get; init; }
    public required string TargetLocation { get; init; }
    /// <summary>Map of originalResourceId → new name confirmed by the user.</summary>
    public Dictionary<string, string> Renames { get; init; } = [];
    /// <summary>Optional tag overrides applied to all replicated resources.</summary>
    public Dictionary<string, string> Tags { get; init; } = [];
}

public record ReplicationPlan
{
    public required string Bicep { get; init; }
    public IReadOnlyList<string> Warnings { get; init; } = [];
    public IReadOnlyList<ReplicatedResourceSummary> Resources { get; init; } = [];
    public string DeploymentStackName { get; init; } = "easyazure-replica";
}
