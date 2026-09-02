using EasyAzure.Core.Models;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace EasyAzure.Designer.Services;

public sealed class ProductSkillDefinition
{
    [JsonPropertyName("$schema")]
    public string? Schema { get; init; }

    [JsonRequired]
    public string Id { get; init; } = string.Empty;
    [JsonRequired]
    public string Version { get; init; } = string.Empty;
    [JsonRequired]
    public string Name { get; init; } = string.Empty;
    [JsonRequired]
    public string Instructions { get; init; } = string.Empty;
    [JsonRequired]
    public string Reference { get; init; } = string.Empty;
    [JsonRequired]
    public IReadOnlyList<string> IntentKeywords { get; init; } = [];
    [JsonRequired]
    public IReadOnlyList<string> ResourceTypes { get; init; } = [];
    [JsonRequired]
    public IReadOnlyList<string> ResourceTypePrefixes { get; init; } = [];
}

public sealed record ProductSkillBundle(
    string Version,
    string Source,
    IReadOnlyList<ProductSkillDefinition> Skills);

public interface IProductSkillProvider
{
    ProductSkillBundle Load();
}

public sealed class JsonProductSkillProvider : IProductSkillProvider
{
    internal const string DefaultRelativePath = "Skills/discovery-assistant";

    private static readonly JsonSerializerOptions SerializerOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
    };

    private readonly IConfiguration _configuration;
    private readonly ILogger<JsonProductSkillProvider> _logger;

    public JsonProductSkillProvider(
        IConfiguration configuration,
        ILogger<JsonProductSkillProvider> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    public ProductSkillBundle Load()
    {
        var configuredPath = _configuration["DiscoveryAssistant:SkillsPath"];
        var requestedPath = string.IsNullOrWhiteSpace(configuredPath)
            ? DefaultRelativePath
            : configuredPath;
        var directory = Path.GetFullPath(Path.IsPathRooted(requestedPath)
            ? requestedPath
            : Path.Combine(AppContext.BaseDirectory, requestedPath));
        var bundle = LoadDirectory(directory);
        _logger.LogInformation(
            "Loaded product skill bundle {BundleVersion} with {SkillCount} skills from {SkillSource}",
            bundle.Version,
            bundle.Skills.Count,
            bundle.Source);
        return bundle;
    }

    internal static ProductSkillBundle LoadDirectory(string directory)
    {
        var manifestPath = Path.Combine(directory, "skill-bundle.json");
        if (!File.Exists(manifestPath))
            throw new InvalidOperationException($"Product skill manifest was not found at '{manifestPath}'.");

        var manifest = Deserialize<ProductSkillManifest>(manifestPath);
        if (manifest.Skills is null || manifest.Skills.Count == 0)
            throw new InvalidOperationException("Product skill manifest must contain at least one skill file.");

        var duplicateFile = manifest.Skills
            .GroupBy(file => file, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicateFile is not null)
            throw new InvalidOperationException($"Product skill manifest contains duplicate file '{duplicateFile.Key}'.");

        var skills = new List<ProductSkillDefinition>(manifest.Skills.Count);
        foreach (var file in manifest.Skills)
        {
            if (string.IsNullOrWhiteSpace(file) || !string.Equals(Path.GetFileName(file), file, StringComparison.Ordinal) ||
                !file.EndsWith(".skill.json", StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException($"Product skill manifest contains invalid file name '{file}'.");

            var skillPath = Path.Combine(directory, file);
            if (!File.Exists(skillPath))
                throw new InvalidOperationException($"Product skill file was not found at '{skillPath}'.");
            skills.Add(Deserialize<ProductSkillDefinition>(skillPath));
        }

        return new ProductSkillBundle(manifest.BundleVersion, directory, skills);
    }

    private static T Deserialize<T>(string path)
    {
        try
        {
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), SerializerOptions)
                ?? throw new InvalidOperationException($"Product skill configuration '{path}' was empty.");
        }
        catch (JsonException ex)
        {
            throw new InvalidOperationException($"Product skill configuration '{path}' is invalid JSON: {ex.Message}", ex);
        }
    }

    private sealed class ProductSkillManifest
    {
        [JsonPropertyName("$schema")]
        public string? Schema { get; init; }

        [JsonRequired]
        public string BundleVersion { get; init; } = string.Empty;
        [JsonRequired]
        public IReadOnlyList<string> Skills { get; init; } = [];
    }
}

public sealed class ProductSkillRegistry
{
    private const string FallbackSkillId = "other";
    private static readonly Regex IdentifierPattern = new(
        "^[a-z0-9]+(?:-[a-z0-9]+)*$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);
    private static readonly Regex VersionPattern = new(
        "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$",
        RegexOptions.CultureInvariant | RegexOptions.NonBacktracking);

    private readonly IReadOnlyDictionary<string, ProductSkillDefinition> _skills;
    private readonly IReadOnlyList<(string Prefix, string SkillId)> _resourceTypePrefixes;
    private readonly IReadOnlyDictionary<string, string> _resourceTypes;

    public ProductSkillRegistry(IProductSkillProvider provider)
        : this(provider.Load())
    {
    }

    internal ProductSkillRegistry(ProductSkillBundle bundle)
    {
        ArgumentNullException.ThrowIfNull(bundle);
        if (!VersionPattern.IsMatch(bundle.Version))
            throw new InvalidOperationException($"Product skill bundle version '{bundle.Version}' is not semantic versioning.");

        var skills = new Dictionary<string, ProductSkillDefinition>(StringComparer.OrdinalIgnoreCase);
        var resourceTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var resourceTypePrefixes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var skill in bundle.Skills)
        {
            Validate(skill);
            if (!skills.TryAdd(skill.Id, skill))
                throw new InvalidOperationException($"Product skill ID '{skill.Id}' is duplicated.");

            foreach (var resourceType in skill.ResourceTypes)
            {
                if (!resourceTypes.TryAdd(resourceType, skill.Id))
                    throw new InvalidOperationException($"Azure resource type '{resourceType}' is assigned to multiple product skills.");
            }
            foreach (var prefix in skill.ResourceTypePrefixes)
            {
                if (!resourceTypePrefixes.TryAdd(prefix, skill.Id))
                    throw new InvalidOperationException($"Azure resource type prefix '{prefix}' is assigned to multiple product skills.");
            }
        }

        if (!skills.ContainsKey(FallbackSkillId))
            throw new InvalidOperationException($"Product skill bundle must contain the '{FallbackSkillId}' fallback skill.");

        Version = bundle.Version;
        Source = bundle.Source;
        _skills = skills;
        _resourceTypes = resourceTypes;
        _resourceTypePrefixes = resourceTypePrefixes
            .Select(mapping => (Prefix: mapping.Key, SkillId: mapping.Value))
            .OrderByDescending(mapping => mapping.Prefix.Length)
            .ToList();
    }

