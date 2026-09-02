import type { DesignIpSuggestion } from '@/utils/designIpSuggestions'

interface IpRangeSuggestionDialogProps {
  suggestions: readonly DesignIpSuggestion[]
  noRangesConfigured: boolean
  onApply: () => void
  onClose: () => void
}

export default function IpRangeSuggestionDialog({
  suggestions,
  noRangesConfigured,
  onApply,
  onClose,
}: IpRangeSuggestionDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" aria-labelledby="ip-suggestion-title">
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-gray-200 bg-white shadow-xl">
        <div className="border-b border-gray-200 px-5 py-4">
          <h2 id="ip-suggestion-title" className="text-base font-bold text-gray-900">
            {noRangesConfigured ? 'No IP ranges in this design' : 'Some IP ranges are missing'}
          </h2>
          <p className="mt-1 text-xs leading-5 text-gray-600">
            Apply non-overlapping RFC 1918 examples based on Azure network planning guidance? These are examples, not approved production allocations, and should be reviewed with your network team.
          </p>
        </div>
        <ul className="max-h-80 divide-y divide-gray-100 overflow-y-auto px-5">
          {suggestions.map((suggestion) => (
            <li key={`${suggestion.nodeId}-${suggestion.propertyKey}`} className="py-3">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-gray-800">{suggestion.nodeLabel}</p>
                  <p className="text-[11px] text-gray-500">{suggestion.blockType}</p>
                </div>
                <code className="shrink-0 rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">
                  {suggestion.value}
                </code>
              </div>
              <p className="mt-1 text-[11px] leading-4 text-gray-500">{suggestion.rationale}</p>
            </li>
          ))}
        </ul>
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 bg-gray-50 px-5 py-3">
          <button type="button" onClick={onClose} className="h-8 px-3 text-xs font-semibold text-gray-600 hover:text-gray-900">
            Keep empty
          </button>
          <button type="button" onClick={onApply} className="h-8 rounded-md bg-teal-600 px-3 text-xs font-semibold text-white hover:bg-teal-700">
            Add example IPs
          </button>
        </div>
      </div>
    </div>
  )
}