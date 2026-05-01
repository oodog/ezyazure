export interface DesignBlock {
  label: string
  blockType: string
  properties: Record<string, unknown>
}

export interface DesignEnvironment {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  nodes: DesignNode[]
  edges: DesignEdge[]
}

export interface DesignNode {
  id: string
  blockType: string
  label: string
  position: { x: number; y: number }
  properties: Record<string, unknown>
}

export interface DesignEdge {
  id: string
  source: string
  target: string
  relationship: string
}
