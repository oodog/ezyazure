import { useState } from 'react'
import { dataPathService } from '@/services/dataPathService'
import PathTrace from './PathTrace'
import type { DataPathRequest, DataPathResult } from '@/types/datapath'

export default function DataPathAnalyzer() {
  const [form, setForm] = useState<DataPathRequest>({
    sourceResourceId: '',
    destinationResourceId: '',
    protocol: 'TCP',
    destinationPort: 443,
  })
  const [result, setResult] = useState<DataPathResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleAnalyze = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await dataPathService.analyze(form)
      setResult(res)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900">Data Path Analyzer</h1>
      <p className="text-sm text-gray-500">
        Trace the network path between two Azure resources and identify NSG rules, routes, peering, and blockers.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Source resource ID</span>
            <input
              type="text"
              value={form.sourceResourceId}
              onChange={(e) => setForm((f) => ({ ...f, sourceResourceId: e.target.value }))}
              placeholder="/subscriptions/.../virtualMachines/vm-a"
              className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Destination resource ID</span>
            <input
              type="text"
              value={form.destinationResourceId}
              onChange={(e) => setForm((f) => ({ ...f, destinationResourceId: e.target.value }))}
              placeholder="/subscriptions/.../privateEndpoints/sql-pe"
              className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Protocol</span>
            <select
              value={form.protocol}
              onChange={(e) => setForm((f) => ({ ...f, protocol: e.target.value as 'TCP' | 'UDP' | 'ICMP' }))}
              className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            >
              <option>TCP</option>
              <option>UDP</option>
              <option>ICMP</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">Destination port</span>
            <input
              type="number"
              value={form.destinationPort}
              onChange={(e) => setForm((f) => ({ ...f, destinationPort: parseInt(e.target.value) }))}
              className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </label>
        </div>
        <button
          onClick={handleAnalyze}
          disabled={!form.sourceResourceId || !form.destinationResourceId || loading}
          className="bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
        >
          {loading ? 'Analyzing...' : 'Analyze path'}
        </button>
        {error && <p className="text-red-600 text-sm">{error}</p>}
      </div>

      {result && <PathTrace result={result} />}
    </div>
  )
}
