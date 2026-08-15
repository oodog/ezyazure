import { useMemo, useRef, useState } from 'react'
import {
  designImportService,
  type DesignImportProposal,
} from '@/services/designImportService'
import { prepareDesignImport } from '@/utils/designImportDocument'
import type { DesignImportApplyMode } from '@/utils/designImportApply'

interface DesignImportDialogProps {
  existingNodeCount: number
  onApply: (
    proposal: DesignImportProposal,
    selectedNodeIds: ReadonlySet<string>,
    mode: DesignImportApplyMode,
  ) => void
  onClose: () => void
}

export default function DesignImportDialog({
  existingNodeCount,
  onApply,
  onClose,
}: DesignImportDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [proposal, setProposal] = useState<DesignImportProposal | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set())
  const [mode, setMode] = useState<DesignImportApplyMode>('merge')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState<string | null>(null)

  const selectedEdges = useMemo(() => {
    if (!proposal) return 0
    return proposal.edges.filter(
      (edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
    ).length
  }, [proposal, selectedNodeIds])

  const nodeNames = useMemo(
    () => new Map(proposal?.nodes.map((node) => [node.id, node.label]) ?? []),
    [proposal],
  )

  const analyze = async (file: File) => {
    setBusy(true)
    setError(null)
    setProposal(null)
    setFileName(file.name)
    try {
      setStatus('Preparing document…')
      const request = await prepareDesignImport(file)
      setStatus('Analyzing architecture…')
      const result = await designImportService.analyze(request)
      setProposal(result)
      setSelectedNodeIds(new Set(result.nodes.map((node) => node.id)))
      setMode(existingNodeCount > 0 ? 'merge' : 'replace')
      setStatus('')
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Document analysis failed.')
      setStatus('')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const toggleNode = (id: string) => {
    setSelectedNodeIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-950/50 flex items-center justify-center p-4">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="design-import-title"
        className="w-full max-w-5xl max-h-[90vh] bg-white border border-gray-200 rounded-lg shadow-xl flex flex-col overflow-hidden"
      >
        <header className="px-5 py-4 border-b border-gray-200 flex items-start justify-between gap-4">
          <div>
            <h2 id="design-import-title" className="text-base font-semibold text-gray-900">
              Import architecture
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              AI proposal · review required before canvas changes
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="text-gray-400 hover:text-gray-700 disabled:opacity-40"
            title="Close"
            aria-label="Close import dialog"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto p-5">
          {!proposal && (
            <div className="space-y-4">
              <input
                ref={inputRef}
                type="file"
                accept=".drawio,.xml,.pdf,image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) void analyze(file)
                }}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() => inputRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.dataTransfer.dropEffect = 'copy'
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  const file = event.dataTransfer.files?.[0]
                  if (file && !busy) void analyze(file)
                }}
                className="w-full min-h-52 border-2 border-dashed border-gray-300 hover:border-azure-400 disabled:opacity-50 rounded-lg bg-gray-50 hover:bg-azure-50/30 flex flex-col items-center justify-center px-6 text-center transition-colors"
              >
                <svg className="w-9 h-9 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                  <path strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0L7 9m5-5l5 5M5 20h14" />
                </svg>
                <span className="mt-3 text-sm font-semibold text-gray-800">
                  {busy ? status : 'Choose or drop a design document'}
                </span>
                <span className="mt-1 text-xs text-gray-500">
                  PNG, JPEG, WebP, PDF, draw.io or XML · maximum 15 MB
                </span>
                {fileName && busy && (
                  <span className="mt-2 text-xs font-mono text-gray-400">{fileName}</span>
                )}
              </button>
              {error && (
                <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
                  {error}
                </div>
              )}
              <p className="text-[11px] text-gray-500">
                Documents are processed in memory. PDF analysis is limited to the first eight pages.
              </p>
            </div>
          )}

          {proposal && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-4 border-b border-gray-100 pb-4">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{proposal.sourceFileName}</p>
                  <p className="mt-1 text-sm text-gray-600">{proposal.summary}</p>
                  <p className="mt-1 text-[11px] text-gray-400">Model: {proposal.model}</p>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">
                    {selectedNodeIds.size}/{proposal.nodes.length} resources
                  </span>
                  <span className="px-2 py-1 rounded bg-gray-100 text-gray-700">
                    {selectedEdges}/{proposal.edges.length} relationships
                  </span>
                </div>
              </div>

              {proposal.warnings.length > 0 && (
                <div className="px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-md">
                  <p className="text-xs font-semibold text-amber-900">Review notes</p>
                  <ul className="mt-1 list-disc pl-4 space-y-1">
                    {proposal.warnings.map((warning) => (
                      <li key={warning} className="text-xs text-amber-800">{warning}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Proposed resources
                  </h3>
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setSelectedNodeIds(new Set(proposal.nodes.map((node) => node.id)))}
                      className="text-azure-600 hover:underline"
                    >
                      Select all
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedNodeIds(new Set())}
                      className="text-gray-500 hover:underline"
                    >
                      Clear
                    </button>
                  </div>
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
                  {proposal.nodes.map((node) => (
                    <li key={node.id}>
                      <label className="flex items-start gap-2.5 p-3 border border-gray-200 rounded-md hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedNodeIds.has(node.id)}
                          onChange={() => toggleNode(node.id)}
                          className="mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium text-gray-900">{node.label}</span>
                            <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                              node.confidence >= 0.8
                                ? 'bg-emerald-100 text-emerald-700'
                                : node.confidence >= 0.6
                                  ? 'bg-amber-100 text-amber-700'
                                  : 'bg-red-100 text-red-700'
                            }`}>
                              {Math.round(node.confidence * 100)}%
                            </span>
                          </span>
                          <span className="block text-xs text-azure-700">{node.blockType}</span>
                          {node.evidence && (
                            <span className="block mt-1 text-[11px] leading-4 text-gray-500">{node.evidence}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>

              {proposal.edges.length > 0 && (
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    Proposed relationships
                  </h3>
                  <ul className="max-h-40 overflow-y-auto divide-y divide-gray-100 border border-gray-200 rounded-md">
                    {proposal.edges.map((edge) => {
                      const included = selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
                      return (
                        <li
                          key={edge.id}
                          className={`px-3 py-2 text-xs ${included ? 'text-gray-700' : 'text-gray-400 bg-gray-50'}`}
                        >
                          <span className="font-medium">{nodeNames.get(edge.source) ?? edge.source}</span>
                          <span className="mx-2 text-gray-400">→</span>
                          <span className="font-medium">{nodeNames.get(edge.target) ?? edge.target}</span>
                          <span className="ml-2 text-gray-500">{edge.relationship}</span>
                          <span className="float-right tabular-nums text-gray-400">
                            {Math.round(edge.confidence * 100)}%
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {proposal && (
          <footer className="px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-4">
            <fieldset className="flex items-center gap-4 text-xs">
              <legend className="sr-only">Import behavior</legend>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
                Merge with canvas
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
                Replace canvas
              </label>
            </fieldset>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setProposal(null)
                  setSelectedNodeIds(new Set())
                  setError(null)
                  setFileName(null)
                }}
                className="px-3 py-1.5 text-xs border border-gray-300 rounded-md bg-white hover:bg-gray-50"
              >
                Choose another
              </button>
              <button
                type="button"
                disabled={selectedNodeIds.size === 0}
                onClick={() => onApply(proposal, selectedNodeIds, mode)}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-azure-500 hover:bg-azure-600 disabled:opacity-50 rounded-md"
              >
                Apply {selectedNodeIds.size} resources
              </button>
            </div>
          </footer>
        )}
      </section>
    </div>
  )
}