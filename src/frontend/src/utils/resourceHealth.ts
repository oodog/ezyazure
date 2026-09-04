import type { AzureResource } from '@/types/azure'

export type ResourceHealthSeverity = 'healthy' | 'warning' | 'critical' | 'unknown'

export interface ResourceProvisioningHealth {
  state: string
  severity: ResourceHealthSeverity
}

const failedStates = new Set(['failed', 'canceled'])
const transitionalStates = new Set(['accepted', 'creating', 'deleting', 'moving', 'registering', 'updating'])

export function getResourceProvisioningHealth(resource: AzureResource): ResourceProvisioningHealth | null {
  const entry = Object.entries(resource.properties).find(([key]) => key.toLowerCase() === 'provisioningstate')
  const state = typeof entry?.[1] === 'string' ? entry[1].trim() : ''
  if (!state) return null

  const normalized = state.toLowerCase()
  if (failedStates.has(normalized)) return { state, severity: 'critical' }
  if (transitionalStates.has(normalized)) return { state, severity: 'warning' }
  if (normalized === 'succeeded') return { state, severity: 'healthy' }
  return { state, severity: 'unknown' }
}

export function isResourceProvisioningFailed(resource: AzureResource): boolean {
  return getResourceProvisioningHealth(resource)?.severity === 'critical'
}