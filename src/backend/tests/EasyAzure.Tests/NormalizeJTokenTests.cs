using EasyAzure.Core.Models;
using EasyAzure.Discovery.Services;
using Newtonsoft.Json.Linq;
using System.Text.Json;

namespace EasyAzure.Tests;

public class NormalizeJTokenTests
{
    [Fact]
    public void NormalizeJObject_ReturnsNativeDictionary_SerializableBySTJ()
    {
        // Simulate the ARM response shape for a subnet
        var arm = JObject.Parse("""
        {
            "addressPrefixes": ["10.5.0.0/24"],
            "networkSecurityGroup": {
                "id": "/subscriptions/9f19629c-4416-43e2-8986-0a8371d83347/resourceGroups/azuretest/providers/Microsoft.Network/networkSecurityGroups/test"
            },
            "defaultOutboundAccess": false,
            "delegations": [],
            "provisioningState": "Succeeded"
        }
        """);

        var native = ResourceGraphService.NormalizeJTokenToNative(arm);

        // Should be a Dictionary<string, object>
        Assert.IsType<Dictionary<string, object>>(native);
        var dict = (Dictionary<string, object>)native!;

        // addressPrefixes should be List<object> with string items
        Assert.True(dict.ContainsKey("addressPrefixes"));
        var prefixes = dict["addressPrefixes"] as List<object>;
        Assert.NotNull(prefixes);
        Assert.Single(prefixes!);
        Assert.Equal("10.5.0.0/24", prefixes![0]);

        // networkSecurityGroup should be Dictionary<string, object> with id string
        Assert.True(dict.ContainsKey("networkSecurityGroup"));
        var nsg = dict["networkSecurityGroup"] as Dictionary<string, object>;
        Assert.NotNull(nsg);
        Assert.Equal("/subscriptions/9f19629c-4416-43e2-8986-0a8371d83347/resourceGroups/azuretest/providers/Microsoft.Network/networkSecurityGroups/test",
            nsg!["id"]);

        // defaultOutboundAccess should be bool
        Assert.IsType<bool>(dict["defaultOutboundAccess"]);
        Assert.False((bool)dict["defaultOutboundAccess"]);

        // delegations (empty array) should be excluded (null returned for empty)
        // Actually our method returns empty list for empty JArray
        // Empty arrays are included as empty lists
        Assert.True(dict.ContainsKey("delegations") == false || (dict["delegations"] is List<object> l && l.Count == 0));

        // Crucially: System.Text.Json must be able to serialize this without throwing
        var json = JsonSerializer.Serialize(dict);
        Assert.Contains("10.5.0.0/24", json);
        Assert.Contains("networkSecurityGroups/test", json);
        Assert.Contains("\"defaultOutboundAccess\":false", json);
    }

    [Fact]
    public void NormalizeJValue_String_ReturnsString()
    {
        var jv = new JValue("hello");
        var result = ResourceGraphService.NormalizeJTokenToNative(jv);
        Assert.IsType<string>(result);
        Assert.Equal("hello", result);
    }

    [Fact]
    public void NormalizeNull_ReturnsNull()
    {
        Assert.Null(ResourceGraphService.NormalizeJTokenToNative(null));
        Assert.Null(ResourceGraphService.NormalizeJTokenToNative(JValue.CreateNull()));
    }

    [Fact]
    public void ParseCountQueryResult_ReadsNumericResourceGraphAggregate()
    {
        var responseData = JArray.Parse("""[{ "count_": 42 }]""");

        var count = ResourceGraphService.ParseCountQueryResult(responseData);

        Assert.Equal(42, count);
    }

    [Fact]
    public void DashboardStats_SerializesVnetCountWithFrontendContractName()
    {
        var json = JsonSerializer.Serialize(
            new DashboardStats { VNetCount = 4 },
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

        Assert.Contains("\"vnetCount\":4", json);
        Assert.DoesNotContain("\"vNetCount\"", json);
    }

    [Fact]
    public void FullTopologyProperties_SerializeCorrectlyWithSTJ()
    {
        // Simulate what Properties dict looks like after ARM enrichment + NormalizeJTokenToNative
        var properties = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase)
        {
            ["addressPrefixes"] = new List<object> { "10.5.0.0/24" },
            ["networkSecurityGroupId"] = "/subscriptions/xxx/providers/Microsoft.Network/networkSecurityGroups/test",
            ["defaultOutboundAccess"] = false,
            ["provisioningState"] = "Succeeded",
            ["networkSecurityGroup"] = new Dictionary<string, object>
            {
                ["id"] = "/subscriptions/xxx/providers/Microsoft.Network/networkSecurityGroups/test"
            },
        };

        var json = JsonSerializer.Serialize(properties);

        // None of these should be "[]" or "{}" — they must be proper values
        Assert.DoesNotContain("\"addressPrefixes\":[]", json);
        Assert.Contains("10.5.0.0/24", json);
        Assert.Contains("networkSecurityGroups/test", json);
        Assert.Contains("\"defaultOutboundAccess\":false", json);
        Assert.Contains("\"provisioningState\":\"Succeeded\"", json);
    }
}
