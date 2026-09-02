// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoveryService } from '@/services/discoveryService'
import DiscoveryAssistantPanel from './DiscoveryAssistantPanel'

describe('DiscoveryAssistantPanel', () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('sends current technology and resource focus and renders grounded metadata', async () => {
    const ask = vi.spyOn(discoveryService, 'askAssistant').mockResolvedValue({
      answer: 'The storage Private Endpoint depends on private DNS resolution.',
      skills: ['Storage', 'Networking'],
      skillBundleVersion: '1.0.0',
      skillVersions: { storage: '1.0.0', networking: '1.0.0' },
      citations: [{
        title: 'Private Endpoint DNS',
        url: 'https://learn.microsoft.com/azure/private-link/private-endpoint-dns',
      }],
      suggestedChecks: ['Resolve the storage FQDN from the source subnet.'],
      confidence: 'medium',
      limitations: ['DNS query output was not collected.'],
      aiUsed: true,
      aiModel: 'gpt-4o-mini',
    })
    render(
      <DiscoveryAssistantPanel
        subscriptionIds={['sub-1']}
        focusTechnologies={['storage', 'networking']}
        focusResourceId="storage-1"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'AI support' }))
    fireEvent.change(screen.getByLabelText('Describe the Azure issue'), {
      target: { value: 'Why can the app not reach storage?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(ask).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionIds: ['sub-1'],
        focusTechnologies: ['storage', 'networking'],
        focusResourceId: 'storage-1',
        message: 'Why can the app not reach storage?',
      }),
      expect.objectContaining({ signal: expect.anything() }),
    ))
    expect(await screen.findByText(/depends on private DNS resolution/)).toBeTruthy()
    expect(screen.getByText('Storage')).toBeTruthy()
    expect(screen.getByText('medium confidence')).toBeTruthy()
    expect(screen.getByText('skills v1.0.0')).toBeTruthy()
    const citation = screen.getByRole('link', { name: 'Private Endpoint DNS' }) as HTMLAnchorElement
    expect(citation.href).toBe('https://learn.microsoft.com/azure/private-link/private-endpoint-dns')
  })

  it('aborts and clears the conversation when the Discovery context changes', async () => {
    let signal: { readonly aborted: boolean } | undefined
    vi.spyOn(discoveryService, 'askAssistant').mockImplementation((_request, config) => {
      signal = config?.signal ?? undefined
      return new Promise(() => {})
    })
    const { rerender } = render(
      <DiscoveryAssistantPanel subscriptionIds={['sub-1']} focusTechnologies={['networking']} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'AI support' }))
    fireEvent.change(screen.getByLabelText('Describe the Azure issue'), {
      target: { value: 'Why is this route failing?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText('Why is this route failing?')).toBeTruthy()

    rerender(<DiscoveryAssistantPanel subscriptionIds={['sub-2']} focusTechnologies={['storage']} />)

    await waitFor(() => expect(signal?.aborted).toBe(true))
    expect(screen.queryByText('Why is this route failing?')).toBeNull()
    expect(screen.getByText('Ask about the current topology or a selected resource.')).toBeTruthy()
  })
})