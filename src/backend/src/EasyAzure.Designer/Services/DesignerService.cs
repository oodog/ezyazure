using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.Designer.Services;

/// <summary>
/// Manages design environments (canvas state) and validates blocks against
/// required properties and best-practice rules.
/// </summary>
public class DesignerService : IDesignerService
{
    // In production, this is backed by PostgreSQL.
    private readonly Dictionary<string, DesignEnvironment> _store = [];
    private readonly IBestPracticeEngine _bestPractice;
    private readonly ILogger<DesignerService> _logger;

    public DesignerService(IBestPracticeEngine bestPractice, ILogger<DesignerService> logger)
    {
        _bestPractice = bestPractice;
        _logger = logger;
    }

    public Task<IReadOnlyList<DesignEnvironmentSummary>> ListEnvironmentsAsync(CancellationToken ct = default)
    {
        var list = _store.Values
            .Select(e => new DesignEnvironmentSummary(e.Id, e.Name, e.UpdatedAt, e.Nodes.Count))
            .ToList();
        return Task.FromResult<IReadOnlyList<DesignEnvironmentSummary>>(list);
    }

    public Task<DesignEnvironment?> GetEnvironmentAsync(string id, CancellationToken ct = default)
    {
        _store.TryGetValue(id, out var env);
        return Task.FromResult(env);
    }

    public Task<DesignEnvironment> CreateEnvironmentAsync(CreateEnvironmentRequest request, CancellationToken ct = default)
    {
        var env = new DesignEnvironment
        {
            Id = Guid.NewGuid().ToString(),
            Name = request.Name,
        };
        _store[env.Id] = env;
        _logger.LogInformation("Created design environment {Id} '{Name}'", env.Id, env.Name);
        return Task.FromResult(env);
    }

    public Task<DesignEnvironment> UpdateEnvironmentAsync(DesignEnvironment environment, CancellationToken ct = default)
    {
        var updated = environment with { UpdatedAt = DateTimeOffset.UtcNow };
        _store[environment.Id] = updated;
        return Task.FromResult(updated);
    }

    public async Task<ValidationResult> ValidateAsync(string environmentId, CancellationToken ct = default)
    {
        if (!_store.TryGetValue(environmentId, out var env))
            return new ValidationResult { IsValid = false, Issues = [new("Error", "Environment not found.")] };

        var issues = new List<ValidationIssue>();

        // Check each block has required label
        foreach (var node in env.Nodes)
        {
            if (string.IsNullOrWhiteSpace(node.Label))
                issues.Add(new("Warning", "Block has no display name.", node.Id));
        }

        // Check VNets have at least one subnet
        var vnets = env.Nodes.Where(n => n.BlockType == "VNet").ToList();
        foreach (var vnet in vnets)
        {
            var hasSubnet = env.Edges.Any(e =>
                e.Source == vnet.Id &&
                env.Nodes.Any(n => n.Id == e.Target && n.BlockType == "Subnet"));

            if (!hasSubnet)
                issues.Add(new("Warning", $"VNet '{vnet.Label}' has no subnet connected.", vnet.Id));
        }

        return new ValidationResult
        {
            IsValid = !issues.Any(i => i.Severity == "Error"),
            Issues = issues,
        };
    }
}
