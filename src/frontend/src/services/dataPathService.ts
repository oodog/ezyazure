import apiClient from './apiClient'
import type { DataPathRequest, DataPathResult } from '@/types/datapath'

export const dataPathService = {
  analyze: async (request: DataPathRequest): Promise<DataPathResult> => {
    const { data } = await apiClient.post<DataPathResult>('/datapath/analyze', request)
    return data
  },
}
