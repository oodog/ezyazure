# EasyAzure hackathon notes

Use these notes for a short project introduction, live demo, judging conversation, or team handover.
They describe the working project without claiming that inventory alone can prove every network path.

## 30-second pitch

EasyAzure helps teams understand and safely change Azure environments. It discovers resources across
subscriptions, turns them into a live topology, highlights possible routing and Private Endpoint
problems, and lets an engineer ask a grounded AI assistant for help. The discovered environment can
then be opened in **Design / Validate** as a protected baseline, where proposed additions are checked
and converted into reviewable Bicep without recreating the existing estate.

## The problem

- Azure context is spread across the portal, diagrams, spreadsheets, deployment code, and support
  conversations.
- Architecture diagrams age quickly and do not contain effective routing evidence.
- Asymmetric paths can cross route tables, peerings, firewalls, NVAs, gateways, and service owners.
- Specialists often spend the first part of an incident gathering basic environment information.
- A proposed diagram and the code eventually deployed can drift apart.

**Simple version:** teams need a faster path from "what is deployed?" to "what is wrong?" and then
to "what exactly will this change add?"

## What the project does today

- Uses Microsoft Entra ID for sign-in and role-based access.
- Discovers supported resources from one or more Azure subscriptions.
- Builds a filterable topology with resource relationships and network context.
- Flags possible asymmetric routes and other UDR, peering, firewall, NVA, gateway, Private Endpoint,
  and DNS concerns with evidence and confidence levels.
- Provides a Discovery chat grounded in the current topology and deterministic findings.
- Selects reviewed, versioned product skills for networking, compute, storage, databases, web,
  containers, AI, security, monitoring, AVS, and general architecture questions.
- Opens Discovery results in **Design / Validate** as an immutable baseline.
- Separates existing resources from proposed additions and validates supported relationships and IP
  ranges.
- Generates additions-only Bicep for supported changes and supports Azure what-if review.
- Runs in a customer-owned Azure environment using managed identity and least-privilege RBAC.

## Suggested live demo

Keep the main path to five or six minutes.

1. Sign in and select an Azure subscription.
2. Run Discovery and show the generated topology.
3. Filter the view and open an asymmetric-routing or Private Endpoint finding.
4. Show the evidence and confidence level, including what is known and what still needs verification.
5. Ask the assistant: "Why might this route be asymmetric, and what should I check next?"
6. Point out the selected product skills and Microsoft Learn references.
7. Open the discovered topology in **Design / Validate**.
8. Add a supported endpoint, subnet, or relationship without changing the discovered baseline.
9. Review validation findings and the additions-only change summary.
10. Generate Bicep and explain that Azure what-if remains an approval gate before deployment.

**Fallback:** if live Azure discovery is slow, use a previously discovered topology and continue from
step 3. Keep screenshots of the topology, finding details, assistant response, delta summary, and
generated Bicep available for the same reason.

## What makes it different

### Evidence before explanation

The routing engine produces deterministic findings first. AI explains the evidence and suggests the
next investigation step; it does not silently invent topology facts.

### A protected bridge from discovery to deployment

The discovered environment becomes an immutable design baseline. Existing resources are classified
separately from proposed additions, reducing the risk that generated code will recreate or overwrite
the estate simply because it appears on the canvas.

### Governed product knowledge

The assistant activates no more than three versioned product skills for a question. Skills provide
reviewed domain instructions, while application code retains control of authorization, secret
filtering, validation, citations, and Azure changes.

### Honest uncertainty

Findings carry evidence and confidence. When inventory is not enough, EasyAzure should say that the
result is unknown and identify the effective route, packet test, appliance state, or specialist
review needed to prove it.

## Architecture in one minute

- **Frontend:** React, TypeScript, React Flow, Tailwind CSS, and MSAL on Azure Static Web Apps.
- **API:** .NET 8 on Azure Container Apps.
- **Discovery:** Azure Resource Graph and Azure APIs through managed identity.
- **Analysis:** deterministic topology, route, relationship, and validation services.
- **AI support:** Azure OpenAI with a strict response contract and versioned product-skill registry.
- **Infrastructure:** Bicep, Azure Container Registry, Storage, Key Vault, Application Insights, and
  Log Analytics.
