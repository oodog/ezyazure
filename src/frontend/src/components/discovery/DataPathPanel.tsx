import { useMemo, useState } from 'react'
import type { DataPathResult } from '@/services/discoveryService'

interface VmOption {
  id: string
  name: string
  resourceGroup: string
}

interface DataPathPanelProps {
  vms: VmOption[]
  result: DataPathResult | null
  loading: boolean
  error: string | null
  onTrace: (req: {
    sourceResourceId: string
    destination: string
    protocol: string
    destinationPort: number
  }) => void
  onClose: () => void
}

const PROTOCOLS = ['TCP', 'UDP', 'ICMP', '*']

/**
 * Data-path tracer embedded in the Discovery view. Lets the user pick a source VM from a
 * searchable dropdown, type a destination (IP or resource ID), choose protocol/port, and
 * trace the path. The result drives the map highlight in the parent view.
 */
export default function DataPathPanel({
  vms,
  result,
  loading,
  error,
  onTrace,
  onClose,
}: DataPathPanelProps) {
  const [search, setSearch] = useState('')
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [destination, setDestination] = useState('')
  const [protocol, setProtocol] = useState('TCP')
  const [port, setPort] = useState(443)

  const filteredVms = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return vms
    return vms.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.resourceGroup.toLowerCase().includes(q) ||
        v.id.toLowerCase().includes(q),
    )
  }, [vms, search])

  const selectedVm = useMemo(() => vms.find((v) => v.id === sourceId) ?? null, [vms, sourceId])

  const canTrace = !!sourceId && destination.trim().length > 0 && !loading

  const submit = () => {
    if (!sourceId) return
    onTrace({
      sourceResourceId: sourceId,
      destination: destination.trim(),
      protocol,
      destinationPort: protocol === 'ICMP' ? 0 : port,
    })
  }

  const statusBadge = () => {
    if (!result) return null
    const map: Record<string, string> = {
      Allowed: 'bg-green-100 text-green-700 border-green-300',
      Blocked: 'bg-red-100 text-red-700 border-red-300',
      Unknown: 'bg-gray-100 text-gray-600 border-gray-300',
    }
    return (
      <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${map[result.status] ?? map.Unknown}`}>
        {result.status}
      </span>
    )
  }

  return (
    <aside className="w-96 shrink-0 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h2 className="font-semibold text-gray-900">Trace data path</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close">
          ✕
        </button>
      </div>

      <div className="p-4 space-y-3 overflow-y-auto">
        {/* Source VM searchable dropdown */}
        <div className="relative">
          <label className="block text-xs font-semibold text-gray-700 mb-1">Source VM</label>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-left bg-white hover:bg-gray-50 flex items-center justify-between"
          >
            <span className={`truncate ${selectedVm ? 'text-gray-900' : 'text-gray-400'}`}>
              {selectedVm ? selectedVm.name : 'Select a virtual machine…'}
            </span>
            <svg className="w-3 h-3 text-gray-500 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {dropdownOpen && (
            <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
              <div className="p-2 border-b border-gray-100">
                <input
                  autoFocus
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search VMs…"
                  className="w-full text-sm px-2 py-1.5 border border-gray-300 rounded"
                />
              </div>
              <ul className="max-h-64 overflow-y-auto py-1">
                {filteredVms.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-gray-500">No matching VMs.</li>
                ) : (
                  filteredVms.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSourceId(v.id)
                          setDropdownOpen(false)
                          setSearch('')
                        }}
                        className={`w-full text-left px-3 py-1.5 text-sm hover:bg-azure-50 ${
                          v.id === sourceId ? 'bg-azure-50 font-medium' : ''
                        }`}
                      >
                        <span className="block truncate">{v.name}</span>
                        <span className="block text-[11px] text-gray-400 truncate">{v.resourceGroup}</span>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}
        </div>

        {/* Destination */}
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">
            Destination (IP address or resource ID)
          </label>
          <input
            type="text"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            placeholder="10.1.2.4  or  /subscriptions/…/virtualMachines/db"
            className="w-full text-sm px-3 py-2 border border-gray-300 rounded-lg font-mono"
            spellCheck={false}
          />
        </div>

        {/* Protocol + Port */}
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Protocol</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value)}
              className="w-full text-sm px-2 py-2 border border-gray-300 rounded-lg bg-white"
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
          <div className="w-28">
            <label className="block text-xs font-semibold text-gray-700 mb-1">Port</label>
            <input
              type="number"
              min={0}
              max={65535}
              value={port}
              disabled={protocol === 'ICMP'}
              onChange={(e) => setPort(Number(e.target.value))}
              className="w-full text-sm px-2 py-2 border border-gray-300 rounded-lg disabled:bg-gray-100"
            />
          </div>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!canTrace}
          className="w-full bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          {loading ? 'Tracing…' : 'Trace path'}
        </button>

        {error && (
          <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">{error}</div>
        )}

        {/* Result */}
        {result && (
          <div className="space-y-3 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-900">Result</span>
              {statusBadge()}
            </div>

            {result.destinationSummary && (
              <p className="text-xs text-gray-500">{result.destinationSummary}</p>
            )}

            {result.blockingRule && (
              <div className="px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                Blocked by: {result.blockingRule}
              </div>
            )}

            {result.hops.length > 0 && (
              <ol className="space-y-1">
                {result.hops.map((h, i) => (
                  <li key={`${h.resourceId}-${i}`} className="flex gap-2 text-xs">
                    <span className="text-gray-400 font-mono shrink-0">{i + 1}.</span>
                    <div className="min-w-0">
                      <span className="font-medium text-gray-900 break-words">{h.resourceName}</span>
                      <span className="text-gray-400"> · {h.resourceType.split('/').pop()}</span>
                      {h.detail && <div className="text-gray-500">{h.detail}</div>}
                      {h.matchedRule && <div className="text-gray-400">rule: {h.matchedRule}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {result.riskNotes.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-amber-700 mb-1">Risk notes</p>
                <ul className="space-y-1">
                  {result.riskNotes.map((n, i) => (
                    <li key={i} className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {result.bestPracticeNotes.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1">Best practice</p>
                <ul className="space-y-1">
                  {result.bestPracticeNotes.map((n, i) => (
                    <li key={i} className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1">
                      {n}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
