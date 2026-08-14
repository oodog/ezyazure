# Getting started — local development

## CI/CD deployment prerequisites

The application workflows deploy the `main` and `develop` branches to the staging resources. Before running them, configure the GitHub `staging` environment and these Actions secrets:

| Secret | Purpose |
| --- | --- |
| `AZURE_CLIENT_ID` | Client ID of the Entra application trusted by GitHub OIDC |
| `AZURE_TENANT_ID` | Entra tenant containing the deployment application |
| `AZURE_SUBSCRIPTION_ID` | Subscription containing the staging resources |
| `ACR_NAME` | Azure Container Registry name without `.azurecr.io` |
| `AZURE_RG_STAGING` | Staging resource group name |
| `SWA_STAGING_TOKEN` | Deployment token for `swa-easyazure-staging` |

The Entra application requires federated credentials for both branch subjects:

- `repo:oodog/ezyazure:ref:refs/heads/main`
- `repo:oodog/ezyazure:ref:refs/heads/develop`

Grant the deployment service principal `Contributor` on `rg-easyazure-staging`. Avoid subscription-wide `Owner` access. The workflows request `id-token: write` only so `azure/login` can exchange the GitHub OIDC token; no client secret is required.

After changing credentials or deployment settings, run **Backend CI** and **Frontend CI** manually from GitHub Actions. Both workflows validate the deployed public endpoint before reporting success.

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download)
- [Node.js 20+](https://nodejs.org/)
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) >= 2.60
- [Bicep CLI](https://learn.microsoft.com/azure/azure-resource-manager/bicep/install) (`az bicep install`)
- Docker Desktop (for container builds)
- An Azure subscription with at least Reader access
- An Entra ID app registration (see below)

## 1. Clone and set up

```bash
git clone https://github.com/your-org/easyazure
cd easyazure
```

## 2. Create Entra ID app registration

```bash
# Create app registration
az ad app create --display-name "EasyAzure" --sign-in-audience AzureADMyOrg

# Note the appId (client ID) and tenant ID
CLIENT_ID=$(az ad app list --display-name "EasyAzure" --query "[0].appId" -o tsv)
TENANT_ID=$(az account show --query tenantId -o tsv)

# Add app roles
# (Do this in the Azure Portal: App registrations → EasyAzure → App roles)
# Add roles: Reader, Designer, Reviewer, Operator, Admin

# Expose an API scope
# (Azure Portal: App registrations → EasyAzure → Expose an API → Add scope: access_as_user)
```

## 3. Configure backend

Copy and edit the development config:

```bash
cp src/backend/src/EasyAzure.Api/appsettings.Development.json.example \
   src/backend/src/EasyAzure.Api/appsettings.Development.json
```

Edit `appsettings.Development.json`:
```json
{
  "AzureAd": {
    "TenantId": "<your-tenant-id>",
    "ClientId": "<your-api-client-id>",
    "Audience": "api://<your-api-client-id>"
  }
}
```

## 4. Configure frontend

```bash
cp src/frontend/.env.example src/frontend/.env
```

Edit `src/frontend/.env`:
```
VITE_AZURE_CLIENT_ID=<your-api-client-id>
VITE_AZURE_TENANT_ID=<your-tenant-id>
VITE_API_BASE_URL=http://localhost:5000/api
```

## 5. Run backend

```bash
cd src/backend
dotnet restore EasyAzure.sln
dotnet run --project src/EasyAzure.Api
# API available at http://localhost:5000
# Swagger UI at http://localhost:5000/swagger
```

## 6. Run frontend

```bash
cd src/frontend
npm install
npm run dev
# App available at http://localhost:3000
```

## 7. Sign in

Open http://localhost:3000 and sign in with your Microsoft account. You must be assigned an app role in the Entra app registration to access the application.

## Run tests

```bash
cd src/backend
dotnet test EasyAzure.sln --logger "console;verbosity=normal"
```

## Deploy infrastructure to Azure

```bash
cd infra
az login

# Edit main.bicepparam with your tenant ID, API client ID, approved API image,
# and admin object ID. The API image must exist before deployment.

az deployment sub create \
  --name easyazure-infra \
  --location australiaeast \
  --template-file main.bicep \
  --parameters main.bicepparam
```

Infrastructure deployment is intentionally manual. In GitHub Actions, run
**Infrastructure Deploy** after reviewing its subscription-level what-if output.

## Lint Bicep

```bash
az bicep lint --file infra/main.bicep
```

## Build Docker images locally

```bash
# API
docker build -f src/backend/src/EasyAzure.Api/Dockerfile -t easyazure-api src/backend

# Discovery worker
docker build -f src/workers/EasyAzure.DiscoveryWorker/Dockerfile -t easyazure-discovery-worker src
```
