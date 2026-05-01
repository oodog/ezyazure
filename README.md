# EasyAzure

An Azure drag-and-drop environment builder, discovery engine, data-path visualizer, and safe IaC deployment tool.

## What it does

- **Discover** existing Azure environments across one or many subscriptions
- **Visualize** VNets, subnets, NSGs, route tables, private endpoints, VMs, App Services, databases, firewalls, gateways, and load balancers
- **Analyze data paths** between resources, including routes, NSGs, next hops, peering, private endpoints, and blockers
- **Design** new environments with drag-and-drop blocks
- **Validate** designs against Microsoft Well-Architected Framework and Azure Landing Zone best practices
- **Generate** Bicep Infrastructure-as-Code using Azure Verified Modules
- **Preview** changes with ARM what-if before deployment
- **Deploy** safely using Deployment Stacks, Managed Identity, and RBAC

## Architecture

```
Azure Front Door (optional WAF)
        │
Azure Static Web Apps (React/TypeScript frontend)
        │
Azure Container Apps (NET 8 Web API)
        │
Azure Container Apps Jobs (discovery + drift workers)
        │
Azure Resource Graph + Azure SDK + Microsoft Graph
        │
Cosmos DB (graph topology) + PostgreSQL (relational)
        │
Storage Account (generated IaC, exports, diagrams)
        │
Key Vault + Managed Identity
        │
Application Insights + Log Analytics
```

## Project structure

```
easyazure/
├── src/
│   ├── frontend/          React + TypeScript + React Flow
│   ├── backend/           .NET 8 Web API solution
│   │   └── src/
│   │       ├── EasyAzure.Api/          REST API + controllers
│   │       ├── EasyAzure.Core/         Shared models + interfaces
│   │       ├── EasyAzure.Discovery/    Resource Graph + Azure SDK collectors
│   │       ├── EasyAzure.Topology/     Graph model builder
│   │       ├── EasyAzure.DataPath/     NSG + route + peering evaluators
│   │       ├── EasyAzure.Designer/     Canvas model + best-practice engine
│   │       └── EasyAzure.IaC/          Bicep generator + deployment stacks
│   └── workers/
│       ├── EasyAzure.DiscoveryWorker/  Container Apps Job for discovery
│       └── EasyAzure.DriftWorker/      Container Apps Job for drift detection
├── infra/                 Bicep for the tool itself
│   ├── main.bicep
│   └── modules/
├── docs/                  Architecture and design docs
└── .github/workflows/     CI/CD pipelines
```

## MVP phases

| Phase | Scope |
|-------|-------|
| MVP 1 | Multi-subscription discovery + topology view |
| MVP 2 | Network data-path analyzer |
| MVP 3 | Drag-and-drop designer |
| MVP 4 | Bicep IaC generation |
| MVP 5 | What-if preview + deployment stacks |

## Technology stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, React Flow, Tailwind CSS, MSAL.js, Monaco Editor |
| Backend API | .NET 8 Web API, Azure SDK for .NET |
| Workers | .NET 8 Container Apps Jobs |
| Discovery | Azure Resource Graph, Azure REST APIs, Network Watcher |
| Graph store | Azure Cosmos DB (Gremlin API) |
| Relational | Azure PostgreSQL Flexible Server |
| IaC | Bicep + Azure Verified Modules + Deployment Stacks |
| Auth | Microsoft Entra ID, MSAL |
| Secrets | Azure Key Vault |
| Observability | Application Insights, Log Analytics |
| CI/CD | GitHub Actions |

## Getting started

### Prerequisites

- Azure CLI >= 2.60
- .NET SDK 8.0
- Node.js >= 20
- Docker Desktop
- Bicep CLI

### Local development

```bash
# Clone and bootstrap
git clone https://github.com/your-org/easyazure
cd easyazure

# Start backend
cd src/backend
dotnet restore EasyAzure.sln
dotnet run --project src/EasyAzure.Api

# Start frontend
cd src/frontend
npm install
npm run dev
```

### Deploy the tool infrastructure to Azure

```powershell
cd infra
az login
az deployment sub create \
  --name easyazure-infra \
  --location australiaeast \
  --template-file main.bicep \
  --parameters main.bicepparam
```

## Security model

- **Authentication**: Microsoft Entra ID (MSAL)
- **Authorization**: App roles — Reader, Designer, Reviewer, Operator, Admin
- **Azure access**: Managed Identity with least-privilege RBAC
  - Discovery: `Reader` + `Network Contributor` (read-only) at subscription scope
  - Deployment: `Contributor` scoped to target resource group only
- **Secrets**: Azure Key Vault, no secrets in code or config files
- **Networking**: Private endpoints for all backend datastores

## Best-practice framework

Rules are sourced and referenced from:

1. Microsoft Learn official documentation
2. Azure Architecture Center
3. Azure Well-Architected Framework
4. Azure Cloud Adoption Framework / Landing Zones
5. Azure Verified Modules
6. Azure Policy built-in definitions

Each rule carries: ID, severity, title, detection logic, remediation, IaC fix, and Microsoft doc reference.

## Contributing

See [docs/contributing.md](docs/contributing.md).

## License

MIT
