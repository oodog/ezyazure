import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { useNavigate, useParams } from 'react-router-dom'
import { discoveryService } from '@/services/discoveryService'
import type { RoutingAnalysisReport, DataPathResult } from '@/services/discoveryService'
import ResourcePanel from './ResourcePanel'
import ReplicateDialog from './ReplicateDialog'
import DiscoveryResourceNode from './DiscoveryResourceNode'
import RoutingFindingsPanel from './RoutingFindingsPanel'
import DataPathPanel from './DataPathPanel'
import VersionHistoryPanel from './VersionHistoryPanel'
import TopologyScopePanel from './TopologyScopePanel'
import { useManualSubscriptions, isValidSubscriptionId } from '@/hooks/useManualSubscriptions'
import type { AzureResource, DiscoveryCoverage, FlowEdge as ApiFlowEdge, FlowNode as ApiFlowNode } from '@/types/azure'
import { applyDagreLayout } from '@/utils/dagreLayout'
import { loadDiscoveryCache, saveDiscoveryCache } from '@/utils/discoveryCache'
import { getVmPrivateIps } from '@/utils/azureResourceDetails'
import {
  discoveryTechnologies,
  filterDiscoveryGraphByView,
  getDiscoveryTechnology,
  type DiscoveryTechnology,
  type DiscoveryTopologyView,
} from '@/utils/discoveryTechnology'
import {
  captureTopologyJpeg,
  createDrawioXml,
  createTopologyPdf,
  downloadFile,
  topologyExportFileName,
  type TopologyExportFormat,
} from '@/utils/topologyExport'
import { createDiscoveryDesignHandoff, saveDiscoveryDesignHandoff } from '@/utils/discoveryDesignHandoff'

const nodeTypes = { azureResource: DiscoveryResourceNode }
const INTERNET_NODE_ID = 'easyazure://internet'

/**
 * Visual treatment per backend edge category. Default routes are always rendered
 * in red because 0.0.0.0/0 controls north/south traffic and is the single
 * highest-impact misconfiguration vector.
 * Reference: https://learn.microsoft.com/azure/virtual-network/virtual-networks-udr-overview
 */
function edgeStyleFor(category: string | undefined) {
  switch (category) {
    case 'default-route':
      return {
        stroke: '#dc2626', // red-600
        strokeWidth: 3,
        animated: true,
        dash: undefined,
        opacity: 1,
      }
    case 'peering':
      return { stroke: '#2563eb', strokeWidth: 2, animated: false, dash: '6 4', opacity: 0.75 }
    case 'route':
      return { stroke: '#f59e0b', strokeWidth: 2, animated: false, dash: undefined, opacity: 0.7 }
    case 'associatedWith':
      return { stroke: '#be185d', strokeWidth: 2, animated: false, dash: undefined, opacity: 0.65 }
    case 'connectedTo':
      return { stroke: '#059669', strokeWidth: 2, animated: false, dash: '3 3', opacity: 0.7 }
    case 'contains':
    default:
      return { stroke: '#94a3b8', strokeWidth: 1.25, animated: false, dash: undefined, opacity: 0.45 }
  }
}

function toReactFlowNode(n: ApiFlowNode): Node<AzureResource> {
  return {
    id: n.id.toLowerCase(),
    type: 'azureResource',
    position: n.position,
    data: n.data,
  }
}

function toReactFlowEdge(e: ApiFlowEdge): Edge {
  const s = edgeStyleFor(e.category)
  return {
    id: e.id.toLowerCase(),
    source: e.source.toLowerCase(),
    target: e.target.toLowerCase(),
    label: e.label,
    animated: s.animated,
    style: {
      stroke: s.stroke,
      strokeWidth: s.strokeWidth,
      strokeDasharray: s.dash,
      opacity: s.opacity,
    },
    labelStyle: { fontSize: 10, fontWeight: 600, fill: s.stroke },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
    labelBgPadding: [4, 2],
    labelBgBorderRadius: 4,
    markerEnd: { type: MarkerType.ArrowClosed, color: s.stroke },
    data: { category: e.category, metadata: e.metadata },
  }
}

