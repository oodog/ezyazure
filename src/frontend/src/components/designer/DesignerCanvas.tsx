import { useCallback, useRef, useState } from 'react'
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  useReactFlow,
  ReactFlowProvider,
  MarkerType,
  type Connection,
  type Edge,
  type Node,
} from 'reactflow'
import 'reactflow/dist/style.css'
import BlockLibrary from './BlockLibrary'
import PropertyEditor from './PropertyEditor'
import EdgePropertyEditor from './EdgePropertyEditor'
import AzureResourceNode from './AzureResourceNode'
import AzureContainerNode from './AzureContainerNode'
import { getBlockMeta, categoryStyles } from './blockMetadata'
import { validateDesign, type ValidationFinding } from './validation'
import { canConnect, canContain, isContainer, containerSize } from './relationships'
import type { DesignBlock } from '@/types/designer'

interface EdgeData {
  relationship?: string
  properties?: Record<string, unknown>
}

const nodeTypes = {
  azureResource: AzureResourceNode,
  azureContainer: AzureContainerNode,
}

const defaultEdgeOptions = {
  style: { strokeWidth: 2, stroke: '#94a3b8' },
  markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
  animated: false,
  labelStyle: { fontSize: 10, fontWeight: 600, fill: '#475569' },
  labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
  labelBgPadding: [4, 2] as [number, number],
  labelBgBorderRadius: 4,
}

