import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { bestPracticeService, type DesignFinding } from '@/services/bestPracticeService'
import { generateBicep } from './bicepGenerator'
import BicepModal from './BicepModal'
import DesignImportDialog from './DesignImportDialog'
import type { DesignBlock } from '@/types/designer'
import type { DesignImportProposal } from '@/services/designImportService'
import {
  applyDesignImport,
  type DesignImportApplyMode,
} from '@/utils/designImportApply'
import { materializeDesignEdges, type DesignEdgeData } from '@/utils/designEdges'
import {
  applyDesignIpSuggestions,
  suggestMissingDesignIpRanges,
  type DesignIpSuggestion,
} from '@/utils/designIpSuggestions'
import IpRangeSuggestionDialog from './IpRangeSuggestionDialog'
import { consumeDiscoveryDesignHandoff } from '@/utils/discoveryDesignHandoff'
import { analyzeDesignDelta } from '@/utils/designDelta'
import DesignerAssistantPanel from './DesignerAssistantPanel'
import { applyDesignerAssistantActions } from './designerAssistantActions'
import type { DesignerAssistantAction } from '@/services/designerAssistantService'

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
  const [edges, setEdges, onEdgesChange] = useEdgesState<DesignEdgeData>([])
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [findings, setFindings] = useState<ValidationFinding[] | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiUsed, setAiUsed] = useState(false)
  const [aiModel, setAiModel] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState<Set<string>>(new Set())
  const [toast, setToast] = useState<{ kind: 'error' | 'info'; msg: string } | null>(null)
  const [bicepCode, setBicepCode] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [ipSuggestions, setIpSuggestions] = useState<DesignIpSuggestion[] | null>(null)
  const reactFlowWrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition, getIntersectingNodes, fitView } = useReactFlow()

  const designEdges = useMemo(() => materializeDesignEdges(nodes, edges), [nodes, edges])
  const designDelta = useMemo(() => analyzeDesignDelta(nodes, designEdges), [nodes, designEdges])
  const selectedNode = selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) : null
  const selectedEdge = selectedEdgeId ? designEdges.find((e) => e.id === selectedEdgeId) : null
  const selectedEdgeSrc = selectedEdge ? nodes.find((n) => n.id === selectedEdge.source) : null
  const selectedEdgeTgt = selectedEdge ? nodes.find((n) => n.id === selectedEdge.target) : null
  const discoveredBaselineCount = nodes.filter((node) => node.data.origin?.kind === 'discovered').length

  const showToast = (kind: 'error' | 'info', msg: string) => {
    setToast({ kind, msg })
    window.setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => {
    const handoff = consumeDiscoveryDesignHandoff()
    if (!handoff) return
    setNodes(handoff.nodes)
    setEdges(handoff.edges)
    const handoffEdges = materializeDesignEdges(handoff.nodes, handoff.edges)
    setFindings(validateDesign(handoff.nodes, handoffEdges).map((finding) => ({
      ...finding,
      source: 'rule' as const,
      requiresAcknowledgement: finding.requiresAcknowledgement ?? finding.severity !== 'info',
    })))
    setAcknowledged(new Set())
    window.requestAnimationFrame(() => void fitView({ padding: 0.12, duration: 300 }))
    const skipped = handoff.skippedResources.length > 0
      ? ` ${handoff.skippedResources.length} unsupported resource(s) were skipped.`
      : ''
    showToast('info', `Opened ${handoff.nodes.length} discovered resource(s) as the deployment baseline.${skipped}`)
  }, [fitView, setEdges, setNodes])

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
        ...(parentId ? { parentId, parentNode: parentId, extent } : {}),
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

  // When an existing node is dragged and released, re-evaluate parent-child containment
  const onNodeDragStop = useCallback(
    (_event: React.MouseEvent, node: Node<DesignBlock>) => {
      const blockType = node.data.blockType
      // Only re-parent non-container resource nodes (containers like VNet don't get parented)
      // and also containers that can be children (Subnet inside VNet)
      const intersecting = getIntersectingNodes(node)
      const candidates = intersecting.filter((n) => {
        const t = (n.data as DesignBlock | undefined)?.blockType
        return t && n.id !== node.id && isContainer(t) && canContain(t, blockType)
      })
      const newParent = candidates.length > 0 ? candidates[candidates.length - 1] : null

      const currentParentId = node.parentId ?? (node as unknown as { parentNode?: string }).parentNode

      if (newParent && newParent.id !== currentParentId) {
        // Reparent: adjust position to be relative to new parent
        const pAbs = newParent.positionAbsolute ?? newParent.position
        const nodeAbs = node.positionAbsolute ?? node.position
        const relPos = { x: nodeAbs.x - pAbs.x, y: nodeAbs.y - pAbs.y }
        setNodes((nds) =>
          nds.map((n) =>
            n.id === node.id
              ? { ...n, position: relPos, parentId: newParent.id, parentNode: newParent.id, extent: 'parent' as const }
              : n,
          ),
        )
      } else if (!newParent && currentParentId) {
        // Dragged out of parent — remove parentId, use absolute position
        const absPos = node.positionAbsolute ?? node.position
        setNodes((nds) =>
          nds.map((n) =>
            n.id === node.id
              ? { ...n, position: absPos, parentId: undefined, parentNode: undefined, extent: undefined }
              : n,
          ),
        )
      }
    },
    [getIntersectingNodes, setNodes],
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
      setAcknowledged(new Set())
      setAiUsed(false)
      setAiModel(null)
      setAiError(null)
      setIpSuggestions(null)
    }
  }

  /** Convert a server DesignFinding into the UI ValidationFinding shape. */
  const mapServerFinding = (f: DesignFinding): ValidationFinding => ({
    severity: f.severity,
    ruleId: f.ruleId,
    message: f.message,
    nodeId: f.nodeId ?? undefined,
    reference: f.reference ?? undefined,
    source: f.source,
    requiresAcknowledgement: f.requiresAcknowledgement,
  })

  /** Local, fast, deterministic validation. */
  const runValidation = () => {
    const local = validateDesign(nodes, designEdges).map((f) => ({
      ...f,
      source: 'rule' as const,
      requiresAcknowledgement: f.requiresAcknowledgement ?? f.severity !== 'info',
    }))
    setFindings(local)
    setAiUsed(false)
    setAiModel(null)
    setAiError(null)
    const suggestions = suggestMissingDesignIpRanges(nodes)
    setIpSuggestions(suggestions.length > 0 ? suggestions : null)
  }

  /**
   * AI-augmented validation. Calls the backend `/api/bestpractice/validate-design`
   * which combines deterministic rules with an Azure OpenAI review. Findings can come
   * from either source; AI findings are constrained to cite Microsoft Learn URLs.
   */
  const runAiValidation = async () => {
    if (nodes.length === 0) {
      showToast('error', 'Add at least one block before validating.')
      return
    }
    setAiBusy(true)
    setAiError(null)
    try {
      const local = validateDesign(nodes, designEdges).map((finding) => ({
        ...finding,
        source: 'rule' as const,
        requiresAcknowledgement: finding.requiresAcknowledgement ?? finding.severity !== 'info',
      }))
      const report = await bestPracticeService.validateDesign(nodes, designEdges, true)
      const server = report.findings.map(mapServerFinding)
      const merged = [...local, ...server].filter((finding, index, all) =>
        all.findIndex((candidate) =>
          candidate.ruleId === finding.ruleId &&
          candidate.nodeId === finding.nodeId &&
          candidate.message === finding.message) === index)
      setFindings(merged)
      setAiUsed(report.aiUsed)
      setAiModel(report.aiModel ?? null)
      const suggestions = suggestMissingDesignIpRanges(nodes)
      setIpSuggestions(suggestions.length > 0 ? suggestions : null)
      if (!report.aiUsed) {
        showToast('info', 'Azure OpenAI not configured on the server — showing rule-based findings only.')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'AI validation failed.'
      setAiError(msg)
      showToast('error', msg)
    } finally {
      setAiBusy(false)
    }
  }

  const toggleAck = (key: string) => {
    setAcknowledged((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleGenerateBicep = () => {
    if (nodes.length === 0) {
      showToast('error', 'Add at least one block before generating Bicep.')
      return
    }
    if (designDelta.hasBaseline) {
      const latestFindings = validateDesign(nodes, designEdges).map((finding) => ({
        ...finding,
        source: 'rule' as const,
        requiresAcknowledgement: finding.requiresAcknowledgement ?? finding.severity !== 'info',
      }))
      setFindings(latestFindings)
      if (designDelta.newNodes.length === 0) {
        showToast('error', 'Add at least one new resource before generating an additions-only deployment.')
        return
      }
      const newNodeIds = new Set(designDelta.newNodes.map((node) => node.id))
      const errors = latestFindings.filter((finding) => finding.severity === 'error' &&
        (finding.ruleId.startsWith('Delta.') || !!finding.nodeId && newNodeIds.has(finding.nodeId))).length
      if (errors > 0) {
        showToast('error', `Resolve ${errors} validation error${errors === 1 ? '' : 's'} before generating additions-only Bicep.`)
        return
      }
    }
    const code = generateBicep(nodes, designEdges)
    setBicepCode(code)
  }

  const handleApplyImport = (
    proposal: DesignImportProposal,
    selectedNodeIds: ReadonlySet<string>,
    mode: DesignImportApplyMode,
  ) => {
    const result = applyDesignImport(proposal, selectedNodeIds, nodes, edges, mode)
    const importedDesignEdges = materializeDesignEdges(result.nodes, result.edges)
    setNodes(result.nodes)
    setEdges(result.edges)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setFindings(validateDesign(result.nodes, importedDesignEdges).map((finding) => ({
      ...finding,
      source: 'rule' as const,
      requiresAcknowledgement: finding.requiresAcknowledgement ?? finding.severity !== 'info',
    })))
    setAcknowledged(new Set())
    setImportOpen(false)
    const suggestions = suggestMissingDesignIpRanges(result.nodes)
    setIpSuggestions(suggestions.length > 0 ? suggestions : null)
    window.requestAnimationFrame(() => void fitView({ padding: 0.15, duration: 300 }))
    const warningSuffix = result.warnings.length > 0
      ? ` ${result.warnings.length} unsupported relationship(s) were skipped.`
      : ''
    showToast('info', `Imported ${selectedNodeIds.size} resource(s).${warningSuffix}`)
  }

  const applySuggestedIpRanges = () => {
    if (!ipSuggestions) return
    const updatedNodes = applyDesignIpSuggestions(nodes, ipSuggestions)
    const updatedEdges = materializeDesignEdges(updatedNodes, edges)
    setNodes(updatedNodes)
    setIpSuggestions(null)
    setFindings(validateDesign(updatedNodes, updatedEdges).map((finding) => ({
      ...finding,
      source: 'rule' as const,
      requiresAcknowledgement: finding.requiresAcknowledgement ?? finding.severity !== 'info',
    })))
    setAcknowledged(new Set())
    setAiUsed(false)
    setAiModel(null)
    showToast('info', `Added ${ipSuggestions.length} example IP range${ipSuggestions.length === 1 ? '' : 's'} for review.`)
  }

  const applyAssistantPlan = (actions: DesignerAssistantAction[]) => {
    const result = applyDesignerAssistantActions(nodes, edges, actions)
    if (result.appliedActions === 0) {
      showToast('error', result.warnings[0] ?? 'No supported changes could be applied.')
      return { appliedActions: 0, warnings: result.warnings }
    }
    const updatedDesignEdges = materializeDesignEdges(result.nodes, result.edges)
    setNodes(result.nodes)
    setEdges(result.edges)
    setSelectedNodeId(null)
    setSelectedEdgeId(null)
    setFindings(validateDesign(result.nodes, updatedDesignEdges).map((finding) => ({
      ...finding,
      source: 'rule' as const,
      requiresAcknowledgement: finding.requiresAcknowledgement ?? finding.severity !== 'info',
    })))
    setAcknowledged(new Set())
    setAiUsed(false)
    setAiModel(null)
    const suggestions = suggestMissingDesignIpRanges(result.nodes)
    setIpSuggestions(suggestions.length > 0 ? suggestions : null)
    window.requestAnimationFrame(() => void fitView({ padding: 0.15, duration: 300 }))
    const warningSuffix = result.warnings.length > 0
      ? ` ${result.warnings.length} unsupported change${result.warnings.length === 1 ? ' was' : 's were'} skipped.`
      : ''
    showToast('info', `Applied ${result.appliedActions} reviewed design change${result.appliedActions === 1 ? '' : 's'}.${warningSuffix}`)
    return { appliedActions: result.appliedActions, warnings: result.warnings }
  }

  /** Stable key for a finding's acknowledgement state. */
  const ackKey = (f: ValidationFinding, idx: number) =>
    `${f.ruleId}::${f.nodeId ?? 'global'}::${idx}`

  /**
   * Compute deployment-readiness. Deployment is blocked when any error remains, or any
   * warning that the engine flagged as requiring acknowledgement has NOT yet been
   * acknowledged by the user.
   */
  const deployGate = useMemo(() => {
    if (!findings) return { blocked: false, errors: 0, pendingAck: 0 }
    const newNodeIds = new Set(designDelta.newNodes.map((node) => node.id))
    const affectsDeployment = (finding: ValidationFinding) => !designDelta.hasBaseline ||
      finding.ruleId.startsWith('Delta.') || !!finding.nodeId && newNodeIds.has(finding.nodeId)
    const errors = findings.filter((f) => f.severity === 'error' && affectsDeployment(f)).length
    let pendingAck = 0
    findings.forEach((f, i) => {
      if (affectsDeployment(f) && f.requiresAcknowledgement && !acknowledged.has(ackKey(f, i))) {
        pendingAck += 1
      }
    })
    return { blocked: errors > 0 || pendingAck > 0, errors, pendingAck }
  }, [findings, acknowledged, designDelta])

  return (
    <div className="flex h-full gap-3 relative">
      <BlockLibrary />

      <div className="flex-1 flex flex-col min-w-0">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div>
            <h1 className="text-lg font-bold text-gray-900 leading-tight">Design / Validate</h1>
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
            {discoveredBaselineCount > 0 && (
              <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-1 rounded-full">
                {discoveredBaselineCount} existing baseline
              </span>
            )}

            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-1.5 text-xs text-azure-700 hover:text-azure-900 bg-azure-50 hover:bg-azure-100 px-3 py-1.5 rounded-lg border border-azure-200 transition-all"
              title="Import an architecture image, PDF, or draw.io file"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" />
              </svg>
              Import design
            </button>

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

            <button
              onClick={runAiValidation}
              disabled={aiBusy || nodes.length === 0}
              title="Run an AI best-practice review backed by Microsoft Learn citations."
              className="flex items-center gap-1.5 text-xs text-violet-700 hover:text-violet-900 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 px-3 py-1.5 rounded-lg border border-violet-200 transition-all"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              {aiBusy ? 'AI reviewing…' : 'AI Validate'}
            </button>

            <button
              onClick={handleGenerateBicep}
              disabled={deployGate.blocked}
              title={
                deployGate.blocked
                  ? `Resolve ${deployGate.errors} error(s) and acknowledge ${deployGate.pendingAck} non-best-practice item(s) before generating Bicep.`
                  : 'Generate Bicep IaC for this design.'
              }
              className="flex items-center gap-1.5 text-xs font-semibold text-white bg-azure-500 hover:bg-azure-600 disabled:bg-gray-300 disabled:cursor-not-allowed px-3 py-1.5 rounded-lg transition-colors shadow-sm"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              {designDelta.hasBaseline ? 'Generate additions Bicep' : 'Generate Bicep'}
              {deployGate.blocked && (
                <span className="ml-1 text-[10px] bg-white/20 rounded px-1">
                  {deployGate.errors > 0 ? `${deployGate.errors} err` : `${deployGate.pendingAck} ack`}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div ref={reactFlowWrapper}
          className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden relative">
          <ReactFlow
            nodes={nodes}
            edges={designEdges}
            nodeTypes={nodeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, node) => { setSelectedNodeId(node.id); setSelectedEdgeId(null) }}
            onEdgeClick={(_, edge) => {
              const edgeData = edge.data as DesignEdgeData | undefined
              if (edgeData?.generatedContainment || edgeData?.origin === 'discovered') return
              setSelectedEdgeId(edge.id)
              setSelectedNodeId(null)
            }}
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

          <DesignerAssistantPanel nodes={nodes} edges={edges} onApply={applyAssistantPlan} />

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
                {aiUsed && (
                  <span className="text-[10px] uppercase tracking-wide font-semibold bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded">
                    AI {aiModel ? `· ${aiModel}` : ''}
                  </span>
                )}
                {deployGate.pendingAck > 0 && (
                  <span className="text-[10px] uppercase tracking-wide font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                    {deployGate.pendingAck} pending ack
                  </span>
                )}
              </div>
              <button onClick={() => setFindings(null)}
                className="text-gray-400 hover:text-gray-700 text-xs">
                Dismiss
              </button>
            </div>
            {aiError && (
              <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">
                {aiError}
              </div>
            )}
            {findings.length === 0 ? (
              <div className="px-4 py-6 text-center">
                <p className="text-sm font-semibold text-emerald-600">
                  No issues — design follows Microsoft best practices.
                </p>
              </div>
            ) : (
              <ul className="max-h-72 overflow-y-auto divide-y divide-gray-100">
                {findings.map((f, i) => {
                  const key = ackKey(f, i)
                  const isAcked = acknowledged.has(key)
                  return (
                    <li
                      key={key}
                      className="px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50"
                    >
                      <span
                        className={`mt-0.5 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full flex-shrink-0 ${
                          f.severity === 'error'
                            ? 'bg-red-100 text-red-700'
                            : f.severity === 'warning'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {f.severity}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-xs text-gray-700 cursor-pointer"
                          onClick={() => f.nodeId && setSelectedNodeId(f.nodeId)}
                        >
                          {f.message}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <code className="text-[10px] text-gray-400">{f.ruleId}</code>
                          {f.source && (
                            <span
                              className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${
                                f.source === 'ai'
                                  ? 'bg-violet-50 text-violet-700 border border-violet-200'
                                  : 'bg-gray-100 text-gray-600 border border-gray-200'
                              }`}
                            >
                              {f.source}
                            </span>
                          )}
                          {f.reference && (
                            <a
                              href={f.reference}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[10px] text-azure-500 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Microsoft Learn ↗
                            </a>
                          )}
                          {f.requiresAcknowledgement && (
                            <label
                              className={`inline-flex items-center gap-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded cursor-pointer border ${
                                isAcked
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border-amber-200'
                              }`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <input
                                type="checkbox"
                                checked={isAcked}
                                onChange={() => toggleAck(key)}
                                className="h-3 w-3 cursor-pointer"
                              />
                              I acknowledge this is not Microsoft best practice
                            </label>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      {selectedNode && selectedNode.data.origin?.kind !== 'discovered' && (
        <PropertyEditor
          nodeId={selectedNode.id}
          block={selectedNode.data as DesignBlock}
          onChange={updateNode}
          onClose={() => setSelectedNodeId(null)}
        />
      )}

      {selectedNode?.data.origin?.kind === 'discovered' && (
        <aside className="w-80 shrink-0 overflow-hidden rounded-xl border border-blue-200 bg-white shadow-sm">
          <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-900">{selectedNode.data.label}</p>
                <p className="text-xs font-medium text-blue-700">Existing discovered baseline</p>
              </div>
              <button type="button" onClick={() => setSelectedNodeId(null)} className="text-gray-400 hover:text-gray-700" aria-label="Close baseline details">×</button>
            </div>
          </div>
          <div className="space-y-3 px-4 py-4 text-xs">
            <div>
              <p className="font-semibold text-gray-500">Azure resource ID</p>
              <code className="mt-1 block break-all rounded bg-slate-50 p-2 text-[10px] text-slate-700">{selectedNode.data.origin.resourceId}</code>
            </div>
            <p className="text-gray-600">This baseline resource is referenced by additions-only Bicep and will not be redeployed or edited.</p>
          </div>
        </aside>
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

      {bicepCode && (
        <BicepModal
          bicep={bicepCode}
          additionsOnly={designDelta.hasBaseline}
          createdResources={designDelta.newNodes.length}
          existingReferences={designDelta.existingNodes.length}
          requiredDeploymentScope={designDelta.requiredDeploymentScopes[0]}
          onClose={() => setBicepCode(null)}
        />
      )}

      {importOpen && (
        <DesignImportDialog
          existingNodeCount={nodes.length}
          onApply={handleApplyImport}
          onClose={() => setImportOpen(false)}
        />
      )}

      {ipSuggestions && (
        <IpRangeSuggestionDialog
          suggestions={ipSuggestions}
          noRangesConfigured={nodes.every((node) => {
            if (node.data.blockType === 'VNet')
              return !Array.isArray(node.data.properties.addressSpace) || node.data.properties.addressSpace.length === 0
            if (node.data.blockType === 'Subnet' || node.data.blockType === 'Virtual Hub')
              return !node.data.properties.addressPrefix
            return true
          })}
          onApply={applySuggestedIpRanges}
          onClose={() => setIpSuggestions(null)}
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
