# Data model

## Resource node

Every discovered Azure resource is stored as a node with its full ARM resource ID as the primary key.

```json
{
  "id": "/subscriptions/xxx/resourceGroups/rg1/providers/Microsoft.Network/virtualNetworks/vnet1",
  "type": "Microsoft.Network/virtualNetworks",
  "name": "vnet1",
  "subscriptionId": "xxx",
  "resourceGroup": "rg1",
  "location": "australiaeast",
  "properties": { ... },
  "tags": { "environment": "prod", "costCenter": "platform" },
  "discoveredAt": "2026-04-30T00:00:00Z"
}
```

## Relationship edge

Edges connect resource nodes directionally and carry a typed relationship label.

```json
{
  "from": "/subscriptions/xxx/.../subnets/subnet-app",
  "to": "/subscriptions/xxx/.../networkSecurityGroups/nsg-app",
  "relationship": "associatedWith"
}
```

## Relationship types

| Relationship | Example |
|-------------|---------|
| `contains` | VNet → Subnet |
| `associatedWith` | Subnet → NSG, Subnet → Route Table |
| `connectedTo` | NIC → Subnet |
| `routesTo` | Route Table entry → Next hop |
| `allows` | NSG rule → traffic |
| `denies` | NSG rule → traffic |
| `peeredWith` | VNet ↔ VNet (peering) |
| `dependsOn` | VM → NIC |
| `deployedBy` | Resource → Deployment Stack |
| `usesIdentity` | App Service → Managed Identity |
| `usesPrivateDnsZone` | Private Endpoint → Private DNS Zone |

## Design environment model

```json
{
  "id": "uuid",
  "name": "App Landing Zone v2",
  "createdAt": "2026-04-30T00:00:00Z",
  "updatedAt": "2026-04-30T00:00:00Z",
  "nodes": [
    {
      "id": "node-1",
      "blockType": "VNet",
      "label": "vnet-app",
      "position": { "x": 100, "y": 150 },
      "properties": { "addressPrefix": "10.10.0.0/16" }
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "source": "node-1",
      "target": "node-2",
      "relationship": "contains"
    }
  ]
}
```

## Best practice rule

```json
{
  "ruleId": "NET-NSG-001",
  "title": "Avoid broad inbound management access",
  "severity": "High",
  "check": "NSG inbound allows 0.0.0.0/0 to port 22 or 3389",
  "recommendation": "Restrict management ports. Use Azure Bastion, JIT access, or restrict to known IPs.",
  "framework": ["Security", "Operational Excellence"],
  "docReference": "https://learn.microsoft.com/azure/security/fundamentals/network-best-practices",
  "remediation": "Add specific source IP prefix rules or use Azure Bastion.",
  "iacFix": "In NSG Bicep, set sourceAddressPrefix to a specific CIDR rather than '*' or '0.0.0.0/0'."
}
```

## Data-path result

```json
{
  "status": "Allowed",
  "blockingRule": null,
  "hops": [
    { "resourceId": "...vm-a", "resourceName": "vm-a", "resourceType": "Microsoft.Compute/virtualMachines" },
    { "resourceId": "...nsg-outbound", "resourceName": "NSG (outbound)", "matchedRule": "DefaultOutboundAllowed" },
    { "resourceId": "...route", "resourceName": "Route Table", "detail": "0.0.0.0/0 → Internet" },
    { "resourceId": "...nsg-inbound", "resourceName": "NSG (inbound)", "matchedRule": "AllowVnetInBound" },
    { "resourceId": "...pe-sql", "resourceName": "pe-sql", "resourceType": "Microsoft.Network/privateEndpoints" }
  ],
  "riskNotes": []
}
```

## Deployment record

```json
{
  "deploymentId": "uuid",
  "status": "Succeeded",
  "startedAt": "2026-04-30T00:00:00Z",
  "completedAt": "2026-04-30T00:05:00Z",
  "message": "Deployment Stack 'easyazure-stack' applied successfully."
}
```
