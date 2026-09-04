// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ReactFlowProvider } from 'reactflow'
import DiscoveryResourceNode from './DiscoveryResourceNode'

describe('DiscoveryResourceNode', () => {
  afterEach(cleanup)

  it('shows long resource names without single-line truncation', () => {
    const name = 'application-gateway-with-a-long-production-resource-name'
    render(
      <ReactFlowProvider>
        <DiscoveryResourceNode
          id="app-gateway"
          type="azureResource"
          selected={false}
          zIndex={0}
          isConnectable={false}
          xPos={0}
          yPos={0}
          dragging={false}
          data={{
            id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/applicationGateways/app-gateway',
            type: 'Microsoft.Network/applicationGateways',
            name,
            subscriptionId: 'sub',
            resourceGroup: 'rg-networking-production',
            location: 'australiaeast',
            properties: {},
          }}
        />
      </ReactFlowProvider>,
    )

    const label = screen.getByText(name)
    expect(label.textContent).toBe(name)
    expect(label.className).toContain('break-words')
    expect(label.className).not.toContain('truncate')
  })

  it('shows a critical badge when Azure reports failed provisioning', () => {
    render(
      <ReactFlowProvider>
        <DiscoveryResourceNode
          id="firewall"
          type="azureResource"
          selected={false}
          zIndex={0}
          isConnectable={false}
          xPos={0}
          yPos={0}
          dragging={false}
          data={{
            id: '/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Network/azureFirewalls/firewall',
            type: 'Microsoft.Network/azureFirewalls',
            name: 'firewall',
            subscriptionId: 'sub',
            resourceGroup: 'rg',
            location: 'australiaeast',
            properties: { provisioningState: 'Failed' },
          }}
        />
      </ReactFlowProvider>,
    )

    expect(screen.getByRole('status').textContent).toContain('Failed')
  })
})