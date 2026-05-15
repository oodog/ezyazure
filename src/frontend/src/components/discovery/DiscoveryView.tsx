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
import type { AzureResource } from '@/types/azure'

export default function DiscoveryView() {
  const { subscriptionId } = useParams()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedResource, setSelectedResource] = useState<AzureResource | null>(null)
  const [loading, setLoading] = useState(false)
  const [subscriptions, setSubscriptions] = useState<{ id: string; displayName: string }[]>([])
  const [selectedSubs, setSelectedSubs] = useState<Set<string>>(
    () => new Set(subscriptionId ? [subscriptionId] : []),
  )
  const [pickerOpen, setPickerOpen] = useState(false)
  const [replicateOpen, setReplicateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    discoveryService.listSubscriptions().then(setSubscriptions).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load subscriptions.')
    })
  }, [])

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
                  <p className="px-3 py-4 text-xs text-gray-500">No subscriptions visible.</p>
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
                          <span className="truncate">{s.displayName}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
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