function CanvasInner() {
  const [nodes, setNodes, onNodesChange] = useNodesState<DesignBlock>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<EdgeData>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [findings, setFindings] = useState<ValidationFinding[] | null>(null)
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, getIntersectingNodes } = useReactFlow()

  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null
  const selectedEdge = selectedEdgeId ? edges.find((e) => e.id === selectedEdgeId) : null
  const selectedEdgeSrc = selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) : null
  const selectedEdgeTgt = selectedEdge ? nodes.find((n) => n.id === selectedEdge.target) : null

  const showToast = (kind: 'error' | 'info', msg: string) => {
    setToast({ kind, msg })
    window.setTimeout(() => setToast(null), 4000)
  }

  // Block invalid connections
  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      const src = nodes.find((n) => n.id === conn.source)
      const tgt = nodes.find((n) => n.id === conn.target)
      if (!src || !tgt) return false
      if (src.id === tgt.id) return false
      const srcType = (src.data as DesignBlock).blockType
      const tgtType = (tgt.data as DesignBlock).blockType
      const result = canConnect(srcType, tgtType)
      return result.allowed
    },
    [nodes],
  )

  const onConnect = useCallback(
    (params: Connection) => {
      const src = nodes.find((n) => n.id === params.source)
      const tgt = nodes.find((n) => n.id === params.target)
      if (!src || !tgt) return
      const srcType = (src.data as DesignBlock).blockType
      const tgtType = (tgt.data as DesignBlock).blockType
      const result = canConnect(srcType, tgtType)
      if (!result.allowed) {
        showToast('error', result.reason ?? 'Connection not allowed')
        return
      }
      const newEdgeId = `e-${params.source}-${params.target}-${Date.now()}`
      setEdges((eds) =>
        addEdge(
          {
            ...params,
            id: newEdgeId,
            ...defaultEdgeOptions,
            label: result.label,
            data: { relationship: result.label, properties: {} },
          },
          eds,
        ),
      )
      setSelectedEdgeId(newEdgeId)
      setSelectedNodeId(null)
    },
    [nodes, setEdges],
  )

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const blockType = event.dataTransfer.getData('application/easyazure-block')
      if (!blockType) return

      const dropPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY })
      const id = `${blockType.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`
      const isCont = isContainer(blockType)
      const size = containerSize(blockType)

      // Find a container under the drop point that can hold this block type
      const intersecting = getIntersectingNodes(
        { x: dropPosition.x, y: dropPosition.y, width: 1, height: 1 },
        false,
      )
      // Pick the deepest (most-specific) valid container
      const candidates = intersecting.filter((n) => {
        const t = (n.data as DesignBlock | undefined)?.blockType
        return t && isContainer(t) && canContain(t, blockType)
      })
      const parent = candidates.length > 0 ? candidates[candidates.length - 1] : null

      let position = dropPosition
      let parentId: string | undefined
      let extent: 'parent' | undefined

      if (parent) {
        // Position becomes relative to the parent's absolute position.
        // ReactFlow stores parent.position in flow coords; for nested parents we need positionAbsolute.
        const pAbs = parent.positionAbsolute ?? parent.position
        position = { x: dropPosition.x - pAbs.x, y: dropPosition.y - pAbs.y - 30 }
        parentId = parent.id
        extent = 'parent'
      } else {
        // If a container, snap small offset; if non-container dropped on empty canvas — that's fine
        // BUT some block types REQUIRE a parent (e.g. Subnet only inside VNet). Reject those.
        const requiredParents: Record<string, string[]> = {
          Subnet: ['VNet'],
          'Virtual Hub': ['Virtual WAN'],
          'Route Intent': ['Virtual Hub'],
          'Private Endpoint': ['Subnet'],
        }
        if (requiredParents[blockType]) {
          showToast('error',
            `${blockType} must be placed inside a ${requiredParents[blockType].join(' or ')}.`)
          return
        }
      }

      const newNode: Node<DesignBlock> = {
        id,
        type: isCont ? 'azureContainer' : 'azureResource',
        position,
        ...(parentId ? { parentId, extent } : {}),
        ...(isCont ? { style: { width: size.width, height: size.height }, zIndex: -1 } : {}),
        data: {
          label: blockType,
          blockType,
          properties: {},
        },
      }
      setNodes((nds) => [...nds, newNode])
    },
    [screenToFlowPosition, getIntersectingNodes, setNodes],
  )

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }, [])

  const updateEdgeProps = useCallback(
    (edgeId: string, properties: Record<string, unknown>) => {
      setEdges((eds) =>
        eds.map((e) =>
          e.id === edgeId
            ? { ...e, data: { ...(e.data ?? {}), properties } }
            : e,
        ),
      )
    },
    [setEdges],
  )

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId))
      setSelectedEdgeId(null)
    },
    [setEdges],
  )

  const updateNode = useCallback(
    (nodeId: string, patch: { label?: string; properties?: Record<string, unknown> }) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? {
              ...n,
              data: {
                ...n.data,
                ...(patch.label !== undefined ? { label: patch.label } : {}),
                ...(patch.properties !== undefined ? { properties: patch.properties } : {}),
              },
            }
            : n,
        ),
      )
    },
    [setNodes],
  )

  const clearCanvas = () => {
    if (nodes.length === 0) return
    if (confirm('Clear the canvas? This cannot be undone.')) {
      setNodes([])
      setEdges([])
      setSelectedNodeId(null)
      setSelectedEdgeId(null)
      setFindings(null)
    }
  }

  const runValidation = () => {
    setFindings(validateDesign(nodes, edges))
  }

  return (
    <div className="flex h-full gap-3 relative">
      <BlockLibrary />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-tight">Environment Designer</h1>
            <p className="text-xs text-gray-400">
              Drop containers (VNet, Resource Group, …) first, then drop child blocks inside them. Connect blocks to define associations.
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {nodes.length > 0 && (
              <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                {nodes.length} block{nodes.length !== 1 ? 's' : ''}
              </span>
            )}

            <button
              onClick={clearCanvas}
              disabled={nodes.length === 0}
              className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-red-200 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Clear
            </button>

            <button onClick={runValidation}
              className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 bg-white hover:bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200 transition-all">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Validate
            </button>

            <button className="flex items-center gap-1.5 text-xs font-semibold text-white bg-azure-500 hover:bg-azure-600 px-3 py-1.5 rounded-lg transition-colors shadow-sm">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              Generate Bicep
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div ref={reactFlowWrapper}
          className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null) }}
            onEdgeClick={(_, edge) => { setSelectedEdgeId(edge.id); setSelectedNodeId(null) }}
            onPaneClick={() => { setSelectedNodeId(null); setSelectedEdgeId(null) }}
            deleteKeyCode="Delete"
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#e2e8f0" />
            <Controls className="!shadow-md !rounded-xl !border !border-gray-200 !overflow-hidden" showInteractive={false} />
            <MiniMap
              className="!rounded-xl !border !border-gray-200 !shadow-md"
              nodeColor={(node) => {
                const data = node.data as DesignBlock
                const meta = getBlockMeta(data.blockType)
                return categoryStyles[meta.category]?.accent ?? '#94a3b8'
              }}
              maskColor="rgba(241,245,249,0.7)"
            />
          </ReactFlow>

          {/* Empty state overlay */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center max-w-sm">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-gray-400">Drop a container block to start</p>
                <p className="text-xs text-gray-300 mt-1">
                  Start with a Resource Group or VNet, then drop Subnets inside, attach NSG / Route Table by drawing a connection from them to the subnet.
                </p>
              </div>
            </div>
          )}

          {/* Toast */}
          {toast && (
            <div className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium z-50 max-w-md ${
              toast.kind === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-azure-50 text-azure-700 border border-azure-200'
            }`}>
              {toast.msg}
            </div>
          )}
        </div>

        {/* Validation results */}
        {findings && (
          <div className="mt-3 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-sm font-bold text-gray-800">Validation results</p>
                <span className="text-xs text-gray-500">
                  {findings.filter((f) => f.severity === 'error').length} errors,{' '}
                  {findings.filter((f) => f.severity === 'warning').length} warnings,{' '}
                  {findings.filter((f) => f.severity === 'info').length} info
                </span>
              </div>
              <button onClick={() => setFindings(null)}
                className="text-gray-400 hover:text-gray-700 text-xs">
                Dismiss
              </button>
            </div>
            {findings.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm font-semibold text-emerald-600">No issues — design follows Microsoft best practices.</p>
              </div>
            ) : (
              <ul className="max-h-56 overflow-y-auto divide-y divide-gray-100">
                {findings.map((f, i) => (
                  <li key={i} className="px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 cursor-pointer"
                    onClick={() => f.nodeId && setSelectedNodeId(f.nodeId)}>
                    <span className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${
                      f.severity === 'error' ? 'bg-red-100 text-red-700'
                      : f.severity === 'warning' ? 'bg-amber-100 text-amber-700'
                      : 'bg-blue-100 text-blue-700'
                    }`}>{f.severity}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-gray-700">{f.message}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <code className="text-[10px] text-gray-400">{f.ruleId}</code>
                        {f.reference && (
                          <a href={f.reference} target="_blank" rel="noopener noreferrer"
                            className="text-[10px] text-azure-500 hover:underline" onClick={(e) => e.stopPropagation()}>
                            docs ↗
                          </a>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {selectedNode && (
        <PropertyEditor
          nodeId={selectedNode.id}
          block={selectedNode.data as DesignBlock}
          onChange={updateNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {selectedEdge && selectedEdgeSrc && selectedEdgeTgt && (
        <EdgePropertyEditor
          edge={selectedEdge}
          sourceType={(selectedEdgeSrc.data as DesignBlock).blockType}
          targetType={(selectedEdgeTgt.data as DesignBlock).blockType}
          onChange={updateEdgeProps}
          onDelete={deleteEdge}
          onClose={() => setSelectedEdgeId(null)}
        />
      )}
    </div>
  )
}

export default function DesignerCanvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
