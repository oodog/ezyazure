namespace EasyAzure.Core.Models;

// ───────── Routing analysis (asymmetric routing detection on the discovery graph) ─────────

/// <summary>
/// Request to analyse a discovered topology for routing issues (primarily asymmetric
/// routing). The backend rebuilds the topology for the supplied subscriptions and runs
/// the deterministic detector; when <see cref="UseAi"/> is set and Azure OpenAI is
/// configured, an additional pass produces recommended remediation steps.
/// </summary>
public record RoutingAnalysisRequest
{
    public required IReadOnlyList<string> SubscriptionIds { get; init; }

    /// <summary>When true, augment deterministic findings with AI-recommended next steps.</summary>
    public bool UseAi { get; init; }
}

/// <summary>
/// A single routing finding. Mirrors the design-validation finding shape so the UI can
/// reuse the same rendering patterns.
/// </summary>
public record RoutingFinding
{
    public required string Severity { get; init; } // error | warning | info
    public string Confidence { get; init; } = "potential"; // confirmed | potential | unknown
    public required string RuleId { get; init; }
    public required string Title { get; init; }
    public required string Message { get; init; }

    /// <summary>Observed configuration facts and verification gaps supporting this finding.</summary>
    public IReadOnlyList<string> Evidence { get; init; } = [];

    /// <summary>Topology node IDs this finding relates to (subnets, VNets, firewalls, route tables).</summary>
    public IReadOnlyList<string> AffectedNodeIds { get; init; } = [];

    /// <summary>Baseline deterministic remediation guidance (always present for rule findings).</summary>
    public string? Recommendation { get; init; }

    /// <summary>AI-generated detailed next steps (only present when AI augmentation ran).</summary>
    public string? AiRecommendation { get; init; }

    /// <summary>Microsoft Learn URL only.</summary>
    public string? Reference { get; init; }

    /// <summary>Source of the finding: "rule" | "ai".</summary>
    public string Source { get; init; } = "rule";
}

public record RoutingAnalysisReport
{
    public IReadOnlyList<RoutingFinding> Findings { get; init; } = [];
    public bool EffectiveRoutesEvaluated { get; init; }
    public IReadOnlyList<string> Limitations { get; init; } = [];
    public bool AiUsed { get; init; }
    public string? AiModel { get; init; }
    public int SubnetsAnalyzed { get; init; }
    public DateTimeOffset RunAt { get; init; } = DateTimeOffset.UtcNow;
}
