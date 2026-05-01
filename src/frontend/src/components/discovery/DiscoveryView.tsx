import { useCallback, useEffect, useState } from 'react'
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
import type { AzureResource } from '@/types/azure'

export default function DiscoveryView() {
  const { subscriptionId } = useParams()
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedResource, setSelectedResource] = useState<AzureResource | null>(null)
  const [loading, setLoading] = useState(false)
  const [subscriptions, setSubscriptions] = useState<{ id: string; displayName: string }[]>([])
  const [selectedSub, setSelectedSub] = useState(subscriptionId ?? '')

  useEffect(() => {
    discoveryService.listSubscriptions().then(setSubscriptions)
  }, [])

  const runDiscovery = useCallback(async () => {
    if (!selectedSub) return
    setLoading(true)
    try {
      const topology = await discoveryService.getTopology(selectedSub)
      setNodes(topology.nodes)
      setEdges(topology.edges)
    } finally {
      setLoading(false)
    }
  }, [selectedSub, setNodes, setEdges])

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges],
  )

  return (
    <div className="flex h-full gap-4">
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center gap-3 mb-4">
          <h1 className="text-xl font-bold text-gray-900">Discovery</h1>
          <select
            value={selectedSub}
            onChange={(e) => setSelectedSub(e.target.value)}
            className="ml-auto border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">Select subscription...</option>
            {subscriptions.map((s) => (
              <option key={s.id} value={s.id}>{s.displayName}</option>
            ))}
          </select>
          <button
            onClick={runDiscovery}
            disabled={!selectedSub || loading}
            className="bg-azure-500 hover:bg-azure-600 disabled:opacity-50 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            {loading ? 'Discovering...' : 'Discover'}
          </button>
        </div>
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
    </div>
  )
}
