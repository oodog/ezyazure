import axios, { AxiosError } from 'axios'
import { InteractionRequiredAuthError } from '@azure/msal-browser'
import { easyAzureApiScopes, msalInstance } from '@/auth/authConfig'

// Do NOT set a default Content-Type. Axios attaches `application/json` automatically
// when a request actually has a JSON body. Setting it on GET requests forces a
// CORS preflight with a non-safelisted Content-Type header that some browsers /
// proxies (notably iOS Safari and certain corporate edges) reject, surfacing as
// an opaque "Network Error" with no HTTP status. See:
// https://fetch.spec.whatwg.org/#cors-safelisted-request-header
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
})

/**
 * Acquires an access token for the EasyAzure API. Silent-only: if interaction is
 * required, the user should re-sign in via the sign-out → sign-in flow. Doing a
 * redirect from inside an axios interceptor causes in-flight requests to surface
 * as confusing "Network Error" because the page navigates away mid-request.
 * Reference: https://learn.microsoft.com/entra/identity-platform/scenario-spa-acquire-token?tabs=react
 */
async function acquireApiToken(): Promise<string | null> {
  const account = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0]
  if (!account) return null
  try {
    const result = await msalInstance.acquireTokenSilent({
      scopes: easyAzureApiScopes.scopes,
      account,
    })
    return result.accessToken
  } catch (err) {
    if (err instanceof InteractionRequiredAuthError) {
      console.warn('[apiClient] API scope consent required — sign out and sign in again.')
    } else {
      console.error('[apiClient] acquireTokenSilent failed:', err)
    }
    return null
  }
}

apiClient.interceptors.request.use(async (config) => {
  const token = await acquireApiToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (resp) => resp,
  (error: AxiosError) => {
    // Surface diagnostic info so the dashboard can render a useful banner instead
    // of the bare "Network Error" string that axios emits for any CORS/preflight
    // / DNS / connection failure.
    if (error.code === 'ERR_NETWORK') {
      console.error('[apiClient] Network/CORS failure', {
        url: `${error.config?.baseURL ?? ''}${error.config?.url ?? ''}`,
        method: error.config?.method,
        message: error.message,
      })
    }
    return Promise.reject(error)
  },
)

export default apiClient
