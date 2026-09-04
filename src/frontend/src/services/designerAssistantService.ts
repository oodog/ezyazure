import type { Edge, Node } from 'reactflow'
import type { DesignBlock } from '@/types/designer'
import type { DesignEdgeData } from '@/utils/designEdges'
import apiClient from './apiClient'

export interface DesignerAssistantTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface DesignerAssistantAction {
  kind: 'addNode' | 'updateNode' | 'connect'
  nodeRef?: string | null
  sourceRef?: string | null
  targetRef?: string | null
  blockType?: string | null
  label?: string | null
  parentRef?: string | null
  properties: Record<string, string>
  explanation: string
}

export interface DesignerAssistantResponse {
  summary: string
  actions: DesignerAssistantAction[]
  warnings: string[]
  requiresClarification: boolean
  clarification?: string | null
  aiUsed: boolean
  aiModel?: string | null
}

export const designerAssistantService = {
  plan: async (
    message: string,
    history: DesignerAssistantTurn[],
    nodes: Node<DesignBlock>[],
    edges: Edge<DesignEdgeData>[],
    signal?: AbortSignal,
  ): Promise<DesignerAssistantResponse> => {
    const { data } = await apiClient.post<DesignerAssistantResponse>(
      '/designer/assistant/chat',
      {
        message,
        history,
        nodes: nodes.map((node) => ({
          id: node.id,
          blockType: node.data.blockType,
          label: node.data.label,
          parentId: node.parentId ?? node.parentNode ?? null,
          readOnly: node.data.origin?.kind === 'discovered',
          properties: node.data.properties,
        })),
        edges: edges.map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          relationship: edge.data?.relationship ?? String(edge.label ?? ''),
        })),
      },
      { signal },
    )
    return data
  },
}