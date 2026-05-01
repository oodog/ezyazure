# Architecture

## Overview

EasyAzure is deployed as an Azure-hosted management tool inside a **dedicated tooling subscription**, separate from the workload subscriptions it manages. It never runs inside the same subscriptions it discovers or deploys into.

## System architecture

```
                         ┌──────────────────────────────────┐
                         │  Azure Static Web Apps           │
                         │  React 18 + TypeScript           │
                         │  React Flow / Monaco Editor      │
                         │  MSAL.js (Entra ID auth)        │
                         └───────────────┬──────────────────┘
                                         │ HTTPS + JWT
                         ┌───────────────▼──────────────────┐
                         │  Azure Container Apps            │
                         │  .NET 8 Web API                  │
                         │  /api/discovery                  │
                         │  /api/datapath                   │
                         │  /api/designer                   │
                         │  /api/bestpractice               │
                         │  /api/iac                        │
                         └──┬──────────────────────────┬───┘
                            │                          │
           ┌────────────────▼──┐              ┌────────▼──────────────┐
           │  Container Apps   │              │  Azure Resource Graph │
           │  Jobs (workers)   │              │  Azure SDK            │
           │  DiscoveryWorker  │              │  Network Watcher      │
           │  DriftWorker      │              └───────────────────────┘
           └──────┬────────────┘
                  │
     ┌────────────▼─────────────────────────────────────┐
     │  Data tier                                        │
     │  Azure Cosmos DB Gremlin  — topology graph        │
     │  Azure PostgreSQL         — projects, deployments │
     │  Azure Storage Account    — generated IaC, exports│
     └──────────────────────────────────────────────────┘
                  │
     ┌────────────▼─────────────────────────────────────┐
     │  Platform services                                │
     │  Azure Key Vault          — secrets               │
     │  Azure Managed Identity   — workload identity     │
     │  Application Insights     — observability         │
     │  Log Analytics Workspace  — logs + queries        │
     └──────────────────────────────────────────────────┘
```

## Authentication and authorization

- **Identity provider**: Microsoft Entra ID (OIDC)
- **Frontend auth**: MSAL.js with PKCE flow, access tokens acquired silently
- **API auth**: JWT bearer tokens validated via Microsoft.Identity.Web
- **App roles** (defined in Entra app registration):

| Role | Permissions |
|------|------------|
| Reader | View discovery, topology, data-path, best-practice reports |
| Designer | All Reader + create/edit design environments |
| Reviewer | All Designer + view what-if results |
| Operator | All Reviewer + trigger what-if + deploy |
| Admin | Full access including user management |

## Azure access model

The tool's Managed Identity holds only what it needs:

| Action | Required role | Scope |
|--------|--------------|-------|
| Discovery (read) | Reader | Subscription |
| Network Watcher queries | Network Contributor (read) | Subscription |
| Resource Graph queries | (built into Reader) | Subscription |
| Deploy resources | Contributor | Target resource group only |
| Deploy RBAC | User Access Administrator | Target resource group only |

## Data flow — discovery

```
Container Apps Job
  → DefaultAzureCredential (Managed Identity)
  → Azure Resource Graph API (bulk inventory)
  → Azure SDK (deep resource properties)
  → Azure Network Watcher (effective routes, effective NSG rules)
  → Topology graph (Cosmos DB Gremlin or PostgreSQL)
  → API serves graph to frontend
```

## Data flow — data-path analysis

```
User selects source + destination + protocol/port
  → API: DataPathService.AnalyzeAsync()
  → Fetch source NIC/subnet from graph
  → NsgEvaluator: check outbound NSG rules
  → RouteEvaluator: check route table / UDR / next hop
  → PeeringEvaluator: check VNet peering hops
  → NsgEvaluator: check inbound NSG rules at destination
  → Return PathResult: Allowed / Blocked / Unknown + hop trace
```

## Data flow — IaC generation and deployment

```
Designer canvas (React Flow nodes/edges)
  → POST /api/iac/generate
  → BicepGeneratorService: node → Bicep resource
  → Return Bicep code (Monaco editor)
  → POST /api/iac/whatif
  → ARM what-if API: preview changes
  → User reviews and approves
  → POST /api/iac/deploy
  → az stack group create (Deployment Stack)
  → Deployment record stored
  → DriftWorker detects future drift
```

## Technology choices

| Concern | Choice | Reason |
|---------|--------|--------|
| Frontend hosting | Azure Static Web Apps | Designed for modern SPA + API integration |
| API hosting | Azure Container Apps | Containerized, scalable, managed |
| Workers | Container Apps Jobs | Run-to-completion jobs, schedule or on-demand |
| Graph store | Cosmos DB Gremlin | Azure-native, designed for connected data |
| Relational | PostgreSQL Flexible Server | Projects, deployments, audit trail |
| IaC language | Bicep | Microsoft-native, best ARM alignment |
| IaC modules | Azure Verified Modules | Microsoft-maintained, aligned with CAF |
| Deployment lifecycle | Deployment Stacks | Manage group of resources as a unit |
| Auth | Microsoft Entra ID | Enterprise-grade, Managed Identity support |
| Secrets | Key Vault | Zero secrets in code or config |
| Observability | App Insights + Log Analytics | Full Azure-native stack |
