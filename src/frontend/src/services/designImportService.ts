import apiClient from './apiClient'
import axios from 'axios'

export type DesignImportDocumentType = 'image' | 'pdf' | 'drawio'

export interface DesignImportImage {
  dataUrl: string
  pageNumber: number
}

export interface DesignImportHint {
  id: string
  label: string
  style?: string
  kind: 'shape' | 'edge'
  x: number
  y: number
  width: number
  height: number
  parentId?: string
  sourceId?: string
  targetId?: string
}

export interface DesignImportRequest {
  fileName: string
  documentType: DesignImportDocumentType
  textContent?: string
  images: DesignImportImage[]
  diagramHints: DesignImportHint[]
}

export interface DesignImportNode {
  id: string
  blockType: string
  label: string
  x: number
  y: number
  parentId?: string | null
  confidence: number
  evidence: string
}

export interface DesignImportEdge {
  id: string
  source: string
  target: string
  relationship: string
  confidence: number
  evidence: string
}

export interface DesignImportProposal {
  summary: string
  sourceFileName: string
  model: string
  nodes: DesignImportNode[]
  edges: DesignImportEdge[]
  warnings: string[]
}

export const designImportService = {
  analyze: async (request: DesignImportRequest): Promise<DesignImportProposal> => {
    try {
      const { data } = await apiClient.post<DesignImportProposal>('/designer/import/analyze', request)
      return data
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const details = error.response?.data as { detail?: string; title?: string } | undefined
        throw new Error(details?.detail ?? details?.title ?? error.message)
      }
      throw error
    }
  },
}