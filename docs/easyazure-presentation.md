# EasyAzure: a day-to-day overview

This is a short presentation for a mixed technical and business audience. It is designed for a
five-to-ten-minute conversation rather than a detailed architecture review.

## 1. What is EasyAzure?

EasyAzure gives us one place to discover, understand, design, validate, and safely change Azure
environments.

**Say:** "Today we often move between the Azure portal, diagrams, spreadsheets, support notes, and
deployment code. EasyAzure brings those jobs together and keeps the discovered environment linked
to the design we want to make."

## 2. The day-to-day problem

- Azure environments grow across subscriptions, teams, and product groups.
- Diagrams become out of date and important relationships are easy to miss.
- Routing and Private Endpoint issues can involve several services and owners.
- A design review and the final deployment code can describe different things.
- Engineers spend time gathering context before a specialist can help.

**Say:** "The goal is not to replace engineers or the Azure portal. The goal is to collect the
right evidence, show it clearly, and help us involve the right people sooner."

## 3. What we can do today

- Sign in with Microsoft Entra ID and discover one or more Azure subscriptions.
- View resources as a topology and filter the view by technology or operational scope.
- Highlight potential asymmetric routes, UDR, peering, Private Endpoint, firewall, NVA, VPN,
  ExpressRoute, and DNS concerns with evidence and confidence levels.
- Ask the Discovery assistant about the current topology and receive grounded guidance with
  Microsoft Learn references.
- Import an existing diagram or document into **Design / Validate**, review the proposed resources,
  and keep only what is useful.
- Draw or update a design, check relationships and IP ranges, and request examples for missing IP
  information.
- Describe a change in the Designer, such as adding a subnet and storage Private Endpoint or routing
  subnet traffic through a firewall, then review the proposed canvas actions before applying them.
- Open a discovered topology in the Designer as an immutable baseline and identify only the new
  resources and supported connections.
- Generate Bicep for supported additions and review Azure what-if before deployment.
- Export topology information for discussion, review, and handover.

**Say:** "A normal conversation can start with 'show me what is there,' move to 'where is the risk,'
and finish with 'show me exactly what this proposed change would add.'"

## 4. A typical workflow

1. Select the subscriptions we are allowed to inspect.
2. Run Discovery and choose the level of topology detail we need.
3. Review routing findings and ask the assistant a focused question.
4. Open the result in Design / Validate.
5. Describe the proposed endpoint, subnet, Private Endpoint, firewall route, or supported
  relationship, review the AI-generated action plan, and apply it to the canvas.
6. Review deterministic validation findings and the additions-only change summary.
7. Generate Bicep and run what-if.
8. Ask the responsible owners to approve before deployment.

**Say:** "The discovered estate remains the baseline. EasyAzure does not quietly recreate or
rewrite existing resources just because we drew a new line on the canvas."

## 5. AI support and product skills

The assistant can activate up to three reviewed product skills for each question:

- Networking
- Compute and virtual machines
- Azure VMware Solution
- Storage
- Databases
- Web and application services
- Containers
- AI and search
- Security and identity
- Monitoring
- General Azure architecture

The AI explanation is grounded in the topology and deterministic findings. Product instructions are
versioned, citations are restricted to Microsoft Learn, and C# code keeps control of access, safety,
secret filtering, and response validation.

**Say:** "This is one governed assistant that brings in the right product knowledge. It is not an
uncontrolled collection of agents, and a skill cannot grant itself access or make an Azure change."

## 6. What we can ask specialists to help with

| Specialist | Useful questions and contributions |
| --- | --- |
| Azure networking | Confirm route selection, return paths, effective routes, NSG behavior, DNS, Private Link, firewalls, and NVA assumptions. |
| Virtual WAN, ExpressRoute, and AVS | Validate hub propagation, route intent, BGP, Global Reach, HCX, NSX-T, and managed-circuit evidence. |
| Azure product teams | Define the service-specific relationships and diagnostics for AKS, App Service, API Management, databases, storage, load balancing, and other services. |
| Security and identity | Review Entra roles, managed identities, RBAC scope, Key Vault, data handling, threat modeling, and least privilege. |
| Platform engineering | Review Bicep modules, Azure Policy alignment, what-if controls, environment promotion, rollback, and deployment ownership. |
| SRE and support | Define incident workflows, useful telemetry, alert context, audit needs, and support handoff information. |
| Responsible AI and product SMEs | Approve skill instructions, evaluation examples, grounded-answer quality, limitations, and release gates. |
| UX and accessibility | Test whether large topologies, findings, and review steps remain clear for day-to-day users. |

**Say:** "We should ask specialists for evidence rules and acceptance tests, not simply ask them to
trust an AI answer. Their knowledge should become reviewed skills, deterministic checks, and test
cases that the product can reuse."

## 7. What we want to do next

- Add effective route and effective NSG collection for supported NICs.
- Integrate Network Watcher next-hop and connection troubleshooting where Azure supports it.
- Add deeper adapters for Virtual WAN, ExpressRoute, AVS, third-party NVAs, Private DNS, gateways,
  load balancers, App Service, API Management, AKS, and other service traffic semantics.
- Build a reviewed evaluation set for each product skill and gate releases on quality and safety.
- Publish immutable skill bundles through governed enterprise configuration with approval and
  rollback.
- Pilot with internal engineering and support teams, measure time saved, false positives, unknowns,
  and specialist handoff quality.
- Strengthen production operations with private networking, policy compliance, monitoring, and
  environment promotion controls.

**Say:** "The next milestone is stronger evidence, not bigger claims. When Azure cannot provide the
required data, the product should say 'unknown' and tell us which specialist or diagnostic is needed."

## 8. The important boundary

EasyAzure can organize evidence, identify risks, explain likely causes, validate supported design
changes, and prepare reviewable infrastructure code. It cannot guarantee every end-to-end traffic
path from inventory alone, see inside an on-premises or third-party appliance without integration,
or replace formal security, architecture, and change approval.

**Close with:** "EasyAzure helps us move from a question to evidence, from evidence to a reviewed
design, and from a reviewed design to a controlled change. The opportunity for specialists is to
teach the platform what good evidence and safe action look like for their product area."
