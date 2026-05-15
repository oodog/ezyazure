extern alias AzureIdentity;

using EasyAzure.Core.Interfaces;
using EasyAzure.Core.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

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
    private readonly IConfiguration _config;
    private readonly IHttpClientFactory? _httpClientFactory;

    public BestPracticeEngine(
        ILogger<BestPracticeEngine> logger,
        IConfiguration config,
        IHttpClientFactory? httpClientFactory = null)
    {
        _logger = logger;
        _config = config;
        _httpClientFactory = httpClientFactory;
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

    // ───────── Design-time validation ─────────

    public async Task<DesignValidationReport> ValidateDesignAsync(
        DesignValidationRequest request, CancellationToken ct = default)
    {
        _logger.LogInformation(
            "Validating design with {Nodes} node(s), {Edges} edge(s), AI={UseAi}",
            request.Nodes.Count, request.Edges.Count, request.UseAi);

        var findings = new List<DesignFinding>();

        // 1. Built-in rule pass — fast, deterministic, always runs.
        findings.AddRange(RunBuiltInRules(request));

        // 2. Optional Azure OpenAI augmentation. Only runs if endpoint/deployment configured.
        string? aiModel = null;
        var aiUsed = false;
        if (request.UseAi)
        {
            var (aiFindings, model) = await TryRunAiReviewAsync(request, ct);
            if (aiFindings is not null)
            {
                findings.AddRange(aiFindings);
                aiUsed = true;
                aiModel = model;
            }
        }

        return new DesignValidationReport
        {
            Findings = findings,
            AiUsed = aiUsed,
            AiModel = aiModel,
        };
    }

    /// <summary>
    /// Rule-based design checks. These mirror the front-end validation but live on the
    /// server so they can be evolved independently and re-used by the AI augmentation step.
    /// Each finding cites a Microsoft Learn URL only.
    /// </summary>
    private static IEnumerable<DesignFinding> RunBuiltInRules(DesignValidationRequest req)
    {
        var findings = new List<DesignFinding>();
        var nodeById = req.Nodes.ToDictionary(n => n.Id);
        string? parentTypeOf(DesignValidationNode n) =>
            n.ParentId is null ? null
            : (nodeById.TryGetValue(n.ParentId, out var p) ? p.BlockType : null);

        DesignFinding Add(string severity, string ruleId, string message, string? nodeId, string reference, bool ack)
            => new()
            {
                Severity = severity,
                RuleId = ruleId,
                Message = message,
                NodeId = nodeId,
                Reference = reference,
                Source = "rule",
                RequiresAcknowledgement = ack,
            };

        foreach (var n in req.Nodes)
        {
            switch (n.BlockType)
            {
                case "Subnet" when parentTypeOf(n) != "VNet":
                    findings.Add(Add("error", "Subnet.Parent",
                        $"Subnet \"{n.Label}\" must live inside a VNet.",
                        n.Id, "https://learn.microsoft.com/azure/virtual-network/virtual-network-manage-subnet",
                        ack: false));
                    break;
                case "Virtual Hub" when parentTypeOf(n) != "Virtual WAN":
                    findings.Add(Add("error", "VHub.Parent",
                        $"Virtual Hub \"{n.Label}\" must live inside a Virtual WAN.",
                        n.Id, "https://learn.microsoft.com/azure/virtual-wan/virtual-wan-about", ack: false));
                    break;
                case "Route Intent" when parentTypeOf(n) != "Virtual Hub":
                    findings.Add(Add("error", "RouteIntent.Parent",
                        $"Route Intent \"{n.Label}\" must live inside a Virtual Hub.",
                        n.Id, "https://learn.microsoft.com/azure/virtual-wan/how-to-routing-policies", ack: false));
                    break;
                case "Private Endpoint" when parentTypeOf(n) != "Subnet":
                    findings.Add(Add("error", "PE.Parent",
                        $"Private Endpoint \"{n.Label}\" must live inside a Subnet.",
                        n.Id, "https://learn.microsoft.com/azure/private-link/private-endpoint-overview", ack: false));
                    break;
            }

            string? Prop(string k) =>
                n.Properties.TryGetValue(k, out var v) ? v?.ToString() : null;
            bool BoolProp(string k) =>
                n.Properties.TryGetValue(k, out var v) && v is bool b && b;

            switch (n.BlockType)
            {
                case "Storage Account":
                    if (BoolProp("allowSharedKeyAccess"))
                        findings.Add(Add("warning", "Storage.SharedKey",
                            $"Storage \"{n.Label}\" allows shared-key access. Microsoft recommends Entra ID (RBAC) only.",
                            n.Id, "https://learn.microsoft.com/azure/storage/common/shared-key-authorization-prevent",
                            ack: true));
                    if (BoolProp("allowBlobPublicAccess"))
                        findings.Add(Add("error", "Storage.BlobPublic",
                            $"Storage \"{n.Label}\" allows anonymous blob access.",
                            n.Id, "https://learn.microsoft.com/azure/storage/blobs/anonymous-read-access-prevent",
                            ack: true));
                    if (Prop("minimumTlsVersion") is not null and not "TLS1_2" and not "TLS1_3")
                        findings.Add(Add("warning", "Storage.TLS",
                            $"Storage \"{n.Label}\" should require TLS 1.2+.",
                            n.Id, "https://learn.microsoft.com/azure/storage/common/transport-layer-security-configure-minimum-version",
                            ack: true));
                    break;

                case "Key Vault":
                    if (!BoolProp("enablePurgeProtection"))
                        findings.Add(Add("warning", "KV.PurgeProtection",
                            $"Key Vault \"{n.Label}\" should enable purge protection.",
                            n.Id, "https://learn.microsoft.com/azure/key-vault/general/soft-delete-overview",
                            ack: true));
                    if (!BoolProp("enableRbacAuthorization"))
                        findings.Add(Add("warning", "KV.RBAC",
                            $"Key Vault \"{n.Label}\" should use RBAC instead of access policies.",
                            n.Id, "https://learn.microsoft.com/azure/key-vault/general/rbac-guide",
                            ack: true));
                    if (Prop("publicNetworkAccess") is "Enabled")
                        findings.Add(Add("warning", "KV.PublicAccess",
                            $"Key Vault \"{n.Label}\" exposes a public endpoint. Use private endpoints + Deny by default.",
                            n.Id, "https://learn.microsoft.com/azure/key-vault/general/private-link-service",
                            ack: true));
                    break;

                case "Azure Firewall":
                    if (Prop("sku") is "Basic")
                        findings.Add(Add("warning", "Firewall.SKU.Basic",
                            $"Azure Firewall \"{n.Label}\" uses the Basic SKU — limited IDPS and TLS inspection.",
                            n.Id, "https://learn.microsoft.com/azure/firewall/choose-firewall-sku",
                            ack: true));
                    break;

                case "App Service":
                case "Function App":
                    if (!BoolProp("httpsOnly"))
                        findings.Add(Add("error", "AppService.HttpsOnly",
                            $"App \"{n.Label}\" should enforce HTTPS only.",
                            n.Id, "https://learn.microsoft.com/azure/app-service/configure-ssl-bindings#enforce-https",
                            ack: true));
                    break;

                case "AKS":
                    if (!BoolProp("privateCluster"))
                        findings.Add(Add("warning", "AKS.PrivateCluster",
                            $"AKS \"{n.Label}\" should be a private cluster.",
                            n.Id, "https://learn.microsoft.com/azure/aks/private-clusters",
                            ack: true));
                    if (!BoolProp("rbacEnabled"))
                        findings.Add(Add("error", "AKS.RBAC",
                            $"AKS \"{n.Label}\" must have Kubernetes RBAC enabled.",
                            n.Id, "https://learn.microsoft.com/azure/aks/manage-azure-rbac",
                            ack: false));
                    break;

                case "SQL Database":
                    if (BoolProp("publicNetworkAccess"))
                        findings.Add(Add("warning", "Sql.PublicAccess",
                            $"SQL \"{n.Label}\" allows public network access.",
                            n.Id, "https://learn.microsoft.com/azure/azure-sql/database/connectivity-settings",
                            ack: true));
                    break;
            }
        }

        // Topology rules
        if (!req.Nodes.Any(n => n.BlockType == "Azure Firewall" || n.BlockType == "NVA"))
        {
            findings.Add(Add("info", "Topology.Firewall.Missing",
                "Design has no Azure Firewall or NVA — consider centralising egress for inspection.",
                null, "https://learn.microsoft.com/azure/architecture/reference-architectures/hybrid-networking/secure-vnet-hybrid",
                ack: true));
        }
        if (!req.Nodes.Any(n => n.BlockType == "Log Analytics"))
        {
            findings.Add(Add("warning", "Topology.Observability.Missing",
                "Design has no Log Analytics workspace — observability is required by the WAF Operational Excellence pillar.",
                null, "https://learn.microsoft.com/azure/well-architected/operational-excellence/observability",
                ack: true));
        }

        return findings;
    }

    /// <summary>
    /// Calls Azure OpenAI (if configured) to perform a best-practice review of the design.
    /// The model is instructed to cite Microsoft Learn URLs only. Returns null when
    /// AI is not configured.
    /// </summary>
    private async Task<(IReadOnlyList<DesignFinding>? Findings, string? Model)> TryRunAiReviewAsync(
        DesignValidationRequest request, CancellationToken ct)
    {
        var endpoint = _config["AzureOpenAI:Endpoint"];
        var deployment = _config["AzureOpenAI:DeploymentName"];
        var apiKey = _config["AzureOpenAI:ApiKey"];
        var apiVersion = _config["AzureOpenAI:ApiVersion"] ?? "2024-10-21";

        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(deployment))
        {
            _logger.LogInformation("Azure OpenAI not configured — skipping AI design review.");
            return (null, null);
        }
        if (_httpClientFactory is null)
        {
            _logger.LogWarning("IHttpClientFactory not registered — cannot call Azure OpenAI.");
            return (null, null);
        }

        try
        {
            var systemPrompt =
                "You are a senior Azure cloud architect performing a best-practice review of an architecture diagram. " +
                "Use ONLY publicly available Microsoft documentation as the basis for your findings — primarily learn.microsoft.com. " +
                "Do not invent rules. Do not cite third-party blogs. Every finding MUST include a Microsoft Learn URL. " +
                "Output a JSON object with this exact shape: " +
                "{\"findings\":[{\"severity\":\"error|warning|info\",\"ruleId\":\"AI.<short-key>\",\"message\":\"...\"," +
                "\"nodeId\":\"<node-id or null>\",\"reference\":\"https://learn.microsoft.com/...\"," +
                "\"requiresAcknowledgement\":true|false}]} " +
                "Only flag genuine deviations from Microsoft Well-Architected Framework, Azure Landing Zones, or service-level best practices. " +
                "Do not duplicate items already covered by the deterministic ruleset (provided to you). " +
                "Use severity 'error' only for things that will not work or are explicitly forbidden by Microsoft guidance.";

            var designJson = JsonSerializer.Serialize(new
            {
                nodes = request.Nodes.Select(n => new
                {
                    n.Id,
                    n.BlockType,
                    n.Label,
                    n.ParentId,
                    n.Properties,
                }),
                edges = request.Edges.Select(e => new
                {
                    e.Id,
                    e.Source,
                    e.Target,
                    e.Relationship,
                }),
            });

            var body = new
            {
                messages = new object[]
                {
                    new { role = "system", content = systemPrompt },
                    new { role = "user", content = "Review this Azure architecture and return JSON only.\n\n" + designJson },
                },
                temperature = 0.0,
                top_p = 1.0,
                response_format = new { type = "json_object" },
                max_tokens = 1500,
            };

            using var client = _httpClientFactory.CreateClient();
            client.Timeout = TimeSpan.FromSeconds(30);
            var url = $"{endpoint.TrimEnd('/')}/openai/deployments/{deployment}/chat/completions?api-version={apiVersion}";
            using var msg = new HttpRequestMessage(HttpMethod.Post, url);
            msg.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
            if (!string.IsNullOrEmpty(apiKey))
            {
                msg.Headers.Add("api-key", apiKey);
            }
            else
            {
                // Managed identity / DefaultAzureCredential path — token fetched by caller's hosting env.
                var cred = new AzureIdentity::Azure.Identity.DefaultAzureCredential();
                var token = await cred.GetTokenAsync(
                    new Azure.Core.TokenRequestContext(["https://cognitiveservices.azure.com/.default"]), ct);
                msg.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token.Token);
            }

            using var response = await client.SendAsync(msg, ct);
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning("Azure OpenAI returned {Status}", (int)response.StatusCode);
                return (null, null);
            }

            using var stream = await response.Content.ReadAsStreamAsync(ct);
            using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: ct);
            var content = doc.RootElement
                .GetProperty("choices")[0]
                .GetProperty("message")
                .GetProperty("content")
                .GetString();

            if (string.IsNullOrWhiteSpace(content))
            {
                return (null, deployment);
            }

            var findings = ParseAiFindings(content);
            return (findings, deployment);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "AI design review failed — falling back to rule-only findings.");
            return (null, null);
        }
    }

    private static readonly Regex LearnUrlPattern =
        new(@"^https://learn\.microsoft\.com/", RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static IReadOnlyList<DesignFinding> ParseAiFindings(string json)
    {
        var result = new List<DesignFinding>();
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("findings", out var arr) || arr.ValueKind != JsonValueKind.Array)
                return result;
            foreach (var f in arr.EnumerateArray())
            {
                var reference = f.TryGetProperty("reference", out var refEl) ? refEl.GetString() : null;
                // Enforce: Microsoft Learn URLs only.
                if (string.IsNullOrWhiteSpace(reference) || !LearnUrlPattern.IsMatch(reference))
                {
                    continue;
                }
                var severity = (f.TryGetProperty("severity", out var sev) ? sev.GetString() : "info") ?? "info";
                if (severity is not "error" and not "warning" and not "info") severity = "info";
                result.Add(new DesignFinding
                {
                    Severity = severity,
                    RuleId = f.TryGetProperty("ruleId", out var rid) ? rid.GetString() ?? "AI.unknown" : "AI.unknown",
                    Message = f.TryGetProperty("message", out var msg) ? msg.GetString() ?? "" : "",
                    NodeId = f.TryGetProperty("nodeId", out var nid) && nid.ValueKind == JsonValueKind.String ? nid.GetString() : null,
                    Reference = reference,
                    Source = "ai",
                    RequiresAcknowledgement = !f.TryGetProperty("requiresAcknowledgement", out var ack) || ack.ValueKind != JsonValueKind.False,
                });
            }
        }
        catch
        {
            // Ignore malformed AI output.
        }
        return result;
    }
}
