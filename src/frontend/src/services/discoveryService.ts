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
}
