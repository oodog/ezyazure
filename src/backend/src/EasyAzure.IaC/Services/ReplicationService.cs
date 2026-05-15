using System.Text;
using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.IaC.Services;

/// <summary>
/// Replicates a discovered environment from one or more source subscriptions into a new
/// target subscription / resource group. Resources whose names are globally unique (and
/// therefore can't be reused) are surfaced to the UI for explicit user confirmation.
///
/// Resource-naming reference: https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules
/// </summary>
public class ReplicationService : IReplicationService
{
    private readonly IDiscoveryService _discovery;
    private readonly ILogger<ReplicationService> _logger;

    /// <summary>
    /// ARM resource types that require a globally-unique name (typically because they
    /// expose a public DNS endpoint). The UI prompts the user to provide a new name for
    /// every resource of these types before generating the deployment plan.
    /// </summary>
    private static readonly Dictionary<string, string> GloballyUniqueTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Microsoft.Storage/storageAccounts"] = "Globally unique DNS name (*.blob.core.windows.net).",
        ["Microsoft.KeyVault/vaults"] = "Globally unique DNS name (*.vault.azure.net).",
        ["Microsoft.Web/sites"] = "Globally unique DNS name (*.azurewebsites.net).",
        ["Microsoft.ContainerRegistry/registries"] = "Globally unique DNS name (*.azurecr.io).",
        ["Microsoft.DocumentDB/databaseAccounts"] = "Globally unique DNS name (*.documents.azure.com).",
        ["Microsoft.Sql/servers"] = "Globally unique DNS name (*.database.windows.net).",
        ["Microsoft.Cache/Redis"] = "Globally unique DNS name (*.redis.cache.windows.net).",
        ["Microsoft.ServiceBus/namespaces"] = "Globally unique DNS name (*.servicebus.windows.net).",
        ["Microsoft.EventHub/namespaces"] = "Globally unique DNS name (*.servicebus.windows.net).",
        ["Microsoft.SignalRService/SignalR"] = "Globally unique DNS name (*.service.signalr.net).",
        ["Microsoft.CognitiveServices/accounts"] = "Globally unique DNS name (*.cognitiveservices.azure.com).",
        ["Microsoft.Search/searchServices"] = "Globally unique DNS name (*.search.windows.net).",
        ["Microsoft.ContainerService/managedClusters"] = "Globally unique DNS prefix.",
        ["Microsoft.ApiManagement/service"] = "Globally unique DNS name (*.azure-api.net).",
    };

    /// <summary>
    /// Resource types we deliberately skip from replication (classic, managed-by-other-resources, etc.).
    /// </summary>
    private static readonly HashSet<string> SkippedTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "Microsoft.ClassicCompute/virtualMachines",
        "Microsoft.ClassicNetwork/virtualNetworks",
        "Microsoft.ClassicStorage/storageAccounts",
    };

    public ReplicationService(IDiscoveryService discovery, ILogger<ReplicationService> logger)
    {
        _discovery = discovery;
        _logger = logger;
    }

    public async Task<ReplicationPreview> PreviewAsync(ReplicationPreviewRequest request, CancellationToken ct = default)
    {
        if (request.SourceSubscriptionIds is null || request.SourceSubscriptionIds.Count == 0)
        {
            throw new ArgumentException("At least one source subscription must be provided.", nameof(request));
        }

        _logger.LogInformation(
            "Building replication preview from {SourceCount} subscription(s) → {Target} ({Rg})",
            request.SourceSubscriptionIds.Count, request.TargetSubscriptionId, request.TargetResourceGroup);

        var graph = await _discovery.GetTopologyMultiAsync(request.SourceSubscriptionIds, ct);

        var rename = new List<RenameCandidate>();
        var keep = new List<ReplicatedResourceSummary>();
        var skipped = new List<string>();

        foreach (var node in graph.Nodes)
        {
            var res = node.Data;
            if (SkippedTypes.Contains(res.Type))
            {
                skipped.Add($"{res.Type}: {res.Name}");
                continue;
            }

            if (GloballyUniqueTypes.TryGetValue(res.Type, out var reason))
            {
                rename.Add(new RenameCandidate
                {
                    SourceResourceId = res.Id,
                    ResourceType = res.Type,
                    OriginalName = res.Name,
                    SuggestedName = SuggestUniqueName(res.Type, res.Name),
                    Reason = reason,
                    DocReference = "https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules",
                });
            }
            else
            {
                keep.Add(new ReplicatedResourceSummary(res.Type, res.Name));
            }
        }

        return new ReplicationPreview
        {
            ResourceCount = graph.Nodes.Count,
            RenameRequired = rename,
            KeepName = keep,
            Skipped = skipped,
        };
    }

    public async Task<ReplicationPlan> PlanAsync(ReplicationPlanRequest request, CancellationToken ct = default)
    {
        if (request.SourceSubscriptionIds is null || request.SourceSubscriptionIds.Count == 0)
        {
            throw new ArgumentException("At least one source subscription must be provided.", nameof(request));
        }

        _logger.LogInformation(
            "Generating replication plan: {SourceCount} sub(s) → {Target}/{Rg} in {Location}",
            request.SourceSubscriptionIds.Count, request.TargetSubscriptionId,
            request.TargetResourceGroup, request.TargetLocation);

        var graph = await _discovery.GetTopologyMultiAsync(request.SourceSubscriptionIds, ct);

        var warnings = new List<string>();
        var replicated = new List<ReplicatedResourceSummary>();

        var sb = new StringBuilder();
        sb.AppendLine("// Generated by EasyAzure on " + DateTimeOffset.UtcNow.ToString("O"));
        sb.AppendLine($"// Replication: {request.SourceSubscriptionIds.Count} source subscription(s) → {request.TargetSubscriptionId}");
        sb.AppendLine("// Resource-naming reference: https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules");
        sb.AppendLine("// DO NOT EDIT — regenerate from EasyAzure Replicate dialog");
        sb.AppendLine();
        sb.AppendLine("targetScope = 'resourceGroup'");
        sb.AppendLine();
        sb.AppendLine("@description('Azure region for all replicated resources.')");
        sb.AppendLine($"param location string = '{request.TargetLocation}'");
        sb.AppendLine();
        sb.AppendLine("@description('Common tags applied to every replicated resource.')");
        sb.AppendLine("param tags object = " + RenderTagObject(request.Tags));
        sb.AppendLine();

        foreach (var node in graph.Nodes)
        {
            var res = node.Data;
            if (SkippedTypes.Contains(res.Type))
            {
                warnings.Add($"Skipped (classic / unsupported): {res.Type} '{res.Name}'");
                continue;
            }

            string name;
            if (GloballyUniqueTypes.ContainsKey(res.Type))
            {
                if (!request.Renames.TryGetValue(res.Id, out var rename) || string.IsNullOrWhiteSpace(rename))
                {
                    warnings.Add(
                        $"Missing rename for globally-unique resource '{res.Name}' ({res.Type}). " +
                        "See https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules");
                    continue;
                }
                name = rename!;
            }
            else
            {
                name = request.Renames.TryGetValue(res.Id, out var override_) && !string.IsNullOrWhiteSpace(override_)
                    ? override_!
                    : res.Name;
            }

            AppendBicepResource(sb, res, name);
            replicated.Add(new ReplicatedResourceSummary(res.Type, name));
        }

        return new ReplicationPlan
        {
            Bicep = sb.ToString(),
            Warnings = warnings,
            Resources = replicated,
            DeploymentStackName = $"easyazure-replica-{request.TargetResourceGroup.ToLowerInvariant()}",
        };
    }

    /// <summary>
    /// Suggests a candidate globally-unique name by appending a short random suffix to
    /// the original. Real validity is checked by Azure at deployment time — this is just
    /// a starting point for the user to confirm or edit in the UI.
    /// </summary>
    private static string SuggestUniqueName(string resourceType, string originalName)
    {
        var maxLength = resourceType switch
        {
            "Microsoft.Storage/storageAccounts" => 24,
            "Microsoft.ContainerRegistry/registries" => 50,
            "Microsoft.KeyVault/vaults" => 24,
            _ => 60,
        };

        var suffix = Guid.NewGuid().ToString("N")[..5];
        var sanitized = SanitiseForType(resourceType, originalName);
        var trimmed = sanitized.Length + suffix.Length > maxLength
            ? sanitized[..(maxLength - suffix.Length)]
            : sanitized;
        return trimmed + suffix;
    }

    private static string SanitiseForType(string resourceType, string name)
    {
        // Storage and ACR allow only lowercase alphanumerics.
        if (resourceType is "Microsoft.Storage/storageAccounts" or "Microsoft.ContainerRegistry/registries")
        {
            var lower = new string(name.ToLowerInvariant().Where(char.IsLetterOrDigit).ToArray());
            return string.IsNullOrEmpty(lower) ? "easyazure" : lower;
        }
        // Most other types allow alphanumerics + hyphens.
        var safe = new string(name.Select(c => char.IsLetterOrDigit(c) || c == '-' ? c : '-').ToArray());
        return safe.Trim('-');
    }

    private static string RenderTagObject(IReadOnlyDictionary<string, string> tags)
    {
        if (tags.Count == 0)
        {
            return "{ managedBy: 'easyazure' }";
        }
        var sb = new StringBuilder("{ managedBy: 'easyazure'");
        foreach (var kv in tags)
        {
            var key = kv.Key.Replace("'", "");
            var val = kv.Value.Replace("'", "''");
            sb.Append($", {key}: '{val}'");
        }
        sb.Append(" }");
        return sb.ToString();
    }

    private static void AppendBicepResource(StringBuilder sb, AzureResource res, string name)
    {
        var symbol = SymbolicName(res.Type, name);
        var apiVersion = DefaultApiVersion(res.Type);

        sb.AppendLine($"// Source: {res.Id}");
        sb.AppendLine($"resource {symbol} '{res.Type}@{apiVersion}' = {{");
        sb.AppendLine($"  name: '{name}'");
        sb.AppendLine("  location: location");
        sb.AppendLine("  tags: tags");

        var bodyProps = RenderProperties(res);
        if (!string.IsNullOrEmpty(bodyProps))
        {
            sb.AppendLine(bodyProps);
        }

        sb.AppendLine("}");
        sb.AppendLine();
    }

    private static string SymbolicName(string resourceType, string name)
    {
        var typePart = resourceType.Split('/').Last();
        var safeName = new string(name.Where(c => char.IsLetterOrDigit(c)).ToArray());
        return $"{char.ToLowerInvariant(typePart[0])}{typePart[1..]}_{safeName}";
    }

    private static string DefaultApiVersion(string resourceType) => resourceType switch
    {
        "Microsoft.Network/virtualNetworks" => "2024-01-01",
        "Microsoft.Network/networkSecurityGroups" => "2024-01-01",
        "Microsoft.Network/routeTables" => "2024-01-01",
        "Microsoft.Network/privateEndpoints" => "2024-01-01",
        "Microsoft.Network/publicIPAddresses" => "2024-01-01",
        "Microsoft.Storage/storageAccounts" => "2024-01-01",
        "Microsoft.KeyVault/vaults" => "2024-04-01-preview",
        "Microsoft.Web/sites" => "2023-12-01",
        "Microsoft.Web/serverfarms" => "2023-12-01",
        "Microsoft.ContainerRegistry/registries" => "2023-11-01-preview",
        "Microsoft.ContainerService/managedClusters" => "2024-09-01",
        "Microsoft.DocumentDB/databaseAccounts" => "2024-05-15",
        "Microsoft.Sql/servers" => "2023-08-01-preview",
        "Microsoft.Compute/virtualMachines" => "2024-07-01",
        _ => "2023-01-01",
    };

    /// <summary>
    /// Renders a minimal, safe `properties` block based on resource type. We deliberately
    /// keep this conservative — production replication should round-trip the full
    /// properties via ARM export — but this produces deployable Bicep for the common
    /// landing-zone resource types.
    /// </summary>
    private static string RenderProperties(AzureResource res)
    {
        switch (res.Type)
        {
            case "Microsoft.Storage/storageAccounts":
                return "  sku: { name: 'Standard_LRS' }\n  kind: 'StorageV2'\n  properties: {\n    minimumTlsVersion: 'TLS1_2'\n    allowBlobPublicAccess: false\n    allowSharedKeyAccess: false\n    supportsHttpsTrafficOnly: true\n  }";
            case "Microsoft.KeyVault/vaults":
                return "  properties: {\n    tenantId: subscription().tenantId\n    sku: { family: 'A', name: 'standard' }\n    enableRbacAuthorization: true\n    enableSoftDelete: true\n    enablePurgeProtection: true\n    publicNetworkAccess: 'Disabled'\n  }";
            case "Microsoft.Network/virtualNetworks":
                return "  properties: {\n    addressSpace: { addressPrefixes: [ '10.0.0.0/16' ] }\n  }";
            case "Microsoft.Network/networkSecurityGroups":
                return "  properties: { securityRules: [] }";
            case "Microsoft.Network/routeTables":
                return "  properties: { routes: [] }";
            default:
                return "  properties: {}";
        }
    }
}