    public string Version { get; }
    public string Source { get; }
    public IReadOnlyDictionary<string, ProductSkillDefinition> Skills => _skills;

    public IReadOnlyList<ProductSkillDefinition> SelectSkills(
        DiscoveryAssistantRequest request,
        TopologyGraph graph)
    {
        var selected = new List<string>();
        void Add(string skillId)
        {
            if (_skills.ContainsKey(skillId) && !selected.Contains(skillId, StringComparer.OrdinalIgnoreCase))
                selected.Add(skillId);
        }

        foreach (var focus in request.FocusTechnologies.Take(3)) Add(focus);
        var question = request.Message;
        foreach (var skill in _skills.Values)
            if (skill.IntentKeywords.Any(keyword => ContainsIntent(question, keyword))) Add(skill.Id);

        if (!string.IsNullOrWhiteSpace(request.FocusResourceId))
        {
            var focusNode = graph.Nodes.FirstOrDefault(node =>
                string.Equals(node.Id, request.FocusResourceId, StringComparison.OrdinalIgnoreCase));
            if (focusNode is not null) Add(TechnologyFor(focusNode.Data.Type));
        }

        if (selected.Count == 0)
        {
            foreach (var technology in graph.Nodes
                         .GroupBy(node => TechnologyFor(node.Data.Type))
                         .OrderByDescending(group => group.Count())
                         .Select(group => group.Key)
                         .Take(2))
                Add(technology);
        }
        if (selected.Count == 0) Add(FallbackSkillId);
        return selected.Take(3).Select(skillId => _skills[skillId]).ToList();
    }

    public string TechnologyFor(string resourceType)
    {
        if (_resourceTypes.TryGetValue(resourceType, out var exactSkillId)) return exactSkillId;
        var prefix = _resourceTypePrefixes.FirstOrDefault(mapping =>
            resourceType.StartsWith(mapping.Prefix, StringComparison.OrdinalIgnoreCase));
        return prefix == default ? FallbackSkillId : prefix.SkillId;
    }

    private static bool ContainsIntent(string question, string keyword)
    {
        var startIndex = 0;
        while (startIndex < question.Length)
        {
            var index = question.IndexOf(keyword, startIndex, StringComparison.OrdinalIgnoreCase);
            if (index < 0) return false;
            var beforeIsBoundary = index == 0 || !char.IsLetterOrDigit(question[index - 1]);
            var afterIndex = index + keyword.Length;
            var afterIsBoundary = afterIndex == question.Length || !char.IsLetterOrDigit(question[afterIndex]);
            if (beforeIsBoundary && afterIsBoundary) return true;
            startIndex = index + 1;
        }
        return false;
    }

    private static void Validate(ProductSkillDefinition skill)
    {
        if (!IdentifierPattern.IsMatch(skill.Id))
            throw new InvalidOperationException($"Product skill ID '{skill.Id}' is invalid.");
        if (!VersionPattern.IsMatch(skill.Version))
            throw new InvalidOperationException($"Product skill '{skill.Id}' version '{skill.Version}' is not semantic versioning.");
        if (string.IsNullOrWhiteSpace(skill.Name) || skill.Name.Length > 100)
            throw new InvalidOperationException($"Product skill '{skill.Id}' must have a name of 100 characters or fewer.");
        if (string.IsNullOrWhiteSpace(skill.Instructions) || skill.Instructions.Length > 4_000)
            throw new InvalidOperationException($"Product skill '{skill.Id}' must have instructions of 4,000 characters or fewer.");
        if (!Uri.TryCreate(skill.Reference, UriKind.Absolute, out var reference) ||
            reference.Scheme != Uri.UriSchemeHttps ||
            !string.Equals(reference.Host, "learn.microsoft.com", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException($"Product skill '{skill.Id}' reference must be an HTTPS Microsoft Learn URL.");

        ValidateValues(skill, skill.IntentKeywords, "intent keyword");
        ValidateValues(skill, skill.ResourceTypes, "resource type");
        ValidateValues(skill, skill.ResourceTypePrefixes, "resource type prefix");
    }

    private static void ValidateValues(ProductSkillDefinition skill, IReadOnlyList<string>? values, string valueType)
    {
        if (values is null)
            throw new InvalidOperationException($"Product skill '{skill.Id}' must provide an {valueType} list.");
        if (values.Any(string.IsNullOrWhiteSpace))
            throw new InvalidOperationException($"Product skill '{skill.Id}' contains an empty {valueType}.");
        var duplicate = values.GroupBy(value => value, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
            throw new InvalidOperationException($"Product skill '{skill.Id}' contains duplicate {valueType} '{duplicate.Key}'.");
    }
}