using EasyAzure.Core.Models;

namespace EasyAzure.Core.Interfaces;

public interface IDiscoveryService
{
    Task<DashboardStats> GetDashboardStatsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<SubscriptionSummary>> ListSubscriptionsAsync(CancellationToken ct = default);
    Task<TopologyGraph> GetTopologyAsync(string subscriptionId, CancellationToken ct = default);
    Task<TopologyGraph> GetTopologyMultiAsync(IReadOnlyList<string> subscriptionIds, CancellationToken ct = default);
    Task<DiscoveryJobStatus> TriggerDiscoveryAsync(string subscriptionId, CancellationToken ct = default);
    Task<DiscoveryJobStatus?> GetJobStatusAsync(string jobId, CancellationToken ct = default);
}

public interface ITopologyService
{
    Task<TopologyGraph> BuildTopologyAsync(string subscriptionId, CancellationToken ct = default);
    Task<TopologyGraph> BuildTopologyMultiAsync(IReadOnlyList<string> subscriptionIds, CancellationToken ct = default);
    Task<IReadOnlyList<ResourceEdge>> GetEdgesAsync(string resourceId, CancellationToken ct = default);
}

public interface IDataPathService
{
    Task<DataPathResult> AnalyzeAsync(DataPathRequest request, CancellationToken ct = default);

    /// <summary>
    /// Traces a data path through an already-built topology graph and returns the ordered
    /// path (including the node IDs to highlight on the map). Resolves the destination
    /// (resource ID or raw IP) to a subnet, walks UDR/peering/firewall next hops, and
    /// evaluates NSG rules at the source and destination.
    /// </summary>
    Task<DataPathResult> TraceOnGraphAsync(TopologyGraph graph, DataPathGraphRequest request, CancellationToken ct = default);
}

public interface IDesignerService
{
    Task<IReadOnlyList<DesignEnvironmentSummary>> ListEnvironmentsAsync(CancellationToken ct = default);
    Task<DesignEnvironment?> GetEnvironmentAsync(string id, CancellationToken ct = default);
    Task<DesignEnvironment> CreateEnvironmentAsync(CreateEnvironmentRequest request, CancellationToken ct = default);
    Task<DesignEnvironment> UpdateEnvironmentAsync(DesignEnvironment environment, CancellationToken ct = default);
    Task<ValidationResult> ValidateAsync(string environmentId, CancellationToken ct = default);
}

public interface IBestPracticeEngine
{
    Task<BestPracticeReport> RunReviewAsync(string? subscriptionId, CancellationToken ct = default);
    Task<IReadOnlyList<BestPracticeRule>> ListRulesAsync(CancellationToken ct = default);
    Task<DesignValidationReport> ValidateDesignAsync(DesignValidationRequest request, CancellationToken ct = default);
}

public interface IRoutingAnalysisService
{
    /// <summary>
    /// Analyses a topology graph for routing issues (asymmetric routing across peerings,
    /// forced-tunnel mismatches, unverified NVA next hops). When <paramref name="useAi"/>
    /// is true and Azure OpenAI is configured, each finding is enriched with AI-recommended
    /// remediation steps.
    /// </summary>
    Task<RoutingAnalysisReport> AnalyzeAsync(TopologyGraph graph, bool useAi, CancellationToken ct = default);
}

/// <summary>
/// Persists and compares discovery snapshots (versioning). Snapshots are stored in blob
/// storage so customers can review how their environment changed between discoveries.
/// </summary>
public interface ISnapshotService
{
    Task<DiscoverySnapshotSummary> SaveAsync(SaveSnapshotRequest request, CancellationToken ct = default);
    Task<IReadOnlyList<DiscoverySnapshotSummary>> ListAsync(CancellationToken ct = default);
    Task<DiscoverySnapshot?> GetAsync(string id, CancellationToken ct = default);
    Task<DiscoveryDiff?> DiffAsync(string fromId, string toId, CancellationToken ct = default);
    Task<bool> DeleteAsync(string id, CancellationToken ct = default);
}

public interface IReplicationService
{
    /// <summary>
    /// Previews what would be replicated. Returns the list of resources whose names
    /// must be globally unique (Storage Account, Key Vault, App Service, etc.) so the
    /// UI can prompt the user for replacement names.
    /// </summary>
    Task<ReplicationPreview> PreviewAsync(ReplicationPreviewRequest request, CancellationToken ct = default);

    /// <summary>
    /// Generates Bicep + a deployment plan that recreates the source resources in
    /// the target subscription / resource group with user-provided renames.
    /// </summary>
    Task<ReplicationPlan> PlanAsync(ReplicationPlanRequest request, CancellationToken ct = default);
}

public interface IBicepGeneratorService
{
    Task<GenerateBicepResult> GenerateBicepAsync(string environmentId, CancellationToken ct = default);
}

public interface IDeploymentService
{
    Task<WhatIfResult> RunWhatIfAsync(WhatIfRequest request, CancellationToken ct = default);
    Task<DeploymentRecord> DeployAsync(DeployRequest request, CancellationToken ct = default);
    Task<DeploymentRecord?> GetDeploymentStatusAsync(string deploymentId, CancellationToken ct = default);
}
