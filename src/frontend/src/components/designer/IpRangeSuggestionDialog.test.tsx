// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import IpRangeSuggestionDialog from './IpRangeSuggestionDialog'

describe('IpRangeSuggestionDialog', () => {
  afterEach(cleanup)

  it('requires confirmation before applying example ranges', () => {
    const apply = vi.fn()
    const close = vi.fn()
    render(
      <IpRangeSuggestionDialog
        noRangesConfigured
        suggestions={[{
          nodeId: 'vnet',
          nodeLabel: 'Hub VNet',
          blockType: 'VNet',
          propertyKey: 'addressSpace',
          value: '10.0.0.0/16',
          rationale: 'RFC 1918 example.',
        }]}
        onApply={apply}
        onClose={close}
      />,
    )

    expect(screen.getByRole('heading', { name: 'No IP ranges in this design' })).toBeTruthy()
    expect(screen.getByText('10.0.0.0/16')).toBeTruthy()
    expect(apply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add example IPs' }))
    expect(apply).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()
  })
})