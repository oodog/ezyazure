import { useEffect, useRef, useState, type FormEvent } from 'react'
import { discoveryService, type DiscoveryAssistantResponse, type DiscoveryAssistantTurn } from '@/services/discoveryService'
import type { DiscoveryTechnology } from '@/utils/discoveryTechnology'

interface DiscoveryAssistantPanelProps {
  subscriptionIds: string[]
  focusTechnologies: DiscoveryTechnology[]
  focusResourceId?: string
  disabled?: boolean
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  response?: DiscoveryAssistantResponse
}

export default function DiscoveryAssistantPanel({
  subscriptionIds,
  focusTechnologies,
  focusResourceId,
  disabled = false,
}: DiscoveryAssistantPanelProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const contextKey = `${subscriptionIds.slice().sort().join('|')}::${focusTechnologies.slice().sort().join('|')}::${focusResourceId ?? ''}`

  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setMessages([])
    setDraft('')
    setError(null)
    setLoading(false)
    return () => abortRef.current?.abort()
  }, [contextKey])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const question = draft.trim()
    if (!question || loading || disabled) return

    const history: DiscoveryAssistantTurn[] = messages.slice(-6).map((message) => ({
      role: message.role,
      content: message.content,
    }))
    setMessages((current) => [...current, { role: 'user', content: question }])
    setDraft('')
    setError(null)
    setLoading(true)
    const controller = new AbortController()
    abortRef.current?.abort()
    abortRef.current = controller
    try {
      const response = await discoveryService.askAssistant({
        subscriptionIds,
        message: question,
        history,
        focusTechnologies,
        focusResourceId,
      }, { signal: controller.signal })
      setMessages((current) => [...current, {
        role: 'assistant',
        content: response.answer,
        response,
      }])
    } catch (assistantError: unknown) {
      if (!controller.signal.aborted)
        setError(assistantError instanceof Error ? assistantError.message : 'The assistant could not answer.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={disabled}
        aria-expanded={open}
        className="w-full h-9 px-3 rounded-md bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-between"
      >
        <span>AI support</span>
        <span aria-hidden="true" className="text-base leading-none">{open ? '−' : '+'}</span>
      </button>

      {open && (
        <div className="mt-2 border border-gray-200 rounded-md bg-gray-50 overflow-hidden">
          <div className="max-h-56 overflow-y-auto px-2.5 py-2 space-y-2" aria-live="polite">
            {messages.length === 0 && (
              <p className="text-[11px] leading-4 text-gray-500">
                Ask about the current topology or a selected resource.
              </p>
            )}
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`text-[11px] leading-4 rounded px-2 py-1.5 ${
                  message.role === 'user'
                    ? 'ml-4 bg-teal-50 border border-teal-100 text-gray-800'
                    : 'mr-1 bg-white border border-gray-200 text-gray-700'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.content}</p>
                {message.response && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1">
                      {message.response.skills.map((skill) => (
                        <span key={skill} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-700">
                          {skill}
                        </span>
                      ))}
                      <span className="px-1.5 py-0.5 rounded bg-blue-50 text-[10px] font-medium text-blue-700">
                        {message.response.confidence} confidence
                      </span>
                      {message.response.skillBundleVersion && (
                        <span
                          className="px-1.5 py-0.5 text-[10px] text-gray-500"
                          title="Approved product skill bundle version"
                        >
                          skills v{message.response.skillBundleVersion}
                        </span>
                      )}
                    </div>
                    {message.response.suggestedChecks.length > 0 && (
                      <ul className="list-disc pl-4 space-y-0.5">
                        {message.response.suggestedChecks.map((check) => <li key={check}>{check}</li>)}
                      </ul>
                    )}
                    {message.response.citations.length > 0 && (
                      <div className="flex flex-col items-start gap-1">
                        {message.response.citations.map((citation) => (
                          <a
                            key={citation.url}
                            href={citation.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-azure-600 hover:underline break-all"
                          >
                            {citation.title}
                          </a>
                        ))}
                      </div>
                    )}
                    {!message.response.aiUsed && (
                      <p className="text-amber-700">AI was unavailable; deterministic findings are shown.</p>
                    )}
                  </div>
                )}
              </div>
            ))}
            {loading && <p className="text-[11px] text-gray-500">Reviewing discovered evidence…</p>}
            {error && <p className="text-[11px] text-red-600" role="alert">{error}</p>}
          </div>
          <form onSubmit={submit} className="p-2 border-t border-gray-200 bg-white">
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value.slice(0, 2_000))}
              maxLength={2_000}
              rows={2}
              placeholder="Describe the issue"
              aria-label="Describe the Azure issue"
              className="w-full resize-none rounded border-gray-300 text-xs leading-4 focus:border-teal-500 focus:ring-teal-500"
            />
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="text-[10px] tabular-nums text-gray-400">{draft.length}/2000</span>
              <button
                type="submit"
                disabled={!draft.trim() || loading || disabled}
                className="h-7 px-3 rounded bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-[11px] font-semibold"
              >
                Send
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}