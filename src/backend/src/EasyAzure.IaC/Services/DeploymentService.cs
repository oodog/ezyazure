using Azure.Identity;
using Azure.ResourceManager;
using Azure.ResourceManager.Resources;
using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.IaC.Services;

/// <summary>
/// Orchestrates ARM what-if previews and Deployment Stack-based deployments.
///
/// what-if reference: https://learn.microsoft.com/azure/azure-resource-manager/templates/deploy-what-if
/// Deployment Stacks reference: https://learn.microsoft.com/azure/azure-resource-manager/bicep/deployment-stacks
/// </summary>
public class DeploymentService : IDeploymentService
{
    private readonly Dictionary<string, DeploymentRecord> _records = [];
    private readonly ILogger<DeploymentService> _logger;

    public DeploymentService(ILogger<DeploymentService> logger)
    {
        _logger = logger;
    }

    public async Task<WhatIfResult> RunWhatIfAsync(WhatIfRequest request, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Running what-if for environment {EnvironmentId} → {Subscription}/{ResourceGroup}",
            request.EnvironmentId, request.TargetSubscriptionId, request.TargetResourceGroup);

        // Production implementation calls:
        //   armClient.GetResourceGroupResource(...).GetArmDeployments()
        //       .WhatIfAsync(WaitUntil.Completed, new ArmDeploymentWhatIfContent(...))
        //
        // Placeholder returns a sample result.
        await Task.CompletedTask;
        return new WhatIfResult
        {
            Status = "Succeeded",
            Changes =
            [
                new WhatIfChange("/subscriptions/.../resourceGroups/rg-example", "Create"),
                new WhatIfChange("/subscriptions/.../resourceGroups/rg-example/providers/Microsoft.Network/virtualNetworks/vnet-app", "Create"),
            ],
        };
    }

    public async Task<DeploymentRecord> DeployAsync(DeployRequest request, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Deploying environment {EnvironmentId} to {Subscription}/{ResourceGroup} using Deployment Stack '{Stack}'",
            request.EnvironmentId, request.TargetSubscriptionId, request.TargetResourceGroup, request.DeploymentStackName);

        var deploymentId = Guid.NewGuid().ToString();

        // Production implementation calls:
        //   az stack group create --name {stack} --resource-group {rg} --template-file ... --deny-settings none
        //   or ARM SDK: resourceGroupResource.GetArmDeploymentStacks().CreateOrUpdateAsync(...)
        //
        // Placeholder returns an accepted record.
        var record = new DeploymentRecord
        {
            DeploymentId = deploymentId,
            Status = "Accepted",
            Message = "Deployment submitted. Monitor progress in Azure Portal → Deployments.",
        };

        _records[deploymentId] = record;
        await Task.CompletedTask;
        return record;
    }

    public Task<DeploymentRecord?> GetDeploymentStatusAsync(string deploymentId, CancellationToken ct = default)
    {
        _records.TryGetValue(deploymentId, out var record);
        return Task.FromResult(record);
    }
}
