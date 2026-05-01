extern alias AzureIdentity;
using Microsoft.Azure.Management.ResourceGraph;
using Microsoft.Azure.Management.ResourceGraph.Models;
using Microsoft.Rest;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.Discovery.Services;

/// <summary>
/// Queries Azure Resource Graph for efficient cross-subscription resource discovery.
/// Azure Resource Graph is designed to query cloud inventory across subscriptions.
/// </summary>
public class ResourceGraphService
{
    private readonly ILogger<ResourceGraphService> _logger;

    public ResourceGraphService(ILogger<ResourceGraphService> logger)
    {
        _logger = logger;
    }

    public async Task<IReadOnlyList<AzureResource>> QueryAsync(
        string kustoQuery,
        IReadOnlyList<string>? subscriptions = null,
        CancellationToken ct = default)
    {
        var credential = new AzureIdentity::Azure.Identity.DefaultAzureCredential();
        var token = await credential.GetTokenAsync(
            new Azure.Core.TokenRequestContext(["https://management.azure.com/.default"]), ct);

        var client = new ResourceGraphClient(new TokenCredentials(token.Token));

        var request = new QueryRequest(
            subscriptions: subscriptions?.ToList() ?? [],
            query: kustoQuery,
            options: new QueryRequestOptions { ResultFormat = ResultFormat.ObjectArray },
            facets: null);

        var response = await client.ResourcesAsync(request);

        return ParseQueryResult(response);
    }

    public async Task<int> CountAllResourcesAsync(CancellationToken ct = default)
    {
        const string query = "Resources | summarize count()";
        var results = await QueryAsync(query, null, ct);
        // The count is returned as a single row; parse from properties
        if (results.Count > 0 && results[0].Properties.TryGetValue("count_", out var count))
        {
            return Convert.ToInt32(count);
        }
        return 0;
    }

    public async Task<int> CountResourceTypeAsync(string resourceType, CancellationToken ct = default)
    {
        var query = $"Resources | where type =~ '{resourceType}' | summarize count()";
        var results = await QueryAsync(query, null, ct);
        if (results.Count > 0 && results[0].Properties.TryGetValue("count_", out var count))
        {
            return Convert.ToInt32(count);
        }
        return 0;
    }

    public Task<IReadOnlyList<AzureResource>> GetVNetsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/virtualNetworks' | project id, name, type, location, resourceGroup, subscriptionId, properties, tags",
            [subscriptionId], ct);

    public Task<IReadOnlyList<AzureResource>> GetSubnetsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/virtualNetworks' | mv-expand subnet = properties.subnets | project id = subnet.id, name = subnet.name, type = 'Microsoft.Network/virtualNetworks/subnets', location, resourceGroup, subscriptionId, properties = subnet.properties, tags",
            [subscriptionId], ct);

    public Task<IReadOnlyList<AzureResource>> GetNSGsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/networkSecurityGroups' | project id, name, type, location, resourceGroup, subscriptionId, properties, tags",
            [subscriptionId], ct);

    public Task<IReadOnlyList<AzureResource>> GetVMsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Compute/virtualMachines' | project id, name, type, location, resourceGroup, subscriptionId, properties, tags",
            [subscriptionId], ct);

    public Task<IReadOnlyList<AzureResource>> GetPrivateEndpointsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/privateEndpoints' | project id, name, type, location, resourceGroup, subscriptionId, properties, tags",
            [subscriptionId], ct);

    public Task<IReadOnlyList<AzureResource>> GetRouteTablesAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/routeTables' | project id, name, type, location, resourceGroup, subscriptionId, properties, tags",
            [subscriptionId], ct);

    private static IReadOnlyList<AzureResource> ParseQueryResult(QueryResponse response)
    {
        if (response.Data is not Newtonsoft.Json.Linq.JArray rows)
            return [];

        var result = new List<AzureResource>();
        foreach (var row in rows)
        {
            if (row is not Newtonsoft.Json.Linq.JObject obj) continue;
            result.Add(new AzureResource
            {
                Id = obj["id"]?.ToString() ?? string.Empty,
                Name = obj["name"]?.ToString() ?? string.Empty,
                Type = obj["type"]?.ToString() ?? string.Empty,
                Location = obj["location"]?.ToString() ?? string.Empty,
                ResourceGroup = obj["resourceGroup"]?.ToString() ?? string.Empty,
                SubscriptionId = obj["subscriptionId"]?.ToString() ?? string.Empty,
                Properties = obj["properties"]?.ToObject<Dictionary<string, object>>() ?? [],
                Tags = obj["tags"]?.ToObject<Dictionary<string, string>>() ?? [],
            });
        }
        return result;
    }
}
