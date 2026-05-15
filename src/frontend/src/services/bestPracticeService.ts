import apiClient from './apiClient'
import type { BestPracticeReport } from '@/types/azure'
import type { Edge, Node } from 'reactflow'

export interface DesignFinding {
  severity: 'error' | 'warning' | 'info'
  ruleId: string
  message: string
  nodeId?: string | null
  /** Microsoft Learn URL only. */
  reference?: string | null
  /** "rule" | "ai". */
  source: 'rule' | 'ai'
  /** When true, the UI must require explicit acknowledgement before deploying. */
  requiresAcknowledgement: boolean
}

export interface DesignValidationReport {
  findings: DesignFinding[]
  aiUsed: boolean
  aiModel?: string | null
  runAt: string
}

export interface DesignValidationNodeDto {
  id: string
  blockType: string
  label: string
  parentId?: string | null
  properties: Record<string, unknown>
}

export interface DesignValidationEdgeDto {
  id: string
  source: string
  target: string
  relationship?: string | null
  properties: Record<string, unknown>
}

export interface DesignValidationRequest {
  nodes: DesignValidationNodeDto[]
  edges: DesignValidationEdgeDto[]
  useAi: boolean
}

export const bestPracticeService = {
  runReview: async (subscriptionId?: string): Promise<BestPracticeReport> => {
    const params = subscriptionId ? { subscriptionId } : {}
    const { data } = await apiClient.get<BestPracticeReport>('/bestpractice/review', { params })
    return data
  },

  /**
   * Server-side validation of a designer canvas. Combines deterministic rules with an
   * optional Azure OpenAI review when configured on the backend. Every finding cites a
   * Microsoft Learn URL — the backend strictly enforces this.
   */
  validateDesign: async (
    nodes: Node[],
    edges: Edge[],
    useAi: boolean,
  ): Promise<DesignValidationReport> => {
    const payload: DesignValidationRequest = {
      useAi,
      nodes: nodes.map((n) => ({
        id: n.id,
        blockType: (n.data?.blockType as string) ?? (n.data?.type as string) ?? n.type ?? 'Unknown',
        label: (n.data?.label as string) ?? n.id,
        parentId: n.parentNode ?? null,
        properties: (n.data?.properties as Record<string, unknown>) ?? {},
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        relationship: (e.data?.relationship as string) ?? (e.label as string) ?? null,
        properties: (e.data?.properties as Record<string, unknown>) ?? {},
      })),
    }
    const { data } = await apiClient.post<DesignValidationReport>(
      '/bestpractice/validate-design',
      payload,
    )
    return data
  },
}
