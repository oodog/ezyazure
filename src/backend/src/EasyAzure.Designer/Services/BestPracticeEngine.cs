using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Logging;

namespace EasyAzure.Designer.Services;

/// <summary>
/// Rules engine validating Azure environments against Microsoft Well-Architected Framework,
/// Azure Landing Zone guidance, networking, security, identity, and governance rules.
///
/// Rule sources (in priority order):
/// 1. Microsoft Learn official docs
/// 2. Azure Architecture Center
/// 3. Azure Well-Architected Framework
/// 4. Azure Cloud Adoption Framework / Landing Zones
/// 5. Azure Verified Modules
/// 6. Azure Policy built-in definitions
/// </summary>
public class BestPracticeEngine : IBestPracticeEngine
{
    private static readonly IReadOnlyList<BestPracticeRule> AllRules = BuildRules();
    private readonly ILogger<BestPracticeEngine> _logger;

    public BestPracticeEngine(ILogger<BestPracticeEngine> logger)
    {
        _logger = logger;
    }

    public Task<BestPracticeReport> RunReviewAsync(string? subscriptionId, CancellationToken ct = default)
    {
        _logger.LogInformation("Running best-practice review for {Subscription}", subscriptionId ?? "all");

        // In production, query Azure Resource Graph to evaluate each rule against live state.
        // MVP returns all rules as findings to demonstrate the schema.
        var pillarScores = new Dictionary<string, double>
        {
            ["Reliability"] = 85,
            ["Security"] = 72,
            ["Cost Optimization"] = 90,
            ["Operational Excellence"] = 78,
            ["Performance Efficiency"] = 88,
        };

        return Task.FromResult(new BestPracticeReport
        {
            SubscriptionId = subscriptionId,
            PillarScores = pillarScores,
            Findings = AllRules,
            OverallScore = pillarScores.Values.Average(),
        });
    }

    public Task<IReadOnlyList<BestPracticeRule>> ListRulesAsync(CancellationToken ct = default)
        => Task.FromResult(AllRules);