- **Delivery:** GitHub Actions and Azure Developer CLI, with infrastructure what-if and endpoint
  validation.

## Value and potential impact

- Reduce time spent collecting environment context during design reviews and incidents.
- Give specialists a reusable evidence package before a handoff.
- Detect likely routing risks earlier, while clearly separating findings from proof.
- Keep proposed architecture, validation, and generated infrastructure code connected.
- Turn reviewed specialist knowledge into reusable product skills and deterministic tests.
- Help smaller teams apply consistent Azure review practices without removing human approval.

## What we want to build next

- Collect effective routes and effective NSGs for supported network interfaces.
- Add Network Watcher next-hop and connection troubleshooting as on-demand evidence.
- Deepen traffic semantics for Virtual WAN, ExpressRoute, AVS, third-party NVAs, Private DNS,
  gateways, load balancers, API Management, App Service, and AKS.
- Create evaluation datasets and release gates for every product skill.
- Add governed skill publishing, approvals, version pinning, and rollback.
- Measure time saved, false positives, unresolved findings, and specialist handoff quality in a pilot.

## Where specialists can help

| Specialist | Best contribution |
| --- | --- |
| Azure networking | Supply route-selection evidence, asymmetric-path examples, and acceptance tests. |
| Virtual WAN, ExpressRoute, and AVS | Validate BGP, propagation, managed-circuit, HCX, and NSX-T assumptions. |
| Azure product teams | Define service relationships, diagnostic evidence, and supported change patterns. |
| Security and identity | Review RBAC, managed identity, threat boundaries, data handling, and least privilege. |
| Platform engineering | Review Bicep, policy alignment, what-if gates, promotion, rollback, and ownership. |
| SRE and support | Define incident evidence, telemetry, audit trails, and escalation packages. |
| Responsible AI and product SMEs | Review skill instructions, grounded answers, evaluations, and release gates. |
| UX and accessibility | Test navigation, large topologies, finding clarity, and approval workflows. |

## Questions judges may ask

### Does AI decide whether a route is valid?

No. Deterministic services create the finding. AI explains the available evidence, cites approved
Microsoft Learn material, and proposes the next check.

### Can it guarantee that traffic will work?

Not from inventory alone. Effective routes, NSGs, runtime diagnostics, DNS responses, and external
appliance state may be required. The product reports these gaps rather than presenting a guess as
proof.

### Can it deploy over an existing environment?

The current workflow protects discovered resources as a baseline and generates supported additions.
Azure what-if and owner approval remain required before deployment.

### How is customer data protected?

The application is customer-owned, uses Entra ID, managed identity, RBAC, and Key Vault, and filters
secrets before AI use. Product skills cannot grant access or execute Azure changes.

### How does this scale beyond networking?

The core topology and validation contracts remain in code. Versioned product skills and service
adapters add reviewed knowledge and evidence rules for each technology area.

## Honest boundary

EasyAzure is a decision-support and controlled-change tool. It does not replace the Azure portal,
Network Watcher, appliance telemetry, formal architecture and security review, or a change approver.
Its job is to gather the right context, expose uncertainty, involve the right expert, and make the
proposed change easier to inspect.

## Useful links

- Live application: <https://salmon-sky-0fe4ee500.7.azurestaticapps.net/>
- Source repository: <https://github.com/oodog/ezyazure>
- Day-to-day presentation: [easyazure-presentation.md](easyazure-presentation.md)
- Discovery coverage: [discovery-routing-coverage.md](discovery-routing-coverage.md)
- Product-skill governance: [product-skills.md](product-skills.md)
- Customer-owned deployment: [self-hosting.md](self-hosting.md)

## Before presenting

- Confirm the demo subscription contains a useful but non-sensitive topology.
- Run the demo once with the same account, browser, and network that will be used on the day.
- Confirm frontend and API health, authentication, Discovery, chat, handoff, and Bicep generation.
- Record the exact scenario, expected finding, and expected additions-only delta.
- Prepare the fallback screenshots and avoid showing tenant, subscription, user, or resource details
  that should not be shared.
- Decide who will introduce the problem, drive the demo, explain the architecture, and answer Azure
  networking or security questions.