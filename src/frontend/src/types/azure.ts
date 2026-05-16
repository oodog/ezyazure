export interface AzureResource {
  id: string
  type: string
  name: string
  subscriptionId: string
  resourceGroup: string
  location: string
  properties: Record<string, unknown>
  tags?: Record<string, string>
  discoveredAt?: string
}

export interface ResourceEdge {
  from: string
  to: string
  relationship:
    | 'contains'
    | 'associatedWith'
    | 'connectedTo'
    | 'routesTo'
    | 'allows'
    | 'denies'
    | 'peeredWith'
    | 'dependsOn'
    | 'deployedBy'
    | 'usesIdentity'
    | 'usesPrivateDnsZone'
}

export interface TopologyGraph {
  nodes: FlowNode[]
  edges: FlowEdge[]
}

export interface FlowNode {
  id: string
  type: string
  position: { x: number; y: number }
  data: AzureResource
}

export interface FlowEdge {
  id: string
  source: string
  target: string
  label?: string
  /**
   * Visual category sent by the backend so the canvas can colour edges:
   * `default-route` is always rendered red because 0.0.0.0/0 is the
   * highest-impact routing decision in any Azure environment.
   */
  category?:
    | 'contains'
    | 'associatedWith'
    | 'peering'
    | 'route'
    | 'default-route'
    | string
  metadata?: Record<string, string>
}

export interface DashboardStats {
  subscriptionCount: number
  vnetCount: number
  resourceCount: number
  complianceScore: number | null
  driftWarnings: number
  recentDeployments: number
  recentDeploymentList?: { id: string; name: string; status: string }[]
  driftList?: { resourceId: string; message: string }[]
}

export interface BestPracticeRule {
  ruleId: string
  title: string
  severity: 'High' | 'Medium' | 'Low' | 'Info'
  check: string
  recommendation: string
  framework: string[]
  docReference?: string
  remediation?: string
}

export interface BestPracticeReport {
  subscriptionId?: string
  runAt: string
  pillarScores: Record<string, number>
  findings: BestPracticeRule[]
  overallScore: number
}
