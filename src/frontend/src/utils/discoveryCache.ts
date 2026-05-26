import type { Edge, Node } from 'reactflow'
import type { AzureResource } from '@/types/azure'

/**
 * Session-scoped cache of the last discovery result. Lets the user navigate
 * away from the Discovery view and back without losing the graph or having
 * to re-run discovery. Cleared when the browser tab/session closes.
 */

const KEY = 'easyazure.discovery.lastResult.v1'

export interface CachedDiscovery {
  subscriptionIds: string[]
  nodes: Node<AzureResource>[]
  edges: Edge[]
  capturedAt: number
}

export function saveDiscoveryCache(value: CachedDiscovery) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(value))
  } catch {
    // sessionStorage may be unavailable or quota-exceeded — fail silently.
  }
}

export function loadDiscoveryCache(): CachedDiscovery | null {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (!raw) return null
    return JSON.parse(raw) as CachedDiscovery
  } catch {
    return null
  }
}

export function clearDiscoveryCache() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}