export default function DiscoveryView() {
  const { subscriptionId } = useParams()
  const navigate = useNavigate()
  const [nodes, setNodes, onNodesChange] = useNodesState<AzureResource>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [flowInstance, setFlowInstance] = useState<ReactFlowInstance | null>(null)
  const topologyCanvasRef = useRef<HTMLDivElement>(null)
  const [exporting, setExporting] = useState<TopologyExportFormat | null>(null)
  const [selectedResource, setSelectedResource] = useState<AzureResource | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
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
  const [topologyView, setTopologyView] = useState<DiscoveryTopologyView>('network')
  const [selectedTechnologies, setSelectedTechnologies] = useState<Set<DiscoveryTechnology>>(
    () => new Set(),
  )
  const [replicateOpen, setReplicateOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [discoveryCoverage, setDiscoveryCoverage] = useState<DiscoveryCoverage | null>(null)

  // Routing analysis (asymmetric routing detection + optional AI remediation)
  const [routingReport, setRoutingReport] = useState<RoutingAnalysisReport | null>(null)
  const [routingOpen, setRoutingOpen] = useState(false)
  const [routingLoading, setRoutingLoading] = useState(false)
  const [routingAiLoading, setRoutingAiLoading] = useState(false)
  const [highlightNodeIds, setHighlightNodeIds] = useState<string[]>([])

  // Data-path tracer (searchable source VM + destination IP/resource id)
  const [dataPathOpen, setDataPathOpen] = useState(false)
  const [dataPathResult, setDataPathResult] = useState<DataPathResult | null>(null)
  const [dataPathLoading, setDataPathLoading] = useState(false)
  const [dataPathError, setDataPathError] = useState<string | null>(null)
  const [pathNodeIds, setPathNodeIds] = useState<string[]>([])

  // Discovery versioning (persisted snapshots + diff)
  const [versionOpen, setVersionOpen] = useState(false)

  useEffect(() => {
    discoveryService.listSubscriptions().then(setApiSubs).catch((e) => {
      setError(e instanceof Error ? e.message : 'Failed to load subscriptions.')
    })
  }, [])

  // Rehydrate the previous discovery result so navigating away from this view
  // and coming back doesn't force a re-discovery. The cache is per-session.
  useEffect(() => {
    const cached = loadDiscoveryCache()
    if (!cached) return
    if (cached.nodes.length === 0) return
    setNodes(cached.nodes)
    setEdges(cached.edges)
    if (cached.subscriptionIds.length > 0) {
      setSelectedSubs(new Set(cached.subscriptionIds))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const availableTechnologies = useMemo(() => {
    const counts = new Map<DiscoveryTechnology, number>()
    for (const node of nodes) {
      const technology = getDiscoveryTechnology(node.data.type)
      counts.set(technology, (counts.get(technology) ?? 0) + 1)
    }
    return discoveryTechnologies
      .map((technology) => ({ ...technology, count: counts.get(technology.key) ?? 0 }))
      .filter((technology) => technology.count > 0)
  }, [nodes])

  const toggleTechnology = (technology: DiscoveryTechnology) => {
    setSelectedTechnologies((previous) => {
      const next = new Set(previous)
      if (next.has(technology)) next.delete(technology)
      else next.add(technology)
      return next
    })
  }

  const toggleSub = (id: string) => {
    setSelectedSubs((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // Auto-close the picker shortly after a selection so it doesn't stay open.
    window.setTimeout(() => setPickerOpen(false), 150)
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
    setDiscoveryCoverage(null)
    try {
      const topology =
        selectedSubIds.length === 1
          ? await discoveryService.getTopology(selectedSubIds[0])
          : await discoveryService.getTopologyMulti(selectedSubIds)
      const rfNodes = topology.nodes.map(toReactFlowNode)
      const rfEdges = topology.edges.map(toReactFlowEdge)
      setDiscoveryCoverage(topology.coverage ?? null)
      const laidOut = applyDagreLayout(rfNodes, rfEdges)
      setNodes(laidOut)
      setEdges(rfEdges)
      saveDiscoveryCache({
        subscriptionIds: selectedSubIds,
        nodes: laidOut,
        edges: rfEdges,
        capturedAt: Date.now(),
      })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Discovery failed.')
    } finally {
      setLoading(false)
    }
  }, [selectedSubIds, setNodes, setEdges])

  const analyzeRouting = useCallback(
    async (useAi: boolean) => {
      if (selectedSubIds.length === 0) return
      if (useAi) setRoutingAiLoading(true)
      else setRoutingLoading(true)
      setError(null)
      try {
        const report = await discoveryService.analyzeRouting(selectedSubIds, useAi)
        setRoutingReport(report)
        setRoutingOpen(true)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Routing analysis failed.')
      } finally {
        setRoutingLoading(false)
        setRoutingAiLoading(false)
      }
    },
    [selectedSubIds],
  )

  // Highlight the nodes a finding refers to, and dim everything else.
  const focusFinding = useCallback((nodeIds: string[]) => {
    setHighlightNodeIds(nodeIds.map((id) => id.toLowerCase()))
    setSelectedNodeId(null)
    setSelectedResource(null)
  }, [])

  // Source VMs available for the data-path tracer.
  const vmOptions = useMemo(
    () => {
      const nodeById = new Map(nodes.map((node) => [node.id, node]))
      return nodes
        .filter((n) => n.data?.type?.toLowerCase() === 'microsoft.compute/virtualmachines')
        .map((n) => ({
          id: n.id,
          name: n.data?.name ?? n.id,
          resourceGroup: n.data?.resourceGroup ?? '',
          subnetName: edges
            .filter((edge) => edge.source === n.id)
            .map((edge) => nodeById.get(edge.target))
            .find((target) => target?.data.type.toLowerCase() === 'microsoft.network/virtualnetworks/subnets')
            ?.data.name,
          privateIps: getVmPrivateIps(n.data),
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    },
    [nodes, edges],
  )

  const tracePath = useCallback(
    async (req: {
      sourceResourceId: string
      destination: string
      protocol: string
      destinationPort: number
    }) => {
      if (selectedSubIds.length === 0) return
      setDataPathLoading(true)
      setDataPathError(null)
      try {
        const result = await discoveryService.tracePath({
          subscriptionIds: selectedSubIds,
          ...req,
        })
        setDataPathResult(result)
        // Highlight the traced path on the map.
        const ids = (result.pathNodeIds ?? []).map((id) => id.toLowerCase())
        setPathNodeIds(ids)
        setHighlightNodeIds(ids)
        setSelectedNodeId(null)
        setSelectedResource(null)
      } catch (e: unknown) {
        setDataPathError(e instanceof Error ? e.message : 'Data path trace failed.')
      } finally {
        setDataPathLoading(false)
      }
    },
    [selectedSubIds],
  )

  const selectedLabel = useMemo(() => {
    if (selectedSubIds.length === 0) return 'Select subscription(s)…'
    if (selectedSubIds.length === 1) {
      const s = subscriptions.find((x) => x.id === selectedSubIds[0])
      return s?.displayName ?? selectedSubIds[0]
    }
    return `${selectedSubIds.length} subscriptions selected`
  }, [selectedSubIds, subscriptions])

  const renderedEdges = useMemo(() => {
    // Highest priority: a traced data path. Highlight the edges that connect
    // consecutive nodes in the returned path and dim everything else.
    if (pathNodeIds.length > 1) {
      const pathSet = new Set(pathNodeIds)
      const adjacentPairs = new Set<string>()
      for (let i = 0; i < pathNodeIds.length - 1; i++) {
        adjacentPairs.add(`${pathNodeIds[i]}__${pathNodeIds[i + 1]}`)
        adjacentPairs.add(`${pathNodeIds[i + 1]}__${pathNodeIds[i]}`)
      }
      const onPath = (e: Edge) =>
        adjacentPairs.has(`${e.source}__${e.target}`) ||
        (pathSet.has(e.source) && pathSet.has(e.target))

      return edges.map((e) => {
        const highlight = onPath(e)
        const style = e.style ?? {}
        const labelStyle = e.labelStyle ?? {}
        return {
          ...e,
          animated: highlight ? true : false,
          style: {
            ...style,
            stroke: highlight ? '#7c3aed' : style.stroke,
            opacity: highlight ? 1 : 0.1,
            strokeWidth: highlight ? 3.5 : Number(style.strokeWidth ?? 1.5),
          },
          labelStyle: { ...labelStyle, opacity: highlight ? 1 : 0.2 },
          markerEnd: highlight
            ? { type: MarkerType.ArrowClosed, color: '#7c3aed' }
            : e.markerEnd,
        }
      })
    }

    if (!selectedNodeId || selectedResource?.type.toLowerCase() !== 'microsoft.compute/virtualmachines') {
      return edges
    }

    const outgoing = new Map<string, Edge[]>()
    for (const e of edges) {
      const list = outgoing.get(e.source) ?? []
      list.push(e)
      outgoing.set(e.source, list)
    }

    const allowed = new Set(['associatedWith', 'route', 'default-route'])
    const edgeInPath = new Set<string>()
    const seenNodes = new Set<string>([selectedNodeId])
    const queue: string[] = [selectedNodeId]

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      const out = outgoing.get(nodeId) ?? []
      for (const e of out) {
        const category = (e.data as { category?: string } | undefined)?.category
        if (!allowed.has(category ?? '')) continue
        edgeInPath.add(e.id)
        if (!seenNodes.has(e.target)) {
          seenNodes.add(e.target)
          queue.push(e.target)
        }
      }
      if (seenNodes.has(INTERNET_NODE_ID)) break
    }

    if (edgeInPath.size === 0) return edges

    return edges.map((e) => {
      const highlight = edgeInPath.has(e.id)
      const style = e.style ?? {}
      const labelStyle = e.labelStyle ?? {}

      return {
        ...e,
        animated: highlight ? true : e.animated,
        style: {
          ...style,
          opacity: highlight ? 1 : 0.16,
          strokeWidth: highlight ? Math.max(Number(style.strokeWidth ?? 2), 2.5) : Number(style.strokeWidth ?? 1.5),
        },
        labelStyle: {
          ...labelStyle,
          opacity: highlight ? 1 : 0.35,
        },
      }
    })
  }, [edges, selectedNodeId, selectedResource, pathNodeIds])

  // When a routing finding is focused, dim every node except the affected ones
  // and outline the affected nodes so the user can locate them on the canvas.
  const renderedNodes = useMemo(() => {
    if (highlightNodeIds.length === 0) return nodes
    const set = new Set(highlightNodeIds)
    return nodes.map((n) => {
      const on = set.has(n.id)
      return {
        ...n,
        style: {
          ...(n.style ?? {}),
          opacity: on ? 1 : 0.25,
          outline: on ? '3px solid #dc2626' : undefined,
          outlineOffset: on ? '2px' : undefined,
          borderRadius: on ? 8 : (n.style?.borderRadius as number | undefined),
        },
      }
    })
  }, [nodes, highlightNodeIds])

  const filteredGraph = useMemo(() => {
    const filtered = filterDiscoveryGraphByView(
      renderedNodes,
      renderedEdges,
      topologyView,
      selectedTechnologies,
    )
    return {
      nodes: applyDagreLayout(filtered.nodes, filtered.edges),
      edges: filtered.edges,
    }
  }, [renderedNodes, renderedEdges, topologyView, selectedTechnologies])

  const visibleNodeIds = useMemo(
    () => new Set(filteredGraph.nodes.map((node) => node.id)),
    [filteredGraph.nodes],
  )

  const assistantTechnologies = useMemo<DiscoveryTechnology[]>(() => {
    if (selectedTechnologies.size > 0) return Array.from(selectedTechnologies)
    if (topologyView === 'network') return ['networking']
    if (topologyView === 'network-compute') return ['networking', 'compute']
    return []
  }, [selectedTechnologies, topologyView])

  useEffect(() => {
    if (!flowInstance || filteredGraph.nodes.length === 0) return
    const frame = window.requestAnimationFrame(() => {
      void flowInstance.fitView({ padding: 0.18, duration: 250 })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [flowInstance, topologyView, selectedTechnologies, filteredGraph.nodes.length])

  const exportTopology = useCallback(async (format: TopologyExportFormat) => {
    if (filteredGraph.nodes.length === 0) return
    setExporting(format)
    setError(null)
    try {
      if (format === 'drawio') {
        const xml = createDrawioXml(
          filteredGraph.nodes,
          filteredGraph.edges,
          `EasyAzure ${topologyView} topology`,
        )
        downloadFile(
          new Blob([xml], { type: 'application/vnd.jgraph.mxfile;charset=utf-8' }),
          topologyExportFileName(topologyView, 'drawio'),
        )
        return
      }

      const viewportElement = topologyCanvasRef.current?.querySelector<HTMLElement>('.react-flow__viewport')
      if (!viewportElement) throw new Error('The topology canvas is not ready.')
      const image = await captureTopologyJpeg(viewportElement, filteredGraph.nodes)
      if (format === 'jpeg') {
        downloadFile(image.blob, topologyExportFileName(topologyView, 'jpeg'))
      } else {
        const pdf = await createTopologyPdf(image, `EasyAzure Discovery - ${topologyView} topology`)
        downloadFile(pdf, topologyExportFileName(topologyView, 'pdf'))
      }
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? `Export failed: ${exportError.message}` : 'Export failed.')
    } finally {
      setExporting(null)
    }
  }, [filteredGraph.edges, filteredGraph.nodes, topologyView])

  const openInDesigner = useCallback(() => {
    try {
      const handoff = createDiscoveryDesignHandoff(filteredGraph.nodes, filteredGraph.edges)
      if (handoff.nodes.length === 0) {
        setError('No resources in the current view can be opened in Design / Validate.')
        return
      }
      saveDiscoveryDesignHandoff(handoff)
      navigate('/designer?source=discovery')
    } catch (handoffError: unknown) {
      setError(handoffError instanceof Error ? handoffError.message : 'The topology could not be opened in Design / Validate.')
    }
  }, [filteredGraph.edges, filteredGraph.nodes, navigate])

  return (
    <div className="flex h-full gap-3">
      {dataPathOpen ? (
        <DataPathPanel
          placement="left"
          vms={vmOptions}
          result={dataPathResult}
          loading={dataPathLoading}
          error={dataPathError}
          onTrace={tracePath}
          onClose={() => {
            setDataPathOpen(false)
            setDataPathResult(null)
            setDataPathError(null)
            setPathNodeIds([])
            setHighlightNodeIds([])
          }}
        />
      ) : (
        <TopologyScopePanel
          view={topologyView}
          onViewChange={(view) => {
            setTopologyView(view)
            setSelectedNodeId(null)
            setSelectedResource(null)
            setHighlightNodeIds([])
            setPathNodeIds([])
          }}
          technologies={availableTechnologies}
          selectedTechnologies={selectedTechnologies}
          onToggleTechnology={toggleTechnology}
          onClearTechnologies={() => setSelectedTechnologies(new Set())}
          visibleCount={filteredGraph.nodes.length}
          totalCount={nodes.length}
          routingLoading={routingLoading}
          onAnalyzeRouting={() => analyzeRouting(false)}
          onOpenDataPath={() => {
            setTopologyView('network-compute')
            setDataPathOpen(true)
          }}
          exporting={exporting}
          onExport={exportTopology}
          assistantSubscriptionIds={selectedSubIds}
          assistantTechnologies={assistantTechnologies}
          assistantResourceId={selectedNodeId ?? undefined}
          onOpenInDesigner={openInDesigner}
        />
      )}
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
          <button
            onClick={() => setVersionOpen((v) => !v)}
            title="Save the current discovery as a version and compare how your environment changed between discoveries."
            className="bg-slate-600 hover:bg-slate-700 text-white text-sm font-medium px-4 py-1.5 rounded-lg transition-colors"
          >
            Version history
          </button>
        </div>
        {error && (
          <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
            {error}
          </div>
        )}
        {discoveryCoverage && !discoveryCoverage.isComplete && (
          <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-900 text-sm rounded-lg">
            <p className="font-semibold">Discovery is partial</p>
            <p className="text-xs mt-0.5">
              {discoveryCoverage.successfulSubscriptionIds.length} of {discoveryCoverage.requestedSubscriptionIds.length} subscriptions completed.
              {' '}Missing resources can make topology and routing findings incomplete.
            </p>
            <ul className="text-xs mt-1 list-disc pl-4">
              {discoveryCoverage.failures.map((failure) => (
                <li key={`${failure.subscriptionId}-${failure.stage}`}>
                  <span className="font-mono">{failure.subscriptionId}</span>: {failure.message}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div ref={topologyCanvasRef} className="relative flex-1 bg-white border border-gray-200 rounded-lg overflow-hidden">
          {nodes.length > 0 && filteredGraph.nodes.length === 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
              <div className="max-w-xs text-center px-5 py-4 bg-white border border-gray-200 rounded-lg shadow-sm">
                <p className="text-sm font-semibold text-gray-800">No resources in this view</p>
                <p className="mt-1 text-xs text-gray-500">
                  Choose Full inventory or clear the technology selections.
                </p>
              </div>
            </div>
          )}
          <ReactFlow
            nodes={filteredGraph.nodes}
            edges={filteredGraph.edges}
            nodeTypes={nodeTypes}
            onInit={setFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            nodesDraggable={false}
            nodesConnectable={false}
            onNodeClick={(_, node) => {
              setSelectedNodeId(node.id)
              setSelectedResource(node.data as AzureResource)
              setHighlightNodeIds([])
            }}
            fitView
            fitViewOptions={{ padding: 0.18 }}
          >
            <Background />
            <Controls />
            <MiniMap />
            {/* Legend so users immediately know that red = default route. */}
            <div className="absolute bottom-3 left-3 z-10 bg-white/95 backdrop-blur border border-gray-200 rounded-lg px-3 py-2 shadow text-[11px] space-y-1">
              <div className="flex items-center gap-2"><span className="inline-block w-6 h-0.5" style={{ backgroundColor: '#dc2626' }} /> <span className="font-semibold text-red-700">Default route (0.0.0.0/0)</span></div>
              <div className="flex items-center gap-2"><span className="inline-block w-6 h-0.5" style={{ backgroundColor: '#2563eb', borderTop: '1px dashed #2563eb' }} /> VNet peering</div>
              <div className="flex items-center gap-2"><span className="inline-block w-6 h-0.5" style={{ backgroundColor: '#f59e0b' }} /> Route table (UDR)</div>
              <div className="flex items-center gap-2"><span className="inline-block w-6 h-0.5" style={{ backgroundColor: '#be185d' }} /> Security / association</div>
              <div className="flex items-center gap-2"><span className="inline-block w-6 h-0.5" style={{ backgroundColor: '#059669' }} /> Private Link / connection</div>
              <div className="flex items-center gap-2"><span className="inline-block w-6 h-0.5" style={{ backgroundColor: '#94a3b8' }} /> VNet → Subnet</div>
            </div>
          </ReactFlow>
        </div>
      </div>
      {selectedResource && selectedNodeId && visibleNodeIds.has(selectedNodeId) && (
        <ResourcePanel
          resource={selectedResource}
          onClose={() => {
            setSelectedResource(null)
            setSelectedNodeId(null)
          }}
        />
      )}
      {routingOpen && routingReport && (
        <RoutingFindingsPanel
          report={routingReport}
          aiLoading={routingAiLoading}
          highlightNodeIds={highlightNodeIds}
          onFocusFinding={focusFinding}
          onAskAi={() => analyzeRouting(true)}
          onClose={() => {
            setRoutingOpen(false)
            setHighlightNodeIds([])
          }}
        />
      )}
      {versionOpen && (
        <VersionHistoryPanel
          subscriptionIds={selectedSubIds}
          hasTopology={nodes.length > 0}
          onClose={() => setVersionOpen(false)}
        />
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
