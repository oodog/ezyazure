extern alias AzureIdentity;
using System.Text;
using System.Text.Json;
using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;

namespace EasyAzure.Discovery.Services;

/// <summary>
/// Persists discovery snapshots to Azure Blob Storage and diffs them, so customers can
/// review how their environment changed between discoveries (versioning).
///
/// Storage layout (container "discovery-snapshots"):
///   {id}.json        — full snapshot (metadata + topology graph)
/// The blob's metadata also carries the summary fields so listing is cheap.
///
/// Authentication is via the Container App's user-assigned managed identity
/// (DefaultAzureCredential → AZURE_CLIENT_ID), which must hold the
/// "Storage Blob Data Contributor" role on the storage account.
/// </summary>
public class SnapshotService : ISnapshotService
{
    private const string ContainerName = "discovery-snapshots";

    private readonly IDiscoveryService _discovery;
    private readonly ILogger<SnapshotService> _logger;
    private readonly BlobContainerClient? _container;
    private readonly JsonSerializerOptions _json = new(JsonSerializerDefaults.Web);

    public SnapshotService(
        IDiscoveryService discovery,
        IConfiguration config,
        ILogger<SnapshotService> logger)
    {
        _discovery = discovery;
        _logger = logger;

        var endpoint = config["Storage:BlobEndpoint"];
        if (!string.IsNullOrWhiteSpace(endpoint))
        {
            var cred = new AzureIdentity::Azure.Identity.DefaultAzureCredential();
            var service = new BlobServiceClient(new Uri(endpoint), cred);
            _container = service.GetBlobContainerClient(ContainerName);
        }
        else
        {
            _logger.LogWarning("Storage:BlobEndpoint not configured — discovery versioning is disabled.");
        }
    }

    private BlobContainerClient Container =>
        _container ?? throw new InvalidOperationException(
            "Discovery versioning is not configured. Set Storage:BlobEndpoint and grant the managed identity " +
            "Storage Blob Data Contributor on the storage account.");

    public async Task<DiscoverySnapshotSummary> SaveAsync(SaveSnapshotRequest request, CancellationToken ct = default)
    {
        if (request.SubscriptionIds is null || request.SubscriptionIds.Count == 0)
            throw new ArgumentException("At least one subscription ID is required.", nameof(request));

        var graph = await _discovery.GetTopologyMultiAsync(request.SubscriptionIds, ct);

        var snapshot = new DiscoverySnapshot
        {
            Id = $"{DateTimeOffset.UtcNow:yyyyMMddHHmmss}-{Guid.NewGuid():N}"[..28],
            CapturedAt = DateTimeOffset.UtcNow,
            SubscriptionIds = request.SubscriptionIds,
            Label = request.Label,
            NodeCount = graph.Nodes?.Count ?? 0,
            EdgeCount = graph.Edges?.Count ?? 0,
            Graph = graph,
        };

        await Container.CreateIfNotExistsAsync(cancellationToken: ct);
        var blob = Container.GetBlobClient($"{snapshot.Id}.json");
        var bytes = JsonSerializer.SerializeToUtf8Bytes(snapshot, _json);
        using var ms = new MemoryStream(bytes);

        var metadata = new Dictionary<string, string>
        {
            ["capturedAt"] = snapshot.CapturedAt.ToString("o"),
            ["nodeCount"] = snapshot.NodeCount.ToString(),
            ["edgeCount"] = snapshot.EdgeCount.ToString(),
            ["subscriptionIds"] = string.Join(",", snapshot.SubscriptionIds),
        };
        if (!string.IsNullOrWhiteSpace(snapshot.Label)) metadata["label"] = SanitizeMetadata(snapshot.Label);

        await blob.UploadAsync(ms, new BlobUploadOptions { Metadata = metadata }, ct);

        _logger.LogInformation("Saved discovery snapshot {Id} ({Nodes} nodes)", snapshot.Id, snapshot.NodeCount);
        return ToSummary(snapshot);
    }

    public async Task<IReadOnlyList<DiscoverySnapshotSummary>> ListAsync(CancellationToken ct = default)
    {
        if (_container is null) return [];
        if (!await Container.ExistsAsync(ct)) return [];

        var results = new List<DiscoverySnapshotSummary>();
        await foreach (var item in Container.GetBlobsAsync(BlobTraits.Metadata, cancellationToken: ct))
        {
            var id = item.Name.EndsWith(".json", StringComparison.OrdinalIgnoreCase)
                ? item.Name[..^5]
                : item.Name;
            var md = item.Metadata ?? new Dictionary<string, string>();
            results.Add(new DiscoverySnapshotSummary
            {
                Id = id,
                CapturedAt = md.TryGetValue("capturedAt", out var ca) && DateTimeOffset.TryParse(ca, out var dt)
                    ? dt
                    : (item.Properties.CreatedOn ?? DateTimeOffset.MinValue),
                NodeCount = md.TryGetValue("nodeCount", out var nc) && int.TryParse(nc, out var n) ? n : 0,
                EdgeCount = md.TryGetValue("edgeCount", out var ec) && int.TryParse(ec, out var e) ? e : 0,
                SubscriptionIds = md.TryGetValue("subscriptionIds", out var s) && !string.IsNullOrWhiteSpace(s)
                    ? s.Split(',', StringSplitOptions.RemoveEmptyEntries)
                    : [],
                Label = md.TryGetValue("label", out var l) ? l : null,
            });
        }

        return results.OrderByDescending(r => r.CapturedAt).ToList();
    }

