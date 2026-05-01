import apiClient from './apiClient'

export const iacService = {
  generateBicep: async (environmentId: string): Promise<{ bicep: string; warnings: string[] }> => {
    const { data } = await apiClient.post('/iac/generate', { environmentId })
    return data
  },

  runWhatIf: async (environmentId: string, bicep: string): Promise<unknown> => {
    const { data } = await apiClient.post('/iac/whatif', { environmentId, bicep })
    return data
  },

  deploy: async (environmentId: string, bicep: string): Promise<{ deploymentId: string }> => {
    const { data } = await apiClient.post('/iac/deploy', { environmentId, bicep })
    return data
  },

  getDeploymentStatus: async (deploymentId: string): Promise<{ status: string; message?: string }> => {
    const { data } = await apiClient.get(`/iac/deployments/${deploymentId}`)
    return data
  },
}
