import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useParams } from 'react-router-dom'
import { discoveryService } from '@/services/discoveryService'
import ResourcePanel from './ResourcePanel'
import ReplicateDialog from './ReplicateDialog'
import { useManualSubscriptions, isValidSubscriptionId } from '@/hooks/useManualSubscriptions'
import type { AzureResource } from '@/types/azure'

export default function DiscoveryView() {
  const { subscriptionId } = useParams()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedResource, setSelectedResource] = useState<AzureResource | null>(null)
  const [loading, setLoading] = useState(false)
  const [apiSubs, setApiSubs] = useState<{ id: string; displayName: string }[]>([])
  const manual = useManualSubscriptions()
  const [manualInputId, setManualInputId] = useState('')
  const [manualInputName, setManualInputName] = useState('')
  const [manualError, setManualError] = useState<string | null>(null)
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(
    () => new Set(subscriptionId ? [subscriptionId] : []),
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replicateOpen, setReplicateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    discoveryService.listSubscriptions().then(setApiSubs).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load subscriptions.')
    })
  }, [])

  // Merge API-visible + manually-added subscriptions, de-duplicated by id.
  // Manual entries override API entries so users can label them however they want.
  const subscriptions = useMemo(() => {
    const map = new Map<string, { id: string; displayName: string; source: 'api' | 'manual' }>()
    for (const s of apiSubs) map.set(s.id.toLowerCase(), { ...s, source: 'api' })
    for (const s of manual.items) map.set(s.id.toLowerCase(), { ...s, source: 'manual' })
    return Array.from(map.values())
  }, [apiSubs, manual.items])

  const selectedSubIds = useMemo(() => Array.from(selectedSubs), [selectedSubs])

  const toggleSub = (id: string) => {
    setSelectedSubs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectAllSubs = () => setSelectedSubs(new Set(subscriptions.map((s) => s.id)))
  const clearSubs = () => setSelectedSubs(new Set())

  const addManualSub = () => {
    const id = manualInputId.trim()
    if (!isValidSubscriptionId(id)) {
      setManualError('Subscription ID must be a GUID, e.g. 9f19629c-4416-43e2-8986-0a8371d83347')
      return
    }
    const ok = manual.add(id, manualInputName)
    if (!ok) {
      setManualError('Invalid subscription ID format.')
      return
    }
    setSelectedSubs((prev) => new Set([...prev, id.toLowerCase()]))
    setManualInputId('')
    setManualInputName('')
    setManualError(null)
  }

  const runDiscovery = useCallback(async () => {
    if (selectedSubIds.length === 0) return
    setLoading(true)
    setError(null)
    try {
      const topology =
        selectedSubIds.length === 1
          ? await discoveryService.getTopology(selectedSubIds[0])
          : await discoveryService.getTopologyMulti(selectedSubIds)
      setNodes(topology.nodes)
      setEdges(topology.edges)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Discovery failed.')
    } finally {
      setLoading(false)
    }
  }, [selectedSubIds, setNodes, setEdges])

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  )

  const selectedLabel = useMemo(() => {
    if (selectedSubIds.length === 0) return 'Select subscription(s)…'
    if (selectedSubIds.length === 1) {
      const s = subscriptions.find((x) => x.id === selectedSubIds[0])
      return s?.displayName ?? selectedSubIds[0]
    }
    return `${selectedSubIds.length} subscriptions selected`
  }, [selectedSubIds, subscriptions])

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <h1 className="text-xl font-bold text-gray-900">Discovery</h1>

          {/* Multi-subscription picker */}
          <div className="relative ml-auto">
            <button
              type="button"
              onClick={() => setPickerOpen((v) => !v)}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white hover:bg-gray-50 flex items-center gap-2"
            >
              <span className="truncate max-w-[18rem]">{selectedLabel}</span>
              <svg className="w-3 h-3 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {pickerOpen && (
              <div className="absolute right-0 mt-1 w-80 max-h-80 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg z-30">
                <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between text-xs">
                  <button onClick={selectAllSubs} className="text-azure-600 hover:underline">
                    Select all
                  </button>
                  <button onClick={clearSubs} className="text-gray-500 hover:underline">
                    Clear
                  </button>
                </div>
                {subscriptions.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-gray-500">No subscriptions visible. Add a subscription ID below.</p>
                ) : (
                  <ul className="py-1">
                    {subscriptions.map((s) => (
                      <li key={s.id}>
                        <label className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedSubs.has(s.id)}
                            onChange={() => toggleSub(s.id)}
                          />
                          <span className="truncate flex-1">{s.displayName}</span>
                          {(s as { source?: string }).source === 'manual' && (
                            <>
                              <span className="text-[10px] uppercase tracking-wide text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">manual</span>
                              <button
                                type="button"
                                onClick={(e) => { e.preventDefault(); manual.remove(s.id) }}
                                className="text-xs text-gray-400 hover:text-red-600"
                                title="Remove this manually-added subscription"
                              >
                                ✕
                              </button>
                            </>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Manual subscription ID entry. Use when the API's managed identity
                    cannot enumerate your subscriptions. Grant the MI Reader on the
                    target sub first:
                    https://learn.microsoft.com/azure/role-based-access-control/role-assignments-cli */}
                <div className="border-t border-gray-100 px-3 py-3 space-y-2 bg-gray-50">
                  <p className="text-xs font-semibold text-gray-700">Add subscription ID</p>
                  <input
                    type="text"
                    value={manualInputId}
                    onChange={(e) => { setManualInputId(e.target.value); setManualError(null) }}
                    placeholder="9f19629c-4416-43e2-8986-0a8371d83347"
                    className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded font-mono"
                    spellCheck={false}
                  />
                  <input
                    type="text"
                    value={manualInputName}
                    onChange={(e) => setManualInputName(e.target.value)}
                    placeholder="Display name (optional)"
                    className="w-full text-xs px-2 py-1.5 border border-gray-300 rounded"
                  />
                  {manualError && (
                    <p className="text-[11px] text-red-600">{manualError}</p>
                  )}
                  <button
                    type="button"
                    onClick={addManualSub}
                    className="w-full text-xs bg-azure-500 hover:bg-azure-600 text-white font-medium px-2 py-1.5 rounded"
                  >
                    Add
                  </button>
                </div>
              </div>
            )}
          </div>

          <button
            onClick={runDiscovery}
            disabled={selectedSubIds.length === 0 || loading}
            className="bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            {loading ? 'Discovering…' : 'Discover'}
          </button>
          <button
            onClick={() => setReplicateOpen(true)}
            disabled={selectedSubIds.length === 0 || nodes.length === 0}
            title="Replicate the discovered environment into a new subscription with renamed globally-unique resources."
            className="bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            Replicate to new subscription
          </button>
        </div>
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}
        <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, node) => setSelectedResource(node.data as AzureResource)}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      </div>
      {selectedResource && (
        <ResourcePanel resource={selectedResource} onClose={() => setSelectedResource(null)} />
      )}
      {replicateOpen && (
        <ReplicateDialog
          sourceSubscriptionIds={selectedSubIds}
          subscriptions={subscriptions}
          onClose={() => setReplicateOpen(false)}
        />
      )}
    </div>
  )
}
