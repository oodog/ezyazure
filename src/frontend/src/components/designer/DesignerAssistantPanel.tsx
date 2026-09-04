import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Edge, Node } from 'reactflow'
import {
  designerAssistantService,
  type DesignerAssistantAction,
  type DesignerAssistantResponse,
  type DesignerAssistantTurn,
} from '@/services/designerAssistantService'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from '@/utils/designEdges'

interface DesignerAssistantPanelProps {
  nodes: Node<DesignBlock>[]
  edges: Edge<DesignEdgeData>[]
  onApply: (actions: DesignerAssistantAction[]) => { appliedActions: number; warnings: string[] }
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  response?: DesignerAssistantResponse
  applied?: boolean
  applyWarnings?: string[]
}

export default function DesignerAssistantPanel({ nodes, edges, onApply }: DesignerAssistantPanelProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => abortRef.current?.abort(), [])
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const request = draft.trim()
    if (!request || loading) return
    const history: DesignerAssistantTurn[] = messages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    }))
    setMessages((current) => [...current, { role: 'user', content: request }])
    setDraft('')
    setError(null)
    setLoading(true)
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    try {
      const response = await designerAssistantService.plan(request, history, nodes, edges, controller.signal)
      setMessages((current) => [...current, {
        role: 'assistant',
        content: response.requiresClarification
          ? response.clarification || response.summary
          : response.summary,
        response,
      }])
    } catch (assistantError: unknown) {
      if (!controller.signal.aborted)
        setError(assistantError instanceof Error ? assistantError.message : 'The Designer assistant could not create a plan.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  const applyPlan = (messageIndex: number, response: DesignerAssistantResponse) => {
    const result = onApply(response.actions)
    setMessages((current) => current.map((message, index) => index === messageIndex
      ? { ...message, applied: result.appliedActions > 0, applyWarnings: result.warnings }
      : message))
  }

  return (
    <div className="absolute right-3 top-3 z-40 flex flex-col items-end">
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-9 px-3 rounded-md bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold shadow-md flex items-center gap-2"
          aria-label="Open AI design assistant"
          title="Describe resources and connections to add"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
            <path strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5m-7 6l-3 1 1-4a8 8 0 1114.5-5A8 8 0 016 20z" />
          </svg>
          AI design
        </button>
      )}

      {open && (
        <section className="w-[min(24rem,calc(100vw-3rem))] overflow-hidden rounded-md border border-gray-200 bg-white shadow-xl" aria-label="AI design assistant">
          <header className="flex h-11 items-center justify-between border-b border-gray-200 bg-slate-800 px-3 text-white">
            <div>
              <p className="text-xs font-semibold">AI design</p>
              <p className="text-[10px] text-slate-300">Review every proposed canvas change</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="h-7 w-7 text-lg text-slate-300 hover:text-white" aria-label="Close AI design assistant">×</button>
          </header>

          <div ref={scrollRef} className="max-h-[22rem] min-h-36 overflow-y-auto bg-gray-50 p-2.5 space-y-2" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2 text-[11px] leading-4 text-gray-600">
                <p>Describe what to add or connect. The assistant creates a plan for review before changing the canvas.</p>
                <button type="button" onClick={() => setDraft('Add a subnet named Data with 10.20.4.0/24, a storage account, and a blob private endpoint in that subnet.')}
                  className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-left hover:border-teal-300">
                  Add a subnet, storage account, and private endpoint
                </button>
                <button type="button" onClick={() => setDraft('Route all subnet traffic through the firewall at 10.0.0.4.')}
                  className="w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-left hover:border-teal-300">
                  Route subnet traffic through a firewall
                </button>
              </div>
            )}
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`rounded px-2.5 py-2 text-[11px] leading-4 ${
                message.role === 'user'
                  ? 'ml-7 border border-teal-100 bg-teal-50 text-gray-800'
                  : 'mr-2 border border-gray-200 bg-white text-gray-700'
              }`}>
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                {message.response && !message.response.requiresClarification && (
                  <div className="mt-2 space-y-2">
                    {message.response.actions.length > 0 ? (
                      <ol className="space-y-1">
                        {message.response.actions.map((action, actionIndex) => (
                          <li key={`${action.kind}-${actionIndex}`} className="rounded bg-slate-50 px-2 py-1 text-slate-700">
                            <span className="font-semibold">{actionIndex + 1}. {actionTitle(action)}</span>
                            <span className="block text-[10px] text-slate-500">{action.explanation}</span>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="text-amber-700">No supported canvas changes were proposed.</p>
                    )}
                    {[...new Set([...message.response.warnings, ...(message.applyWarnings ?? [])])].map((warning) => (
                      <p key={warning} className="text-amber-700">{warning}</p>
                    ))}
                    {message.response.actions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => applyPlan(index, message.response!)}
                        disabled={message.applied}
                        className="h-7 w-full rounded bg-teal-700 text-[11px] font-semibold text-white hover:bg-teal-800 disabled:bg-emerald-600"
                      >
                        {message.applied ? 'Applied to canvas' : `Apply ${message.response.actions.length} proposed change${message.response.actions.length === 1 ? '' : 's'}`}
                      </button>
                    )}
                    {!message.response.aiUsed && (
                      <p className="text-amber-700">AI planning is currently unavailable; no changes were applied.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && <p className="text-[11px] text-gray-500">Building a reviewable design plan...</p>}
            {error && <p className="text-[11px] text-red-600" role="alert">{error}</p>}
          </div>

          <form onSubmit={submit} className="border-t border-gray-200 bg-white p-2.5">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 2_000))}
              maxLength={2_000}
              rows={3}
              placeholder="Add a subnet, connect private access, route via firewall..."
              aria-label="Describe the Azure design changes"
              className="w-full resize-none rounded border-gray-300 text-xs leading-4 focus:border-teal-500 focus:ring-teal-500"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] tabular-nums text-gray-400">{draft.length}/2000</span>
              <button type="submit" disabled={!draft.trim() || loading}
                className="h-7 px-3 rounded bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-[11px] font-semibold">
                Create plan
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  )
}

function actionTitle(action: DesignerAssistantAction): string {
  if (action.kind === 'addNode') return `Add ${action.label || action.blockType || 'resource'}`
  if (action.kind === 'updateNode') return `Update ${action.label || action.nodeRef || 'resource'}`
  return `Connect ${action.sourceRef || 'source'} to ${action.targetRef || 'target'}`
}