    public async Task<DiscoverySnapshot?> GetAsync(string id, CancellationToken ct = default)
    {
        if (_container is null) return null;
        var blob = Container.GetBlobClient($"{id}.json");
        try
        {
            var response = await blob.DownloadContentAsync(ct);
            return JsonSerializer.Deserialize<DiscoverySnapshot>(response.Value.Content.ToString(), _json);
        }
        catch (RequestFailedException ex) when (ex.Status == 404)
        {
            return null;
        }
    }

    public async Task<bool> DeleteAsync(string id, CancellationToken ct = default)
    {
        if (_container is null) return false;
        var blob = Container.GetBlobClient($"{id}.json");
        var response = await blob.DeleteIfExistsAsync(cancellationToken: ct);
        return response.Value;
    }

    public async Task<DiscoveryDiff?> DiffAsync(string fromId, string toId, CancellationToken ct = default)
    {
        var from = await GetAsync(fromId, ct);
        var to = await GetAsync(toId, ct);
        if (from is null || to is null) return null;

        var fromNodes = (from.Graph?.Nodes ?? []).ToDictionary(n => n.Id, n => n.Data, StringComparer.OrdinalIgnoreCase);
        var toNodes = (to.Graph?.Nodes ?? []).ToDictionary(n => n.Id, n => n.Data, StringComparer.OrdinalIgnoreCase);

        var added = new List<DiffResource>();
        var removed = new List<DiffResource>();
        var changed = new List<DiffChangedResource>();

        foreach (var (id, data) in toNodes)
        {
            if (!fromNodes.ContainsKey(id))
            {
                added.Add(new DiffResource { Id = id, Name = data.Name, Type = data.Type });
            }
        }

        foreach (var (id, data) in fromNodes)
        {
            if (!toNodes.ContainsKey(id))
            {
                removed.Add(new DiffResource { Id = id, Name = data.Name, Type = data.Type });
            }
            else
            {
                var fields = DiffProperties(data, toNodes[id]);
                if (fields.Count > 0)
                {
                    changed.Add(new DiffChangedResource
                    {
                        Id = id,
                        Name = data.Name,
                        Type = data.Type,
                        Changes = fields,
                    });
                }
            }
        }

        return new DiscoveryDiff
        {
            FromSnapshotId = fromId,
            ToSnapshotId = toId,
            FromCapturedAt = from.CapturedAt,
            ToCapturedAt = to.CapturedAt,
            Added = added.OrderBy(r => r.Type).ThenBy(r => r.Name).ToList(),
            Removed = removed.OrderBy(r => r.Type).ThenBy(r => r.Name).ToList(),
            Changed = changed.OrderBy(r => r.Type).ThenBy(r => r.Name).ToList(),
        };
    }

    /// <summary>
    /// Compares two resources' properties by flattening to dotted-path key/value pairs and
    /// reporting added/removed/changed leaf values. Volatile keys (timestamps, provisioning
    /// state, etags) are ignored to avoid noise.
    /// </summary>
    private static List<DiffField> DiffProperties(AzureResource a, AzureResource b)
    {
        var flatA = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var flatB = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        Flatten("", a.Properties, flatA);
        Flatten("", b.Properties, flatB);

        var fields = new List<DiffField>();
        var allKeys = new HashSet<string>(flatA.Keys, StringComparer.OrdinalIgnoreCase);
        allKeys.UnionWith(flatB.Keys);

        foreach (var key in allKeys)
        {
            if (IsVolatileKey(key)) continue;
            flatA.TryGetValue(key, out var oldV);
            flatB.TryGetValue(key, out var newV);
            if (!string.Equals(oldV, newV, StringComparison.Ordinal))
            {
                fields.Add(new DiffField { Path = key, OldValue = oldV, NewValue = newV });
            }
        }

        return fields.OrderBy(f => f.Path, StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static void Flatten(string prefix, object? value, IDictionary<string, string> sink)
    {
        switch (value)
        {
            case null:
                return;
            case IDictionary<string, object> dict:
                foreach (var (k, v) in dict)
                {
                    var path = string.IsNullOrEmpty(prefix) ? k : $"{prefix}.{k}";
                    Flatten(path, v, sink);
                }
                break;
            case System.Collections.IEnumerable list and not string:
                var i = 0;
                foreach (var item in list)
                {
                    Flatten($"{prefix}[{i}]", item, sink);
                    i++;
                }
                break;
            default:
                sink[prefix] = value.ToString() ?? string.Empty;
                break;
        }
    }

    private static bool IsVolatileKey(string key)
    {
        return key.Contains("provisioningState", StringComparison.OrdinalIgnoreCase)
            || key.Contains("etag", StringComparison.OrdinalIgnoreCase)
            || key.Contains("resourceGuid", StringComparison.OrdinalIgnoreCase)
            || key.Contains("timeCreated", StringComparison.OrdinalIgnoreCase)
            || key.Contains("lastModified", StringComparison.OrdinalIgnoreCase);
    }

    private static string SanitizeMetadata(string value)
    {
        // Blob metadata must be ASCII and header-safe; keep it short and printable.
        var sb = new StringBuilder();
        foreach (var c in value)
        {
            if (c is >= ' ' and < (char)127 && c != '\r' && c != '\n') sb.Append(c);
            if (sb.Length >= 200) break;
        }
        return sb.ToString();
    }

    private static DiscoverySnapshotSummary ToSummary(DiscoverySnapshot s) => new()
    {
        Id = s.Id,
        CapturedAt = s.CapturedAt,
        SubscriptionIds = s.SubscriptionIds,
        Label = s.Label,
        NodeCount = s.NodeCount,
        EdgeCount = s.EdgeCount,
    };
}
