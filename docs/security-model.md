# Security model

## Authentication

All users must authenticate with **Microsoft Entra ID**. The application uses OpenID Connect with PKCE. No local accounts are supported.

## App roles

Roles are defined in the Entra app registration manifest and enforced in the .NET API using `[Authorize(Policy = "...")]`.

| Role | Description |
|------|-------------|
| `Reader` | View discovery results, topology, data-path analysis, best-practice reports |
| `Designer` | All Reader permissions + create and edit design environments |
| `Reviewer` | All Designer permissions + view what-if results |
| `Operator` | All Reviewer permissions + trigger deployments |
| `Admin` | Full access including user and role management |

## Azure access — principle of least privilege

The application uses two separate managed identities:

### Discovery identity (Reader)

Used by the API and discovery workers to read existing Azure state.

```
Role: Reader
Role: Network Contributor (read-only network operations)
Scope: Each managed subscription (not subscription of the tool itself)
```

### Deployment identity (scoped Contributor)

Used only when deploying resources. Created per-deployment and scoped to the target resource group.

```
Role: Contributor
Scope: Target resource group only
Role: User Access Administrator (only if deploying RBAC assignments)
Scope: Target resource group only
```

**Owner is never assigned.** Broad subscription-level Contributor is avoided.

## Secret management

- All secrets, certificates, and connection strings are stored in **Azure Key Vault**
- The API retrieves secrets at startup using `DefaultAzureCredential` via the managed identity
- No secrets in `appsettings.json`, code, or environment variables
- Key Vault uses private endpoint — not accessible over the public internet
- Key Vault has soft-delete and purge protection enabled

## Network security

- Frontend: Azure Static Web Apps (managed TLS, CDN)
- API: Azure Container Apps (managed TLS, no public IP on containers)
- All backend data stores (Cosmos DB, PostgreSQL, Storage, Key Vault) use **private endpoints**
- Public network access disabled on all data plane resources
- NSG on Container Apps environment allows only HTTPS inbound

## Transport security

- All HTTP is redirected to HTTPS
- Minimum TLS version: TLS 1.2
- HSTS enforced

## Content security

- CORS restricted to the known frontend origin only
- `allowSharedKeyAccess: false` on Storage (requires Entra auth or SAS with short expiry)
- `allowBlobPublicAccess: false` on all containers
- Key Vault RBAC authorization (not legacy access policies)

## Audit trail

- All API calls logged to Application Insights with user identity (from JWT claims)
- All deployment actions stored in the deployment record table
- Key Vault diagnostic logs forwarded to Log Analytics
- Azure Monitor alerts on privilege escalation and unusual access patterns

## Security review checklist

Before deploying to production:

- [ ] App registration has no client secrets (use federated credentials or managed identity)
- [ ] No Owner role assigned anywhere
- [ ] Private endpoints configured for all data stores
- [ ] Key Vault purge protection enabled
- [ ] Diagnostic settings enabled on all resources
- [ ] Defender for Cloud enabled on all managed subscriptions
- [ ] Conditional Access policy applied to the application
- [ ] App roles assigned via groups, not individual users
