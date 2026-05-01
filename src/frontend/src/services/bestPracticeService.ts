import apiClient from './apiClient'
import type { BestPracticeReport } from '@/types/azure'

export const bestPracticeService = {
  runReview: async (subscriptionId?: string): Promise<BestPracticeReport> => {
    const params = subscriptionId ? { subscriptionId } : {}
    const { data } = await apiClient.get<BestPracticeReport>('/bestpractice/review', { params })
    return data
  },
}
