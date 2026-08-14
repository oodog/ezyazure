using EasyAzure.Discovery.Services;
using Newtonsoft.Json.Linq;

namespace EasyAzure.Discovery.Tests;

public class ResourceGraphNormalizationTests
{
    [Fact]
    public void NormalizeJTokenToNative_PreservesNestedResourceReferences()
    {
        var source = JObject.Parse("""
        {
          "privateLinkServiceConnections": [
            {
              "properties": {
                "privateLinkServiceId": "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/data",
                "groupIds": ["blob"]
              }
            }
          ]
        }
        """);

        var normalized = Assert.IsType<Dictionary<string, object>>(
            ResourceGraphService.NormalizeJTokenToNative(source));
        var connections = Assert.IsType<List<object>>(normalized["privateLinkServiceConnections"]);
        var connection = Assert.IsType<Dictionary<string, object>>(Assert.Single(connections));
        var properties = Assert.IsType<Dictionary<string, object>>(connection["properties"]);

        Assert.Equal(
            "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/data",
            properties["privateLinkServiceId"]);
        Assert.Equal("blob", Assert.Single(Assert.IsType<List<object>>(properties["groupIds"])));
    }
}