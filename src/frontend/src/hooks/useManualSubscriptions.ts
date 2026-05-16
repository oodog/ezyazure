import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'easyazure.manualSubscriptions.v1'

export interface ManualSubscription {
  id: string
  displayName: string
}

/**
 * GUID format used by Azure subscription IDs (RFC 4122 v4).
 * Reference: https://learn.microsoft.com/azure/azure-resource-manager/management/overview#terminology
 */
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidSubscriptionId(id: string): boolean {
  return GUID_RE.test(id.trim())
}

function read(): ManualSubscription[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((s): s is ManualSubscription =>
      typeof s === 'object' && s !== null &&
      typeof (s as ManualSubscription).id === 'string' &&
      typeof (s as ManualSubscription).displayName === 'string',
    )
  } catch {
    return []
  }
}

/**
 * Hook that lets users add Azure subscription IDs manually (persisted in
 * localStorage). Used when the Container App's managed identity does not have
 * visibility into the caller's subscriptions via the standard /subscriptions
 * ARM endpoint — the user grants the MI Reader on a target subscription and
 * adds the ID here.
 * Subscription ID format reference:
 * https://learn.microsoft.com/azure/azure-resource-manager/management/overview
 */
export function useManualSubscriptions() {
  const [items, setItems] = useState<ManualSubscription[]>(() => read())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      /* quota / disabled storage — non-fatal */
    }
  }, [items])

  const add = useCallback((id: string, displayName?: string) => {
    const trimmed = id.trim().toLowerCase()
    if (!isValidSubscriptionId(trimmed)) return false
    setItems((prev) => {
      if (prev.some((s) => s.id === trimmed)) return prev
      return [...prev, { id: trimmed, displayName: displayName?.trim() || trimmed }]
    })
    return true
  }, [])

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((s) => s.id !== id))
  }, [])

  return { items, add, remove }
}
