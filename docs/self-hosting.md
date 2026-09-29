# Customer-owned deployment

EasyAzure supports source-to-cloud deployment into a customer's own Azure subscription with Azure
Developer CLI. No application secret, deployment token, tenant ID, or subscription ID is stored in
the repository.

## What the command deploys

- A single-tenant Microsoft Entra application with `Reader`, `Designer`, `Reviewer`, `Operator`,
  and `Admin` application roles
- Azure Static Web Apps (Free) for the React frontend
- Azure Container Apps for the .NET API, built remotely in customer-owned Azure Container Registry
- A user-assigned managed identity with subscription `Reader` for Azure Resource Graph discovery
- Azure Storage with shared keys and anonymous access disabled; the API receives Blob Data
  Contributor for discovery snapshots
- Key Vault with purge protection, Application Insights, and Log Analytics

The default deployment does not create a VNet or private endpoints. Storage remains reachable over
its public endpoint but requires Microsoft Entra authentication and denies shared-key and anonymous
access. Organizations requiring private-only ingress should add their approved hub/spoke or vWAN
networking before production use.

## Prerequisites

Install Azure CLI, Node.js 20+, npm, and `azd` 1.20 or newer. Docker is not required because the API
uses an ACR remote build.

The deploying user needs:

- Azure `Owner` on the target subscription, or `Contributor` plus `User Access Administrator`
- Microsoft Entra `Cloud Application Administrator`, `Application Administrator`, or equivalent
  permissions to create and own an application/service principal and assign an app role

Restricted tenants can have an administrator create the application first. Set its application ID
before running deployment:

```bash
azd env set EASYAZURE_CLIENT_ID <application-client-id>
```

The application must expose an `access_as_user` delegated scope and the EasyAzure application roles.

## One-command deployment

Windows PowerShell:

```powershell
./scripts/deployment/deploy.ps1
```

macOS/Linux:

```bash
./scripts/deployment/deploy.sh
```

On first use, the command signs in to Azure CLI and `azd`, initializes an environment by asking for
its name, subscription, and region, and configures Entra before running `azd provision --preview`.
Deployment stops if preview or Entra setup fails. After a successful preview, `azd up` provisions resources, builds and pushes the API,
builds the frontend with the generated tenant/client/API values, deploys both services, and verifies
their public endpoints.

Rerun the same command or `azd up` to update an existing environment. Entra setup is idempotent and
reuses the environment's app registration.

## Optional Azure OpenAI

Deterministic features deploy without Azure OpenAI. To enable AI design import and recommendation
augmentation, configure an existing endpoint before deployment:

```bash
azd env set AZURE_OPENAI_ENDPOINT https://<resource-name>.openai.azure.com/
azd env set AZURE_OPENAI_RESOURCE_ID /subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.CognitiveServices/accounts/<resource-name>
azd env set AZURE_OPENAI_DEPLOYMENT_NAME gpt-4o-mini
azd up
```

Design import (reading diagrams, PDFs, and draw.io files into the designer) needs a stronger vision
model than `gpt-4o-mini` to reproduce nested structure reliably. Deploy `gpt-4.1` (fast, deterministic)
or `gpt-5` (best accuracy, slower) on the same account and point import at it:

```bash
az cognitiveservices account deployment create \
  --resource-group <resource-group> --name <resource-name> \
  --deployment-name gpt-4.1 --model-name gpt-4.1 --model-version 2025-04-14 \
  --model-format OpenAI --sku-name GlobalStandard --sku-capacity 50
azd env set AZURE_OPENAI_DESIGN_IMPORT_DEPLOYMENT_NAME gpt-4.1
azd up
```

Deployments whose names start with `gpt-5` or `o<digit>` are called as reasoning models automatically
(API version `2025-04-01-preview`, `max_completion_tokens`, no temperature). Override detection with
`AzureOpenAI__DesignImportReasoningModel=true|false` and the API version with
`AzureOpenAI__DesignImportApiVersion` when a deployment has a custom name. The GitHub infra workflow
uses the `AZURE_OPENAI_DESIGN_IMPORT_DEPLOYMENT_NAME` repository variable when set; otherwise it
picks the strongest deployment already on the discovered account (newest full `gpt-5.x`, then
`gpt-4.1`, newest `gpt-5.x-mini`, then `gpt-4o`) and falls back to `AZURE_OPENAI_DEPLOYMENT_NAME`
when none exists.

For the lowest cost, deploy only a `gpt-5.x-mini` model (for example `gpt-5-mini`). Global Standard
deployments are billed per token with no idle charge, and a typical diagram import costs a few cents.

When the resource is in the selected subscription, the Entra setup attempts to infer its resource
ID from the endpoint. Setting `AZURE_OPENAI_RESOURCE_ID` explicitly is the most reliable option.
Bicep grants the deployed API identity `Cognitive Services OpenAI User` on that account.

If an existing environment already has equivalent role assignments created outside this Bicep
deployment, preserve them by setting their role-assignment resource names before running `azd up`:

```bash
azd env set EASYAZURE_DISCOVERY_READER_ROLE_ASSIGNMENT_NAME <reader-assignment-guid>
azd env set EASYAZURE_STORAGE_BLOB_ROLE_ASSIGNMENT_NAME <blob-assignment-guid>
azd env set EASYAZURE_OPENAI_USER_ROLE_ASSIGNMENT_NAME <openai-assignment-guid>
```

Leave these values empty for a new environment. Bicep then generates stable assignment names.

## Discover additional subscriptions

The deployment grants the API identity `Reader` only on the subscription selected during `azd up`.
To discover another subscription, assign Reader to the emitted identity there:

```bash
az role assignment create \
  --assignee-object-id "$(azd env get-value EASYAZURE_API_IDENTITY_PRINCIPAL_ID)" \
  --assignee-principal-type ServicePrincipal \
  --role Reader \
  --scope /subscriptions/<additional-subscription-id>
```

## Operations

Show URLs and environment values:

```bash
azd show
azd env get-values
```

Preview future infrastructure changes:

```bash
azd provision --preview
```

Remove the Azure resource group and purge soft-deleted resources managed by `azd`:

```bash
azd down --purge
```

The Entra application is intentionally retained to avoid deleting directory configuration without
an explicit administrator action. Delete `EasyAzure-<environment-name>` separately when it is no
longer needed.
