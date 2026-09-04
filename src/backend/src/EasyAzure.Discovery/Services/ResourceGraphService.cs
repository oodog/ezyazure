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

        using var client = new ResourceGraphClient(new TokenCredentials(token.Token));
        var results = new List<AzureResource>();
        string? skipToken = null;

        do
        {
            var request = new QueryRequest(
                subscriptions: subscriptions?.ToList() ?? [],
                query: kustoQuery,
                options: new QueryRequestOptions
                {
                    ResultFormat = ResultFormat.ObjectArray,
                    Top = 1000,
                    SkipToken = skipToken,
                },
                facets: null);

            var response = await client.ResourcesAsync(request, ct);
            results.AddRange(ParseQueryResult(response));
            skipToken = response.SkipToken;
        }
        while (!string.IsNullOrWhiteSpace(skipToken));

        return results;
    }

    public virtual Task<IReadOnlyList<AzureResource>> GetAllResourcesAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | project id, name, type, location, resourceGroup, subscriptionId, properties, tags | order by id asc",
            [subscriptionId], ct);

    public Task<int> CountAllResourcesAsync(
        IReadOnlyList<string> subscriptions,
        CancellationToken ct = default) =>
        QueryCountAsync("Resources | summarize count()", subscriptions, ct);

    public Task<int> CountResourceTypeAsync(
        string resourceType,
        IReadOnlyList<string> subscriptions,
        CancellationToken ct = default)
    {
        var escapedType = resourceType.Replace("'", "''", StringComparison.Ordinal);
        return QueryCountAsync(
            $"Resources | where type =~ '{escapedType}' | summarize count()",
            subscriptions,
            ct);
    }

    private async Task<int> QueryCountAsync(
        string query,
        IReadOnlyList<string> subscriptions,
        CancellationToken ct)
    {
        if (subscriptions.Count == 0) return 0;

        var credential = new AzureIdentity::Azure.Identity.DefaultAzureCredential();
        var token = await credential.GetTokenAsync(
            new Azure.Core.TokenRequestContext(["https://management.azure.com/.default"]), ct);

        using var client = new ResourceGraphClient(new TokenCredentials(token.Token));
        var request = new QueryRequest(
            subscriptions: subscriptions.ToList(),
            query: query,
            options: new QueryRequestOptions
            {
                ResultFormat = ResultFormat.ObjectArray,
                Top = 1,
            },
            facets: null);
        var response = await client.ResourcesAsync(request, ct);
        return ParseCountQueryResult(response.Data);
    }

    public static int ParseCountQueryResult(object? data)
    {
        if (data is not Newtonsoft.Json.Linq.JArray rows
            || rows.FirstOrDefault() is not Newtonsoft.Json.Linq.JObject row)
            return 0;

        var value = row.Properties()
            .FirstOrDefault(property =>
                property.Name.Equals("count_", StringComparison.OrdinalIgnoreCase)
                || property.Name.Equals("count", StringComparison.OrdinalIgnoreCase))
            ?.Value;
        return value?.Type switch
        {
            Newtonsoft.Json.Linq.JTokenType.Integer => value.ToObject<int>(),
            Newtonsoft.Json.Linq.JTokenType.Float => Convert.ToInt32(value.ToObject<double>()),
            Newtonsoft.Json.Linq.JTokenType.String when int.TryParse(value.ToObject<string>(), out var parsed) => parsed,
            _ => 0,
        };
    }

    public Task<IReadOnlyList<AzureResource>> GetVNetsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/virtualNetworks' | extend addressPrefixesJson = tostring(properties.addressSpace.addressPrefixes), dnsServersJson = tostring(properties.dhcpOptions.dnsServers) | project id, name, type, location, resourceGroup, subscriptionId, properties, tags, addressPrefixesJson, dnsServersJson",
            [subscriptionId], ct);

    public Task<IReadOnlyList<AzureResource>> GetSubnetsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/virtualNetworks/subnets' | extend addressPrefix = tostring(properties.addressPrefix), addressPrefixesJson = tostring(properties.addressPrefixes), networkSecurityGroupId = tostring(properties.networkSecurityGroup.id), routeTableId = tostring(properties.routeTable.id) | project id, name, type, location, resourceGroup, subscriptionId, properties, tags, addressPrefix, addressPrefixesJson, networkSecurityGroupId, routeTableId",
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

    public Task<IReadOnlyList<AzureResource>> GetNetworkInterfacesAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/networkInterfaces' | project id, name, type, location, resourceGroup, subscriptionId, properties, tags",
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

    public Task<IReadOnlyList<AzureResource>> GetFirewallsAsync(
        string subscriptionId, CancellationToken ct = default) =>
        QueryAsync(
            "Resources | where type =~ 'Microsoft.Network/azureFirewalls' | project id, name, type, location, resourceGroup, subscriptionId, properties, tags",
            [subscriptionId], ct);

    /// <summary>
    /// Direct ARM REST GET against a subnet (or any) resource. Resource Graph sometimes
    /// omits subnet properties such as addressPrefix when subnets are IPAM-managed or
    /// freshly created — this gives us the authoritative property bag from ARM itself.
    /// </summary>
    public virtual async Task<Newtonsoft.Json.Linq.JObject?> GetArmResourceAsync(
        string resourceId, string apiVersion, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(resourceId) || !resourceId.StartsWith("/", StringComparison.Ordinal))
            return null;

        try
        {
            var credential = new AzureIdentity::Azure.Identity.DefaultAzureCredential();
            var token = await credential.GetTokenAsync(
                new Azure.Core.TokenRequestContext(["https://management.azure.com/.default"]), ct);

            using var http = new HttpClient { BaseAddress = new Uri("https://management.azure.com") };
            http.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token.Token);

            var url = $"{resourceId}?api-version={apiVersion}";
            using var resp = await http.GetAsync(url, ct);
            if (!resp.IsSuccessStatusCode)
            {
                _logger.LogDebug("ARM GET {Url} returned {Status}", url, (int)resp.StatusCode);
                return null;
            }

            var json = await resp.Content.ReadAsStringAsync(ct);
            return Newtonsoft.Json.Linq.JObject.Parse(json);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "ARM REST GET failed for {ResourceId}", resourceId);
            return null;
        }
    }

    private static IReadOnlyList<AzureResource> ParseQueryResult(QueryResponse response)
    {
        if (response.Data is not Newtonsoft.Json.Linq.JArray rows)
            return [];

        var result = new List<AzureResource>();
        foreach (var row in rows)
        {
            if (row is not Newtonsoft.Json.Linq.JObject obj) continue;

            var properties = NormalizeJTokenToNative(obj["properties"]) as Dictionary<string, object>
                ?? new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);

            // Promote any sibling string columns (e.g. addressPrefixFlat, nsgIdFlat)
            // into the properties dictionary so the topology + UI layers can read them
            // even when Resource Graph returns a malformed nested shape (e.g. id: []).
            foreach (var prop in obj.Properties())
            {
                var name = prop.Name;
                if (name.Equals("id", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("name", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("type", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("location", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("resourceGroup", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("subscriptionId", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("properties", StringComparison.OrdinalIgnoreCase) ||
                    name.Equals("tags", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                if (prop.Value is Newtonsoft.Json.Linq.JValue jv &&
                    jv.Type == Newtonsoft.Json.Linq.JTokenType.String)
                {
                    var s = jv.ToString();
                    if (!string.IsNullOrWhiteSpace(s) && s != "[]" && s != "{}")
                    {
                        properties[name] = s;
                    }
                }
            }

            result.Add(new AzureResource
            {
                Id = obj["id"]?.ToString() ?? string.Empty,
                Name = obj["name"]?.ToString() ?? string.Empty,
                Type = obj["type"]?.ToString() ?? string.Empty,
                Location = obj["location"]?.ToString() ?? string.Empty,
                ResourceGroup = obj["resourceGroup"]?.ToString() ?? string.Empty,
                SubscriptionId = obj["subscriptionId"]?.ToString() ?? string.Empty,
                Properties = properties,
                Tags = obj["tags"]?.ToObject<Dictionary<string, string>>() ?? [],
            });
        }
        return result;
    }

    /// <summary>
    /// Recursively converts a Newtonsoft <see cref="Newtonsoft.Json.Linq.JToken"/> hierarchy
    /// into native .NET types (Dictionary, List, string, long, double, bool, null) so that
    /// System.Text.Json can serialize them correctly. Without this, JObject/JArray values in
    /// <see cref="AzureResource.Properties"/> serialize as empty <c>{}</c> or <c>[]</c>.
    /// </summary>
    public static object? NormalizeJTokenToNative(Newtonsoft.Json.Linq.JToken? token)
    {
        if (token is null || token.Type == Newtonsoft.Json.Linq.JTokenType.Null)
            return null;

        switch (token)
        {
            case Newtonsoft.Json.Linq.JObject jObj:
                var dict = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                foreach (var prop in jObj.Properties())
                {
                    var val = NormalizeJTokenToNative(prop.Value);
                    if (val is not null) dict[prop.Name] = val;
                }
                return dict;

            case Newtonsoft.Json.Linq.JArray jArr:
                var list = new List<object>();
                foreach (var item in jArr)
                {
                    var val = NormalizeJTokenToNative(item);
                    if (val is not null) list.Add(val);
                }
                return list;

            case Newtonsoft.Json.Linq.JValue jVal:
                return jVal.Type switch
                {
                    Newtonsoft.Json.Linq.JTokenType.String => jVal.ToObject<string>(),
                    Newtonsoft.Json.Linq.JTokenType.Integer => jVal.ToObject<long>(),
                    Newtonsoft.Json.Linq.JTokenType.Float => jVal.ToObject<double>(),
                    Newtonsoft.Json.Linq.JTokenType.Boolean => jVal.ToObject<bool>(),
                    _ => jVal.ToString(),
                };

            default:
                return token.ToString();
        }
    }
}