    private static IReadOnlyList<BestPracticeRule> BuildRules() =>
    [
        // Networking rules
        new BestPracticeRule
        {
            RuleId = "NET-NSG-001",
            Title = "Avoid broad inbound management access",
            Severity = "High",
            Check = "NSG inbound allows 0.0.0.0/0 to port 22 or 3389",
            Recommendation = "Restrict management ports. Use Azure Bastion, JIT access, or restrict to known IPs.",
            Framework = ["Security", "Operational Excellence"],
            DocReference = "https://learn.microsoft.com/azure/security/fundamentals/network-best-practices",
            Remediation = "Add specific source IP prefix rules or use Azure Bastion.",
            IaCFix = "In NSG Bicep, set sourceAddressPrefix to a specific CIDR rather than '*' or '0.0.0.0/0'.",
        },
        new BestPracticeRule
        {
            RuleId = "NET-PE-001",
            Title = "Private endpoints should use private DNS zones",
            Severity = "High",
            Check = "Private endpoint exists without a linked private DNS zone",
            Recommendation = "Link the private endpoint to the correct Azure Private DNS Zone to ensure DNS resolves privately.",
            Framework = ["Security", "Reliability"],
            DocReference = "https://learn.microsoft.com/azure/private-link/private-endpoint-dns",
            IaCFix = "Add a privateDnsZoneGroup to the private endpoint Bicep module.",
        },
        new BestPracticeRule
        {
            RuleId = "NET-DIAG-001",
            Title = "Enable diagnostics on critical network resources",
            Severity = "Medium",
            Check = "NSG, VNet, Firewall, or Load Balancer lacks diagnostic settings",
            Recommendation = "Enable diagnostic settings to Log Analytics for all critical network resources.",
            Framework = ["Operational Excellence"],
            DocReference = "https://learn.microsoft.com/azure/azure-monitor/essentials/diagnostic-settings",
        },
        new BestPracticeRule
        {
            RuleId = "NET-UDR-001",
            Title = "Review UDRs for asymmetric routing risk",
            Severity = "Medium",
            Check = "Route table has UDRs that may cause asymmetric routing",
            Recommendation = "Validate that return traffic follows the same path to avoid asymmetric routing through firewalls or NVAs.",
            Framework = ["Reliability", "Security"],
            DocReference = "https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview",
        },

        // Identity rules
        new BestPracticeRule
        {
            RuleId = "ID-RBAC-001",
            Title = "Avoid Owner role assignment without justification",
            Severity = "High",
            Check = "Owner role assigned at subscription or resource group scope",
            Recommendation = "Replace Owner with least-privilege roles. Owner should only be used for Break Glass accounts.",
            Framework = ["Security"],
            DocReference = "https://learn.microsoft.com/azure/role-based-access-control/best-practices",
        },
        new BestPracticeRule
        {
            RuleId = "ID-MI-001",
            Title = "Use managed identities for application access",
            Severity = "High",
            Check = "Application uses service principal with client secret instead of managed identity",
            Recommendation = "Use user-assigned managed identity with permissions applied directly to the identity.",
            Framework = ["Security"],
            DocReference = "https://learn.microsoft.com/azure/active-directory/managed-identities-azure-resources/overview",
            IaCFix = "Replace service principal with a managed identity resource and assign roles.",
        },
        new BestPracticeRule
        {
            RuleId = "ID-KV-001",
            Title = "Use Key Vault for all secrets",
            Severity = "High",
            Check = "Application configuration contains secret values outside of Key Vault",
            Recommendation = "Store all secrets, certificates, and keys in Azure Key Vault. Never commit secrets to code.",
            Framework = ["Security"],
            DocReference = "https://learn.microsoft.com/azure/key-vault/general/best-practices",
        },

        // Landing Zone rules
        new BestPracticeRule
        {
            RuleId = "LZ-MG-001",
            Title = "Use management groups",
            Severity = "Medium",
            Check = "Subscriptions not placed under a management group hierarchy",
            Recommendation = "Organise subscriptions under management groups to apply policy at scale.",
            Framework = ["Operational Excellence"],
            DocReference = "https://learn.microsoft.com/azure/cloud-adoption-framework/ready/landing-zone/design-area/resource-org-management-groups",
        },
        new BestPracticeRule
        {
            RuleId = "LZ-DEF-001",
            Title = "Enable Defender for Cloud",
            Severity = "High",
            Check = "Microsoft Defender for Cloud not enabled on subscription",
            Recommendation = "Enable Defender for Cloud with at least the CSPM plan.",
            Framework = ["Security"],
            DocReference = "https://learn.microsoft.com/azure/defender-for-cloud/get-started",
        },
        new BestPracticeRule
        {
            RuleId = "LZ-TAG-001",
            Title = "Apply resource tagging standards",
            Severity = "Low",
            Check = "Resources missing required tags (environment, costCenter, owner)",
            Recommendation = "Apply consistent tags to all resources for cost management, governance, and operations.",
            Framework = ["Operational Excellence", "Cost Optimization"],
            DocReference = "https://learn.microsoft.com/azure/cloud-adoption-framework/ready/azure-best-practices/resource-tagging",
        },

        // Deployment rules
        new BestPracticeRule
        {
            RuleId = "DEPLOY-STACK-001",
            Title = "Use Deployment Stacks for lifecycle management",
            Severity = "Medium",
            Check = "Resources deployed without a deployment stack",
            Recommendation = "Use Deployment Stacks to manage groups of Azure resources as a single unit, including deletion.",
            Framework = ["Operational Excellence"],
            DocReference = "https://learn.microsoft.com/azure/azure-resource-manager/bicep/deployment-stacks",
            IaCFix = "Wrap deployment in az stack sub create or az stack group create with --deny-settings.",
        },
        new BestPracticeRule
        {
            RuleId = "DEPLOY-WHATIF-001",
            Title = "Run what-if before every deployment",
            Severity = "Medium",
            Check = "Deployment submitted without prior what-if validation",
            Recommendation = "Always run ARM what-if to preview resource changes before deploying.",
            Framework = ["Operational Excellence"],
            DocReference = "https://learn.microsoft.com/azure/azure-resource-manager/templates/deploy-what-if",
        },
    ];
}
