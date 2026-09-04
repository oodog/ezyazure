import { describe, expect, it } from 'vitest'
import type { AzureResource } from '@/types/azure'
import { getResourceProvisioningHealth, isResourceProvisioningFailed } from './resourceHealth'

function resource(properties: Record<string, unknown>): AzureResource {
  return {
    id: 'resource-id',
    type: 'Microsoft.Network/azureFirewalls',
    name: 'firewall',
    subscriptionId: 'subscription',
    resourceGroup: 'networking',
    location: 'australiaeast',
    properties,
  }
}

describe('resource provisioning health', () => {
  it('classifies failed state case-insensitively as critical', () => {
    const failed = resource({ ProvisioningState: 'Failed' })

    expect(getResourceProvisioningHealth(failed)).toEqual({ state: 'Failed', severity: 'critical' })
    expect(isResourceProvisioningFailed(failed)).toBe(true)
  })

  it('distinguishes transitional, successful, and absent states', () => {
    expect(getResourceProvisioningHealth(resource({ provisioningState: 'Updating' }))?.severity).toBe('warning')
    expect(getResourceProvisioningHealth(resource({ provisioningState: 'Succeeded' }))?.severity).toBe('healthy')
    expect(getResourceProvisioningHealth(resource({}))).toBeNull()
  })
})