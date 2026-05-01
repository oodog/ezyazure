import apiClient from './apiClient'
import type { DashboardStats, TopologyGraph } from '@/types/azure'

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

  triggerDiscovery: async (subscriptionId: string): Promise<{ jobId: string }> => {
    const { data } = await apiClient.post('/discovery/run', { subscriptionId })
    return data
  },

  getDiscoveryJobStatus: async (jobId: string): Promise<{ status: string; progress: number }> => {
    const { data } = await apiClient.get(`/discovery/jobs/${jobId}`)
    return data
  },
}
