import { useState } from 'react'
import { bestPracticeService } from '@/services/bestPracticeService'
import type { BestPracticeReport, BestPracticeRule } from '@/types/azure'

const severityColors: Record<string, string> = {
  High: 'bg-red-100 text-red-700',
  Medium: 'bg-yellow-100 text-yellow-700',
  Low: 'bg-blue-100 text-blue-700',
  Info: 'bg-gray-100 text-gray-600',
}

export default function BestPracticeReview() {
  const [subscriptionId, setSubscriptionId] = useState('')
  const [report, setReport] = useState<BestPracticeReport | null>(null)
  const [loading, setLoading] = useState(false)

  const runReview = async () => {
    setLoading(true)
    try {
      const r = await bestPracticeService.runReview(subscriptionId)
      setReport(r)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <h1 className="text-2xl font-bold text-gray-900">Best Practice Review</h1>
      <p className="text-sm text-gray-500">
        Validates your Azure environment against the Microsoft Well-Architected Framework, Azure Landing Zone guidance, and security best practices.
      </p>

      <div className="flex gap-3">
        <input
          type="text"
          value={subscriptionId}
          onChange={(e) => setSubscriptionId(e.target.value)}
          placeholder="Subscription ID (leave blank for all)"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
        />
        <button
          onClick={runReview}
          disabled={loading}
          className="bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Running...' : 'Run review'}
        </button>
      </div>

      {report && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {Object.entries(report.pillarScores).map(([pillar, score]) => (
              <div key={pillar} className="bg-white border border-gray-200 rounded-xl p-4">
                <p className="text-xl font-bold text-gray-900">{score}%</p>
                <p className="text-xs text-gray-500 mt-1">{pillar}</p>
              </div>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Rule</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Severity</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Pillar</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Recommendation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.findings.map((rule: BestPracticeRule) => (
                  <tr key={rule.ruleId} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{rule.title}</p>
                      <p className="text-xs text-gray-400 font-mono">{rule.ruleId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${severityColors[rule.severity] ?? ''}`}>
                        {rule.severity}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{rule.framework?.join(', ')}</td>
                    <td className="px-4 py-3 text-xs text-gray-700">{rule.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
