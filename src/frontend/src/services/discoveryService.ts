import apiClient from './apiClient'
import type { DashboardStats, TopologyGraph } from '@/types/azure'

export interface ReplicationPreviewRequest {
  sourceSubscriptionIds: string[]
  targetSubscriptionId: string
  targetResourceGroup: string
  targetLocation: string
}

export interface RenameCandidate {
  sourceResourceId: string
  resourceType: string
  originalName: string
  suggestedName: string
  reason?: string
  docReference?: string
}

export interface ReplicatedResourceSummary {
  resourceType: string
  name: string
}

export interface ReplicationPreview {
  resourceCount: number
  renameRequired: RenameCandidate[]
  keepName: ReplicatedResourceSummary[]
  skipped: string[]
}

export interface ReplicationPlanRequest extends ReplicationPreviewRequest {
  /** Map of sourceResourceId -> new name confirmed by the user. */
  renames: Record<string, string>
  tags?: Record<string, string>
}

export interface ReplicationPlan {
  bicep: string
  warnings: string[]
  resources: ReplicatedResourceSummary[]
  deploymentStackName: string
}

export interface RoutingFinding {
  severity: string
  ruleId: string
  title: string
  message: string
  affectedNodeIds: string[]
  recommendation?: string
  aiRecommendation?: string
  reference?: string
  source: string
}

export interface RoutingAnalysisReport {
  findings: RoutingFinding[]
  aiUsed: boolean
  aiModel?: string
  subnetsAnalyzed: number
  runAt: string
}

export interface PathHop {
  resourceId: string
  resourceName: string
  resourceType: string
  detail?: string
  matchedRule?: string
}

export type PathStatus = 'Allowed' | 'Blocked' | 'Unknown'

export interface DataPathResult {
  status: PathStatus
  blockingRule?: string
  hops: PathHop[]
  riskNotes: string[]
  bestPracticeNotes: string[]
  pathNodeIds: string[]
  destinationSummary?: string
}

export interface DiscoverySnapshotSummary {
  id: string
  capturedAt: string
  subscriptionIds: string[]
  label?: string
  nodeCount: number
  edgeCount: number
}

export interface DiffResource {
  id: string
  name: string
  type: string
}

export interface DiffField {
  path: string
  oldValue?: string
  newValue?: string
}

export interface DiffChangedResource {
  id: string
  name: string
  type: string
  changes: DiffField[]
}

export interface DiscoveryDiff {
  fromSnapshotId: string
  toSnapshotId: string
  fromCapturedAt: string
  toCapturedAt: string
  added: DiffResource[]
  removed: DiffResource[]
  changed: DiffChangedResource[]
}

export const discoveryService = {
  getDashboardStats: async (): Promise<DashboardStats> => {
    const { data } = await apiClient.get<DashboardStats>('/discovery/dashboard')
    return data
  },

  listSubscriptions: async (): Promise<{ id: string; displayName: string }[]> => {
    const { data } = await apiClient.get('/discovery/subscriptions')
    return data
  },

  getTopology: async (subscriptionId: string): Promise<TopologyGraph> => {
    const { data } = await apiClient.get<TopologyGraph>(`/discovery/topology/${subscriptionId}`)
    return data
  },

  /**
   * Builds a topology graph spanning multiple subscriptions. Used by the multi-select
   * subscription picker in the Discovery view.
   */
  getTopologyMulti: async (subscriptionIds: string[]): Promise<TopologyGraph> => {
    const { data } = await apiClient.post<TopologyGraph>('/discovery/topology', {
      subscriptionIds,
    })
    return data
  },

  triggerDiscovery: async (subscriptionId: string): Promise<{ jobId: string }> => {
    const { data } = await apiClient.post('/discovery/run', { subscriptionId })
    return data
  },

  getDiscoveryJobStatus: async (jobId: string): Promise<{ status: string; progress: number }> => {
    const { data } = await apiClient.get(`/discovery/jobs/${jobId}`)
    return data
  },

  /**
   * Previews replicating the discovered resources from one or more source subscriptions
   * into a new target subscription. The response includes a list of resources whose
   * names must be globally unique (and therefore need user confirmation).
   * Reference: https://learn.microsoft.com/azure/azure-resource-manager/management/resource-name-rules
   */
  replicatePreview: async (req: ReplicationPreviewRequest): Promise<ReplicationPreview> => {
    const { data } = await apiClient.post<ReplicationPreview>('/replication/preview', req)
    return data
  },

  /**
   * Generates a Bicep deployment plan that creates the replicated environment in the
   * target subscription with user-confirmed renames.
   */
  replicatePlan: async (req: ReplicationPlanRequest): Promise<ReplicationPlan> => {
    const { data } = await apiClient.post<ReplicationPlan>('/replication/plan', req)
    return data
  },

  /**
   * Analyses the discovered topology for routing issues — primarily asymmetric routing
   * across VNet peerings and forced-tunnel mismatches. When useAi is true and Azure
   * OpenAI is configured, findings are enriched with AI-recommended remediation steps.
   */
  analyzeRouting: async (
    subscriptionIds: string[],
    useAi: boolean,
  ): Promise<RoutingAnalysisReport> => {
    const { data } = await apiClient.post<RoutingAnalysisReport>('/discovery/analyze-routing', {
      subscriptionIds,
      useAi,
    })
    return data
  },

  /**
   * Traces a data path through the discovered topology. The destination may be a full
   * ARM resource ID or a raw IPv4 address. Returns the ordered hops plus the node IDs
   * that make up the path so the Discovery map can highlight the exact route.
   */
  tracePath: async (req: {
    subscriptionIds: string[]
    sourceResourceId: string
    destination: string
    protocol: string
    destinationPort: number
  }): Promise<DataPathResult> => {
    const { data } = await apiClient.post<DataPathResult>('/discovery/trace-path', req)
    return data
  },

  /**
   * Discovery versioning — captures a point-in-time snapshot of the discovered topology so
   * customers can compare how their environment changed between discoveries.
   */
  saveSnapshot: async (req: {
    subscriptionIds: string[]
    label?: string
  }): Promise<DiscoverySnapshotSummary> => {
    const { data } = await apiClient.post<DiscoverySnapshotSummary>('/discovery/snapshots', req)
    return data
  },

  listSnapshots: async (): Promise<DiscoverySnapshotSummary[]> => {
    const { data } = await apiClient.get<DiscoverySnapshotSummary[]>('/discovery/snapshots')
    return data
  },

  deleteSnapshot: async (id: string): Promise<void> => {
    await apiClient.delete(`/discovery/snapshots/${id}`)
  },

  diffSnapshots: async (from: string, to: string): Promise<DiscoveryDiff> => {
    const { data } = await apiClient.get<DiscoveryDiff>('/discovery/snapshots/diff', {
      params: { from, to },
    })
    return data
  },
}
