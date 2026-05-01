# Getting started — local development

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
# (Azure Portal: App registrations → EasyAzure → Expose an API → Add scope: user_impersonation)
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

# Edit main.bicepparam with your tenant ID and admin object ID

az deployment sub create \
  --name easyazure-infra \
  --location australiaeast \
  --template-file main.bicep \
  --parameters main.bicepparam
```

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
