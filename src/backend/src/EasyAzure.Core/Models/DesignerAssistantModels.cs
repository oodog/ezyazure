namespace EasyAzure.Core.Models;

public record DesignerAssistantRequest
{
    public required string Message { get; init; }
    public IReadOnlyList<DiscoveryAssistantTurn> History { get; init; } = [];
    public IReadOnlyList<DesignerAssistantNode> Nodes { get; init; } = [];
    public IReadOnlyList<DesignerAssistantEdge> Edges { get; init; } = [];
}

public record DesignerAssistantNode
{
    public required string Id { get; init; }
    public required string BlockType { get; init; }
    public required string Label { get; init; }
    public string? ParentId { get; init; }
    public bool ReadOnly { get; init; }
    public Dictionary<string, object?> Properties { get; init; } = [];
}

public record DesignerAssistantEdge
{
    public required string Id { get; init; }
    public required string Source { get; init; }
    public required string Target { get; init; }
    public string? Relationship { get; init; }
}

public record DesignerAssistantResponse
{
    public required string Summary { get; init; }
    public IReadOnlyList<DesignerAssistantAction> Actions { get; init; } = [];
    public IReadOnlyList<string> Warnings { get; init; } = [];
    public bool RequiresClarification { get; init; }
    public string? Clarification { get; init; }
    public bool AiUsed { get; init; }
    public string? AiModel { get; init; }
}

public record DesignerAssistantAction
{
    public required string Kind { get; init; } // addNode | updateNode | connect
    public string? NodeRef { get; init; }
    public string? SourceRef { get; init; }
    public string? TargetRef { get; init; }
    public string? BlockType { get; init; }
    public string? Label { get; init; }
    public string? ParentRef { get; init; }
    public IReadOnlyDictionary<string, string> Properties { get; init; } = new Dictionary<string, string>();
    public required string Explanation { get; init; }
}