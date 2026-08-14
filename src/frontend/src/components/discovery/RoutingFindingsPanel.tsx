import type { RoutingAnalysisReport, RoutingFinding } from '@/services/discoveryService'

interface Props {
  report: RoutingAnalysisReport
  aiLoading: boolean
  highlightNodeIds: string[]
  onFocusFinding: (nodeIds: string[]) => void
  onAskAi: () => void
  onClose: () => void
}

function severityStyle(severity: string) {
  switch (severity.toLowerCase()) {
    case 'error':
      return { badge: 'bg-red-100 text-red-700 border-red-200', dot: '#dc2626' }
    case 'warning':
      return { badge: 'bg-amber-100 text-amber-800 border-amber-200', dot: '#d97706' }
    default:
      return { badge: 'bg-sky-100 text-sky-700 border-sky-200', dot: '#0284c7' }
  }
}

function confidenceStyle(confidence: RoutingFinding['confidence']) {
  switch (confidence) {
    case 'confirmed':
      return 'bg-red-50 text-red-700 border-red-200'
    case 'potential':
      return 'bg-amber-50 text-amber-800 border-amber-200'
    default:
      return 'bg-gray-50 text-gray-600 border-gray-200'
  }
}

function FindingCard({
  finding,
  highlighted,
  onFocus,
}: {
  finding: RoutingFinding
  highlighted: boolean
  onFocus: () => void
}) {
  const s = severityStyle(finding.severity)
  return (
    <li
      className={`rounded-lg border p-3 space-y-2 transition-colors ${
        highlighted ? 'border-red-400 bg-red-50/40' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1 inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: s.dot }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] uppercase tracking-wide font-semibold border rounded px-1.5 py-0.5 ${s.badge}`}>
              {finding.severity}
            </span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold border rounded px-1.5 py-0.5 ${confidenceStyle(finding.confidence)}`}>
              {finding.confidence}
            </span>
            <span className="text-[10px] font-mono text-gray-400">{finding.ruleId}</span>
          </div>
          <p className="text-sm font-semibold text-gray-900 mt-1">{finding.title}</p>
        </div>
      </div>

      <p className="text-xs text-gray-600 leading-relaxed">{finding.message}</p>

      {finding.evidence.length > 0 && (
        <div className="text-xs text-gray-600">
          <p className="font-semibold text-gray-800 mb-1">Evidence</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {finding.evidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </div>
      )}

      {finding.recommendation && (
        <div className="text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded p-2">
          <span className="font-semibold text-gray-800">Recommended: </span>
          {finding.recommendation}
        </div>
      )}

      {finding.aiRecommendation && (
        <div className="text-xs text-violet-900 bg-violet-50 border border-violet-200 rounded p-2">
          <div className="flex items-center gap-1 mb-1">
            <svg className="w-3 h-3 text-violet-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5z" />
            </svg>
            <span className="font-semibold text-violet-700">AI recommended steps</span>
          </div>
          <p className="whitespace-pre-wrap leading-relaxed">{finding.aiRecommendation}</p>
        </div>
      )}

      <div className="flex items-center gap-3 pt-1">
        {finding.affectedNodeIds.length > 0 && (
          <button
            type="button"
            onClick={onFocus}
            className="text-xs font-medium text-azure-600 hover:underline"
          >
            {highlighted ? 'Highlighted on map' : `Show on map (${finding.affectedNodeIds.length})`}
          </button>
        )}
        {finding.reference && (
          <a
            href={finding.reference}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-500 hover:text-azure-600 hover:underline"
          >
            Microsoft Learn ↗
          </a>
        )}
      </div>
    </li>
  )
}

export default function RoutingFindingsPanel({
  report,
  aiLoading,
  highlightNodeIds,
  onFocusFinding,
  onAskAi,
  onClose,
}: Props) {
  const highlightSet = new Set(highlightNodeIds.map((id) => id.toLowerCase()))
  const hasAi = report.findings.some((f) => f.aiRecommendation)

  return (
    <aside className="w-96 shrink-0 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900">Routing analysis</h2>
          <p className="text-[11px] text-gray-500">
            {report.subnetsAnalyzed} subnet{report.subnetsAnalyzed === 1 ? '' : 's'} analyzed
            {report.aiUsed && report.aiModel ? ` · AI: ${report.aiModel}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg leading-none"
          title="Close"
        >
          ✕
        </button>
      </div>

      <div className="px-4 py-3 border-b border-gray-100">
        {!report.effectiveRoutesEvaluated && report.limitations.length > 0 && (
          <div className="mb-3 border-l-2 border-amber-400 pl-2 text-[11px] text-gray-600">
            Configuration analysis only. Effective routes and BGP paths were not verified.
          </div>
        )}
        <button
          type="button"
          onClick={onAskAi}
          disabled={aiLoading || report.findings.length === 0}
          className="w-full bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-3 py-2 rounded-lg transition-colors flex items-center justify-center gap-2"
          title="Use Azure OpenAI to generate step-by-step remediation guidance for each finding."
        >
          {aiLoading
            ? 'Asking AI…'
            : hasAi
              ? 'Refresh AI recommendations'
              : 'Ask AI for recommended steps'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {report.findings.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm font-semibold text-emerald-700">No routing issues detected</p>
            <p className="text-xs text-gray-500 mt-1">
              No asymmetric-routing risks were found in the discovered ARM configuration. Effective route verification is still required.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {report.findings.map((f, i) => {
              const highlighted =
                f.affectedNodeIds.length > 0 &&
                f.affectedNodeIds.every((id) => highlightSet.has(id.toLowerCase())) &&
                highlightSet.size === f.affectedNodeIds.length
              return (
                <FindingCard
                  key={`${f.ruleId}-${i}`}
                  finding={f}
                  highlighted={highlighted}
                  onFocus={() => onFocusFinding(f.affectedNodeIds)}
                />
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
