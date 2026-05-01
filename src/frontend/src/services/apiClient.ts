import axios from 'axios'
import { msalInstance } from '@/auth/authConfig'

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  headers: { 'Content-Type': 'application/json' },
})

apiClient.interceptors.request.use(async (config) => {
  try {
    const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0]
    if (account) {
      const response = await msalInstance.acquireTokenSilent({
        scopes: ['https://management.azure.com/user_impersonation'],
        account,
      })
      config.headers.Authorization = `Bearer ${response.accessToken}`
    }
  } catch {
    // Token acquisition failed silently — request proceeds without auth header
  }
  return config
})

export default apiClient
