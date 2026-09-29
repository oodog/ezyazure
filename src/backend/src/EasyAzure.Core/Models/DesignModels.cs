namespace EasyAzure.Core.Models;

public record DesignEnvironment
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; init; } = DateTimeOffset.UtcNow;
    public IReadOnlyList<DesignNode> Nodes { get; init; } = [];
    public IReadOnlyList<DesignEdge> Edges { get; init; } = [];
}

public record DesignEnvironmentSummary(string Id, string Name, DateTimeOffset UpdatedAt, int NodeCount);

public record DesignNode
{
    public required string Id { get; init; }
    public required string BlockType { get; init; }
    public required string Label { get; init; }
    public FlowPosition Position { get; init; } = new(0, 0);
    public Dictionary<string, object> Properties { get; init; } = [];
}

public record DesignEdge
{
    public required string Id { get; init; }
    public required string Source { get; init; }
    public required string Target { get; init; }
    public string Relationship { get; init; } = "connectedTo";
}

public record CreateEnvironmentRequest(string Name);

public record DesignImportRequest
{
    public required string FileName { get; init; }
    public required string DocumentType { get; init; } // image | pdf | drawio
    public string? TextContent { get; init; }
    public IReadOnlyList<DesignImportImage> Images { get; init; } = [];
    public IReadOnlyList<DesignImportHint> DiagramHints { get; init; } = [];
}

public record DesignImportImage
{
    public required string DataUrl { get; init; }
    public int PageNumber { get; init; }
}

public record DesignImportHint
{
    public required string Id { get; init; }
    public required string Label { get; init; }
    public string? Style { get; init; }
    public string Kind { get; init; } = "shape";
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public string? ParentId { get; init; }
    public string? SourceId { get; init; }
    public string? TargetId { get; init; }
}

public record DesignImportProposal
{
    public required string Summary { get; init; }
    public required string SourceFileName { get; init; }
    public required string Model { get; init; }
    public IReadOnlyList<DesignImportNode> Nodes { get; init; } = [];
    public IReadOnlyList<DesignImportEdge> Edges { get; init; } = [];
    public IReadOnlyList<string> Warnings { get; init; } = [];
}

public record DesignImportNode
{
    public required string Id { get; init; }
    public required string BlockType { get; init; }
    public required string Label { get; init; }
    public double X { get; init; }
    public double Y { get; init; }
    public double Width { get; init; }
    public double Height { get; init; }
    public string? ParentId { get; init; }
    public double Confidence { get; init; }
    public string Evidence { get; init; } = string.Empty;
    public Dictionary<string, object> Properties { get; init; } = [];
}

public record DesignImportEdge
{
    public required string Id { get; init; }
    public required string Source { get; init; }
    public required string Target { get; init; }
    public required string Relationship { get; init; }
    public double Confidence { get; init; }
    public string Evidence { get; init; } = string.Empty;
}

public record ValidationResult
{
    public bool IsValid { get; init; }
    public IReadOnlyList<ValidationIssue> Issues { get; init; } = [];
}

public record ValidationIssue(string Severity, string Message, string? NodeId = null);

public record GenerateBicepRequest(string EnvironmentId);

public record GenerateBicepResult
{
    public required string Bicep { get; init; }
    public IReadOnlyList<string> Warnings { get; init; } = [];
}

public record WhatIfRequest
{
    public required string EnvironmentId { get; init; }
    public required string Bicep { get; init; }
    public required string TargetSubscriptionId { get; init; }
    public required string TargetResourceGroup { get; init; }
}

public record WhatIfResult
{
    public required string Status { get; init; }
    public IReadOnlyList<WhatIfChange> Changes { get; init; } = [];
}

public record WhatIfChange(string ResourceId, string ChangeType, string? Before = null, string? After = null);

public record DeployRequest
{
    public required string EnvironmentId { get; init; }
    public required string Bicep { get; init; }
    public required string TargetSubscriptionId { get; init; }
    public required string TargetResourceGroup { get; init; }
    public string DeploymentStackName { get; init; } = "easyazure-stack";
}

public record DeploymentRecord
{
    public required string DeploymentId { get; init; }
    public required string Status { get; init; }
    public DateTimeOffset StartedAt { get; init; } = DateTimeOffset.UtcNow;
    public DateTimeOffset? CompletedAt { get; init; }
    public string? Message { get; init; }
}
