# Product skill governance

## Purpose

EasyAzure uses one Discovery assistant with deterministic activation of up to three Azure
product-group skills. Product skills are configuration, not independent agents and not an
authorization mechanism. C# remains responsible for grounding, secret filtering, safety policy,
response validation, and all access to Azure.

## Source of truth

The source-controlled bundle is in
`src/backend/src/EasyAzure.Designer/Skills/discovery-assistant`.

- `skill-bundle.json` is the ordered, versioned manifest.
- `*.skill.json` contains one product group's instructions and routing metadata.
- `product-skill.schema.json` and `skill-bundle.schema.json` provide editor validation.
- `ProductSkillRegistry` performs authoritative runtime validation and rejects unsafe bundles.

Each skill owns its stable ID, semantic version, display name, concise specialist instructions,
Microsoft Learn reference, intent keywords, exact resource types, and resource-type prefixes.
Product documentation belongs in Microsoft Learn and should be retrieved as grounded knowledge;
large copies of documentation do not belong in skill instructions.

## Change procedure

1. Change only the affected `*.skill.json` file and increment its semantic version.
2. Increment `bundleVersion` in `skill-bundle.json` for every released bundle change.
3. Add or update routing and safety tests for the changed behavior.
4. Require pull-request approval from the relevant product SME and the EasyAzure service owner.
5. Run the backend CI suite before promotion.
6. Deploy the immutable application artifact through the normal staged rollout.

Do not provide a production UI that writes skill instructions directly. Emergency rollback should
redeploy the previously approved image or point `DiscoveryAssistant__SkillsPath` at a previously
approved, read-only bundle mounted in the container.

## Runtime configuration

The default bundle is copied into API build, test, publish, and container artifacts. The default
configuration is:

```json
{
  "DiscoveryAssistant": {
    "SkillsPath": "Skills/discovery-assistant"
  }
}
```

Relative paths resolve from the application directory. An absolute path can be supplied through
`DiscoveryAssistant__SkillsPath` for a read-only mounted bundle. The application loads the bundle
once and logs its version, source, and skill count. Missing, malformed, duplicated, unsafe, or
incomplete configuration stops startup rather than falling back to unreviewed instructions.

Never store credentials in a skill bundle. Azure OpenAI authentication continues to use managed
identity, with Key Vault reserved for secrets that cannot use identity.

## Validation requirements

The registry enforces:

- Semantic versions for the bundle and every skill
- Unique product skill IDs and manifest file names
- A required `other` fallback skill
- HTTPS Microsoft Learn references only
- Unique exact Azure resource-type ownership
- Non-empty, duplicate-free routing values
- File-name restrictions that prevent path traversal
- Strict JSON properties so misspelled configuration is rejected

The CI tests also lock the backend catalog to the frontend technology taxonomy and exercise product
routing, citation filtering, unsafe-property removal, fallback behavior, and invalid bundle cases.

## Future remote distribution

The `IProductSkillProvider` boundary allows a governed remote provider without changing assistant
logic. A remote rollout should publish immutable bundle versions to customer-owned storage, keep
only the approved active-version pointer in Azure App Configuration, access both with managed
identity, cache the active bundle, and retain a last-known-good version. Production activation must
remain approval-gated and auditable; it must not accept arbitrary prompt text from users or an
administrative form.