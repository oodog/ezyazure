using EasyAzure.Core.Models;

namespace EasyAzure.Core.Interfaces;

public interface IDiscoveryService
{
    Task<DashboardStats> GetDashboardStatsAsync(CancellationToken ct = default);
    Task<IReadOnlyList<SubscriptionSummary>> ListSubscriptionsAsync(CancellationToken ct = default);
    Task<TopologyGraph> GetTopologyAsync(string subscriptionId, CancellationToken ct = default);
    Task<DiscoveryJobStatus> TriggerDiscoveryAsync(string subscriptionId, CancellationToken ct = default);
    Task<DiscoveryJobStatus?> GetJobStatusAsync(string jobId, CancellationToken ct = default);
}

public interface ITopologyService
{
    Task<TopologyGraph> BuildTopologyAsync(string subscriptionId, CancellationToken ct = default);
    Task<IReadOnlyList<ResourceEdge>> GetEdgesAsync(string resourceId, CancellationToken ct = default);
}

public interface IDataPathService
{
    Task<DataPathResult> AnalyzeAsync(DataPathRequest request, CancellationToken ct = default);
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
